"""WebSocket hub — pub/sub broadcast em memória."""

import asyncio
import logging
from fastapi import WebSocket

logger = logging.getLogger("ws")


class WebSocketHub:
    """Gerencia conexões WebSocket e broadcast de eventos."""

    def __init__(self):
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)
        logger.info(f"WS connect ({len(self._connections)} ativas)")

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self._connections.discard(ws)
        logger.info(f"WS disconnect ({len(self._connections)} ativas)")

    async def broadcast(self, event: dict):
        """Envia evento para TODAS as conexões ativas."""
        dead: list[WebSocket] = []
        async with self._lock:
            connections = self._connections.copy()
        for ws in connections:
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.discard(ws)

    @property
    def active_count(self) -> int:
        return len(self._connections)
