"""MagiskInstallerService — instala o Magisk em um TV Box de forma automatizada.

Navega a UI do app Magisk via `uiautomator dump` + `input tap` (ADB), sem
interação humana além de aceitar o prompt de autorização do Magisk no box
(primeira vez que o su é solicitado após o reboot).

Fluxo:
  1. adb install do APK (se não instalado na versão esperada)
  2. abre o app (MainActivity)
  3. navega: permite permissão de armazenamento → "Instalar" →
     "Instalação direta (recomendada)" → aguarda flash
  4. reboot do box
  5. aguarda boot + verifica `magisk -v`

Uso pelo painel: POST /api/devices/{id}/magisk/install (roda em background).
Uso standalone: scripts/magisk_install.py <ip> — mesma lógica.
"""

import asyncio
import logging
import re
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger("magisk")

# Caminho padrão do APK no servidor (copiado pelo install.ps1 ou manual)
DEFAULT_APK = Path(__file__).resolve().parent.parent.parent / "bin" / "Magisk.apk"

# Tempos
DUMP_RETRY_S = 3
TAP_WAIT_S = 2
FLASH_TIMEOUT_S = 120
BOOT_TIMEOUT_S = 180


class MagiskInstaller:
    """Orquestra a instalação do Magisk em um device via ADB."""

    def __init__(self, adb_manager=None, apk_path: Optional[Path] = None, send_event=None):
        self.adb = adb_manager
        self.apk_path = Path(apk_path) if apk_path else DEFAULT_APK
        self._send_event = send_event

    async def _event(self, device_id: str, step: str, message: str):
        logger.info("[magisk][%s] %s: %s", device_id, step, message)
        if self._send_event:
            try:
                await self._send_event({
                    "type": "magisk",
                    "device_id": device_id,
                    "step": step,
                    "message": message,
                    "timestamp": __import__("datetime").datetime.now().isoformat(),
                })
            except Exception:
                pass

    async def _shell(self, ip: str, port: int, cmd: str, timeout: int = 20) -> str:
        out, code = await self.adb.shell(ip, cmd, port=port, timeout=timeout)
        return out or ""

    async def _dump_ui(self, ip: str, port: int) -> str:
        """Dump da UI atual via uiautomator → XML em string."""
        try:
            await self._shell(ip, port, "uiautomator dump /data/local/tmp/panel_ui.xml", timeout=20)
            out = await self._shell(ip, port, "cat /data/local/tmp/panel_ui.xml", timeout=20)
            return out or ""
        except Exception as e:
            logger.debug("dump_ui falhou: %s", e)
            return ""

    @staticmethod
    def _find_button(xml: str, *labels: str) -> Optional[tuple[int, int]]:
        """Acha o centro do primeiro botão cujo text casa com algum label."""
        for label in labels:
            esc = re.escape(label)
            m = re.search(
                rf'text="[^"]*{esc}[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
                xml,
            )
            if m:
                x1, y1, x2, y2 = map(int, m.groups())
                return ((x1 + x2) // 2, (y1 + y2) // 2)
        return None

    @staticmethod
    def _has_text(xml: str, *labels: str) -> bool:
        return any(re.search(re.escape(l), xml) for l in labels)

    async def _tap(self, ip: str, port: int, x: int, y: int):
        await self._shell(ip, port, f"input tap {x} {y}", timeout=15)

    async def install(self, device, reboot: bool = True) -> dict:
        """Executa o fluxo completo. device: DeviceConfig com ip/adb_port."""
        ip, port = device.ip, device.adb_port
        steps = []
        errors = []

        if not self.apk_path.is_file():
            return {"success": False, "error": f"APK não encontrado em {self.apk_path}"}

        # ── 1. Instala o APK ─────────────────────────────────────────
        await self._event(device.id, "apk_install", "Instalando APK do Magisk...")
        try:
            # uso adb direto via shell do manager? install não é shell; usa _run
            installed = await self._install_apk(ip, port)
            steps.append("apk_install")
            if not installed:
                errors.append("adb install falhou (ver log)")
        except Exception as e:
            errors.append(f"apk_install: {e}")

        # ── 2. Abre o app e navega ───────────────────────────────────
        await self._event(device.id, "open_app", "Abrindo app Magisk...")
        await self._shell(ip, port, "am start -n com.topjohnwu.magisk/.ui.MainActivity", timeout=15)
        await asyncio.sleep(4)
        steps.append("open_app")

        # Já está instalado? (home do app mostra "Instalado: 30.7 ...")
        xml = await self._dump_ui(ip, port)
        if self._has_text(xml, "Instalado") and not self._has_text(xml, "Não disponível"):
            await self._event(device.id, "already", "Magisk já instalado no boot — pulando navegação")
            steps.append("already_installed")
            if not reboot:
                return {"success": True, "steps": steps, "errors": errors}
        else:
            nav_ok = await self._navigate_to_direct(ip, port)
            if not nav_ok:
                errors.append("navegação até 'Instalação direta' falhou")
            else:
                steps.append("navigate")
                # ── 3. Confirma a instalação direta ──────────────────
                await self._event(device.id, "flash", "Instalando no boot image (aguarde)...")
                flash_ok = await self._wait_flash_done(ip, port)
                if flash_ok:
                    steps.append("flash_done")
                else:
                    # Pode ter concluído mesmo sem dump legível (uiautomator
                    # falha em algumas ROMs após flash). Confere o daemon.
                    out = await self._shell(ip, port, "magisk -v", timeout=10)
                    if "MAGISK" in out.upper():
                        flash_ok = True
                        steps.append("flash_done_implicit")
                    else:
                        errors.append(f"flash não confirmou em {FLASH_TIMEOUT_S}s (magisk -v: {out.strip() or '(vazio)'})")

        # ── 4. Reboot (necessário para ativar o Magisk) ─────────────
        if reboot and not errors:
            await self._event(device.id, "reboot", "Reiniciando o box para ativar o Magisk...")
            try:
                await self.adb.reboot(ip, port=port)
                steps.append("reboot")
                await self._wait_boot(ip, port)
                steps.append("boot_done")
            except Exception as e:
                errors.append(f"reboot: {e}")

        # ── 5. Verifica ─────────────────────────────────────────────
        magisk_ver = ""
        if not errors:
            try:
                out = await self._shell(ip, port, "magisk -v", timeout=15)
                magisk_ver = out.strip()
                if "MAGISK" in magisk_ver.upper():
                    steps.append("verified")
                else:
                    errors.append(f"magisk -v inesperado: {magisk_ver or '(vazio)'}")
            except Exception as e:
                errors.append(f"verify: {e}")

        return {"success": not errors, "steps": steps, "errors": errors, "magisk": magisk_ver}

    async def _install_apk(self, ip: str, port: int) -> bool:
        """adb install -r do APK."""
        try:
            out, code = await self.adb._run(
                "-s", f"{ip}:{port}", "install", "-r", str(self.apk_path), timeout=120
            )
            return code == 0
        except Exception as e:
            logger.warning("install apk falhou: %s", e)
            return False

    async def _navigate_to_direct(self, ip: str, port: int) -> bool:
        """Navega: permissão → Instalar → 'Instalação direta (recomendada)'."""
        for _ in range(12):  # até ~36s
            xml = await self._dump_ui(ip, port)
            if not xml:
                await asyncio.sleep(DUMP_RETRY_S)
                continue

            # Permissão de armazenamento
            btn = self._find_button(xml, "Permitir")
            if btn and self._has_text(xml, "acesse fotos", "fotos, mídia"):
                await self._tap(ip, port, *btn)
                await asyncio.sleep(TAP_WAIT_S)
                continue

            # Tela de método: seleciona "Instalação direta (recomendada)"
            btn = self._find_button(xml, "Instalação direta", "instalação direta")
            if btn and self._has_text(xml, "Método", "Selecione"):
                await self._tap(ip, port, *btn)
                await asyncio.sleep(TAP_WAIT_S)
                # Depois de selecionar, confirma com "Instalar" no rodapé
                xml2 = await self._dump_ui(ip, port)
                btn2 = self._find_button(xml2, "Instalar")
                if btn2:
                    await self._tap(ip, port, *btn2)
                    return True
                return True  # pode ter iniciado direto

            # Já está na tela de flash / progresso
            if self._has_text(xml, "Flashando", "Instalando", "Target image"):
                return True

            # Home com "Instalar" (primeiro botão)
            btn = self._find_button(xml, "Instalar")
            if btn and self._has_text(xml, "Não disponível"):
                await self._tap(ip, port, *btn)
                await asyncio.sleep(TAP_WAIT_S)
                continue

            await asyncio.sleep(DUMP_RETRY_S)
        return False

    async def _wait_flash_done(self, ip: str, port: int) -> bool:
        """Espera a instalação terminar (app volta p/ home com versão ou fecha)."""
        deadline = asyncio.get_event_loop().time() + FLASH_TIMEOUT_S
        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(5)
            xml = await self._dump_ui(ip, port)
            if self._has_text(xml, "Instalado") and not self._has_text(xml, "Não disponível"):
                return True
            # Flashando → continua esperando
            if self._has_text(xml, "Flashando", "Instalando", "Target image"):
                continue
        return False

    async def _wait_boot(self, ip: str, port: int) -> bool:
        """Espera o box voltar com sys.boot_completed=1."""
        deadline = asyncio.get_event_loop().time() + BOOT_TIMEOUT_S
        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(10)
            try:
                out = await self._shell(ip, port, "getprop sys.boot_completed", timeout=8)
                if out.strip() == "1":
                    return True
            except Exception:
                pass
        return False
