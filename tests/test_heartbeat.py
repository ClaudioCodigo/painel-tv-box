"""Testes do endpoint de heartbeat device→servidor."""

from types import SimpleNamespace

import httpx
import pytest

from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


class FakeDevice:
    def __init__(self):
        self.id = "qa"
        self.state = SimpleNamespace(last_heartbeat=None, current_activity="")


class FakeConfig:
    def __init__(self):
        self.system = SimpleNamespace(security=SimpleNamespace(heartbeat_key="test-heartbeat-key"))
        self._devices = {"qa": FakeDevice()}

    def get_device(self, device_id):
        return self._devices.get(device_id)


@pytest.fixture
def fake_config(monkeypatch):
    import app.main as main_module

    cfg = FakeConfig()
    monkeypatch.setattr(main_module, "config", cfg)
    return cfg


async def _post(client, device_id, key):
    return await client.post(
        f"/api/heartbeat/{device_id}",
        headers={"X-Heartbeat-Key": key},
        json={"activity": "org.videolan.vlc"},
    )


class TestHeartbeat:
    @pytest.mark.asyncio
    async def test_valid_heartbeat_returns_204_and_updates_state(self, fake_config):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await _post(client, "qa", "test-heartbeat-key")
            assert resp.status_code == 204

        dev = fake_config._devices["qa"]
        assert dev.state.last_heartbeat is not None
        assert dev.state.current_activity == "org.videolan.vlc"

    @pytest.mark.asyncio
    async def test_wrong_key_returns_401(self, fake_config):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await _post(client, "qa", "chave-errada")
            assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_unknown_device_returns_404(self, fake_config):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await _post(client, "nao-existe", "test-heartbeat-key")
            assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_rate_limit_returns_429(self, fake_config):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            first = await _post(client, "qa", "test-heartbeat-key")
            assert first.status_code == 204
            # Imediatamente depois → rate limit
            second = await _post(client, "qa", "test-heartbeat-key")
            assert second.status_code == 429

    @pytest.mark.asyncio
    async def test_traversal_device_id_is_rejected(self, fake_config):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/heartbeat/..%2f..%2fetc%2fpasswd",
                headers={"X-Heartbeat-Key": "test-heartbeat-key"},
                json={},
            )
            # Traversal não chega ao endpoint (decodificação de %2f quebra o match da rota)
            # → 405 (catch-all GET) ou 400/404; o importante: nunca executa device lookup
            assert resp.status_code in (400, 404, 405)
