"""Matrícula de estações scrcpy com chaves ADB individuais.

A chave privada nasce e permanece no computador operador. O painel recebe apenas
a chave pública e, usando o acesso root já autorizado, cadastra-a no TV Box.
"""

import base64
import hashlib
import json
import re
import secrets
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.managers.adb import ADBManager
from app.utils.system import get_data_dir, is_safe_id


ENROLLMENT_TTL = 10 * 60
PUBLIC_KEY_MAX_LENGTH = 4096
CLIENT_NAME_RE = re.compile(r"^[A-Za-z0-9À-ÿ ._@()\-]{1,80}$")


def normalize_adb_public_key(value: str, client_name: str) -> tuple[str, str]:
    """Valida uma chave pública ADB e retorna linha normalizada + fingerprint."""
    if not isinstance(value, str) or not value or len(value) > PUBLIC_KEY_MAX_LENGTH:
        raise ValueError("Chave pública ADB inválida")
    if "\n" in value or "\r" in value or "\x00" in value:
        raise ValueError("Chave pública ADB inválida")
    if not CLIENT_NAME_RE.fullmatch(client_name or ""):
        raise ValueError("Nome da estação inválido")

    encoded = value.strip().split(maxsplit=1)[0]
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValueError("Chave pública ADB inválida") from exc
    # O formato Android RSA-2048 tem tamanho fixo, mas esta faixa mantém
    # compatibilidade com evoluções do ADB sem aceitar payloads arbitrários.
    if not 256 <= len(raw) <= 1024:
        raise ValueError("Chave pública ADB inválida")

    fingerprint = base64.urlsafe_b64encode(hashlib.sha256(raw).digest()).decode("ascii").rstrip("=")
    safe_comment = re.sub(r"[^A-Za-z0-9._@-]", "_", client_name)[:80]
    return f"{encoded} panel@{safe_comment}", f"SHA256:{fingerprint}"


class EnrollmentStore:
    """Tokens efêmeros e registro persistente das chaves matriculadas."""

    _tokens: dict[str, dict] = {}

    def __init__(self, path: Optional[Path] = None):
        self.path = path or (get_data_dir() / "scrcpy" / "enrollments.json")

    @staticmethod
    def _token_digest(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def issue_token(self, device_id: str, issued_by: str = "panel", ttl: int = ENROLLMENT_TTL) -> dict:
        if not is_safe_id(device_id):
            raise ValueError("ID de dispositivo inválido")
        token = secrets.token_urlsafe(32)
        expires_at = time.time() + max(30, min(int(ttl), ENROLLMENT_TTL))
        self._tokens[self._token_digest(token)] = {
            "device_id": device_id,
            "issued_by": issued_by[:80],
            "expires_at": expires_at,
        }
        self._purge_tokens()
        return {"token": token, "expires_at": expires_at, "ttl_seconds": int(expires_at - time.time())}

    def consume_token(self, token: str, device_id: str) -> dict:
        """Consome antes do provisionamento: falhas exigem novo bundle/token."""
        self._purge_tokens()
        digest = self._token_digest(token or "")
        record = self._tokens.pop(digest, None)
        if not record or record["device_id"] != device_id or record["expires_at"] < time.time():
            raise ValueError("Token de matrícula inválido ou expirado")
        return record

    def _purge_tokens(self):
        now = time.time()
        for digest, record in list(self._tokens.items()):
            if record.get("expires_at", 0) < now:
                self._tokens.pop(digest, None)

    def _load(self) -> dict:
        if not self.path.is_file():
            return {"clients": {}}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) and isinstance(data.get("clients"), dict) else {"clients": {}}
        except Exception:
            return {"clients": {}}

    def _save(self, data: dict):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)

    def register(self, device_id: str, client_name: str, public_key: str, fingerprint: str, issued_by: str) -> dict:
        data = self._load()
        client_id = "ws-" + fingerprint.removeprefix("SHA256:")[:16].lower()
        client = data["clients"].get(client_id, {
            "id": client_id,
            "name": client_name,
            "fingerprint": fingerprint,
            "public_key": public_key,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by": issued_by,
            "devices": [],
        })
        client["name"] = client_name
        client["public_key"] = public_key
        client["fingerprint"] = fingerprint
        client["last_enrolled_at"] = datetime.now(timezone.utc).isoformat()
        if device_id not in client["devices"]:
            client["devices"].append(device_id)
            client["devices"].sort()
        data["clients"][client_id] = client
        self._save(data)
        return dict(client)

    def list_clients(self) -> list[dict]:
        clients = self._load()["clients"].values()
        return sorted((dict(item) for item in clients), key=lambda item: item.get("name", "").lower())

    def get_client(self, client_id: str) -> Optional[dict]:
        if not is_safe_id(client_id):
            return None
        client = self._load()["clients"].get(client_id)
        return dict(client) if client else None

    def remove_device(self, client_id: str, device_id: str) -> Optional[dict]:
        data = self._load()
        client = data["clients"].get(client_id)
        if not client or device_id not in client.get("devices", []):
            return None
        client["devices"].remove(device_id)
        client["revoked_at"] = datetime.now(timezone.utc).isoformat()
        if client["devices"]:
            data["clients"][client_id] = client
        else:
            data["clients"].pop(client_id, None)
        self._save(data)
        return dict(client)


