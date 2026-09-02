"""Testes para Web Signage (app.api.signage)."""

from datetime import datetime
import pytest
from starlette.testclient import TestClient

from app.main import app
import app.main as main_module
from app.models.device import DeviceConfig


@pytest.fixture
def signage_client(tmp_path, monkeypatch):
    """Client com device configurado em modo web."""
    from app.core.config import ConfigurationManager

    cfg = ConfigurationManager()
    device = DeviceConfig(
        id="tv-signage-1",
        name="TV Recepção",
        ip="192.168.1.100",
        mode="web",
        target_url="https://dashboard.empresa.com/view",
        web_browser="chrome",
    )
    cfg.devices = [device]
    monkeypatch.setattr(main_module, "config", cfg)
    return TestClient(app)


def test_signage_page_returns_html(signage_client):
    """GET /signage/{device_id} renderiza o template com iframe e target_url."""
    res = signage_client.get("/signage/tv-signage-1")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert "https://dashboard.empresa.com/view" in res.text
    assert "tv-signage-1" in res.text
    assert "signage-frame" in res.text


def test_signage_page_not_found(signage_client):
    """GET /signage/{device_id} para device inexistente retorna 404."""
    res = signage_client.get("/signage/tv-inexistente")
    assert res.status_code == 404


def test_signage_page_invalid_id(signage_client):
    """GET /signage/{device_id} com id inseguro retorna 400."""
    res = signage_client.get("/signage/invalid$id")
    assert res.status_code == 400


def test_signage_websocket_ping(signage_client):
    """WebSocket /ws/signage/{device_id} recebe ping e atualiza last_signage_ping."""
    with signage_client.websocket_connect("/ws/signage/tv-signage-1") as ws:
        device = main_module.config.get_device("tv-signage-1")
        assert device.state.last_signage_ping is not None

        # Envia ping
        ws.send_text('{"type": "ping", "device_id": "tv-signage-1"}')
        assert isinstance(device.state.last_signage_ping, datetime)
