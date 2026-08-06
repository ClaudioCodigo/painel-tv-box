"""Testes da autenticação por usuário/senha do administrador (D-05..D-08).

Isolam config/admin.json e .session_secret em tmp_path (nunca tocam a config
real da máquina de dev).
"""

import time

import httpx
import pytest

import app.core.auth as auth
from app.main import app

# Sessão legada (token do painel) — vale enquanto não há admin
LEGACY_TOKEN = auth.get_or_create_token()


@pytest.fixture
def auth_files(tmp_path, monkeypatch):
    """Redireciona admin.json/.session_secret para tmp_path e limpa caches."""
    admin_file = tmp_path / "admin.json"
    secret_file = tmp_path / ".session_secret"
    monkeypatch.setattr(auth, "ADMIN_FILE", admin_file)
    monkeypatch.setattr(auth, "SESSION_SECRET_FILE", secret_file)
    monkeypatch.setattr(auth, "_secret_cache", "")
    monkeypatch.setattr(auth, "_token_cache", "")
    return admin_file


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def _client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


# ── Admin storage ────────────────────────────────────────────────────────────

def test_admin_configured_false_by_default(auth_files):
    assert auth.admin_configured() is False


def test_set_and_verify_admin(auth_files):
    auth.set_admin("admin", "senha-super-secreta-1")
    assert auth.admin_configured() is True
    assert auth.verify_admin("admin", "senha-super-secreta-1") is True
    assert auth.verify_admin("admin", "errada") is False
    assert auth.verify_admin("outro", "senha-super-secreta-1") is False
    assert auth.get_admin_username() == "admin"


def test_set_admin_rejects_short_password(auth_files):
    auth.set_admin("admin", "curta")
    assert auth.verify_admin("admin", "curta") is True  # set_admin não valida; API valida


# ── Session token ────────────────────────────────────────────────────────────

def test_session_token_roundtrip(auth_files):
    tok = auth.create_session_token("admin")
    assert auth.verify_session_token(tok) == "admin"


def test_session_token_tampered(auth_files):
    tok = auth.create_session_token("admin")
    tampered = tok[:-3] + ("abc" if not tok.endswith("abc") else "xyz")
    assert auth.verify_session_token(tampered) is None


def test_session_token_expired(auth_files, monkeypatch):
    auth.create_session_token("admin")  # garante secret
    payload = {
        "sub": "admin",
        "iat": int(time.time()) - 100,
        "exp": int(time.time()) - 10,
        "jti": "x",
    }
    body = auth._b64url_encode(__import__("json").dumps(payload, separators=(",", ":")).encode())
    import hashlib, hmac as _hmac
    sig = _hmac.new(auth._session_secret().encode(), body.encode(), hashlib.sha256).digest()
    tok = f"{body}.{auth._b64url_encode(sig)}"
    assert auth.verify_session_token(tok) is None


# ── check_token (compat legado → só sessão) ─────────────────────────────────

def test_check_token_legacy_without_admin(auth_files):
    assert auth.check_token(LEGACY_TOKEN) is True
    assert auth.check_token("qualquer-coisa") is False


def test_check_token_session_only_with_admin(auth_files):
    auth.set_admin("admin", "senha-super-secreta-1")
    assert auth.check_token(LEGACY_TOKEN) is False  # token legado deixa de valer
    tok = auth.create_session_token("admin")
    assert auth.check_token(tok) is True
    assert auth.check_token("garbage") is False


# ── API ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_auth_status_public(auth_files):
    async with await _client() as c:
        r = await c.get("/api/auth/status")
        assert r.status_code == 200
        assert r.json()["admin_configured"] is False
        assert r.json()["method"] == "token"


@pytest.mark.asyncio
async def test_login_409_when_no_admin(auth_files):
    async with await _client() as c:
        r = await c.post("/api/auth/login", json={"username": "admin", "password": "x" * 8})
        assert r.status_code == 409
        assert r.json()["detail"] == "admin_nao_configurado"


