"""API routes para configuração do sistema."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/system", tags=["system"])


def _get_config():
    import app.main

    return app.main.config


@router.get("/wizard-status")
async def wizard_status():
    config = _get_config()
    return {
        "completed": config.wizard_completed if config else False,
        "devices_count": len(config.devices) if config else 0,
        "groups_count": len(config.groups) if config else 0,
    }


@router.get("/config")
async def get_all_config():
    """Retorna toda configuração atual (para debug/settings)."""
    config = _get_config()
    if not config:
        return {"error": "Config não carregada"}
    return {
        "system": config.system.model_dump() if config.system else None,
        "watchdog": config.watchdog.model_dump() if config.watchdog else None,
        "players": config.players.model_dump() if config.players else None,
        "mediamtx": config.mediamtx.model_dump() if config.mediamtx else None,
        "wizard_completed": config.wizard_completed,
        "devices_count": len(config.devices),
        "groups_count": len(config.groups),
    }
