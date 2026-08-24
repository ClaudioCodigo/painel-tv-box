"""Testes para o endpoint de bundle e launcher client-side do scrcpy (Phase 3)."""

import io
from pathlib import Path
import zipfile
import pytest
import httpx

from app.main import app
from app.models.device import DeviceConfig
import app.core.auth as auth
from app.managers.scrcpy import ScrcpyManager


@pytest.fixture
def auth_header(tmp_path, monkeypatch):
    admin_file = tmp_path / "admin.json"
    secret_file = tmp_path / ".session_secret"
    monkeypatch.setattr(auth, "ADMIN_FILE", admin_file)
    monkeypatch.setattr(auth, "SESSION_SECRET_FILE", secret_file)
    monkeypatch.setattr(auth, "_secret_cache", "")
    monkeypatch.setattr(auth, "_token_cache", "")
    auth._reset_rate_limits()
    auth.set_admin("admin", "senha-admin-123")
    token = auth.create_session_token("admin")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def setup_device(monkeypatch):
    import app.main

    device = DeviceConfig(
        id="tv-sala",
        name="TV da Recepção",
        ip="192.168.254.150",
        adb_port=5555,
        stream_url="rtsp://192.168.254.102:8554/live",
    )

    class MockConfigManager:
        def get_device(self, dev_id):
            if dev_id == "tv-sala":
                return device
            return None

    monkeypatch.setattr(app.main, "config", MockConfigManager())
    return device


async def _client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_get_launcher_success(auth_header, setup_device):
    """GET /api/scrcpy/client/launcher/{id} retorna arquivo .bat configurado."""
    async with await _client() as c:
        r = await c.get("/api/scrcpy/client/launcher/tv-sala", headers=auth_header)
        assert r.status_code == 200
        assert "attachment" in r.headers.get("content-disposition", "")
        content = r.text
        assert "192.168.254.150:5555" in content
        assert "adb.exe connect" in content
        assert "scrcpy.exe -s" in content
        assert "chcp 65001" in content


@pytest.mark.asyncio
async def test_get_launcher_not_found(auth_header, setup_device):
    """GET /api/scrcpy/client/launcher/{id} retorna 404 para device inexistente."""
    async with await _client() as c:
        r = await c.get("/api/scrcpy/client/launcher/tv-inexistente", headers=auth_header)
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_launcher_invalid_id(auth_header, setup_device):
    """GET /api/scrcpy/client/launcher/{id} rejeita id com path traversal."""
    async with await _client() as c:
        r = await c.get("/api/scrcpy/client/launcher/../../etc/passwd", headers=auth_header)
        assert r.status_code in (400, 404)


@pytest.mark.asyncio
async def test_get_bundle_without_scrcpy_returns_500(auth_header, setup_device, monkeypatch):
    """GET /api/scrcpy/client/bundle/{id} retorna 500 se o scrcpy não estiver instalado no servidor."""
    monkeypatch.setattr(ScrcpyManager, "get_active_dir", lambda self: None)

    async with await _client() as c:
        r = await c.get("/api/scrcpy/client/bundle/tv-sala", headers=auth_header)
        assert r.status_code == 500
        assert "scrcpy não instalado" in r.json()["detail"]


@pytest.mark.asyncio
async def test_get_bundle_success(auth_header, setup_device, tmp_path, monkeypatch):
    """GET /api/scrcpy/client/bundle/{id} entrega ZIP com executáveis, launcher e README."""
    scrcpy_mock_dir = tmp_path / "scrcpy_mock"
    scrcpy_mock_dir.mkdir()
    (scrcpy_mock_dir / "scrcpy.exe").write_bytes(b"MZ_DUMMY_EXE")
    (scrcpy_mock_dir / "scrcpy-server").write_bytes(b"DUMMY_SERVER_JAR")
    (scrcpy_mock_dir / "adb.exe").write_bytes(b"MZ_DUMMY_ADB")

    monkeypatch.setattr(ScrcpyManager, "get_active_dir", lambda self: scrcpy_mock_dir)

    async with await _client() as c:
        r = await c.get("/api/scrcpy/client/bundle/tv-sala", headers=auth_header)
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/zip"
        assert 'filename="scrcpy-TV_da_Recep__o.zip"' in r.headers["content-disposition"] or 'filename="scrcpy-' in r.headers["content-disposition"]

        # Inspeciona o ZIP retornado
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()

        assert "scrcpy/scrcpy.exe" in names
        assert "scrcpy/scrcpy-server" in names
        assert "scrcpy/adb.exe" in names
        assert "README.txt" in names

        bat_files = [n for n in names if n.endswith(".bat")]
        assert len(bat_files) == 1

        bat_content = zf.read(bat_files[0]).decode("utf-8")
        assert "192.168.254.150:5555" in bat_content
        assert "scrcpy\\scrcpy.exe" in bat_content

        readme_content = zf.read("README.txt").decode("utf-8")
        assert "192.168.254.150:5555" in readme_content
        assert "Alt + F" in readme_content
