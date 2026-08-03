"""API de heartbeat — device→servidor (substitui reverse_ping).

O TV Box envia POST /api/heartbeat/<device_id> em loop com cooldown.
Este endpoint NÃO usa ADB: apenas registra a batida (last_heartbeat) e
opcionalmente a activity em foco. Autenticado por chave dedicada
(security.heartbeat_key), não pelo token do painel.
"""

import hmac
import logging
from datetime import datetime

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.utils.system import is_safe_id

logger = logging.getLogger("heartbeat")

router = APIRouter(prefix="/api/heartbeat", tags=["heartbeat"])

MIN_INTERVAL_SECONDS = 5  # anti-spam: mínimo entre batidas por device


class HeartbeatBody(BaseModel):
    activity: Optional[str] = None


class HeartbeatResultBody(BaseModel):
    id: str
    success: bool = False
    output: Optional[str] = None


def _get_config():
    import app.main

    return app.main.config


@router.post("/{device_id}", status_code=204)
async def device_heartbeat(
    device_id: str,
    body: HeartbeatBody = None,
    x_heartbeat_key: str = Header("", alias="X-Heartbeat-Key"),
):
    config = _get_config()

    # Valida device (id seguro + existente)
    if not is_safe_id(device_id):
        raise HTTPException(400, "device_id inválido")
    device = config.get_device(device_id) if config else None
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    # Valida chave dedicada (comparação em tempo constante)
    expected = ""
    if config and config.system and config.system.security:
        expected = config.system.security.heartbeat_key
    if not expected or not hmac.compare_digest(x_heartbeat_key, expected):
        raise HTTPException(401, "Chave de heartbeat inválida")

    # Rate limit: mínimo MIN_INTERVAL_SECONDS entre batidas do mesmo device
    now = datetime.now()
    last = device.state.last_heartbeat
    if last and (now - last).total_seconds() < MIN_INTERVAL_SECONDS:
        raise HTTPException(429, "Batida muito frequente")

    # Registra a batida (sem ADB)
    device.state.last_heartbeat = now
    if body and body.activity:
        device.state.current_activity = body.activity.strip()

    logger.debug("[heartbeat] %s ok", device_id)
    return None


@router.get("/{device_id}/commands")
async def heartbeat_commands(device_id: str, x_heartbeat_key: str = Header("", alias="X-Heartbeat-Key")):
    """Device puxa comandos pendentes (Ideia 3).

    Resposta text/plain: uma linha por comando, `id<TAB>cmd` — parseável no
    shell do Android sem JSON. Linhas vazias = sem comandos.
    """
    config = _get_config()
    expected = ""
    if config and config.system and config.system.security:
        expected = config.system.security.heartbeat_key
    if not expected or not hmac.compare_digest(x_heartbeat_key, expected):
        raise HTTPException(401, "Chave de heartbeat inválida")

    from app.services import command_queue as cq

    pending = await cq.pop_pending(device_id)
    lines = [f"{c['id']}\t{c['cmd']}" for c in pending]
    from fastapi.responses import PlainTextResponse

    return PlainTextResponse("\n".join(lines), media_type="text/plain; charset=utf-8")


@router.post("/{device_id}/result")
async def heartbeat_result(device_id: str, body: HeartbeatResultBody, x_heartbeat_key: str = Header("", alias="X-Heartbeat-Key")):
    """Device reporta o resultado de um comando executado localmente."""
    config = _get_config()
    expected = ""
    if config and config.system and config.system.security:
        expected = config.system.security.heartbeat_key
    if not expected or not hmac.compare_digest(x_heartbeat_key, expected):
        raise HTTPException(401, "Chave de heartbeat inválida")

    from app.services import command_queue as cq

    await cq.ack(device_id, body.id, body.success, body.output or "")
    return None
