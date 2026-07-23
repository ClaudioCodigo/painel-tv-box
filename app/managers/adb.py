"""ADBManager — abstração total sobre o binário adb."""

import asyncio
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("adb")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class ADBManager:
    """Gerencia conexões ADB com TV Boxes via TCP."""

    def __init__(self, binary: str = "adb", connect_timeout: int = 10):
        self.binary = binary
        self.connect_timeout = connect_timeout
        self._connected: set[str] = set()

    async def _run(self, *args, timeout: int = 15) -> tuple[str, int]:
        cmd = [self.binary, *args]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            output = stdout.decode(errors="replace").strip()
            if proc.returncode != 0 and stderr:
                output += "\n" + stderr.decode(errors="replace").strip()
            return output, proc.returncode
        except asyncio.TimeoutError:
            return "timeout", -1
        except FileNotFoundError:
            return "adb binary not found", -2

    async def connect(self, ip: str, port: int = 5555) -> bool:
        target = f"{ip}:{port}"
        output, code = await self._run("connect", target, timeout=self.connect_timeout)
        if code == 0 or "connected" in output.lower() or "already connected" in output.lower():
            self._connected.add(target)
            logger.info("ADB connected: %s", target)
            return True
        logger.warning("ADB connect failed: %s -> %s", target, output.strip())
        return False

    async def disconnect(self, ip: str, port: int = 5555):
        target = f"{ip}:{port}"
        await self._run("disconnect", target)
        self._connected.discard(target)

    async def shell(self, ip: str, command: str, port: int = 5555, timeout: int = 15) -> tuple[str, int]:
        target = f"{ip}:{port}"
        await self.connect(ip, port)
        return await self._run("-s", target, "shell", command, timeout=timeout)

    async def push(self, ip: str, local: str, remote: str, port: int = 5555, timeout: int = 30) -> bool:
        """Faz adb push de um arquivo local para o dispositivo."""
        target = f"{ip}:{port}"
        await self.connect(ip, port)
        output, code = await self._run("-s", target, "push", local, remote, timeout=timeout)
        return code == 0

    async def pull(self, ip: str, remote: str, local: str, port: int = 5555, timeout: int = 30) -> bool:
        """Faz adb pull de um arquivo do dispositivo para o host."""
        target = f"{ip}:{port}"
        await self.connect(ip, port)
        output, code = await self._run("-s", target, "pull", remote, local, timeout=timeout)
        return code == 0

    async def is_reachable(self, ip: str, port: int = 5555) -> dict:
        """Verifica se o dispositivo está alcançável via ADB.
        Retorna dict com ping, adb_connected, root, model, android_version.
        """
        result = {"ping": False, "adb_connected": False, "root": False, "model": "", "android": ""}

        # Tenta conectar
        connected = await self.connect(ip, port)
        if not connected:
            return result

        result["adb_connected"] = True

        # Modelo
        output, code = await self.shell(ip, "getprop ro.product.model", port=port)
        if code == 0 and output:
            result["model"] = output.strip()

        # Versão Android
        output, code = await self.shell(ip, "getprop ro.build.version.release", port=port)
        if code == 0 and output:
            result["android"] = output.strip()

        # Root check
        output, code = await self.shell(ip, "su -c 'echo rootok' 2>/dev/null || echo noroot", port=port)
        if "rootok" in output:
            result["root"] = True

        # IP (para confirmar)
        output, code = await self.shell(ip, "ip addr show wlan0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1 || getprop dhcp.wlan0.ipaddress", port=port)
        if code == 0 and output:
            result["device_ip"] = output.strip().split("\n")[0]

        return result

    async def start_server(self):
        """Garante que o servidor ADB está rodando."""
        await self._run("start-server")

    async def reboot(self, ip: str, port: int = 5555):
        """Reinicia o dispositivo Android."""
        await self.shell(ip, "reboot", port=port, timeout=3)
        self._connected.discard(f"{ip}:{port}")
