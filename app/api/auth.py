"""API de autenticação — login com usuário/senha do administrador."""

import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.auth import (
    _extract_token,
    admin_configured,
    clear_ip_failures,
    create_ephemeral_ticket,
    create_session_token,
    get_admin_username,
    is_ip_rate_limited,
    record_login_failure,
    require_auth,
    revoke_token_by_raw,
    set_admin,
    validate_credentials,
    verify_admin,
    verify_session_token,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    # Com admin configurado: usa username/password.
    # Sem admin (migração): aceita o token legado do painel.
    username: str | None = Field(default=None, min_length=1, max_length=64)
    password: str | None = Field(default=None, min_length=1, max_length=256)
    token: str | None = Field(default=None, max_length=256)


class SetAdminBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)
    current_password: str | None = Field(default=None, max_length=256)


@router.get("/status")
async def auth_status():
    """Estado da autenticação (público — usado pela tela de login)."""
    from app.api.system import wizard_status

    ws = await wizard_status()
    return {
        "admin_configured": admin_configured(),
        "wizard_completed": bool(ws.get("wizard_completed", False)),
        "method": "admin" if admin_configured() else "token",
    }


@router.post("/login")
async def login(body: LoginBody, request: Request):
    """Autentica com usuário/senha do administrador e emite token de sessão.

    Sem admin configurado (migração de instalações existentes), aceita o
    token legado de `config/.panel_token` para não bloquear o acesso."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    if is_ip_rate_limited(client_ip):
        raise HTTPException(
            status_code=429,
            detail="Muitas tentativas inválidas — aguarde 10 minutos",
        )

    if not admin_configured():
        # Migração: token legado ainda vale até o admin ser criado
        from app.core.auth import check_token

        if body.token and check_token(body.token):
            clear_ip_failures(client_ip)
            return {"success": True, "token": body.token, "username": "painel", "expires_in": None}
        record_login_failure(client_ip, body.username)
        raise HTTPException(status_code=409, detail="admin_nao_configurado")

    if not body.username or not body.password:
        record_login_failure(client_ip, body.username)
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")

    if not verify_admin(body.username, body.password):
        record_login_failure(client_ip, body.username)
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")

    clear_ip_failures(client_ip)
    token = create_session_token(get_admin_username())
    return {
        "success": True,
        "token": token,
        "username": get_admin_username(),
        "expires_in": 12 * 3600,
    }


@router.post("/logout")
async def logout(request: Request):
    """Revoga o token de sessão atual e encerra conexões WebSocket ativas."""
    token = _extract_token(request)
    if token:
        revoke_token_by_raw(token)
    hub = getattr(request.app.state, "ws_hub", None)
    if hub:
        await hub.close_all(code=4401, reason="Logout")
    return {"success": True, "message": "Sessão encerrada"}


@router.post("/ticket", dependencies=[Depends(require_auth)])
async def issue_ticket(request: Request):
    """Emite um ticket efêmero descartável (TTL 60s) para conexões sensíveis como WebSocket."""
    token = _extract_token(request)
    username = verify_session_token(token) if admin_configured() else "painel"
    if not username:
        username = get_admin_username() or "admin"
    ticket = create_ephemeral_ticket(username)
    return {"ticket": ticket, "expires_in": 60}


@router.post("/set-admin")
async def auth_set_admin(body: SetAdminBody):
    """Cria/atualiza o administrador (exige senha atual quando já configurado)."""
    was_configured = admin_configured()

    if was_configured:
        if not body.current_password or not verify_admin(get_admin_username(), body.current_password):
            raise HTTPException(status_code=401, detail="Senha atual incorreta")

    error = validate_credentials(body.username, body.password)
    if error:
        raise HTTPException(400, error)

    created = set_admin(body.username, body.password)

    # Na primeira criação, devolve um token de sessão (login imediato)
    result = {"success": True, "username": created["username"], "created": not was_configured}
    if not was_configured:
        result["token"] = create_session_token(created["username"])
    return result
