"""Testes para ScheduleManager e CronParser."""

import pytest
from datetime import datetime
from app.managers.schedule import CronParser


class TestCronParser:
    """Testes para o CronParser."""

    def test_wildcard_matches(self):
        c = CronParser("* * * * *")
        assert c.matches(datetime(2026, 7, 22, 14, 30))

    def test_specific_minute(self):
        c = CronParser("30 * * * *")
        assert c.matches(datetime(2026, 7, 22, 14, 30))
        assert not c.matches(datetime(2026, 7, 22, 14, 31))

    def test_specific_hour(self):
        c = CronParser("* 8 * * *")
        assert c.matches(datetime(2026, 7, 22, 8, 0))
        assert not c.matches(datetime(2026, 7, 22, 9, 0))

    def test_range(self):
        c = CronParser("* 8-10 * * *")
        assert c.matches(datetime(2026, 7, 22, 8, 0))
        assert c.matches(datetime(2026, 7, 22, 10, 0))
        assert not c.matches(datetime(2026, 7, 22, 11, 0))

    def test_step(self):
        c = CronParser("*/5 * * * *")
        assert c.matches(datetime(2026, 7, 22, 14, 0))
        assert c.matches(datetime(2026, 7, 22, 14, 10))
        assert not c.matches(datetime(2026, 7, 22, 14, 7))

    def test_comma_separated(self):
        c = CronParser("0 8,12,18 * * *")
        assert c.matches(datetime(2026, 7, 22, 8, 0))
        assert c.matches(datetime(2026, 7, 22, 12, 0))
        assert c.matches(datetime(2026, 7, 22, 18, 0))
        assert not c.matches(datetime(2026, 7, 22, 15, 0))

    def test_daily_8am(self):
        c = CronParser("0 8 * * *")
        assert c.matches(datetime(2026, 7, 22, 8, 0))
        assert not c.matches(datetime(2026, 7, 22, 8, 1))
        assert not c.matches(datetime(2026, 7, 22, 9, 0))

    def test_invalid_expression(self):
        with pytest.raises(ValueError):
            CronParser("invalid")

    def test_too_few_fields(self):
        with pytest.raises(ValueError):
            CronParser("0 8")

    def test_weekday(self):
        # Convenção cron: 0 (ou 7) = domingo, 1 = segunda
        c = CronParser("* * * * 1")
        # 2026-07-27 é segunda
        assert c.matches(datetime(2026, 7, 27, 10, 0))
        # 2026-07-22 é quarta
        assert not c.matches(datetime(2026, 7, 22, 10, 0))

    def test_weekday_sunday_0_and_7(self):
        sunday = datetime(2026, 7, 26, 10, 0)
        assert CronParser("* * * * 0").matches(sunday)
        assert CronParser("* * * * 7").matches(sunday)

    def test_weekdays_mon_to_fri(self):
        c = CronParser("0 8 * * 1-5")
        assert c.matches(datetime(2026, 7, 27, 8, 0))      # segunda
        assert c.matches(datetime(2026, 7, 31, 8, 0))      # sexta
        assert not c.matches(datetime(2026, 8, 1, 8, 0))   # sábado
        assert not c.matches(datetime(2026, 7, 26, 8, 0))  # domingo

    def test_step_with_range_and_list(self):
        c = CronParser("0-30/10,45 * * * *")
        for m in (0, 10, 20, 30, 45):
            assert c.matches(datetime(2026, 7, 27, 10, m))
        for m in (5, 40, 50):
            assert not c.matches(datetime(2026, 7, 27, 10, m))


class TestScheduleManager:
    """Testes para o ScheduleManager."""

    @pytest.mark.asyncio
    async def test_intraday_multiple_executions(self):
        from unittest.mock import AsyncMock, MagicMock
        from app.managers.schedule import ScheduleManager
        from app.models.device import DeviceConfig, DeviceSchedule

        mock_config = MagicMock()
        dev = DeviceConfig(
            id="dev1",
            ip="192.168.1.50",
            schedule=[DeviceSchedule(cron="0 8,18 * * *", action="reboot")],
        )
        mock_config.devices = [dev]
        mock_config.get_device.return_value = dev

        mock_adb = MagicMock()
        mock_adb.reboot = AsyncMock()

        sm = ScheduleManager(config_manager=mock_config, adb_manager=mock_adb)

        # 1st trigger: 8:00 AM
        dt1 = datetime(2026, 8, 24, 8, 0)
        await sm._check_devices(dt1)
        assert mock_adb.reboot.call_count == 1

        # Same minute: should NOT trigger again
        await sm._check_devices(dt1)
        assert mock_adb.reboot.call_count == 1

        # 2nd trigger: 18:00 (same day, different hour) -> MUST trigger!
        dt2 = datetime(2026, 8, 24, 18, 0)
        await sm._check_devices(dt2)
        assert mock_adb.reboot.call_count == 2


@pytest.mark.asyncio
async def test_execute_action_accepts_hyphen_form():
    from unittest.mock import AsyncMock, MagicMock
    from app.managers.schedule import ScheduleManager
    cfg = MagicMock()
    cfg.get_device.return_value = MagicMock()
    player = MagicMock(start_stream=AsyncMock(), stop_stream=AsyncMock())
    sm = ScheduleManager(config_manager=cfg, player_manager=player)
    await sm._execute_action("d1", "start-stream")
    await sm._execute_action("d1", "stop_stream")
    player.start_stream.assert_awaited_once()
    player.stop_stream.assert_awaited_once()
