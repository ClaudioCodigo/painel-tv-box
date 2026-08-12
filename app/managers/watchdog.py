"""WatchdogManager — monitoramento e recuperação automática."""

import asyncio
import logging
import time
from datetime import datetime

from app.models.device import DeviceConfig

logger = logging.getLogger("watchdog")

# Diretório remoto dos scripts Android (mesmo de app/services/provision.py)
REMOTE_DIR = "/data/local/tmp/panel"
# Scripts que o guardião pode ressuscitar se parados
GUARDIAN_SCRIPTS = ("heartbeat.sh", "netwatch.sh")


class WatchdogManager:
    """Gerencia watchdog independente por dispositivo."""

    def __init__(self, health_manager=None, recovery_service=None, config=None):
        self.health = health_manager
        self.recovery = recovery_service
        self.cfg = config
        self._tasks: dict[str, asyncio.Task] = {}
        self._running = False
        self._send_event = None
        # Guardião: último check por device (timestamp monotônico)
        self._guardian_last: dict[str, float] = {}

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

    @staticmethod
    def _is_stream_issue(reason: str) -> bool:
        r = reason.lower()
        return "stream" in r or "player" in r

    async def _guardian_check(self, device: DeviceConfig):
        """Guardião: ressuscita heartbeat.sh/netwatch.sh se parados no device.

        Respeita a regra ADB×scrcpy (docs/09 §3.3): zero ADB enquanto houver
        sessão scrcpy ativa no device ou heartbeat fresco. Só usa ADB quando o
        heartbeat expirou — sinal de script morto ou box recém-reiniciado.
        """
        g = getattr(self.cfg, "guardian", None) if self.cfg else None
        if not g or not g.enabled:
            return
        adb = getattr(self.health, "adb", None)
        if not adb:
            return

        # Cooldown por device
        now = time.monotonic()
        if now - self._guardian_last.get(device.id, 0) < g.check_interval:
            return
        self._guardian_last[device.id] = now

        # Device offline: recovery já cuida; não fica martelando ADB inalcançável
        if device.state.status == "offline":
            return

        # Regra ADB×scrcpy: se scrcpy ativo → zero ADB no device
        from app.managers.scrcpy import ScrcpyManager

        if ScrcpyManager.is_device_active(f"{device.ip}:{device.adb_port}"):
            logger.debug("Guardião pulou %s — scrcpy ativo (regra ADB×scrcpy)", device.id)
            return

        # Heartbeat fresco = scripts vivos (heartbeat é o próprio script)
        hb_timeout = getattr(self.cfg, "heartbeat_timeout", 60) if self.cfg else 60
        if device.state.last_heartbeat and (
            datetime.now() - device.state.last_heartbeat
        ).total_seconds() < hb_timeout:
            return

        for script in GUARDIAN_SCRIPTS:
            try:
                out, code = await adb.shell(
                    device.ip,
                    f"sh {REMOTE_DIR}/{script} status",
                    port=device.adb_port,
                    timeout=g.adb_timeout,
                )
                stopped = code != 0 or "PARADO" in out
                if not stopped:
                    continue
                logger.warning("Guardião: %s PARADO em %s — reiniciando", script, device.id)
                await adb.shell(
                    device.ip,
                    f"sh {REMOTE_DIR}/{script} start",
                    port=device.adb_port,
                    timeout=g.adb_timeout,
                )
                if self._send_event:
                    await self._send_event({
                        "type": "guardian",
                        "device_id": device.id,
                        "script": script,
                        "action": "restart",
                        "timestamp": datetime.now().isoformat(),
                    })
            except Exception as e:
                logger.warning("Guardião falhou ao checar %s em %s: %s", script, device.id, e)

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

                # Recuperação:
                #  - offline  → cascata completa (rede caiu)
                #  - degraded com motivo stream/player E recovery_enabled → só reabrir player
                stream_issue = status == "degraded" and self._is_stream_issue(device.state.reason or "")
                if self.recovery and (
                    status == "offline"
                    or (stream_issue and getattr(device, "recovery_enabled", True))
                ):
                    # Cooldown entre recoveries
                    last_recovery = getattr(device.state, "last_recovery_time", None)
                    if last_recovery:
                        since_last = (datetime.now() - last_recovery).total_seconds()
                        min_interval = 120  # mínimo 2 min entre recoveries
                        if since_last < min_interval:
                            await asyncio.sleep(interval)
                            continue

                    stream_only = stream_issue  # degraded → só player_retry
                    rec_result = await self.recovery.recover(device, send_event=self._send_event, stream_only=stream_only)
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
                        # Alerta crítico (apenas na cascata completa — degraded é informativo)
                        if not stream_only and self._send_event:
                            await self._send_event({
                                "type": "alert",
                                "device_id": device.id,
                                "severity": "critical",
                                "message": f"Recuperação falhou após {len(rec_result.get('steps_taken', []))} passos",
                                "timestamp": datetime.now().isoformat(),
                            })

                # Guardião: ressuscita heartbeat/netwatch se parados (com cooldown)
                await self._guardian_check(device)

                # Device offline: não adianta re-verificar a cada 10s (o health
                # check já tem cooldown ADB, mas o sleep maior economiza CPU e
                # reduz ruído). Quando volta a responder, o próximo check pega.
                if device.state.status == "offline":
                    await asyncio.sleep(max(interval, 30))
                else:
                    await asyncio.sleep(interval)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Erro no watchdog de %s: %s", device.id, e, exc_info=True)
                await asyncio.sleep(interval)
