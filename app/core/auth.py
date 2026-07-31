"""Autenticação simples por token compartilhado (painel de rede local).

O token é gerado automaticamente no primeiro boot e persistido em
config/.panel_token (fora do versionamento). Todas as rotas /api/*
(exceto health, login e wizard pendente) exigem o token via header
`Authorization: Bearer <token>` ou query `?token=` (necessário para
downloads/img via window.open e <img>).
"""

import hmac
import logging
import secrets
from pathlib import Path

from fastapi import HTTPException, Request

logger = logging.getLogger("system")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TOKEN_FILE = PROJECT_ROOT / "config" / ".panel_token"

_token_cache: str = ""


def get_or_create_token() -> str:
    """Lê o token do arquivo; gera e persiste um novo se não existir."""
    global _token_cache
    if _token_cache:
        return _token_cache
    try:
        if TOKEN_FILE.is_file():
            tok = TOKEN_FILE.read_text(encoding="utf-8").strip()
            if tok:
                _token_cache = tok
                return tok
        tok = secrets.token_urlsafe(32)
        TOKEN_FILE.write_text(tok, encoding="utf-8")
        try:
            TOKEN_FILE.chmod(0o600)
        except Exception:
            pass
        _token_cache = tok
        logger.warning("Painel: token de acesso gerado em %s (guarde-o em local seguro)", TOKEN_FILE)
        return tok
    except Exception as e:
        logger.error("Falha ao gerenciar token de acesso: %s", e)
        return ""


def check_token(candidate: str | None) -> bool:
    """Comparação em tempo constante com o token armazenado."""
    if not candidate:
        return False
    token = get_or_create_token()
    if not token:
        return False
    return hmac.compare_digest(candidate.encode("utf-8"), token.encode("utf-8"))


PUBLIC_PATHS = {"/api/system/health", "/api/auth/login"}


def _extract_token(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip() or None
    return request.query_params.get("token")


async def require_auth(request: Request):
    """Dependency global: exige token válido em rotas protegidas."""
    if request.url.path in PUBLIC_PATHS:
        return

    # Se a segurança estiver desligada na config, não exige token.
    # Sem config carregada (app.main.config is None) → fail-closed: exige token.
    try:
        import app.main

        cfg = app.main.config
        if cfg is None:
            security_enabled = True
        else:
            security_enabled = bool(
                getattr(cfg, "system", None)
                and getattr(cfg.system, "security", None)
                and cfg.system.security.enabled
            )
    except Exception:
        security_enabled = True
    if not security_enabled:
        return

    # Wizard liberado enquanto a configuração inicial não estiver completa
    try:
        import app.main

        cfg = app.main.config
        wizard_pending = not (cfg and getattr(cfg, "wizard_completed", False))
    except Exception:
        wizard_pending = True

    if wizard_pending and (
        request.url.path.startswith("/api/wizard")
        or request.url.path == "/api/system/wizard-status"
    ):
        return

    if not check_token(_extract_token(request)):
        raise HTTPException(status_code=401, detail="Não autenticado — faça login")


async def require_auth_ws(websocket) -> bool:
    """Valida token para conexões WebSocket (via ?token=)."""
    return check_token(websocket.query_params.get("token"))
