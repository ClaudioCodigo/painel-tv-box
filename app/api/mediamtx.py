"""API routes para MediaMTX — proxy para API REST do MediaMTX."""

from fastapi import APIRouter, HTTPException

from app.managers.mediamtx import MediaMTXManager

router = APIRouter(prefix="/api/mediamtx", tags=["mediamtx"])


def _get_config():
    import app.main

    return app.main.config


@router.get("/health")
async def mediamtx_health():
    """Verifica se MediaMTX está respondendo."""
    config = _get_config()
    if not config or not config.mediamtx:
        raise HTTPException(503, "MediaMTX config não carregada")

    url = config.mediamtx.api.url if hasattr(config.mediamtx, "api") else "http://localhost:9997"
    timeout = config.mediamtx.api.timeout if hasattr(config.mediamtx, "api") else 5

    mtx = MediaMTXManager(api_url=url, timeout=timeout)
    result = await mtx.health()
    return result


@router.get("/paths")
async def mediamtx_list_paths():
    """Lista todas as paths do MediaMTX (readers, publisher, estado)."""
    config = _get_config()
    if not config or not config.mediamtx:
        raise HTTPException(503, "MediaMTX config não carregada")

    url = config.mediamtx.api.url if hasattr(config.mediamtx, "api") else "http://localhost:9997"
    timeout = config.mediamtx.api.timeout if hasattr(config.mediamtx, "api") else 5

    mtx = MediaMTXManager(api_url=url, timeout=timeout)
    result = await mtx.list_paths()
    return result


@router.get("/paths/{name}")
async def mediamtx_get_path(name: str):
    """Retorna detalhes de uma path específica."""
    config = _get_config()
    if not config or not config.mediamtx:
        raise HTTPException(503, "MediaMTX config não carregada")

    url = config.mediamtx.api.url if hasattr(config.mediamtx, "api") else "http://localhost:9997"
    timeout = config.mediamtx.api.timeout if hasattr(config.mediamtx, "api") else 5

    mtx = MediaMTXManager(api_url=url, timeout=timeout)
    result = await mtx.get_path(name)
    if not result.get("success"):
        raise HTTPException(404, f"Path '{name}' não encontrada")
    return result


@router.post("/paths/{name}")
async def mediamtx_add_path(name: str, data: dict = {}):
    """Cria uma nova path no MediaMTX."""
    config = _get_config()
    if not config or not config.mediamtx:
        raise HTTPException(503, "MediaMTX config não carregada")

    url = config.mediamtx.api.url if hasattr(config.mediamtx, "api") else "http://localhost:9997"
    timeout = config.mediamtx.api.timeout if hasattr(config.mediamtx, "api") else 5

    mtx = MediaMTXManager(api_url=url, timeout=timeout)
    result = await mtx.add_path(name, data)
    if not result.get("success"):
        raise HTTPException(500, result.get("error", "Falha ao criar path"))
    return result


@router.delete("/paths/{name}")
async def mediamtx_delete_path(name: str):
    """Remove uma path do MediaMTX."""
    config = _get_config()
    if not config or not config.mediamtx:
        raise HTTPException(503, "MediaMTX config não carregada")

    url = config.mediamtx.api.url if hasattr(config.mediamtx, "api") else "http://localhost:9997"
    timeout = config.mediamtx.api.timeout if hasattr(config.mediamtx, "api") else 5

    mtx = MediaMTXManager(api_url=url, timeout=timeout)
    result = await mtx.delete_path(name)
    if not result.get("success"):
        raise HTTPException(404, f"Path '{name}' não encontrada")
    return result
