"""Testes do canal de comandos via heartbeat (Ideia 3)."""

from types import SimpleNamespace

import httpx
import pytest

from app.main import app
from app.services import command_queue as cq


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


@pytest.fixture(autouse=True)
def clean_queue():
    cq._QUEUE.clear()
    cq._RESULTS.clear()
    yield
    cq._QUEUE.clear()
    cq._RESULTS.clear()


@pytest.fixture
def fake_config(monkeypatch):
    import app.main as main_module

    cfg = FakeConfig()
    monkeypatch.setattr(main_module, "config", cfg)
    return cfg


class TestCommandQueueModule:
    @pytest.mark.asyncio
    async def test_enqueue_pop_and_ack(self):
        await cq.enqueue("qa", "reboot", "reboot")
        pending = await cq.pop_pending("qa")
        assert len(pending) == 1
        assert pending[0]["cmd"] == "reboot"
        # Segunda chamada → vazio (já enviado)
        assert await cq.pop_pending("qa") == []
        # Resultado
        await cq.ack("qa", pending[0]["id"], True, "ok")
        res = cq.result_of("qa", pending[0]["id"])
        assert res["success"] is True
        assert res["output"] == "ok"


class TestHeartbeatCommandsAPI:
    @pytest.mark.asyncio
    async def test_commands_roundtrip(self, fake_config):
        transport = httpx.ASGITransport(app=app)
        headers = {"X-Heartbeat-Key": "test-heartbeat-key"}
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            # Enfileira
            await cq.enqueue("qa", "reboot", "reboot")
            # Device puxa
            resp = await client.get("/api/heartbeat/qa/commands", headers=headers)
            assert resp.status_code == 200
            assert "reboot" in resp.text
            assert "\t" in resp.text  # id<TAB>cmd
            # Segunda vez → vazio
            resp2 = await client.get("/api/heartbeat/qa/commands", headers=headers)
            assert resp2.text.strip() == ""
            # Reporta resultado
            cmd_id = resp.text.split("\t")[0]
            r = await client.post(
                "/api/heartbeat/qa/result",
                headers=headers,
                json={"id": cmd_id, "success": True, "output": "done"},
            )
            assert r.status_code in (200, 204)
            res = cq.result_of("qa", cmd_id)
            assert res and res["success"] is True

    @pytest.mark.asyncio
    async def test_commands_require_key(self, fake_config):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/heartbeat/qa/commands")
            assert resp.status_code == 401
