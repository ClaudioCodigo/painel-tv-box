"""Testes para o endpoint de bundle e launcher client-side do scrcpy (Phase 3)."""

import io
import base64
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import zipfile
import pytest
import httpx

from app.main import app
from app.models.device import DeviceConfig
import app.core.auth as auth
from app.managers.scrcpy import ScrcpyManager
import app.managers.adb_enrollment as enrollment_module
from app.managers.adb_enrollment import ADBKeyProvisioner, EnrollmentStore


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
        wizard_completed = True
        system = SimpleNamespace(security=SimpleNamespace(enabled=True))

        def get_device(self, dev_id):
            if dev_id == "tv-sala":
                return device
            return None

    monkeypatch.setattr(app.main, "config", MockConfigManager())
    return device


async def _client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _public_key():
    return base64.b64encode(b"K" * 524).decode("ascii") + " test@client"


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
        assert "matricular.ps1" in names
        assert "README.txt" in names

        bat_files = [n for n in names if n.endswith(".bat")]
        assert len(bat_files) == 1

        bat_content = zf.read(bat_files[0]).decode("utf-8")
        assert "192.168.254.150:5555" in bat_content
        assert "scrcpy\\scrcpy.exe" in bat_content
        assert 'set "ADB_VENDOR_KEYS=%~dp0credencial\\adbkey"' in bat_content
        assert "matricular.ps1" in bat_content
        assert "get-state" in bat_content
        assert 'findstr /x /c:"device"' in bat_content
        assert 'del /q "credencial\\.matriculado"' in bat_content

        enroll_content = zf.read("matricular.ps1").decode("utf-8-sig")
        assert "$KeyPath + '.pub'" in enroll_content
        assert "adb.exe keygen" not in enroll_content  # chamado pela variável $Adb
        assert "keygen $KeyPath" in enroll_content
        assert "/api/scrcpy/client/enroll/tv-sala" in enroll_content
        assert "public_key = $PublicKey" in enroll_content
        assert "private_key" not in enroll_content

        readme_content = zf.read("README.txt").decode("utf-8")
        assert "192.168.254.150:5555" in readme_content
        assert "Alt + F" in readme_content


@pytest.mark.asyncio
async def test_station_bundle_installs_protocol_without_private_key(
    auth_header, setup_device, tmp_path, monkeypatch,
):
    scrcpy_mock_dir = tmp_path / "scrcpy_mock"
    scrcpy_mock_dir.mkdir()
    (scrcpy_mock_dir / "scrcpy.exe").write_bytes(b"MZ_DUMMY_EXE")
    (scrcpy_mock_dir / "adb.exe").write_bytes(b"MZ_DUMMY_ADB")
    monkeypatch.setattr(ScrcpyManager, "get_active_dir", lambda self: scrcpy_mock_dir)

    async with await _client() as c:
        response = await c.get("/api/scrcpy/client/station-bundle", headers=auth_header)

    assert response.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(response.content))
    assert {"PainelScrcpy.ps1", "instalar-cliente.ps1", "instalar-cliente.bat", "README.txt"} <= set(zf.namelist())
    installer = zf.read("instalar-cliente.ps1").decode("utf-8-sig")
    launcher = zf.read("PainelScrcpy.ps1").decode("utf-8-sig")
    assert "HKCU:\\Software\\Classes\\paineltvbox" in installer
    assert "$env:LOCALAPPDATA" in installer
    assert "keygen $KeyPath" in installer
    assert "/api/scrcpy/client/launch/resolve" in launcher
    assert "$env:ADB_VENDOR_KEYS = $KeyPath" in launcher
    assert "if ($Target.newly_authorized) { Start-Sleep -Seconds 3 }" in launcher
    assert "scrcpy/?\\?ticket=" in launcher
    assert "private_key" not in installer + launcher


@pytest.mark.asyncio
async def test_online_installer_downloads_bundle_with_one_time_token(
    auth_header, setup_device, tmp_path, monkeypatch,
):
    EnrollmentStore._tokens.clear()
    monkeypatch.setattr(enrollment_module, "get_data_dir", lambda: tmp_path)
    scrcpy_mock_dir = tmp_path / "scrcpy_mock"
    scrcpy_mock_dir.mkdir()
    (scrcpy_mock_dir / "scrcpy.exe").write_bytes(b"MZ_DUMMY_EXE")
    (scrcpy_mock_dir / "adb.exe").write_bytes(b"MZ_DUMMY_ADB")
    monkeypatch.setattr(ScrcpyManager, "get_active_dir", lambda self: scrcpy_mock_dir)

    async with await _client() as c:
        installer = await c.get("/api/scrcpy/client/installer", headers=auth_header)
        assert installer.status_code == 200
        assert 'filename="instalar-scrcpy.cmd"' in installer.headers["content-disposition"]
        encoded = installer.text.split("-EncodedCommand ", 1)[1].splitlines()[0]
        script = base64.b64decode(encoded).decode("utf-16le")
        assert "Invoke-WebRequest" in script
        package_url = script.split("-Uri '", 1)[1].split("'", 1)[0]
        package = await c.get(package_url)
        replay = await c.get(package_url)

    assert package.status_code == 200
    assert package.headers["content-type"] == "application/zip"
    assert replay.status_code == 400


