"""Autenticação do painel: login com usuário/senha de administrador.

- As credenciais do admin ficam em `config/admin.json` (gitignored), criadas
  pelo wizard (1ª execução) ou pela página Configurações. Hash PBKDF2-SHA256
  com salt aleatório; comparação em tempo constante.
- O login emite um **token de sessão** assinado (HMAC-SHA256, expira em 12h)
  usando um segredo persistido em `config/.session_secret` (gitignored).
  Enviado via `Authorization: Bearer <token>` ou query `?token=` (downloads/
  imagens via window.open/<img>); o WebSocket valida via `?token=`.
- **Compat/backward:** enquanto NÃO houver admin configurado, o painel aceita
  o token legado `config/.panel_token` (instalações existentes). Assim que o
  admin é criado, apenas sessões de login são aceitas.
"""

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
from pathlib import Path

from fastapi import HTTPException, Request

logger = logging.getLogger("system")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"
TOKEN_FILE = CONFIG_DIR / ".panel_token"
ADMIN_FILE = CONFIG_DIR / "admin.json"
SESSION_SECRET_FILE = CONFIG_DIR / ".session_secret"

SESSION_TTL = 12 * 3600  # 12h
PBKDF2_ITERATIONS = 200_000

# Rate limiting & Lockout
RATE_LIMIT_WINDOW = 300       # 5 minutos
RATE_LIMIT_MAX = 5            # máx 5 tentativas por IP em 5 min
LOCKOUT_DURATION = 900        # 15 minutos de bloqueio
LOCKOUT_THRESHOLD = 5         # 5 falhas consecutivas bloqueiam usuário

_login_attempts: dict[str, list[float]] = {}   # ip -> timestamps
_user_failures: dict[str, list[float]] = {}    # user -> timestamps de falhas
_revoked_jtis: set[str] = set()                # JTIs de tokens revogados
_revoked_before: float = 0.0                       # revogação em massa

# Username: allowlist estrita — letras/dígitos e . _ @ - (SEM espaços,
# sem controle, sem separadores de caminho, sem aspas/colchetes).
USERNAME_RE = re.compile(r"^[A-Za-z0-9._@-]{2,64}$")
# Caracteres de controle (incl. \0, \n, \r, DEL) — rejeitados na senha.
PASSWORD_CTRL_RE = re.compile(r"[\x00-\x1f\x7f]")

_token_cache: str = ""
_secret_cache: str = ""


def check_rate_limit(client_ip: str) -> bool:
    """Verifica rate limiting por IP na janela deslizante. Retorna False se exceder."""
    now = time.time()
    attempts = _login_attempts.get(client_ip, [])
    attempts = [t for t in attempts if now - t < RATE_LIMIT_WINDOW]
    if len(attempts) >= RATE_LIMIT_MAX:
        _login_attempts[client_ip] = attempts
        return False
    attempts.append(now)
    _login_attempts[client_ip] = attempts
    return True


def is_user_locked(username: str) -> bool:
    """Verifica se o usuário está temporariamente bloqueado após muitas falhas."""
    if not username:
        return False
    now = time.time()
    uname = username.strip().lower()
    fails = _user_failures.get(uname, [])
    fails = [t for t in fails if now - t < LOCKOUT_DURATION]
    _user_failures[uname] = fails
    return len(fails) >= LOCKOUT_THRESHOLD


def record_login_failure(username: str | None, client_ip: str):
    """Registra falha de login para lockout de usuário e log de auditoria."""
    now = time.time()
    uname = (username or "").strip().lower()
    if uname:
        fails = _user_failures.get(uname, [])
        fails = [t for t in fails if now - t < LOCKOUT_DURATION]
        fails.append(now)
        _user_failures[uname] = fails
    logger.warning("Falha de autenticação: user='%s' ip=%s", username or "", client_ip)


def clear_user_failures(username: str | None):
    """Limpa contador de falhas após login bem-sucedido."""
    uname = (username or "").strip().lower()
    if uname:
        _user_failures.pop(uname, None)


def _reset_rate_limits():
    """Auxiliar para testes: limpa rate limits e lockouts."""
    _login_attempts.clear()
    _user_failures.clear()
    _revoked_jtis.clear()
    global _revoked_before
    _revoked_before = 0


def revoke_token_by_raw(token: str | None) -> bool:
    """Revoga um token de sessão pelo seu JTI."""
    if not token or "." not in token:
        return False
    try:
        body, _ = token.rsplit(".", 1)
        payload = json.loads(_b64url_decode(body))
        jti = payload.get("jti")
        if jti:
            _revoked_jtis.add(str(jti))
            logger.info("Token de sessão revogado (jti='%s')", jti)
            return True
    except Exception as e:
        logger.warning("Falha ao revogar token: %s", e)
    return False


def revoke_all_tokens():
    """Invalida todas as sessões anteriores a este momento."""
    global _revoked_before
    _revoked_before = time.time()
    _revoked_jtis.clear()
    logger.warning("Todas as sessões ativas foram revogadas.")


def validate_credentials(username: str, password: str) -> str | None:
    """Valida usuário/senha para criar/alterar o administrador.

    Retorna uma mensagem de erro legível ou None se válido. Usada pela API
    (/api/auth/set-admin) E pelo wizard (/api/wizard/finish) — nunca crie
    admin fora desta validação.
    """
    username = (username or "").strip()
    if not USERNAME_RE.match(username):
        return "Usuário inválido — use 2-64 caracteres: letras, números, . _ @ - (sem espaços)"
    if not password or PASSWORD_CTRL_RE.search(password):
        return "Senha inválida — não pode conter caracteres de controle"
    if len(password) < 8:
        return "Senha precisa ter pelo menos 8 caracteres"
    if len(password) > 256:
        return "Senha muito longa (máximo 256 caracteres)"
    if username.lower() in password.lower():
        return "A senha não pode conter o nome de usuário"
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Admin (usuário/senha)
# ─────────────────────────────────────────────────────────────────────────────

