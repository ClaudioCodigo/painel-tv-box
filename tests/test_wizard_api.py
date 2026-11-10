"""Testes para o Wizard de Configuração Inicial (Wave 2 - DTO Tipado e Bloqueio 403)."""

import httpx
import pytest
from pydantic import ValidationError

import app.core.auth as auth
from app.core.auth import verify_session_token
from app.main import app
from app.models.wizard import WizardAdminDTO, WizardDeviceDTO, WizardFinishRequest


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    """Isola arquivos de config e auth em tmp_path para testes de wizard."""
    admin_file = tmp_path / "admin.json"
    secret_file = tmp_path / ".session_secret"
    revoked_file = tmp_path / ".revoked_epoch"

    monkeypatch.setattr(auth, "ADMIN_FILE", admin_file)
    monkeypatch.setattr(auth, "SESSION_SECRET_FILE", secret_file)
    monkeypatch.setattr(auth, "REVOKED_EPOCH_FILE", revoked_file)
    monkeypatch.setattr(auth, "_secret_cache", "")
    monkeypatch.setattr(auth, "_token_cache", "")
    auth._reset_rate_limits()

    # Isola config manager
    import app.main as main
    from app.core.config import ConfigurationManager
    from app.models.config import SystemConfig

    cm = ConfigurationManager()
    cm.config_dir = tmp_path / "config"
    cm.devices_dir = tmp_path / "devices"
    cm.groups_dir = tmp_path / "groups"
    cm.config_dir.mkdir(parents=True, exist_ok=True)
    cm.devices_dir.mkdir(parents=True, exist_ok=True)
    cm.groups_dir.mkdir(parents=True, exist_ok=True)
    cm.system = SystemConfig()
    cm.system.wizard_completed = False
    cm.wizard_completed = False
    cm.devices = []
    cm.groups = []

    monkeypatch.setattr(main, "config", cm)
    return cm


async def _client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


# ── Testes de Modelos DTO Pydantic v2 ─────────────────────────────────────────

def test_wizard_admin_dto_validation():
    # Válido
    dto = WizardAdminDTO(username="admin", password="password123")
    assert dto.username == "admin"
    assert dto.password == "password123"

    # Username muito curto (< 2 chars)
    with pytest.raises(ValidationError):
        WizardAdminDTO(username="a", password="password123")

    # Senha muito curta (< 8 chars)
    with pytest.raises(ValidationError):
        WizardAdminDTO(username="admin", password="short")


def test_wizard_device_dto_validation():
    # Válido com defaults
    dev = WizardDeviceDTO(name="TV Sala", ip="192.168.1.100")
    assert dev.name == "TV Sala"
    assert dev.ip == "192.168.1.100"
    assert dev.adb_port == 5555
    assert dev.group == ""
    assert dev.location == ""
    assert dev.player == "vlc"

    # Nome vazio
    with pytest.raises(ValidationError):
        WizardDeviceDTO(name="", ip="192.168.1.100")

    # IP vazio
    with pytest.raises(ValidationError):
        WizardDeviceDTO(name="TV Sala", ip="")

    # Porta inválida
    with pytest.raises(ValidationError):
        WizardDeviceDTO(name="TV Sala", ip="192.168.1.100", adb_port=70000)


def test_wizard_finish_request_validation():
    admin = WizardAdminDTO(username="admin", password="password123")
    dev = WizardDeviceDTO(name="TV Sala", ip="192.168.1.100")

    # Requer pelo menos 1 dispositivo
    with pytest.raises(ValidationError):
        WizardFinishRequest(admin=admin, devices=[])

    # Válido
    req = WizardFinishRequest(admin=admin, devices=[dev])
    assert len(req.devices) == 1
    assert req.server is None
    assert req.mediamtx is None


# ── Testes de Endpoint /api/wizard/finish ──────────────────────────────────────

@pytest.mark.asyncio
async def test_wizard_finish_validates_credentials(isolated_env):
    """Senha que contém o nome de usuário deve ser rejeitada com 400."""
    async with await _client() as client:
        payload = {
            "admin": {
                "username": "admin",
                "password": "ADMIN-password-fraca",  # contém 'admin'
            },
            "devices": [
                {"name": "TV Box 1", "ip": "192.168.1.101"}
            ],
        }
        resp = await client.post("/api/wizard/finish", json=payload)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Credenciais de administrador inválidas"


