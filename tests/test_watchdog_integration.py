"""Testes de integração com mocks — ADB, Watchdog, Health."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime, timedelta
from app.models.device import DeviceConfig


class TestWatchdogIntegration:
    """Testes de integração simulando cenários reais."""

    @pytest.mark.asyncio
    async def test_health_online_when_adb_and_mediamtx_ok(self):
        """Cenário: ADB OK + MediaMTX com readers → online."""
        from app.managers.health import HealthManager
        h = HealthManager()
        h.adb = AsyncMock()
        h.adb.shell = AsyncMock(return_value=("ok", 0))
        h.mediamtx = AsyncMock()
        h.mediamtx.list_paths = AsyncMock(return_value={
            "success": True,
            "data": {"items": [{"name": "TEST", "ready": True, "tracks": [1, 2], "readers": [{"id": "r1"}]}]}
        })
        d = DeviceConfig(id="test", ip="192.168.1.1", rtsp_path="TEST")
        r = await h.check(d)
        assert r["status"] == "online"
        assert r["readers"] > 0

    @pytest.mark.asyncio
    async def test_health_degraded_no_readers(self):
        """Cenário: ADB OK + MediaMTX sem readers → degraded."""
        from app.managers.health import HealthManager
        h = HealthManager()
        h.adb = AsyncMock()
        h.adb.shell = AsyncMock(return_value=("ok", 0))
        h.mediamtx = AsyncMock()
        h.mediamtx.list_paths = AsyncMock(return_value={
            "success": True,
            "data": {"items": [{"name": "TEST", "ready": True, "tracks": [1], "readers": []}]}
        })
        d = DeviceConfig(id="test", ip="192.168.1.1", rtsp_path="TEST")
        r = await h.check(d)
        assert r["status"] == "degraded"
        assert r["readers"] == 0

    @pytest.mark.asyncio
    async def test_watchdog_grace_period(self):
        """Cenário: ADB falha mas estava OK há <60s → degraded, não offline."""
        from app.managers.health import HealthManager
        h = HealthManager()
        h.adb = AsyncMock()
        h.adb.shell = AsyncMock(side_effect=Exception("ADB fail"))
        h._last_good["test"] = datetime.now() - timedelta(seconds=30)  # 30s atrás
        d = DeviceConfig(id="test", ip="192.168.1.1")
        r = await h.check(d)
        assert r["status"] == "degraded"  # grace period ativo
        assert "transient" in (r.get("error") or "")

    @pytest.mark.asyncio
    async def test_watchdog_grace_expired(self):
        """Cenário: ADB falha há >60s → offline."""
        from app.managers.health import HealthManager
        h = HealthManager()
        h.adb = AsyncMock()
        h.adb.shell = AsyncMock(side_effect=Exception("ADB fail"))
        h._last_good["test"] = datetime.now() - timedelta(seconds=120)  # 2 min atrás
        d = DeviceConfig(id="test", ip="192.168.1.1")
        r = await h.check(d)
        assert r["status"] == "offline"

    @pytest.mark.asyncio
    async def test_adb_retry_twice(self):
        """Cenário: ADB falha na 1ª tentativa, OK na 2ª."""
        from app.managers.health import HealthManager
        h = HealthManager()
        # Primeira falha, segunda OK
        h.adb = AsyncMock()
        h.adb.shell = AsyncMock(side_effect=[Exception("fail"), ("ok", 0)])
        d = DeviceConfig(id="test", ip="192.168.1.1")
        r = await h.check(d)
        assert r["adb"] is True
        assert h.adb.shell.call_count >= 2

    @pytest.mark.asyncio
    async def test_health_reason_sem_stream(self):
        """Cenário: ADB OK, sem atividade e sem path → 'Sem stream ativa'."""
        from app.managers.health import HealthManager
        h = HealthManager()
        h.adb = AsyncMock()
        h.adb.shell = AsyncMock(return_value=("ok\n", 0))  # ADB responde
        h.mediamtx = AsyncMock()
        h.mediamtx.list_paths = AsyncMock(return_value={
            "success": True, "data": {"items": []}
        })
        d = DeviceConfig(id="test", ip="192.168.1.1", rtsp_path="NONEXISTENT")
        r = await h.check(d)
        assert r["reason"] == "Sem stream ativa"
