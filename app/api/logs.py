"""API routes para Logs — busca, filtros, download, fontes."""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.managers.log import LogManager, LOG_SOURCES

router = APIRouter(prefix="/api/logs", tags=["logs"])


def _validate_source(source: str | None):
    """Garante que a fonte passada está na allowlist (anti path traversal)."""
    if source and source not in LOG_SOURCES:
        raise HTTPException(400, f"Fonte inválida: {source!r}. Válidas: {', '.join(LOG_SOURCES)}")


def _get_log_manager():
    import app.main

    mgr = getattr(app.main.app.state, "log_manager", None)
    if mgr is None:
        mgr = LogManager()
        mgr.setup()
        app.main.app.state.log_manager = mgr
    return mgr


@router.get("")
async def list_logs(
    source: str = Query(None, description="Fonte: system|adb|mediamtx|watchdog|user|api"),
    level: str = Query(None, description="Nível: INFO|ERROR|WARNING|DEBUG|CRITICAL"),
    device_id: str = Query(None, description="Filtrar por device ID"),
    q: str = Query(None, description="Texto na mensagem"),
    from_date: str = Query(None, alias="from", description="Data início (YYYY-MM-DD)"),
    to_date: str = Query(None, alias="to", description="Data fim (YYYY-MM-DD)"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
):
    """Busca logs com filtros."""
    _validate_source(source)
    mgr = _get_log_manager()
    result = mgr.search(
        source=source,
        level=level,
        device_id=device_id,
        q=q,
        from_date=from_date,
        to_date=to_date,
        page=page,
        per_page=per_page,
    )
    return result


@router.get("/tail")
async def tail_logs(
    source: str = Query(None, description="Fonte específica"),
    n: int = Query(50, ge=1, le=500, description="Número de linhas"),
):
    """Retorna as últimas N linhas de log."""
    _validate_source(source)
    mgr = _get_log_manager()
    items = mgr.tail(source=source, n=n)
    return {"items": items, "count": len(items)}


@router.get("/sources")
async def log_sources():
    """Retorna fontes de log disponíveis com metadados."""
    mgr = _get_log_manager()
    return {"sources": mgr.get_sources()}


@router.get("/download")
async def download_logs(
    source: str = Query(None, description="Fonte específica. Se vazio, todos os logs."),
):
    """Download de arquivo de log."""
    _validate_source(source)
    mgr = _get_log_manager()
    path = mgr.download(source=source)
    if path is None:
        raise HTTPException(404, "Nenhum log encontrado")

    filename = f"{source or 'all'}.log"
    return FileResponse(path, filename=filename, media_type="text/plain")
