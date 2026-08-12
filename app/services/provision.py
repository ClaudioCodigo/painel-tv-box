"""ProvisionService — instala scripts Android nos TV Boxes."""

import logging
import os
from pathlib import Path
from typing import Optional

from app.models.device import DeviceConfig

logger = logging.getLogger("provision")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR = PROJECT_ROOT / "scripts" / "android"
REMOTE_DIR = "/data/local/tmp/panel"

# Scripts que devem ser enviados para o TV Box
MANIFEST = [
    "start_stream.sh",
    "stop_stream.sh",
    "restart_wifi.sh",
    "restart_eth.sh",
    "capture.sh",
    "healthcheck.sh",
    "install_apk.sh",
    "update.sh",
    "netwatch.sh",
    "heartbeat.sh",  # batida HTTP device→servidor (docs/09)
    "boot_hook.sh",  # religa heartbeat/netwatch no boot (só instala com root)
]

HEARTBEAT_INTERVAL = 20  # s entre batidas


class ProvisionService:
    """Gerencia instalação e atualização de scripts nos TV Boxes."""

    def __init__(self, adb_manager=None):
        self.adb = adb_manager

    async def provision(self, device: DeviceConfig) -> dict:
        """Faz push de todos os scripts para o dispositivo.
        Cria diretório remoto, envia scripts, chmod +x.
        """
        if not self.adb:
            return {"success": False, "error": "ADBManager não configurado"}

        ip = device.ip
        port = device.adb_port
        results = []
        errors = []

        # 1. Cria diretório remoto
        output, code = await self.adb.shell(
            ip, f"mkdir -p {REMOTE_DIR}", port=port, timeout=10
        )
        if code != 0 and "File exists" not in output:
            errors.append(f"mkdir falhou: {output.strip()}")

        # 2. Push de cada script
        for script_name in MANIFEST:
            local_path = SCRIPTS_DIR / script_name
            if not local_path.is_file():
                errors.append(f"script não encontrado: {script_name}")
                continue

            remote_path = f"{REMOTE_DIR}/{script_name}"
            try:
                success = await self.adb.push(ip, str(local_path), remote_path, port=port)
                if success:
                    results.append(script_name)
                else:
                    errors.append(f"push falhou: {script_name}")
            except Exception as e:
                errors.append(f"{script_name}: {e}")

        # 3. chmod +x em todos
        output, code = await self.adb.shell(
            ip, f"chmod +x {REMOTE_DIR}/*.sh", port=port, timeout=10
        )
        if code != 0:
            errors.append(f"chmod falhou: {output.strip()}")

        # 3b. Heartbeat: gera heartbeat.conf + instala e inicia no device
        try:
            hb = self._heartbeat_conf(device)
            if hb:
                import tempfile

                conf_remote = f"{REMOTE_DIR}/heartbeat.conf"
                # adb push espera um CAMINHO local; modo binário p/ não traduzir
                # \n → \r\n (Windows), o que quebraria o sleep/URL no device.
                with tempfile.NamedTemporaryFile(suffix=".conf", delete=False) as tmp:
                    tmp.write(hb.encode("utf-8"))
                    tmp_path = tmp.name
                try:
                    pushed = await self.adb.push(ip, tmp_path, conf_remote, port=port)
                    if pushed:
                        # conf já está no device — basta iniciar (start lê o heartbeat.conf)
                        await self.adb.shell(
                            ip, f"sh {REMOTE_DIR}/heartbeat.sh start", port=port, timeout=15
                        )
                        await self.adb.shell(
                            ip, f"sh {REMOTE_DIR}/netwatch.sh start", port=port, timeout=15
                        )
                        results.append("heartbeat.conf")
                    else:
                        errors.append("push heartbeat.conf falhou")
                finally:
                    os.unlink(tmp_path)
        except Exception as e:
            errors.append(f"heartbeat: {e}")

        # 3c. Boot hook (item 4 do HANDOFF): religa heartbeat+netwatch no boot
        #     do box, sem depender do painel. Prefere Magisk (service.d — não
        #     mexe em /system); fallback: /system/bin/install-recovery.sh (o
        #     init.rc executa no boot, class main/oneshot) — mas só se o
        #     firmware permitir remount (system-as-root/dm-verity bloqueia).
        if getattr(device, "root", False):
            try:
                # Detecta Magisk e instala em /data/adb/service.d/
                # Usa /sbin/su (do Magisk) quando existir — boxes com SuperSU
                # antigo (daemonsu em /system/xbin) têm um su conflitante que
                # nega as solicitações. O /sbin/su do Magisk sempre responde.
                out_m, code_m = await self.adb.shell(
                    ip, "if [ -x /sbin/su ]; then /sbin/su -c 'magisk -v'; else su -c 'magisk -v'; fi",
                    port=port, timeout=15,
                )
                if code_m == 0 and "MAGISK" in out_m.upper():
                    magisk_cmd = (
                        "if [ -x /sbin/su ]; then /sbin/su -c "
                        f"'cp {REMOTE_DIR}/boot_hook.sh "
                        f"/data/adb/service.d/99panel.sh && "
                        f"chmod 755 /data/adb/service.d/99panel.sh'; "
                        "else su -c "
                        f"'cp {REMOTE_DIR}/boot_hook.sh "
                        f"/data/adb/service.d/99panel.sh && "
                        f"chmod 755 /data/adb/service.d/99panel.sh'; fi"
                    )
                    output, code = await self.adb.shell(ip, magisk_cmd, port=port, timeout=15)
                    if code == 0 and "not found" not in output.lower():
                        results.append("boot_hook_magisk")
                    else:
                        errors.append(f"boot hook magisk: {output.strip()}")
                else:
                    # Sem Magisk: tenta install-recovery.sh (não sobrescreve
                    # script real de OTA do firmware).
                    install_cmd = (
                        "if [ -x /sbin/su ]; then /sbin/su -c "
                        f"'mount -o rw,remount /system && "
                        f"if [ ! -f /system/bin/install-recovery.sh ] || "
                        f"grep -q PANEL_DIR /system/bin/install-recovery.sh 2>/dev/null; then "
                        f"cp {REMOTE_DIR}/boot_hook.sh /system/bin/install-recovery.sh && "
                        f"chmod 755 /system/bin/install-recovery.sh; fi && "
                        f"mount -o ro,remount /system'; "
                        "else su -c "
                        f"'mount -o rw,remount /system && "
                        f"if [ ! -f /system/bin/install-recovery.sh ] || "
                        f"grep -q PANEL_DIR /system/bin/install-recovery.sh 2>/dev/null; then "
                        f"cp {REMOTE_DIR}/boot_hook.sh /system/bin/install-recovery.sh && "
                        f"chmod 755 /system/bin/install-recovery.sh; fi && "
                        f"mount -o ro,remount /system'; fi"
                    )
                    output, code = await self.adb.shell(ip, install_cmd, port=port, timeout=20)
                    if code == 0 and "not found" not in output.lower():
                        results.append("boot_hook")
                    else:
                        errors.append(f"boot hook não instalado: {output.strip()}")
            except Exception as e:
                errors.append(f"boot hook: {e}")

        # 4. Verifica
        output, _ = await self.adb.shell(
            ip, f"ls -la {REMOTE_DIR}/", port=port, timeout=10
        )

        logger.info(
            "Provision %s: %d scripts enviados, %d erros",
            device.id, len(results), len(errors)
        )

        return {
            "success": len(errors) == 0,
            "device_id": device.id,
            "scripts_pushed": results,
            "scripts_count": len(results),
            "errors": errors,
            "remote_ls": output.strip(),
        }

    def _heartbeat_conf(self, device: DeviceConfig) -> Optional[str]:
        """Gera conteúdo do heartbeat.conf ou None se config indisponível.
        Usa a heartbeat_key dedicada (não o token do painel).
        """
        try:
            import app.main

            cfg = app.main.config
            if not cfg or not cfg.system:
                return None
            host_ip = cfg.system.host.ip or ""
            port = cfg.system.server.port or 8080
            key = (cfg.system.security.heartbeat_key if cfg.system.security else "") or ""
            if not host_ip or not key:
                return None
            url = f"http://{host_ip}:{port}"
            return (
                f"PANEL_URL={url}\n"
                f"DEVICE_ID={device.id}\n"
                f"KEY={key}\n"
                f"INTERVAL={HEARTBEAT_INTERVAL}\n"
            )
        except Exception:
            return None

    async def verify(self, device: DeviceConfig) -> dict:
        """Verifica quais scripts existem no dispositivo."""
        if not self.adb:
            return {"success": False, "error": "ADBManager não configurado"}

        output, code = await self.adb.shell(
            device.ip, f"ls {REMOTE_DIR}/ 2>/dev/null || echo 'DIR_NOT_FOUND'",
            port=device.adb_port, timeout=10
        )

        if "DIR_NOT_FOUND" in output or not output.strip():
            return {"provisioned": False, "files": []}

        files = [f.strip() for f in output.strip().split("\n") if f.strip().endswith(".sh")]
        all_present = all(s in files for s in MANIFEST)

        return {
            "provisioned": all_present,
            "files": files,
            "missing": [s for s in MANIFEST if s not in files],
        }