def admin_configured() -> bool:
    try:
        return ADMIN_FILE.is_file()
    except Exception:
        return False


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS).hex()


def set_admin(username: str, password: str) -> dict:
    """Cria/atualiza o administrador. Retorna o registro salvo (sem o hash)."""
    salt = secrets.token_bytes(16)
    data = {
        "username": username.strip(),
        "salt": salt.hex(),
        "hash": _hash_password(password, salt),
        "created_at": int(time.time()),
    }
    ADMIN_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    try:
        ADMIN_FILE.chmod(0o600)
    except Exception:
        pass
    logger.info("Administrador do painel configurado (usuário '%s')", data["username"])
    return {"username": data["username"], "created_at": data["created_at"]}


def verify_admin(username: str, password: str) -> bool:
    """Verifica usuário/senha em tempo constante (anti enumeração de usuário)."""
    try:
        data = json.loads(ADMIN_FILE.read_text(encoding="utf-8"))
    except Exception:
        return False
    user_ok = hmac.compare_digest(username.strip().encode("utf-8"), data.get("username", "").encode("utf-8"))
    salt = bytes.fromhex(data.get("salt", ""))
    expected = data.get("hash", "")
    pass_ok = hmac.compare_digest(_hash_password(password, salt).encode("utf-8"), expected.encode("utf-8"))
    return user_ok and pass_ok


def get_admin_username() -> str:
    try:
        return json.loads(ADMIN_FILE.read_text(encoding="utf-8")).get("username", "")
    except Exception:
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Token de sessão (assinado, expira)
# ─────────────────────────────────────────────────────────────────────────────

def _session_secret() -> str:
    global _secret_cache
    if _secret_cache:
        return _secret_cache
    try:
        if SESSION_SECRET_FILE.is_file():
            s = SESSION_SECRET_FILE.read_text(encoding="utf-8").strip()
            if s:
                _secret_cache = s
                return s
        s = secrets.token_urlsafe(48)
        SESSION_SECRET_FILE.write_text(s, encoding="utf-8")
        try:
            SESSION_SECRET_FILE.chmod(0o600)
        except Exception:
            pass
        _secret_cache = s
        return s
    except Exception as e:
        logger.error("Falha ao gerenciar segredo de sessão: %s", e)
        return ""


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def create_session_token(username: str) -> str:
    payload = {
        "sub": username,
        "iat": time.time(),
        "exp": int(time.time()) + SESSION_TTL,
        "jti": secrets.token_urlsafe(12),
    }
    body = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(_session_secret().encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64url_encode(sig)}"


def verify_session_token(token: str | None) -> str | None:
    """Valida assinatura/expiração; retorna o username ou None."""
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    secret = _session_secret()
    if not secret:
        return None
    expected = hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    try:
        if not hmac.compare_digest(expected, _b64url_decode(sig)):
            return None
        payload = json.loads(_b64url_decode(body))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < time.time():
        return None
    iat = float(payload.get("iat", 0))
    if _revoked_before and iat <= _revoked_before:
        return None
    jti = payload.get("jti")
    if jti and str(jti) in _revoked_jtis:
        return None
    return str(payload.get("sub", "")) or None


# ─────────────────────────────────────────────────────────────────────────────
# Token legado (config/.panel_token) — aceito apenas enquanto não há admin
# ─────────────────────────────────────────────────────────────────────────────

def get_or_create_token() -> str:
    """Lê o token legado; gera e persiste um novo se não existir."""
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
        logger.warning("Painel: token de acesso gerado em %s (use até criar o administrador)", TOKEN_FILE)
        return tok
    except Exception as e:
        logger.error("Falha ao gerenciar token de acesso: %s", e)
        return ""


def check_token(candidate: str | None) -> bool:
    """Valida a credencial de acesso.

    Com admin configurado: aceita apenas token de sessão válido.
    Sem admin (instalação nova/legada): aceita o token legado do painel.
    """
    if not candidate:
        return False
    if admin_configured():
        return verify_session_token(candidate) is not None
    token = get_or_create_token()
    if not token:
        return False
    return hmac.compare_digest(candidate.encode("utf-8"), token.encode("utf-8"))


PUBLIC_PATHS = {"/api/system/health", "/api/auth/login", "/api/auth/status", "/api/auth/logout"}


def _is_public_path(path: str) -> bool:
    """Rotas públicas que possuem sua própria credencial de uso único."""
    if path in PUBLIC_PATHS:
        return True
    return bool(re.fullmatch(r"/api/scrcpy/client/enroll/[a-z0-9][a-z0-9._-]{0,63}", path))


def _extract_token(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip() or None
    return request.query_params.get("token")


async def require_auth(request: Request):
    """Dependency global: exige credencial válida em rotas protegidas."""
    if _is_public_path(request.url.path):
        return

    # Se a segurança estiver desligada na config, não exige credencial.
    # Sem config carregada (app.main.config is None) → fail-closed: exige.
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
    """Valida credencial para conexões WebSocket (via ?token=)."""
    return check_token(websocket.query_params.get("token"))
