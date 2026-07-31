"""WatchdogManager — monitoramento e recuperação automática."""

import asyncio
import logging
from datetime import datetime

from app.models.device import DeviceConfig

logger = logging.getLogger("watchdog")


class WatchdogManager:
    """Gerencia watchdog independente por dispositivo."""

    def __init__(self, health_manager=None, recovery_service=None, config=None):
        self.health = health_manager
        self.recovery = recovery_service
        self.cfg = config
        self._tasks: dict[str, asyncio.Task] = {}
        self._running = False
        self._send_event = None

    def set_event_broadcast(self, send_event):
        """Define callback para broadcast de eventos WebSocket."""
        self._send_event = send_event

    def start(self, devices: list[DeviceConfig]):
        """Inicia watchdog para todos os dispositivos."""
        self._running = True
        for device in devices:
            self.add_device(device)
        logger.info("Watchdog iniciado para %d dispositivos", len(devices))

    def stop(self):
        """Para todos os watchdogs."""
        self._running = False
        for device_id, task in self._tasks.items():
            task.cancel()
        self._tasks.clear()
        logger.info("Watchdog parado")

    def add_device(self, device: DeviceConfig):
        """Adiciona monitoramento para um dispositivo."""
        if device.id in self._tasks:
            return
        task = asyncio.create_task(self._watch_loop(device))
        self._tasks[device.id] = task
        logger.debug("Watchdog iniciado para %s", device.id)

    def remove_device(self, device_id: str):
        """Remove monitoramento de um dispositivo."""
        task = self._tasks.pop(device_id, None)
        if task:
            task.cancel()
            logger.debug("Watchdog removido: %s", device_id)

    async def _watch_loop(self, device: DeviceConfig):
        """Loop principal de health check + recovery."""
        interval = self.cfg.check_interval if self.cfg else 10
        health_cache = "unknown"

        while self._running:
            try:
                # Re-read device config do ConfigurationManager (pode ter sido atualizado)
                import app.main

                fresh = app.main.config.get_device(device.id) if app.main.config else None
                if fresh:
                    device = fresh

                # Health check
                result = await self.health.check(device)
                status = result["status"]
                device.state.status = status
                device.state.reason = result.get("reason", "")
                device.state.last_seen = datetime.now()

                # Broadcast health
                if self._send_event and status != health_cache:
                    await self._send_event({
                        "type": "health",
                        "device_id": device.id,
                        "status": status,
                        "reason": device.state.reason,
                        "checks": result,
                        "timestamp": datetime.now().isoformat(),
                    })

                # Log mudança
                if status != health_cache:
                    logger.info("Health %s: %s -> %s", device.id, health_cache, status)
                    health_cache = status

                if status == "offline" and self.recovery:
                    # Cooldown entre recoveries
                    last_recovery = getattr(device.state, "last_recovery_time", None)
                    if last_recovery:
                        since_last = (datetime.now() - last_recovery).total_seconds()
                        min_interval = 120  # mínimo 2 min entre recoveries
                        if since_last < min_interval:
                            await asyncio.sleep(interval)
                            continue

                    rec_result = await self.recovery.recover(device, send_event=self._send_event)
                    device.state.last_recovery_time = datetime.now()

                    if rec_result.get("success"):
                        device.state.status = "online"
                        if self._send_event:
                            await self._send_event({
                                "type": "health",
                                "device_id": device.id,
                                "status": "online",
                                "reason": device.state.reason,
                                "recovery": rec_result,
                                "timestamp": datetime.now().isoformat(),
                            })
                    else:
                        # Alerta crítico
                        if self._send_event:
                            await self._send_event({
                                "type": "alert",
                                "device_id": device.id,
                                "severity": "critical",
                                "message": f"Recuperação falhou após {len(rec_result.get('steps_taken', []))} passos",
                                "timestamp": datetime.now().isoformat(),
                            })

                await asyncio.sleep(interval)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Erro no watchdog de %s: %s", device.id, e, exc_info=True)
                await asyncio.sleep(interval)
