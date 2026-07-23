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
        # 0=Monday in Python datetime.weekday()
        c = CronParser("* * * * 0")
        # 2026-07-27 is a Monday
        assert c.matches(datetime(2026, 7, 27, 10, 0))
        # 2026-07-22 is a Wednesday (weekday=2)
        assert not c.matches(datetime(2026, 7, 22, 10, 0))
