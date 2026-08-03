"""ADBManager — abstração total sobre o binário adb."""

import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger("adb")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class ADBManager:
    """Gerencia conexões ADB com TV Boxes via TCP."""

    def __init__(self, binary: str = "adb", connect_timeout: int = 10, server_port: int | None = None):
        self.binary = binary
        self.connect_timeout = connect_timeout
        # Servidor ADB isolado (Ideia 4): painel usa porta própria para não
        # interferir no transporte do scrcpy (default 5037).
        if server_port is None:
            env_port = os.environ.get("PANEL_ADB_SERVER_PORT", "")
            server_port = int(env_port) if env_port.isdigit() else None
        self.server_port = server_port
        self._connected: set[str] = set()
        self._locks: dict[str, asyncio.Lock] = {}
        self._last_connect_attempt: dict[str, float] = {}
        self.metrics = {
            "connect_attempts": 0,
            "connect_success": 0,
            "connect_failures": 0,
            "connect_skipped_cached": 0,
            "shell_calls": 0,
            "timeouts": 0,
            "last_error": "",
        }

    def _lock_for(self, target: str) -> asyncio.Lock:
        lock = self._locks.get(target)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[target] = lock
        return lock

    async def _run(self, *args, timeout: int = 15) -> tuple[str, int]:
        cmd = [self.binary, *args]
        # Se a porta isolada estiver configurada, injeta ADB_SERVER_PORT
        env = None
        if self.server_port:
            env = {**os.environ, "ADB_SERVER_PORT": str(self.server_port)}
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            output = stdout.decode(errors="replace").strip()
            if proc.returncode != 0 and stderr:
                output += "\n" + stderr.decode(errors="replace").strip()
            return output, proc.returncode
        except asyncio.TimeoutError:
            self.metrics["timeouts"] += 1
            self.metrics["last_error"] = f"timeout: {' '.join(cmd)}"
            try:
                proc.kill()
            except Exception:
                pass
            return "timeout", -1
        except FileNotFoundError:
            self.metrics["last_error"] = f"adb binary not found: {self.binary}"
            return "adb binary not found", -2

    async def connect(self, ip: str, port: int = 5555, force: bool = False) -> bool:
        target = f"{ip}:{port}"
        if target in self._connected and not force:
            self.metrics["connect_skipped_cached"] += 1
            return True

        async with self._lock_for(target):
            if target in self._connected and not force:
                self.metrics["connect_skipped_cached"] += 1
                return True

            now = time.monotonic()
            last_attempt = self._last_connect_attempt.get(target, 0)
            if not force and now - last_attempt < 2:
                self.metrics["connect_skipped_cached"] += 1
                return target in self._connected

            self._last_connect_attempt[target] = now
            self.metrics["connect_attempts"] += 1
            output, code = await self._run("connect", target, timeout=self.connect_timeout)
            normalized = output.lower()
            if code == 0 or "connected" in normalized or "already connected" in normalized:
                self._connected.add(target)
                self.metrics["connect_success"] += 1
                logger.info("ADB connected: %s", target)
                return True

            self.metrics["connect_failures"] += 1
            self.metrics["last_error"] = output.strip()
            logger.warning("ADB connect failed: %s -> %s", target, output.strip())
            return False

    async def disconnect(self, ip: str, port: int = 5555):
        target = f"{ip}:{port}"
        await self._run("disconnect", target)
        self._connected.discard(target)

    async def shell(self, ip: str, command: str, port: int = 5555, timeout: int = 15, force: bool = False) -> tuple[str, int]:
        # Nota: `force` é mantido por compatibilidade de assinatura. O antigo
        # cooldown de 2h que retornava ("ok (cooldown)", 0) sem executar nada
        # foi removido — ele fazia health checks declararem device online mesmo
        # offline e streams reportarem sucesso fictício.
        target = f"{ip}:{port}"
        self.metrics["shell_calls"] += 1

        await self.connect(ip, port)
        output, code = await self._run("-s", target, "shell", command, timeout=timeout)
        if code in {-1, -2} or "device offline" in output.lower() or "not found" in output.lower():
            self._connected.discard(target)
            await self.connect(ip, port, force=True)
            output, code = await self._run("-s", target, "shell", command, timeout=timeout)

        return output, code

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
