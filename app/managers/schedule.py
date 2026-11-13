"""ScheduleManager — agendamento de ações via expressões cron."""

import asyncio
import logging
from datetime import datetime

logger = logging.getLogger("schedule")


class CronParser:
    """Parser simples de expressão cron de 5 campos."""

    def __init__(self, expression: str):
        self.expression = expression.strip()
        parts = expression.split()
        if len(parts) != 5:
            raise ValueError(f"Expressão cron inválida (precisa 5 campos): {expression}")
        self.minute = parts[0]
        self.hour = parts[1]
        self.day = parts[2]
        self.month = parts[3]
        self.weekday = parts[4]

    def matches(self, dt: datetime) -> bool:
        """Verifica se a data/hora atual bate com a expressão cron."""
        if not self._match_field(self.minute, dt.minute):
            return False
        if not self._match_field(self.hour, dt.hour):
            return False
        if not self._match_field(self.day, dt.day):
            return False
        if not self._match_field(self.month, dt.month):
            return False
        # cron: 0=domingo..6=sábado (7 também = domingo); Python: 0=segunda
        cron_wd = (dt.weekday() + 1) % 7
        if not (self._match_field(self.weekday, cron_wd)
                or (cron_wd == 0 and self._match_field(self.weekday, 7))):
            return False
        return True

    @staticmethod
    def _match_field(pattern: str, value: int) -> bool:
        if pattern == "*":
            return True
        if pattern.isdigit():
            return int(pattern) == value
        # Lista primeiro: "*/15,50" e "1-5,0" combinam outros formatos
        if "," in pattern:
            return any(CronParser._match_field(p.strip(), value) for p in pattern.split(","))
        if "/" in pattern:
            base, step = pattern.split("/")
            step_val = int(step)
            if step_val <= 0:
                return False
            if base == "*":
                low, high = 0, value
            elif "-" in base:
                low, high = map(int, base.split("-"))
            else:
                low, high = int(base), value
            return low <= value <= high and (value - low) % step_val == 0
        if "-" in pattern:
            low, high = map(int, pattern.split("-"))
            return low <= value <= high
        return False


class ScheduleManager:
    """Gerencia execução de ações agendadas (cron)."""

    def __init__(self, config_manager=None, adb_manager=None, player_manager=None):
        self.config = config_manager
        self.adb = adb_manager
        self.player = player_manager
        self._running = False
        self._task = None
        self._last_triggered: dict[str, str] = {}  # schedule_id -> last_date

    def start(self):
        """Inicia o loop de verificação de schedules."""
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("ScheduleManager iniciado")

    def stop(self):
        """Para o loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None

    async def _loop(self):
        """Verifica schedules a cada 60 segundos."""
        while self._running:
            try:
                now = datetime.now()
                # Limpa entradas antigas para evitar acumular chaves em memória
                current_min = now.strftime("%Y-%m-%d %H:%M")
                self._last_triggered = {
                    k: v for k, v in self._last_triggered.items()
                    if v == current_min
                }
                await self._check_devices(now)
                await self._check_groups(now)
            except Exception as e:
                logger.error("Schedule loop error: %s", e)
            await asyncio.sleep(60)

    async def _check_devices(self, now: datetime):
        """Verifica schedules de dispositivos."""
        if not self.config or not self.config.devices:
            return
        current_min = now.strftime("%Y-%m-%d %H:%M")

        for device in self.config.devices:
            for sched in device.schedule:
                sched_id = f"device_{device.id}_{sched.action}_{sched.cron}"
                if self._last_triggered.get(sched_id) == current_min:
                    continue

                try:
                    parser = CronParser(sched.cron)
                    if parser.matches(now):
                        await self._execute_action(device.id, sched.action)
                        self._last_triggered[sched_id] = current_min
                        logger.info("Schedule triggered: %s -> %s", device.id, sched.action)
                except Exception as e:
                    logger.warning("Schedule parse error for %s: %s", device.id, e)

    async def _check_groups(self, now: datetime):
        """Verifica schedules de grupos."""
        if not self.config or not self.config.groups:
            return
        current_min = now.strftime("%Y-%m-%d %H:%M")

        for group in self.config.groups:
            for sched in group.schedule:
                sched_id = f"group_{group.id}_{sched.action}_{sched.cron}"
                if self._last_triggered.get(sched_id) == current_min:
                    continue

                try:
                    parser = CronParser(sched.cron)
                    if parser.matches(now):
                        devices = [d for d in self.config.devices if d.group == group.id]
                        for device in devices:
                            await self._execute_action(device.id, sched.action)
                        self._last_triggered[sched_id] = current_min
                        logger.info("Group schedule triggered: %s (%d devices) -> %s", group.id, len(devices), sched.action)
                except Exception as e:
                    logger.warning("Schedule parse error for group %s: %s", group.id, e)

    async def _execute_action(self, device_id: str, action: str):
        """Executa ação em um dispositivo."""
        device = self.config.get_device(device_id) if self.config else None
        if not device:
            return

        # Aceita "start-stream" (forma usada na API/UI/docs) e "start_stream"
        action = action.strip().lower().replace("-", "_")
        if action == "start_stream":
            if self.player:
                await self.player.start_stream(device)
        elif action == "stop_stream":
            if self.player:
                await self.player.stop_stream(device)
        elif action == "reboot":
            if self.adb:
                await self.adb.reboot(device.ip, port=device.adb_port)
        else:
            logger.warning("Schedule com ação desconhecida ignorado: %s (%s)", action, device_id)
