"""API de autenticação — login com usuário/senha do administrador."""

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import (
    admin_configured,
    create_session_token,
    get_admin_username,
    set_admin,
    verify_admin,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Usuário: 2-64 chars, sem separadores de caminho/controle (espaços e acentos ok)
USERNAME_RE = re.compile(r"^[^\x00-\x1f/\\<>:\"|?*]{2,64}$")


class LoginBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)


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
    """Autentica com usuário/senha do administrador e emite token de sessão."""
    if not admin_configured():
        raise HTTPException(status_code=409, detail="admin_nao_configurado")

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
    if not USERNAME_RE.match(body.username.strip()):
        raise HTTPException(400, "Usuário inválido (2-64 caracteres, sem / \\ < > : \" | ? *)")
    if len(body.password) < 8:
        raise HTTPException(400, "Senha precisa ter pelo menos 8 caracteres")
    if body.username.strip().lower() in body.password.lower():
        raise HTTPException(400, "A senha não pode conter o nome de usuário")

    was_configured = admin_configured()
    created = set_admin(body.username, body.password)

    # Na primeira criação, devolve um token de sessão (login imediato)
    result = {"success": True, "username": created["username"], "created": not was_configured}
    if not was_configured:
        result["token"] = create_session_token(created["username"])
    return result