class ADBKeyProvisioner:
    """Instala e remove chaves públicas no arquivo de confiança do adbd."""

    REMOTE_KEYS = "/data/misc/adb/adb_keys"

    def __init__(self, adb: Optional[ADBManager] = None):
        self.adb = adb or ADBManager()

    async def install(self, ip: str, port: int, public_key: str) -> dict:
        remote = f"/data/local/tmp/panel_adbkey_{secrets.token_hex(8)}.pub"
        local = self._temporary_key(public_key)
        try:
            if not await self.adb.push(ip, str(local), remote, port=port):
                return {"success": False, "error": "Não foi possível enviar a chave pública ao TV Box"}
            command = (
                f"su -c \"mkdir -p /data/misc/adb; touch {self.REMOTE_KEYS}; "
                f"grep -qxF -f {remote} {self.REMOTE_KEYS} || cat {remote} >> {self.REMOTE_KEYS}; "
                f"chmod 640 {self.REMOTE_KEYS}; restorecon {self.REMOTE_KEYS} 2>/dev/null || true; "
                f"rm -f {remote}\""
            )
            output, code = await self.adb.shell(ip, command, port=port, timeout=20)
            if code != 0:
                return {"success": False, "error": f"Magisk/root não instalou a chave: {output[:300]}"}
            await self._reload_adbd(ip, port)
            return {"success": True}
        finally:
            local.unlink(missing_ok=True)

    async def revoke(self, ip: str, port: int, public_key: str) -> dict:
        remote = f"/data/local/tmp/panel_adbkey_{secrets.token_hex(8)}.pub"
        replacement = f"{remote}.new"
        local = self._temporary_key(public_key)
        try:
            if not await self.adb.push(ip, str(local), remote, port=port):
                return {"success": False, "error": "Não foi possível enviar a chave de revogação ao TV Box"}
            command = (
                f"su -c \"test -f {self.REMOTE_KEYS} || exit 3; "
                f"grep -vxF -f {remote} {self.REMOTE_KEYS} > {replacement} || true; "
                f"cat {replacement} > {self.REMOTE_KEYS}; chmod 640 {self.REMOTE_KEYS}; "
                f"restorecon {self.REMOTE_KEYS} 2>/dev/null || true; rm -f {remote} {replacement}\""
            )
            output, code = await self.adb.shell(ip, command, port=port, timeout=20)
            if code != 0:
                return {"success": False, "error": f"Magisk/root não revogou a chave: {output[:300]}"}
            await self._reload_adbd(ip, port)
            return {"success": True}
        finally:
            local.unlink(missing_ok=True)

    @staticmethod
    def _temporary_key(public_key: str) -> Path:
        base = get_data_dir() / "scrcpy" / "tmp"
        base.mkdir(parents=True, exist_ok=True)
        handle = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".pub", dir=base, delete=False)
        try:
            handle.write(public_key.rstrip() + "\n")
            return Path(handle.name)
        finally:
            handle.close()

    async def _reload_adbd(self, ip: str, port: int):
        """Agenda reload do adbd sem cortar a resposta do comando atual."""
        command = "su -c \"(sleep 1; setprop ctl.restart adbd) >/dev/null 2>&1 &\""
        await self.adb.shell(ip, command, port=port, timeout=5)
