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


class TestAdbAntiSpam:
    """Cooldown anti-spam: ping falho não martela ADB a cada ciclo."""

    @pytest.mark.asyncio
    async def test_adb_cooldown_apos_ping_falho(self):
        """Ping falhou recentemente → não toca ADB (cooldown)."""
        from app.managers.health import HealthManager, ADB_TRY_COOLDOWN
        import time

        h = HealthManager()
        h.adb = AsyncMock()
        h.adb.shell = AsyncMock(return_value=("ok", 0))
        # Simula que tentamos ADB há 5s (dentro do cooldown de 60s)
        h._last_adb_try["test"] = time.monotonic() - 5

        d = DeviceConfig(id="test", ip="192.168.254.200", adb_port=5555)
        with patch("app.managers.health.asyncio.create_subprocess_exec", AsyncMock(return_value=AsyncMock(wait=AsyncMock(return_value=1)))):
            r = await h.check(d)
        # ping falhou + cooldown → não tenta ADB, device offline
        assert r["ping"] is False
        assert r["adb"] is False
        h.adb.shell.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_adb_tentado_apos_cooldown(self):
        """Passou o cooldown → tenta ADB (e atualiza o timestamp)."""
        from app.managers.health import HealthManager, ADB_TRY_COOLDOWN
        import time

        h = HealthManager()
        h.adb = AsyncMock()
        h.adb.shell = AsyncMock(return_value=("ok", 0))
        h._last_adb_try["test"] = time.monotonic() - ADB_TRY_COOLDOWN - 1

        d = DeviceConfig(id="test", ip="192.168.254.200", adb_port=5555)
        with patch("app.managers.health.asyncio.create_subprocess_exec", AsyncMock(return_value=AsyncMock(wait=AsyncMock(return_value=1)))):
            r = await h.check(d)
        assert r["adb"] is True  # ADB respondeu ok
        h.adb.shell.assert_awaited()


class TestWatchdogSyncCrud:
    """CRUD de device deve sincronizar com o WatchdogManager."""

    def test_create_device_registers_watchdog(self, monkeypatch):
        """create_device chama watchdog.add_device."""
        from app.api import devices as devices_api

        calls = []
        fake_wd = type("FakeWD", (), {"add_device": lambda self, d: calls.append(d.id), "remove_device": lambda self, i: calls.append(i)})()
        monkeypatch.setattr(devices_api, "_get_watchdog", lambda: fake_wd)
        monkeypatch.setattr(devices_api, "_sync_mediamtx", lambda cfg: None)

        # Mock config com add_device que retorna o device
        class FakeConfig:
            def __init__(self):
                self.devices = []

            def get_device(self, did):
                return None

            def add_device(self, device):
                self.devices.append(device)

        monkeypatch.setattr(devices_api, "_get_config", lambda: FakeConfig())

        import asyncio
        from app.models.device import DeviceConfig

        # create_device é async; roda com asyncio.run. O auto-provision chama
        # app.managers.adb.ADBManager() — mocka para lançar e cair no except.
        class BoomADB:
            def __init__(self, *a, **k):
                raise RuntimeError("sem adb no teste")

        monkeypatch.setattr("app.managers.adb.ADBManager", BoomADB)

        async def run():
            d = DeviceConfig(id="new-dev", name="Novo", ip="10.0.0.1")
            return await devices_api.create_device(d.model_dump())

        r = asyncio.run(run())
        assert "new-dev" in calls

    def test_delete_device_removes_watchdog(self, monkeypatch):
        """delete_device chama watchdog.remove_device."""
        from app.api import devices as devices_api

        calls = []
        fake_wd = type("FakeWD", (), {"remove_device": lambda self, i: calls.append(i)})()
        monkeypatch.setattr(devices_api, "_get_watchdog", lambda: fake_wd)
        monkeypatch.setattr(devices_api, "_sync_mediamtx", lambda cfg: None)

        class FakeConfig:
            def get_device(self, did):
                return DeviceConfig(id=did, ip="10.0.0.1")

            def delete_device(self, did):
                return True

        monkeypatch.setattr(devices_api, "_get_config", lambda: FakeConfig())

        import asyncio
        r = asyncio.run(devices_api.delete_device("del-dev"))
        assert "del-dev" in calls
