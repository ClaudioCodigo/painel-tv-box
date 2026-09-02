"""Router para Web Signage — serve a página wrapper e gerencia o heartbeat WebSocket."""

import asyncio
from datetime import datetime
import json
import logging
from pathlib import Path
from typing import Optional

import html
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from app.utils.system import is_safe_id

logger = logging.getLogger("signage")

router = APIRouter(tags=["signage"])

TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "templates"


class SignageConnectionManager:
    """Gerencia conexões WebSocket ativas das páginas de Signage."""

    def __init__(self):
        self._active: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, device_id: str, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            if device_id not in self._active:
                self._active[device_id] = set()
            self._active[device_id].add(ws)
        logger.info("Signage WS connect: device=%s (total conexões=%d)", device_id, len(self._active.get(device_id, set())))

    async def disconnect(self, device_id: str, ws: WebSocket):
        async with self._lock:
            if device_id in self._active:
                self._active[device_id].discard(ws)
                if not self._active[device_id]:
                    self._active.pop(device_id, None)
        logger.info("Signage WS disconnect: device=%s", device_id)

    async def reload_device(self, device_id: str):
        """Envia comando para a página wrapper recarregar o iframe."""
        async with self._lock:
            sockets = list(self._active.get(device_id, set()))
        for ws in sockets:
            try:
                await ws.send_json({"action": "reload"})
            except Exception:
                pass


signage_manager = SignageConnectionManager()


def _get_config():
    import app.main
    return app.main.config


@router.get("/signage/{device_id}", response_class=HTMLResponse)
async def get_signage_page(device_id: str, request: Request = None):
    """Serve a página HTML wrapper para o TV Box rodando em modo web."""
    if not is_safe_id(device_id):
        raise HTTPException(400, "ID de dispositivo inválido")

    config = _get_config()
    device = config.get_device(device_id) if config else None
    if not device:
        raise HTTPException(404, f"Dispositivo '{device_id}' não encontrado")

    target_url = device.target_url or "about:blank"
    device_name = device.name or device.id

    template_file = TEMPLATES_DIR / "signage.html"
    if not template_file.is_file():
        raise HTTPException(500, "Template signage.html não encontrado")

    content = template_file.read_text(encoding="utf-8")
    content = content.replace("{{ device_id }}", html.escape(device.id))
    content = content.replace("{{ device_name }}", html.escape(device_name))
    content = content.replace("{{ target_url }}", html.escape(target_url, quote=True))

    return HTMLResponse(content=content)


@router.websocket("/ws/signage/{device_id}")
async def signage_websocket(websocket: WebSocket, device_id: str):
    """Canal WebSocket de heartbeat da página wrapper (TV Box -> Painel)."""
    if not is_safe_id(device_id):
        await websocket.close(code=4000)
        return

    config = _get_config()
    device = config.get_device(device_id) if config else None
    if not device:
        await websocket.close(code=4004)
        return

    await signage_manager.connect(device_id, websocket)
    # Primeiro ping ao conectar
    device.state.last_signage_ping = datetime.now()

    try:
        while True:
            text = await websocket.receive_text()
            try:
                data = json.loads(text)
                if data.get("type") == "ping":
                    device.state.last_signage_ping = datetime.now()
                    logger.debug("Signage ping recebido de %s", device_id)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        await signage_manager.disconnect(device_id, websocket)
    except Exception as e:
        logger.warning("Signage WS error para %s: %s", device_id, e)
        await signage_manager.disconnect(device_id, websocket)