@pytest.mark.asyncio
async def test_login_legacy_token_when_no_admin(auth_files):
    """Migração: sem admin, o token legado ainda faz login (não trava acesso)."""
    async with await _client() as c:
        r = await c.post("/api/auth/login", json={"token": LEGACY_TOKEN})
        assert r.status_code == 200
        assert r.json()["token"] == LEGACY_TOKEN
        r = await c.post("/api/auth/login", json={"token": "invalido"})
        assert r.status_code == 409


@pytest.mark.asyncio
async def test_login_ok_and_wrong(auth_files):
    auth.set_admin("admin", "senha-super-secreta-1")
    async with await _client() as c:
        r = await c.post("/api/auth/login", json={"username": "admin", "password": "errada"})
        assert r.status_code == 401
        r = await c.post("/api/auth/login", json={"username": "admin", "password": "senha-super-secreta-1"})
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True
        assert data["username"] == "admin"
        assert auth.verify_session_token(data["token"]) == "admin"


@pytest.mark.asyncio
async def test_protected_route_requires_session(auth_files):
    auth.set_admin("admin", "senha-super-secreta-1")
    async with await _client() as c:
        # token legado NÃO abre mais as rotas
        r = await c.get("/api/system/metrics", headers={"Authorization": f"Bearer {LEGACY_TOKEN}"})
        assert r.status_code == 401
        # sessão válida abre
        tok = auth.create_session_token("admin")
        r = await c.get("/api/system/metrics", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200


@pytest.mark.asyncio
async def test_set_admin_api_creates_and_returns_token(auth_files):
    async with await _client() as c:
        r = await c.post(
            "/api/auth/set-admin",
            headers={"Authorization": f"Bearer {LEGACY_TOKEN}"},
            json={"username": "admin", "password": "senha-super-secreta-1"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["created"] is True
        assert auth.verify_session_token(data["token"]) == "admin"
        assert auth.admin_configured() is True


@pytest.mark.asyncio
async def test_set_admin_api_validations(auth_files):
    async with await _client() as c:
        r = await c.post(
            "/api/auth/set-admin",
            headers={"Authorization": f"Bearer {LEGACY_TOKEN}"},
            json={"username": "admin", "password": "curta"},
        )
        assert r.status_code == 400
        r = await c.post(
            "/api/auth/set-admin",
            headers={"Authorization": f"Bearer {LEGACY_TOKEN}"},
            json={"username": "../etc/passwd", "password": "senha-super-secreta-1"},
        )
        assert r.status_code == 400
        # usuário com espaço é rejeitado (username, não nome completo)
        r = await c.post(
            "/api/auth/set-admin",
            headers={"Authorization": f"Bearer {LEGACY_TOKEN}"},
            json={"username": "admin da silva", "password": "senha-super-secreta-1"},
        )
        assert r.status_code == 400
        # payload/controle na senha é rejeitado
        r = await c.post(
            "/api/auth/set-admin",
            headers={"Authorization": f"Bearer {LEGACY_TOKEN}"},
            json={"username": "admin", "password": "senha\ncom\ncontrole"},
        )
        assert r.status_code == 400


# ── validate_credentials (regra única: API + wizard) ─────────────────────────

def test_validate_credentials_ok():
    assert auth.validate_credentials("admin", "senha-super-secreta-1") is None
    assert auth.validate_credentials("claudio.lima@tvbox", "senha-super-secreta-1") is None
    assert auth.validate_credentials("tv_admin-2", "senha-super-secreta-1") is None


def test_validate_credentials_rejects():
    # espaço no username
    assert auth.validate_credentials("admin da silva", "senha-super-secreta-1") is not None
    # payload/separadores de caminho
    assert auth.validate_credentials("../etc/passwd", "senha-super-secreta-1") is not None
    assert auth.validate_credentials("a/b", "senha-super-secreta-1") is not None
    assert auth.validate_credentials('x"y', "senha-super-secreta-1") is not None
    # controle
    assert auth.validate_credentials("admin", "senha\nquebrada") is not None
    assert auth.validate_credentials("admin", "senha\x00nula") is not None
    # curta / longa / contém o usuário
    assert auth.validate_credentials("admin", "curta") is not None
    assert auth.validate_credentials("admin", "x" * 300) is not None
    assert auth.validate_credentials("admin", "ADMIN-senha-fraca") is not None
