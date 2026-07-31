"""Testes para a API REST (FastAPI endpoints)."""

import pytest
import httpx
from app.main import app
from app.core.auth import get_or_create_token

# Token real do painel (criado em config/.panel_token, gitignored)
AUTH_HEADERS = {"Authorization": f"Bearer {get_or_create_token()}"}


@pytest.fixture
def anyio_backend():
    return "asyncio"


class TestAPIHealth:
    """Testes de endpoints de sistema."""

    @pytest.mark.asyncio
    async def test_health_endpoint(self):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/system/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ok"

    @pytest.mark.asyncio
    async def test_metrics_endpoint(self):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/system/metrics", headers=AUTH_HEADERS)
            assert resp.status_code == 200
            data = resp.json()
            assert "cpu_percent" in data
            assert "ram_percent" in data

    @pytest.mark.asyncio
    async def test_wizard_status_endpoint(self):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/system/wizard-status", headers=AUTH_HEADERS)
            assert resp.status_code == 200
            data = resp.json()
            assert "completed" in data
            assert "devices_count" in data

    @pytest.mark.asyncio
    async def test_scrcpy_status_endpoint(self):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/scrcpy/status", headers=AUTH_HEADERS)
            assert resp.status_code == 200
            data = resp.json()
            assert "current_version" in data
            assert "binary_path" in data

    @pytest.mark.asyncio
    async def test_backup_list_endpoint(self):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/backup/list", headers=AUTH_HEADERS)
            assert resp.status_code == 200
            data = resp.json()
            assert "backups" in data

    @pytest.mark.asyncio
    async def test_logs_sources_endpoint(self):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/logs/sources", headers=AUTH_HEADERS)
            assert resp.status_code == 200
            data = resp.json()
            assert "sources" in data

    @pytest.mark.asyncio
    async def test_unauthenticated_request_rejected(self):
        """Sem token, rotas protegidas devem retornar 401."""
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/devices")
            assert resp.status_code == 401
