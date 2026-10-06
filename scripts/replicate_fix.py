"""Script utilitário para replicação do fix de Ethernet e ADB Inseguro nos TV Boxes.

Uso:
  # Para dispositivos específicos:
  .venv\\Scripts\\python.exe scripts/replicate_fix.py 192.168.254.85 192.168.254.96

  # Para todos os dispositivos já conectados no adb devices:
  .venv\\Scripts\\python.exe scripts/replicate_fix.py --attached

  # Para escanear uma faixa de IPs procurando ADB na porta 5555:
  .venv\\Scripts\\python.exe scripts/replicate_fix.py --scan 192.168.254.50-100

Opções adicionais:
  --reboot    Envia reboot após aplicar a correção para validar se a rede sobe sozinha.
"""

import asyncio
import os
import re
import socket
import sys
from pathlib import Path

# Adiciona raiz do projeto ao path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app.managers.adb import ADBManager  # noqa: E402
from app.models.device import DeviceConfig  # noqa: E402
from app.services.provision import ProvisionService  # noqa: E402


async def check_port_open(ip: str, port: int = 5555, timeout: float = 0.6) -> bool:
    """Verifica se a porta está aberta via TCP."""
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=timeout
        )
        writer.close()
        await writer.wait_closed()
        return True
    except Exception:
        return False


async def scan_subnet(base_ip_range: str, port: int = 5555) -> list[str]:
    """Escaneia faixa de IPs (ex: 192.168.254.50-100 ou 192.168.254.0/24)."""
    ips_to_test = []
    if "-" in base_ip_range:
        prefix, end_str = base_ip_range.split("-")
        parts = prefix.split(".")
        start = int(parts[-1])
        end = int(end_str)
        base = ".".join(parts[:-1])
        for i in range(start, end + 1):
            ips_to_test.append(f"{base}.{i}")
    else:
        # Padrão ou único
        ips_to_test.append(base_ip_range)

    print(f"[*] Escaneando {len(ips_to_test)} endereços na porta {port}...")
    found = []

    sem = asyncio.Semaphore(40)

    async def _test(ip):
        async with sem:
            if await check_port_open(ip, port):
                found.append(ip)
                print(f"  [+] Aberto: {ip}:{port}")

    await asyncio.gather(*[_test(ip) for ip in ips_to_test])
    return sorted(found, key=lambda x: [int(p) for p in x.split(".")])


async def get_attached_ips(adb: ADBManager) -> list[str]:
    """Retorna IPs de dispositivos já conectados no ADB."""
    out, code = await adb._run("devices")
    ips = []
    for line in out.splitlines():
        parts = line.strip().split()
        if len(parts) >= 2 and parts[1] == "device":
            serial = parts[0]
            if ":" in serial:
                ips.append(serial.split(":")[0])
    return ips


async def apply_fix_to_device(adb: ADBManager, ip: str, port: int = 5555, do_reboot: bool = False) -> bool:
    """Aplica o provisionamento completo (fix eth, Magisk service.d, bypass RSA) no TV Box."""
    print(f"\n=======================================================")
    print(f"[*] Processando TV Box: {ip}:{port}")
    print(f"=======================================================")

    # 1. Conecta ADB
    connected = await adb.connect(ip, port=port)
    if not connected:
        print(f"[-] Erro ao conectar ADB em {ip}:{port} (timeout ou recusado).")
        return False

    # 2. Testa root
    out, code = await adb.shell(ip, "if [ -x /sbin/su ]; then /sbin/su -c id; else su -c id; fi", port=port, timeout=10)
    has_root = (code == 0 and "uid=0" in out)
    if not has_root:
        print(f"[!] AVISO: Dispositivo {ip} respondeu ao ADB, mas não possui root (su).")
        print("    A autocura por unbind/bind exige root para acessar /data/adb/service.d.")
        return False

    dev = DeviceConfig(
        id=f"tvbox-{ip.replace('.', '-')}",
        name=f"TVBox-{ip}",
        ip=ip,
        adb_port=port,
        root=True,
    )

    provisioner = ProvisionService(adb_manager=adb)
    res = await provisioner.provision(dev)

    if res.get("success"):
        print(f"[+] Provisionamento concluído com sucesso!")
        for item in res.get("results", []):
            print(f"    ✓ {item}")

        # Valida service.d
        out_ls, _ = await adb.shell(ip, "if [ -x /sbin/su ]; then /sbin/su -c 'ls -la /data/adb/service.d'; else su -c 'ls -la /data/adb/service.d'; fi", port=port)
        print("\n--- Conteúdo de /data/adb/service.d ---")
        print(out_ls.strip())

        if do_reboot:
            print(f"[*] Enviando reboot para {ip}:{port}...")
            await adb.reboot(ip, port=port)
            print(f"[+] Reboot enviado.")

        return True
    else:
        print(f"[-] Erro no provisionamento: {res.get('errors')}")
        return False


async def main():
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        sys.exit(0)

    adb = ADBManager()
    do_reboot = "--reboot" in argv
    clean_args = [a for a in argv if a != "--reboot"]

    target_ips = []

    if "--attached" in clean_args:
        target_ips = await get_attached_ips(adb)
        if not target_ips:
            print("[-] Nenhum dispositivo conectado em 'adb devices'.")
            sys.exit(1)
    elif "--scan" in clean_args:
        idx = clean_args.index("--scan")
        if idx + 1 < len(clean_args):
            scan_range = clean_args[idx + 1]
            target_ips = await scan_subnet(scan_range)
        else:
            print("[-] Especifique a faixa após --scan (ex: --scan 192.168.254.1-254)")
            sys.exit(1)
    else:
        target_ips = clean_args

    if not target_ips:
        print("[-] Nenhum IP de destino fornecido.")
        sys.exit(1)

    print(f"\n[+] Alvos selecionados ({len(target_ips)}): {', '.join(target_ips)}")

    success_count = 0
    for ip in target_ips:
        ok = await apply_fix_to_device(adb, ip, do_reboot=do_reboot)
        if ok:
            success_count += 1

    print(f"\n=======================================================")
    print(f"[*] Finalizado: {success_count}/{len(target_ips)} dispositivos configurados com sucesso.")
    print(f"=======================================================\n")


if __name__ == "__main__":
    asyncio.run(main())
