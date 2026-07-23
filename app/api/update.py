"""API routes para Update — check e apply."""

from fastapi import APIRouter, HTTPException

from app.managers.update import UpdateManager

router = APIRouter(prefix="/api/update", tags=["update"])


@router.get("/status")
async def update_status():
    """Retorna status da última verificação."""
    mgr = UpdateManager()
    return mgr.get_status()


@router.post("/check")
async def update_check():
    """Verifica se há atualização disponível."""
    mgr = UpdateManager()
    result = await mgr.check()
    return result


@router.post("/apply")
async def update_apply():
    """Aplica atualização via git pull."""
    mgr = UpdateManager()
    result = await mgr.apply()
    return result
