"""RecoveryService — recuperação automática em cascata."""

import asyncio
import logging
from datetime import datetime

from app.models.device import DeviceConfig

logger = logging.getLogger("recovery")


class RecoveryService:
    """Executa fluxo de recuperação em cascata para um dispositivo."""

    def __init__(self, adb_manager=None, player_manager=None, watchdog_config=None):
        self.adb = adb_manager
        self.player = player_manager
        self.cfg = watchdog_config

    async def recover(self, device: DeviceConfig, send_event=None, stream_only: bool = False) -> dict:
        """Tenta recuperar o dispositivo seguindo cascata.

        send_event: callback async para publicar no WebSocket.
        stream_only: True = apenas reabrir o player (degraded, device online);
                     False = cascata completa (offline).
        Retorna dict com resultado.
        """
        if not self.cfg:
            return {"success": False, "error": "watchdog_config ausente", "steps_taken": []}

        recovery_cfg = self.cfg.recovery
        steps_taken = []
        final_status = "failed"

        # Cooldown antes de agir
        cooldown = recovery_cfg.cooldown_seconds
        if cooldown > 0:
            await self._event(send_event, device.id, "cooldown", f"Aguardando {cooldown}s")
            await asyncio.sleep(cooldown)

        # 1. Reabrir Player (ADB-safe: via heartbeat se scrcpy ativo/heartbeat fresco)
        for attempt in range(1, recovery_cfg.player_retry_max + 1):
            await self._event(send_event, device.id, "player_retry", f"Tentativa {attempt}/{recovery_cfg.player_retry_max}")
            steps_taken.append(f"player_retry_{attempt}")

            result = await self._reopen_stream(device)
            if result.get("success"):
                final_status = "recovered"
                method = result.get("method", "player_retry")
                await self._event(send_event, device.id, "recovered", f"Player reaberto (tentativa {attempt}, via {method})")
                return {"success": True, "method": method, "attempt": attempt, "steps_taken": steps_taken}

            await asyncio.sleep(recovery_cfg.player_retry_delay)

        # Se for só reabrir a stream (degraded), para por aqui — sem wifi/reboot
        if stream_only:
            final_status = "critical"
            await self._event(send_event, device.id, "critical", "Não foi possível reabrir o player (degraded)")
            return {"success": False, "method": "exhausted", "steps_taken": steps_taken, "status": final_status}

        # 2. Reiniciar Wi-Fi
        if recovery_cfg.wifi_restart:
            await self._event(send_event, device.id, "wifi_restart", "Reiniciando Wi-Fi...")
            steps_taken.append("wifi_restart")

            await self.adb.shell(device.ip, "nohup sh -c 'svc wifi disable && sleep 5 && svc wifi enable' >/dev/null 2>&1 &", port=device.adb_port)
            await asyncio.sleep(recovery_cfg.wifi_reconnect_timeout)

            # Verifica se recuperou
            if self.player:
                result = await self._reopen_stream(device)
                if result.get("success"):
                    final_status = "recovered"
                    await self._event(send_event, device.id, "recovered", "Wi-Fi reiniciado, player reaberto")
                    return {"success": True, "method": "wifi_restart", "steps_taken": steps_taken}

        # 3. Reiniciar Ethernet
        if recovery_cfg.eth_restart:
            await self._event(send_event, device.id, "eth_restart", "Reiniciando Ethernet...")
            steps_taken.append("eth_restart")

            await self.adb.shell(device.ip, "nohup sh -c 'ip link set eth0 down && sleep 3 && ip link set eth0 up' >/dev/null 2>&1 &", port=device.adb_port)
            await asyncio.sleep(recovery_cfg.eth_reconnect_timeout)

            if self.player:
                result = await self._reopen_stream(device)
                if result.get("success"):
                    final_status = "recovered"
                    await self._event(send_event, device.id, "recovered", "Ethernet reiniciado, player reaberto")
                    return {"success": True, "method": "eth_restart", "steps_taken": steps_taken}

        # 4. Reboot Android
        reboot_count = getattr(device.state, "reboot_count", 0)
        if recovery_cfg.reboot_max > 0 and reboot_count < recovery_cfg.reboot_max:
            await self._event(send_event, device.id, "reboot", f"Reiniciando Android (reboot {reboot_count + 1}/{recovery_cfg.reboot_max})...")
            steps_taken.append("reboot")

            await self.adb.reboot(device.ip, port=device.adb_port)
            await asyncio.sleep(recovery_cfg.reboot_boot_timeout)

            # Tenta reconectar ADB e abrir stream
            connected = await self.adb.connect(device.ip, device.adb_port)
            if connected and self.player:
                result = await self._reopen_stream(device)
                if result.get("success"):
                    device.state.reboot_count = reboot_count + 1
                    final_status = "recovered"
                    await self._event(send_event, device.id, "recovered", f"Reboot {reboot_count + 1} bem-sucedido")
                    return {"success": True, "method": "reboot", "steps_taken": steps_taken}

        # 5. Falhou tudo — alerta crítico
        final_status = "critical"
        await self._event(send_event, device.id, "critical", "Todas as tentativas de recuperação falharam")
        logger.error("Recovery crítico para %s: %d steps", device.id, len(steps_taken))

        return {"success": False, "method": "exhausted", "steps_taken": steps_taken, "status": final_status}

    async def _reopen_stream(self, device: DeviceConfig) -> dict:
        """Reabre o conteúdo (stream ou web) SEM derrubar o scrcpy (regra ADB×scrcpy):

        - scrcpy ativo → enfileira via canal de comandos (o device executa
          localmente; zero ADB painel→device — ADB derrubaria o mirror);
        - senão → ADB direto (síncrono e confiável).
        """
        from datetime import datetime

        from app.managers.scrcpy import ScrcpyManager

        target = f"{device.ip}:{device.adb_port}"

        if ScrcpyManager.is_device_active(target):
            if not self.player:
                return {"success": False, "error": "player config ausente"}
            cmd = self.player.build_start_cmd(device)
            if not cmd:
                return {"success": False, "error": "player não encontrado em players.yml"}
            from app.services import command_queue as cq

            # Evita enfileirar comando duplicado
            if await cq.pending(device.id):
                return {"success": True, "method": "heartbeat_queue", "already_queued": True}
            item = await cq.enqueue(device.id, "start_stream", cmd)
            return {"success": True, "method": "heartbeat_queue", "queued": item["id"]}

        if self.player:
            if getattr(device, "mode", "stream") == "web":
                return await self.player.start_web(device)
            return await self.player.start_stream(device)
        return {"success": False, "error": "player config ausente"}

    async def _event(self, send_event, device_id: str, event_type: str, message: str):
        """Publica evento se callback existir."""
        if send_event:
            try:
                await send_event({
                    "type": "recovery",
                    "device_id": device_id,
                    "event": event_type,
                    "message": message,
                    "timestamp": datetime.now().isoformat(),
                })
            except Exception:
                pass
        logger.info("[%s] %s: %s", device_id, event_type, message)
