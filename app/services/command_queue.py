"""Fila de comandos device→servidor (Ideia 3 — docs/09 §4.4b).

O painel enfileira comandos que serão executados LOCALMENTE pelo TV Box
(no próprio shell do Android), sem nenhuma conexão ADB painel→device.
Assim o transporte do scrcpy nunca é derrubado por ações do painel.

Fluxo:
  1. POST /api/devices/{id}/command  (painel enfileira {action, cmd})
  2. GET  /api/heartbeat/{id}/commands (device puxa: linhas "id<TAB>cmd")
  3. device executa via `sh -c "$cmd"`
  4. POST /api/heartbeat/{id}/result  (device reporta {id, success, output})
"""

import asyncio
import logging
from typing import Optional

logger = logging.getLogger("command_queue")

# device_id -> lista de comandos pendentes {id, cmd, action, enqueued_at}
_QUEUE: dict[str, list[dict]] = {}
# device_id -> dict[id] resultado reportado {success, output, at}
_RESULTS: dict[str, dict[str, dict]] = {}
# device_id -> lock por device (enqueue/pop atômicos)
_LOCKS: dict[str, asyncio.Lock] = {}


def _lock_for(device_id: str) -> asyncio.Lock:
    if device_id not in _LOCKS:
        _LOCKS[device_id] = asyncio.Lock()
    return _LOCKS[device_id]


async def enqueue(device_id: str, action: str, cmd: str) -> dict:
    """Enfileira um comando; retorna o item criado."""
    item = {"id": f"{device_id}-{len(_QUEUE.get(device_id, [])) + 1}-{__import__('time').time_ns() % 100000}",
            "action": action, "cmd": cmd}
    async with _lock_for(device_id):
        _QUEUE.setdefault(device_id, []).append(item)
    logger.info("[cmd-queue] %s enfileirado: %s", device_id, action)
    return item


async def pop_pending(device_id: str) -> list[dict]:
    """Retorna e REMOVE os comandos pendentes do device (usado no GET /commands)."""
    async with _lock_for(device_id):
        pending = _QUEUE.pop(device_id, [])
    return pending


async def ack(device_id: str, cmd_id: str, success: bool, output: str = "") -> bool:
    """Registra o resultado de um comando; retorna False se id desconhecido."""
    # Confirma que o id já foi enviado ao device (removido da fila)
    known = any(c["id"] == cmd_id for c in _QUEUE.get(device_id, [])) is False
    _RESULTS.setdefault(device_id, {})[cmd_id] = {
        "success": bool(success), "output": output[:500],
        "at": __import__("datetime").datetime.now().isoformat(),
    }
    logger.info("[cmd-queue] %s resultado %s: success=%s", device_id, cmd_id, success)
    return known


def result_of(device_id: str, cmd_id: str) -> Optional[dict]:
    return _RESULTS.get(device_id, {}).get(cmd_id)
