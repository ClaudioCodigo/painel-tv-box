"""Testes da API de grupos (usada pela página de grupo da Fase C)."""

from types import SimpleNamespace

import httpx
import pytest

from app.main import app
from app.core.auth import get_or_create_token

AUTH_HEADERS = {"Authorization": f"Bearer {get_or_create_token()}"}


@pytest.fixture
def anyio_backend():
    return "asyncio"


class FakeGroup:
    def __init__(self, gid, name):
        self.id = gid
        self.name = name

    def model_dump(self):
        return {"id": self.id, "name": self.name}

    def model_dump_safe(self):
        return self.model_dump()


class FakeDevice:
    def __init__(self, did, group):
        self.id = did
        self.name = did
        self.ip = "10.0.0.5"
        self.group = group
        self.state = SimpleNamespace(status="online")

    def model_dump(self):
        return {"id": self.id, "name": self.name, "ip": self.ip, "group": self.group,
                "state": {"status": "online"}}


class FakeConfig:
    def __init__(self):
        self.groups = [FakeGroup("adm", "Administração"), FakeGroup("vazio", "Vazio")]
        self.devices = [FakeDevice("qa", "adm")]

    def get_group(self, gid):
        return next((g for g in self.groups if g.id == gid), None)


@pytest.fixture
def fake_config(monkeypatch):
    import app.main as main_module

    cfg = FakeConfig()
    monkeypatch.setattr(main_module, "config", cfg)
    return cfg


class TestGroupsAPI:
    @pytest.mark.asyncio
    async def test_list_groups_with_devices(self, fake_config):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/groups", headers=AUTH_HEADERS)
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 2
            adm = next(g for g in data if g["id"] == "adm")
            assert adm["device_count"] == 1
            assert adm["devices"][0]["id"] == "qa"
            assert adm["devices"][0]["status"] == "online"

    @pytest.mark.asyncio
    async def test_get_group(self, fake_config):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/groups/adm", headers=AUTH_HEADERS)
            assert resp.status_code == 200
            data = resp.json()
            assert data["name"] == "Administração"
            assert len(data["devices"]) == 1

    @pytest.mark.asyncio
    async def test_get_unknown_group_returns_404(self, fake_config):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/groups/nao-existe", headers=AUTH_HEADERS)
            assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_groups_require_auth(self):
        # Sem config carregada (config=None) o require_auth é fail-closed → 401
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/groups")
            assert resp.status_code == 401
