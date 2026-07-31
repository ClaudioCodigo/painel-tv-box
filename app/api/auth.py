"""API de autenticação — login por token compartilhado."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.auth import check_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    token: str


@router.post("/login")
async def login(body: LoginBody):
    """Valida o token de acesso do painel."""
    if not check_token(body.token):
        raise HTTPException(status_code=401, detail="Token inválido")
    return {"success": True, "token": body.token}