@pytest.mark.asyncio
async def test_launch_ticket_requires_session(auth_header, setup_device):
    EnrollmentStore._tokens.clear()
    async with await _client() as c:
        unauthorized = await c.post("/api/scrcpy/client/launch-ticket/tv-sala")
        authorized = await c.post(
            "/api/scrcpy/client/launch-ticket/tv-sala", headers=auth_header,
        )

    assert unauthorized.status_code == 401
    assert authorized.status_code == 200
    assert authorized.json()["protocol_url"].startswith("paineltvbox://scrcpy?ticket=")


@pytest.mark.asyncio
async def test_launch_resolve_provisions_once_and_rejects_replay(
    auth_header, setup_device, tmp_path, monkeypatch,
):
    EnrollmentStore._tokens.clear()
    monkeypatch.setattr(enrollment_module, "get_data_dir", lambda: tmp_path)
    install = AsyncMock(return_value={"success": True})
    monkeypatch.setattr(ADBKeyProvisioner, "install", install)

    async with await _client() as c:
        first_ticket = await c.post(
            "/api/scrcpy/client/launch-ticket/tv-sala", headers=auth_header,
        )
        token = first_ticket.json()["protocol_url"].split("ticket=", 1)[1]
        payload = {"token": token, "client_name": "PC-Recepcao", "public_key": _public_key()}
        resolved = await c.post("/api/scrcpy/client/launch/resolve", json=payload)
        replay = await c.post("/api/scrcpy/client/launch/resolve", json=payload)

        second_ticket = await c.post(
            "/api/scrcpy/client/launch-ticket/tv-sala", headers=auth_header,
        )
        payload["token"] = second_ticket.json()["protocol_url"].split("ticket=", 1)[1]
        resolved_again = await c.post("/api/scrcpy/client/launch/resolve", json=payload)

    assert resolved.status_code == 200
    assert resolved.json()["device_id"] == "tv-sala"
    assert resolved.json()["ip"] == "192.168.254.150"
    assert resolved.json()["newly_authorized"] is True
    assert replay.status_code == 400
    assert resolved_again.status_code == 200
    assert resolved_again.json()["newly_authorized"] is False
    install.assert_awaited_once()


@pytest.mark.asyncio
async def test_enroll_uses_one_time_token_without_panel_session(setup_device, tmp_path, monkeypatch):
    EnrollmentStore._tokens.clear()
    monkeypatch.setattr(enrollment_module, "get_data_dir", lambda: tmp_path)
    install = AsyncMock(return_value={"success": True})
    monkeypatch.setattr(ADBKeyProvisioner, "install", install)
    token = EnrollmentStore().issue_token("tv-sala", "admin")["token"]

    async with await _client() as c:
        payload = {"token": token, "client_name": "PC-Recepcao", "public_key": _public_key()}
        response = await c.post("/api/scrcpy/client/enroll/tv-sala", json=payload)
        replay = await c.post("/api/scrcpy/client/enroll/tv-sala", json=payload)

    assert response.status_code == 200
    assert response.json()["fingerprint"].startswith("SHA256:")
    assert replay.status_code == 400
    install.assert_awaited_once()


@pytest.mark.asyncio
async def test_enroll_rejects_token_for_another_device(setup_device, tmp_path, monkeypatch):
    EnrollmentStore._tokens.clear()
    monkeypatch.setattr(enrollment_module, "get_data_dir", lambda: tmp_path)
    token = EnrollmentStore().issue_token("tv-outra", "admin")["token"]

    async with await _client() as c:
        response = await c.post("/api/scrcpy/client/enroll/tv-sala", json={
            "token": token, "client_name": "PC-01", "public_key": _public_key(),
        })
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_and_revoke_enrollment_require_session(auth_header, setup_device, tmp_path, monkeypatch):
    EnrollmentStore._tokens.clear()
    monkeypatch.setattr(enrollment_module, "get_data_dir", lambda: tmp_path)
    store = EnrollmentStore()
    from app.managers.adb_enrollment import normalize_adb_public_key
    normalized, fingerprint = normalize_adb_public_key(_public_key(), "PC-01")
    registered = store.register("tv-sala", "PC-01", normalized, fingerprint, "admin")
    revoke = AsyncMock(return_value={"success": True})
    monkeypatch.setattr(ADBKeyProvisioner, "revoke", revoke)

    async with await _client() as c:
        unauthorized = await c.get("/api/scrcpy/client/enrollments")
        listed = await c.get("/api/scrcpy/client/enrollments", headers=auth_header)
        removed = await c.delete(
            f"/api/scrcpy/client/enrollments/{registered['id']}/tv-sala", headers=auth_header,
        )

    assert unauthorized.status_code == 401
    assert listed.status_code == 200
    assert "public_key" not in listed.json()["clients"][0]
    assert removed.status_code == 200
    assert EnrollmentStore().get_client(registered["id"]) is None
    revoke.assert_awaited_once()
