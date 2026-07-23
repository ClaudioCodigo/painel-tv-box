"""Histórico de métricas do servidor — coleta e armazena pontos no tempo."""

import logging
from collections import deque
from datetime import datetime, timezone
from typing import Optional

from app.utils.system import get_metrics

logger = logging.getLogger("metrics")

MAX_POINTS = 60  # manter 60 amostras (10 min com check a cada 10s)


class MetricsHistory:
    """Armazena histórico de métricas do servidor em memória."""

    def __init__(self, max_points: int = MAX_POINTS):
        self.max_points = max_points
        self._points: deque[dict] = deque(maxlen=max_points)

    def sample(self):
        """Coleta uma amostra atual e adiciona ao histórico."""
        try:
            m = get_metrics()
            m["timestamp"] = datetime.now(timezone.utc).isoformat()
            self._points.append(m)
        except Exception as e:
            logger.warning("Falha ao amostrar métricas: %s", e)

    def get_history(self, last_n: Optional[int] = None) -> dict:
        """Retorna histórico formatado para sparklines."""
        points = list(self._points)
        if last_n:
            points = points[-last_n:]

        if not points:
            return {"cpu": [], "ram": [], "disk": [], "count": 0}

        return {
            "cpu": [p.get("cpu_percent", 0) for p in points],
            "ram": [p.get("ram_percent", 0) for p in points],
            "disk": [p.get("disk_percent", 0) for p in points],
            "count": len(points),
            "timestamps": [p.get("timestamp", "") for p in points],
        }

    def latest(self) -> dict:
        """Última amostra ou dict vazio."""
        if self._points:
            return dict(self._points[-1])
        return {}
