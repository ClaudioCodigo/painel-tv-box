"""Testes para captura e exibição de screenshots (Mural / Painel)."""

import pytest
import httpx
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.main import app
from app.core.auth import get_or_create_token
from app.models.device import DeviceConfig, DeviceState
import app.main as main_module

AUTH_HEADERS = {"Authorization": f"Bearer {get_or_create_token()}"}


class FakeConfig:
    def __init__(self, device):
        self.device = device

    def get_device(self, did):
        if self.device and self.device.id == did:
            return self.device
        return None


@pytest.fixture
def mock_device(tmp_path, monkeypatch):
    """Garante um dispositivo mockado em app.main.config e limpa screenshots."""
    dev = DeviceConfig(
        id="dev-test-1",
        name="TV Sala 1",
        ip="192.168.1.101",
        adb_port=5555,
        state=DeviceState(status="online"),
    )
    cfg = FakeConfig(dev)
    monkeypatch.setattr(main_module, "config", cfg)

    # Isola pasta de screenshots
    test_dir = tmp_path / "screenshots"
    test_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("app.api.devices.SCREENSHOTS_DIR", test_dir)
    return dev, test_dir


@pytest.mark.asyncio
async def test_screenshot_device_not_found(mock_device):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/devices/inexistente/screenshot", headers=AUTH_HEADERS)
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_screenshot_get_cached(mock_device):
    dev, test_dir = mock_device
    img_file = test_dir / f"{dev.id}.png"
    img_file.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 200)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(f"/api/devices/{dev.id}/screenshot", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert len(resp.content) > 100


@pytest.mark.asyncio
async def test_screenshot_capture_post(mock_device):
    dev, test_dir = mock_device
    img_file = test_dir / f"{dev.id}.png"

    async def fake_pull(ip, remote, local, port=5555, timeout=10):
        Path(local).write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 300)
        return True

    mock_adb = AsyncMock()
    mock_adb.connect.return_value = True
    mock_adb.shell.return_value = ("screenshot: salvo em /sdcard/panel/screenshot.png", 0)
    mock_adb.pull.side_effect = fake_pull

    with patch("app.managers.adb.ADBManager", return_value=mock_adb):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(f"/api/devices/{dev.id}/screenshot", headers=AUTH_HEADERS)
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            assert img_file.is_file()
            assert img_file.stat().st_size > 100


@pytest.mark.asyncio
async def test_screenshot_auto_capture_on_get(mock_device):
    dev, test_dir = mock_device
    img_file = test_dir / f"{dev.id}.png"
    assert not img_file.is_file()

    async def fake_pull(ip, remote, local, port=5555, timeout=10):
        Path(local).write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 400)
        return True

    mock_adb = AsyncMock()
    mock_adb.connect.return_value = True
    mock_adb.shell.return_value = ("screenshot: salvo em /sdcard/panel/screenshot.png", 0)
    mock_adb.pull.side_effect = fake_pull

    with patch("app.managers.adb.ADBManager", return_value=mock_adb):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(f"/api/devices/{dev.id}/screenshot", headers=AUTH_HEADERS)
            assert resp.status_code == 200
            assert resp.headers["content-type"] == "image/png"
            assert img_file.is_file()
