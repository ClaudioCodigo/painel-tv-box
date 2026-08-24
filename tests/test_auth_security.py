"""Testes de segurança e robustez da autenticação (Phase 1).

Testa:
- Rate limiting por IP (HTTP 429)
- Lockout temporário por username após 5 falhas
- Revogação de token individual via /api/auth/logout (JTI)
- Revogação em massa via revoke_all_tokens
- Proteção de alteração de credenciais via current_password
"""

import time
import httpx
import pytest

import app.core.auth as auth
from app.main import app


@pytest.fixture
def auth_security_files(tmp_path, monkeypatch):
    admin_file = tmp_path / "admin.json"
    secret_file = tmp_path / ".session_secret"
    monkeypatch.setattr(auth, "ADMIN_FILE", admin_file)
    monkeypatch.setattr(auth, "SESSION_SECRET_FILE", secret_file)
    monkeypatch.setattr(auth, "_secret_cache", "")
    monkeypatch.setattr(auth, "_token_cache", "")
    auth._reset_rate_limits()
    yield admin_file
    auth._reset_rate_limits()


async def _client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_rate_limiting_ip(auth_security_files):
    """6 tentativas de login a partir do mesmo IP disparam rate limit 429."""
    auth.set_admin("admin", "senha-super-secreta-1")
    async with await _client() as c:
        for i in range(5):
            r = await c.post("/api/auth/login", json={"username": "admin", "password": "errada"})
            assert r.status_code == 401
        # 6ª tentativa -> 429
        r = await c.post("/api/auth/login", json={"username": "admin", "password": "senha-super-secreta-1"})
        assert r.status_code == 429
        assert "Muitas tentativas" in r.json()["detail"]


@pytest.mark.asyncio
async def test_user_lockout(auth_security_files):
    """5 falhas consecutivas para o mesmo usuário bloqueiam a conta (HTTP 429)."""
    auth.set_admin("alvo", "senha-super-secreta-1")
    # Reset IP rate limit to test specifically username lockout
    auth._login_attempts.clear()
    
    # 5 failures from different IPs
    for i in range(5):
        auth.record_login_failure("alvo", f"192.168.1.{i+10}")

    assert auth.is_user_locked("alvo") is True

    async with await _client() as c:
        r = await c.post("/api/auth/login", json={"username": "alvo", "password": "senha-super-secreta-1"})
        assert r.status_code == 429
        assert "bloqueada" in r.json()["detail"]


@pytest.mark.asyncio
async def test_logout_revokes_token(auth_security_files):
    """POST /api/auth/logout invalida o token de sessão atual."""
    auth.set_admin("admin", "senha-super-secreta-1")
    async with await _client() as c:
        # Login
        r = await c.post("/api/auth/login", json={"username": "admin", "password": "senha-super-secreta-1"})
        assert r.status_code == 200
        token = r.json()["token"]

        # Rota protegida acessível
        r = await c.get("/api/system/metrics", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200

        # Logout
        r = await c.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200

        # Rota protegida agora rejeita o token revogado
        r = await c.get("/api/system/metrics", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_revoke_all_tokens(auth_security_files):
    """revoke_all_tokens invalida todas as sessões emitidas anteriormente."""
    auth.set_admin("admin", "senha-super-secreta-1")
    tok1 = auth.create_session_token("admin")
    time.sleep(0.01)
    
    assert auth.verify_session_token(tok1) == "admin"
    auth.revoke_all_tokens()
    assert auth.verify_session_token(tok1) is None

    # Novo token após revogação funciona
    time.sleep(0.01)
    tok2 = auth.create_session_token("admin")
    assert auth.verify_session_token(tok2) == "admin"


@pytest.mark.asyncio
async def test_set_admin_requires_current_password(auth_security_files):
    """Alterar admin existente exige a senha atual correta."""
    auth.set_admin("admin", "senha-antiga-123")
    tok = auth.create_session_token("admin")

    async with await _client() as c:
        # Sem current_password -> 401
        r = await c.post(
            "/api/auth/set-admin",
            headers={"Authorization": f"Bearer {tok}"},
            json={"username": "admin", "password": "nova-senha-456"},
        )
        assert r.status_code == 401
        assert "Senha atual incorreta" in r.json()["detail"]

        # Com current_password errada -> 401
        r = await c.post(
            "/api/auth/set-admin",
            headers={"Authorization": f"Bearer {tok}"},
            json={"username": "admin", "password": "nova-senha-456", "current_password": "errada"},
        )
        assert r.status_code == 401

        # Com current_password correta -> 200
        r = await c.post(
            "/api/auth/set-admin",
            headers={"Authorization": f"Bearer {tok}"},
            json={"username": "admin", "password": "nova-senha-456", "current_password": "senha-antiga-123"},
        )
        assert r.status_code == 200
        assert auth.verify_admin("admin", "nova-senha-456") is True
