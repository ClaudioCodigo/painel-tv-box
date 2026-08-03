from types import SimpleNamespace
"""Testes do health check ADB-light (heartbeat fresco → zero ADB)."""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from app.core.auth import get_or_create_token

AUTH_HEADERS = {"Authorization": f"Bearer {get_or_create_token()}"}

from app.managers.health import HealthManager
from app.models.device import DeviceConfig


class TestHeartbeatAdbLight:
    @pytest.mark.asyncio
    async def test_heartbeat_fresh_skips_adb_entirely(self):
        adb = AsyncMock()
        adb.shell = AsyncMock()
        h = HealthManager(adb_manager=adb, heartbeat_timeout=60)

        dev = DeviceConfig(id="qa", ip="10.0.0.5")
        dev.state.last_heartbeat = datetime.now()  # fresco

        res = await h.check(dev)

        assert res["heartbeat_fresh"] is True
        assert res["adb"] is True
        adb.shell.assert_not_awaited()  # regra §3.3: zero ADB

    @pytest.mark.asyncio
    async def test_heartbeat_stale_falls_back_to_adb(self):
        adb = AsyncMock()
        # 1ª chamada: echo ok (liveness) · 2ª: dumpsys activity
        adb.shell = AsyncMock(side_effect=[("ok", 0), ("", 0)])
        h = HealthManager(adb_manager=adb, heartbeat_timeout=60)

        dev = DeviceConfig(id="qa", ip="10.0.0.5")
        dev.state.last_heartbeat = datetime.now() - timedelta(minutes=5)  # expirado

        res = await h.check(dev)

        assert res["heartbeat_fresh"] is False
        assert res["adb"] is True
        adb.shell.assert_awaited()  # fallback ADB completo

    @pytest.mark.asyncio
    async def test_heartbeat_with_activity_uses_it(self):
        adb = AsyncMock()
        adb.shell = AsyncMock()
        h = HealthManager(adb_manager=adb, heartbeat_timeout=60)

        dev = DeviceConfig(id="qa", ip="10.0.0.5")
        dev.state.last_heartbeat = datetime.now()
        dev.state.current_activity = "org.videolan.vlc"

        res = await h.check(dev)

        assert res["activity"] == "org.videolan.vlc"
        adb.shell.assert_not_awaited()


class FakeState:
    status = "unknown"
    last_heartbeat = None
    current_activity = ""
    last_seen = None


class FakeDev:
    id = "qa"
    ip = "10.99.99.99"  # inalcançável — se o endpoint tocar em ADB, falharia
    adb_port = 5555


class TestStatusEndpointAdbLight:
    @pytest.mark.asyncio
    async def test_status_with_fresh_heartbeat_skips_adb(self, monkeypatch):
        import httpx
        from app.main import app
        import app.main as main_module

        dev = FakeDev()
        dev.state = FakeState()
        dev.state.last_heartbeat = datetime.now()  # fresco

        cfg = SimpleNamespace(
            system=SimpleNamespace(adb=SimpleNamespace(binary="adb", connect_timeout=3)),
            watchdog=SimpleNamespace(heartbeat_timeout=60),
            get_device=lambda _id: dev if _id == "qa" else None,
        )
        monkeypatch.setattr(main_module, "config", cfg)
        # is_device_active retorna False (scrcpy não ativo no teste)
        monkeypatch.setattr("app.managers.scrcpy.ScrcpyManager.is_device_active", lambda t: False)

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/devices/qa/status", headers=AUTH_HEADERS)
            assert resp.status_code == 200
            data = resp.json()
            assert data["source"] == "heartbeat"
            assert data["adb_connected"] is True
