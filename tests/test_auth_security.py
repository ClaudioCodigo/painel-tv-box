"""Testes de segurança e robustez da autenticação (Wave 1).

Testa:
- Rate limiting por IP sem mutação na checagem (HTTP 429)
- Falhas associadas estritamente ao IP (sem lockout global de usuário entre IPs)
- Limpeza imediata de falhas do IP após login com sucesso
- Revogação de token individual via /api/auth/logout (JTI)
- Revogação persistente de tokens via .revoked_epoch
- Fechamento ativo de conexões WebSocket no logout (ws_hub.close_all)
- Emissão e consumo de tickets efêmeros (TTL 60s) e rota POST /api/auth/ticket
- Proteção de alteração de credenciais via current_password
"""

import time
from unittest.mock import AsyncMock

import httpx
import pytest

import app.core.auth as auth
from app.core.websocket import WebSocketHub
from app.main import app


@pytest.fixture
def auth_security_files(tmp_path, monkeypatch):
    admin_file = tmp_path / "admin.json"
    secret_file = tmp_path / ".session_secret"
    revoked_file = tmp_path / ".revoked_epoch"
    monkeypatch.setattr(auth, "ADMIN_FILE", admin_file)
    monkeypatch.setattr(auth, "SESSION_SECRET_FILE", secret_file)
    monkeypatch.setattr(auth, "REVOKED_EPOCH_FILE", revoked_file)
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
        for _ in range(5):
            r = await c.post("/api/auth/login", json={"username": "admin", "password": "errada"})
            assert r.status_code == 401
        # 6ª tentativa -> 429
        r = await c.post("/api/auth/login", json={"username": "admin", "password": "senha-super-secreta-1"})
        assert r.status_code == 429
        assert "Muitas tentativas" in r.json()["detail"]


@pytest.mark.asyncio
async def test_no_global_user_lockout_across_ips(auth_security_files):
    """Falhas para um usuário no IP A não bloqueiam o mesmo usuário a partir do IP B."""
    auth.set_admin("admin", "senha-super-secreta-1")
    # 5 falhas no IP 10.0.0.1
    for _ in range(5):
        auth.record_login_failure("10.0.0.1", "admin")

    assert auth.is_ip_rate_limited("10.0.0.1") is True
    assert auth.is_ip_rate_limited("10.0.0.2") is False

    # IP 127.0.0.1 (cliente de teste) faz login com sucesso mesmo com 10.0.0.1 bloqueado
    async with await _client() as c:
        r = await c.post("/api/auth/login", json={"username": "admin", "password": "senha-super-secreta-1"})
        assert r.status_code == 200
        assert r.json()["success"] is True


def test_is_ip_rate_limited_does_not_mutate():
    """is_ip_rate_limited faz apenas checagem, sem registrar nova falha."""
    ip = "192.168.1.150"
    for _ in range(10):
        assert auth.is_ip_rate_limited(ip) is False

    for _ in range(4):
        auth.record_login_failure(ip, "admin")
    assert auth.is_ip_rate_limited(ip) is False

    auth.record_login_failure(ip, "admin")
    assert auth.is_ip_rate_limited(ip) is True


def test_clear_ip_failures():
    """clear_ip_failures reseta as falhas acumuladas do IP."""
    ip = "192.168.1.160"
    for _ in range(5):
        auth.record_login_failure(ip, "admin")
    assert auth.is_ip_rate_limited(ip) is True
    auth.clear_ip_failures(ip)
    assert auth.is_ip_rate_limited(ip) is False


@pytest.mark.asyncio
async def test_logout_revokes_token_and_closes_ws(auth_security_files, monkeypatch):
    """POST /api/auth/logout invalida o token e chama ws_hub.close_all."""
    auth.set_admin("admin", "senha-super-secreta-1")

    # Mock do ws_hub no app.state
    mock_hub = AsyncMock()
    monkeypatch.setattr(app.state, "ws_hub", mock_hub, raising=False)

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
        assert r.json()["message"] == "Sessão encerrada"

        # Hub close_all foi invocado
        mock_hub.close_all.assert_awaited_once_with(code=4401, reason="Logout")

        # Rota protegida agora rejeita o token revogado
        r = await c.get("/api/system/metrics", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_revoke_all_tokens_persistent(auth_security_files):
    """revoke_all_tokens persiste em disco e invalida tokens mesmo após reset em memória."""
    auth.set_admin("admin", "senha-super-secreta-1")
    tok1 = auth.create_session_token("admin")
    time.sleep(0.01)

    assert auth.verify_session_token(tok1) == "admin"
    auth.revoke_all_tokens()
    assert auth.verify_session_token(tok1) is None

    # Simula reinício de processo zerando _revoked_before em memória
    auth._revoked_before = 0.0
    # O arquivo persistido ainda invalida tok1
    assert auth.verify_session_token(tok1) is None

    # Novo token após revogação funciona
    time.sleep(0.01)
    tok2 = auth.create_session_token("admin")
    assert auth.verify_session_token(tok2) == "admin"


@pytest.mark.asyncio
async def test_ws_hub_close_all_method():
    """WebSocketHub.close_all fecha todas as conexões com o código fornecido."""
    hub = WebSocketHub()
    mock_ws1 = AsyncMock()
    mock_ws2 = AsyncMock()
    await hub.connect(mock_ws1)
    await hub.connect(mock_ws2)
    assert hub.active_count == 2

    await hub.close_all(code=4401, reason="Logout")
    assert hub.active_count == 0
    mock_ws1.close.assert_awaited_once_with(code=4401, reason="Logout")
    mock_ws2.close.assert_awaited_once_with(code=4401, reason="Logout")


def test_ephemeral_ticket_lifecycle():
    """Tickets efêmeros funcionam como descartáveis de uso único e expiram."""
    ticket = auth.create_ephemeral_ticket("admin")
    assert isinstance(ticket, str) and len(ticket) > 10

    # 1º consumo: sucesso
    assert auth.consume_ephemeral_ticket(ticket) == "admin"
    # 2º consumo: descartável (None)
    assert auth.consume_ephemeral_ticket(ticket) is None

    # Ticket expirado
    t_exp = auth.create_ephemeral_ticket("admin")
    auth._ephemeral_tickets[t_exp] = ("admin", time.time() - 1.0)
    assert auth.consume_ephemeral_ticket(t_exp) is None


@pytest.mark.asyncio
async def test_ephemeral_ticket_endpoint(auth_security_files):
    """POST /api/auth/ticket emite ticket de 60s sob autenticação Bearer."""
    auth.set_admin("admin", "senha-super-secreta-1")

    async with await _client() as c:
        # Sem autenticação -> 401
        r = await c.post("/api/auth/ticket")
        assert r.status_code == 401

        # Com autenticação -> 200
        tok = auth.create_session_token("admin")
        r = await c.post("/api/auth/ticket", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        data = r.json()
        assert "ticket" in data
        assert data["expires_in"] == 60

        # Ticket emitido pode ser consumido uma única vez
        assert auth.consume_ephemeral_ticket(data["ticket"]) == "admin"
        assert auth.consume_ephemeral_ticket(data["ticket"]) is None


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
