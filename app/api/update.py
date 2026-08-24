"""API routes para Update — check, apply, changelog e rollback."""

from fastapi import APIRouter, HTTPException, Request

from app.managers.update import UpdateManager

router = APIRouter(prefix="/api/update", tags=["update"])

_fallback_manager: UpdateManager | None = None


def _get_manager(request: Request | None = None) -> UpdateManager:
    global _fallback_manager
    if request and hasattr(request.app.state, "update_manager"):
        return request.app.state.update_manager
    try:
        import app.main

        if hasattr(app.main.app.state, "update_manager"):
            return app.main.app.state.update_manager
    except Exception:
        pass
    if _fallback_manager is None:
        _fallback_manager = UpdateManager()
    return _fallback_manager


@router.get("/status")
async def update_status(request: Request):
    """Retorna status da última verificação."""
    mgr = _get_manager(request)
    return mgr.get_status()


@router.get("/changelog")
async def update_changelog(request: Request):
    """Retorna a lista de commits pendentes."""
    mgr = _get_manager(request)
    return {"changelog": mgr.get_changelog()}


@router.post("/check")
async def update_check(request: Request):
    """Verifica se há atualização disponível."""
    mgr = _get_manager(request)
    result = await mgr.check()
    return result


@router.post("/apply")
async def update_apply(request: Request):
    """Aplica atualização via git pull."""
    mgr = _get_manager(request)
    result = await mgr.apply()
    return result


@router.post("/rollback")
async def update_rollback(request: Request):
    """Executa rollback para a versão anterior."""
    mgr = _get_manager(request)
    result = await mgr.rollback()
    return result
