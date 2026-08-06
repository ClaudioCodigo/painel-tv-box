"""API de autenticação — login com usuário/senha do administrador."""

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import (
    admin_configured,
    create_session_token,
    get_admin_username,
    set_admin,
    validate_credentials,
    verify_admin,
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
async def login(body: LoginBody):
    """Autentica com usuário/senha do administrador e emite token de sessão.

    Sem admin configurado (migração de instalações existentes), aceita o
    token legado de `config/.panel_token` para não bloquear o acesso."""
    if not admin_configured():
        # Migração: token legado ainda vale até o admin ser criado
        from app.core.auth import check_token

        if body.token and check_token(body.token):
            return {"success": True, "token": body.token, "username": "painel", "expires_in": None}
        raise HTTPException(status_code=409, detail="admin_nao_configurado")

    if not body.username or not body.password:
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")

    if not verify_admin(body.username, body.password):
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")

    token = create_session_token(get_admin_username())
    return {
        "success": True,
        "token": token,
        "username": get_admin_username(),
        "expires_in": 12 * 3600,
    }


@router.post("/set-admin")
async def auth_set_admin(body: SetAdminBody):
    """Cria/atualiza o administrador (exige sessão válida; o wizard também
    cria na 1ª execução via /api/wizard/finish)."""
    error = validate_credentials(body.username, body.password)
    if error:
        raise HTTPException(400, error)

    was_configured = admin_configured()
    created = set_admin(body.username, body.password)

    # Na primeira criação, devolve um token de sessão (login imediato)
    result = {"success": True, "username": created["username"], "created": not was_configured}
    if not was_configured:
        result["token"] = create_session_token(created["username"])
    return result
