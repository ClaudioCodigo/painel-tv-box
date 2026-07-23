"""Utilitários de sistema — CPU, RAM, disco, uptime."""

import logging
import re
import unicodedata

logger = logging.getLogger("system")


def slugify(text: str) -> str:
    """Converte texto em slug (id seguro para device/group)."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[-\s]+", "-", text).strip("-")


def get_metrics() -> dict:
    """Retorna métricas do host (CPU, RAM, disco, uptime)."""
    try:
        import psutil
    except ImportError:
        return {
            "cpu_percent": 0,
            "ram_percent": 0,
            "ram_used_gb": 0,
            "ram_total_gb": 0,
            "disk_percent": 0,
            "disk_used_gb": 0,
            "disk_total_gb": 0,
            "uptime_seconds": 0,
            "error": "psutil não instalado",
        }

    cpu = psutil.cpu_percent(interval=0.1)
    ram = psutil.virtual_memory()
    disk = psutil.disk_usage("/")

    return {
        "cpu_percent": cpu,
        "ram_percent": ram.percent,
        "ram_used_gb": round(ram.used / (1024**3), 1),
        "ram_total_gb": round(ram.total / (1024**3), 1),
        "disk_percent": disk.percent,
        "disk_used_gb": round(disk.used / (1024**3), 1),
        "disk_total_gb": round(disk.total / (1024**3), 1),
        "uptime_seconds": int(psutil.boot_time()),
    }