@pytest.mark.asyncio
async def test_wizard_finish_validates_ip(isolated_env):
    """IP inseguro (loopback/link-local/inválido) deve ser rejeitado com 400."""
    async with await _client() as client:
        payload = {
            "admin": {
                "username": "admin",
                "password": "senha-super-segura-1",
            },
            "devices": [
                {"name": "TV Box 1", "ip": "127.0.0.1"}  # loopback
            ],
        }
        resp = await client.post("/api/wizard/finish", json=payload)
        assert resp.status_code == 400
        assert "Endereço IP inválido ou inseguro" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_wizard_finish_success_with_defaults(isolated_env):
    """Execução bem-sucedida do wizard com aplicação de defaults."""
    async with await _client() as client:
        payload = {
            "admin": {
                "username": "gerente",
                "password": "senha-super-segura-1",
            },
            "devices": [
                {"name": "TV Recepcao", "ip": "192.168.1.150", "location": "Recepção", "player": "vlc"}
            ],
        }
        resp = await client.post("/api/wizard/finish", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["success"] is True
        assert data["wizard_completed"] is True
        assert data["username"] == "gerente"
        assert "session_token" in data

        # Token é válido
        token = data["session_token"]
        assert verify_session_token(token) == "gerente"

        # Admin configurado
        assert auth.admin_configured() is True
        assert auth.verify_admin("gerente", "senha-super-segura-1") is True

        # Rota protegida aceita o token emitido
        metrics_resp = await client.get("/api/system/metrics", headers={"Authorization": f"Bearer {token}"})
        assert metrics_resp.status_code == 200


@pytest.mark.asyncio
async def test_wizard_lockdown_blocks_reexecution(isolated_env):
    """Após finalização, /finish e /validate-device retornam 403."""
    async with await _client() as client:
        payload = {
            "admin": {
                "username": "admin",
                "password": "senha-super-segura-1",
            },
            "devices": [
                {"name": "TV Recepcao", "ip": "192.168.1.150"}
            ],
        }
        # Primeira execução (sucesso)
        resp1 = await client.post("/api/wizard/finish", json=payload)
        assert resp1.status_code == 200
        token = resp1.json()["session_token"]

        headers = {"Authorization": f"Bearer {token}"}

        # Segunda execução de /finish deve retornar 403
        resp2 = await client.post("/api/wizard/finish", json=payload, headers=headers)
        assert resp2.status_code == 403
        assert resp2.json()["detail"] == "Wizard já concluído — configuração protegida"

        # Execução de /validate-device deve retornar 403
        resp3 = await client.post("/api/wizard/validate-device", json={"ip": "192.168.1.150"}, headers=headers)
        assert resp3.status_code == 403
        assert resp3.json()["detail"] == "Wizard já concluído — configuração protegida"


@pytest.mark.asyncio
async def test_wizard_finish_with_full_custom_config_and_multiple_devices(isolated_env):
    """Execução do wizard com configs customizadas e dispositivos com nomes repetidos gerando IDs únicos."""
    async with await _client() as client:
        payload = {
            "admin": {
                "username": "superadmin",
                "password": "senha-super-segura-1",
            },
            "server": {"host": "192.168.1.10", "port": 8088, "ip": "192.168.1.10"},
            "mediamtx": {"api_url": "http://127.0.0.1:9997", "rtsp_port": 8555, "rtmp_port": 1936},
            "adb": {"default_port": 5556, "connect_timeout": 15},
            "groups": [{"name": "Setor Comercial", "description": "TVs do setor comercial"}],
            "devices": [
                {"name": "TV Sala", "ip": "192.168.1.101", "adb_port": 5555},
                {"name": "TV Sala", "ip": "192.168.1.102", "adb_port": 5555},
            ],
        }
        resp = await client.post("/api/wizard/finish", json=payload)
        assert resp.status_code == 200

        cm = isolated_env
        assert len(cm.devices) == 2
        ids = [d.id for d in cm.devices]
        assert len(set(ids)) == 2  # IDs únicos
        assert "tv-sala" in ids
        assert "tv-sala-2" in ids

        assert len(cm.groups) == 1
        assert cm.groups[0].name == "Setor Comercial"

        assert cm.system.server.port == 8088
        assert cm.system.adb.default_port == 5556


@pytest.mark.asyncio
async def test_wizard_validate_device_before_completed(isolated_env, monkeypatch):
    """Validação de dispositivo via ADB antes da conclusão do wizard."""
    from app.managers.adb import ADBManager

    async def mock_is_reachable(self, ip, port=5555):
        return {"ip": ip, "port": port, "reachable": True, "state": "device"}

    monkeypatch.setattr(ADBManager, "is_reachable", mock_is_reachable)

    async with await _client() as client:
        # IP não informado
        r1 = await client.post("/api/wizard/validate-device", json={})
        assert r1.status_code == 400
        assert r1.json()["detail"] == "IP não informado"

        # IP inseguro (loopback)
        r2 = await client.post("/api/wizard/validate-device", json={"ip": "127.0.0.1"})
        assert r2.status_code == 400
        assert "bloqueado" in r2.json()["detail"]

        # IP válido
        r3 = await client.post("/api/wizard/validate-device", json={"ip": "192.168.1.120"})
        assert r3.status_code == 200
        assert r3.json()["reachable"] is True

