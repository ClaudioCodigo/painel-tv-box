"""Router da API para Host Streaming (Captura de janelas Windows / Office e streaming para TVs)."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.utils.system import is_safe_id

logger = logging.getLogger("host_stream_api")

router = APIRouter(prefix="/api/host-stream", tags=["host-stream"])


class StartStreamRequest(BaseModel):
    stream_id: str = Field(..., description="ID único para a rota de stream (ex: 'ppt-loop', 'ppt-mes')")
    window_title: str = Field(..., description="Título da janela a capturar ou 'desktop'")
    profile: str = Field("loop", description="'loop' para slides animados (30 fps) ou 'fixed' para slide estático do mês (2 fps)")
    fps: Optional[int] = Field(None, description="Taxa de quadros opcional (sobrescreve o default do profile)")
    target_device_ids: list[str] = Field(default_factory=list, description="Dispositivos que devem começar a reproduzir este stream")
    target_group_ids: list[str] = Field(default_factory=list, description="Grupos que devem começar a reproduzir este stream")


class StopStreamRequest(BaseModel):
    stream_id: str


def _get_host_stream_manager(request: Request):
    mgr = getattr(request.app.state, "host_stream", None)
    if not mgr:
        from app.managers.host_stream import HostStreamManager
        mediamtx = getattr(request.app.state, "mediamtx", None)
        mgr = HostStreamManager(mediamtx_manager=mediamtx)
        request.app.state.host_stream = mgr
    return mgr


@router.get("/windows")
async def list_available_windows(request: Request):
    """Lista as janelas visíveis no Windows (PowerPoint, Excel, etc.) disponíveis para captura."""
    mgr = _get_host_stream_manager(request)
    windows = mgr.list_windows()
    return {"success": True, "count": len(windows), "windows": windows}


@router.get("/streams")
async def list_active_streams(request: Request):
    """Retorna todas as streams de janelas/desktop em execução no host."""
    mgr = _get_host_stream_manager(request)
    streams = await mgr.list_active_streams()
    return {"success": True, "count": len(streams), "streams": streams}


@router.post("/start")
async def start_host_stream(req: StartStreamRequest, request: Request):
    """Inicia a captura de uma janela e transmissão para o MediaMTX."""
    if not is_safe_id(req.stream_id):
        raise HTTPException(status_code=400, detail="stream_id inválido. Use apenas letras, números, hífen e underline.")

    mgr = _get_host_stream_manager(request)
    res = await mgr.start_stream(
        stream_id=req.stream_id,
        window_title=req.window_title,
        profile=req.profile,
        custom_fps=req.fps,
    )
    if not res.get("success"):
        raise HTTPException(status_code=500, detail=res.get("error", "Falha ao iniciar streaming da janela"))

    # Se alvos foram especificados, comanda o início da reprodução nos aparelhos
    rtsp_url = f"rtsp://{request.url.hostname or '127.0.0.1'}:8554/{res['rtsp_path']}"
    config = getattr(request.app.state, "config", None)
    player_mgr = getattr(request.app.state, "player", None)

    devices_started = []
    if config and player_mgr and (req.target_device_ids or req.target_group_ids):
        # Mapeia IDs de dispositivos a partir de grupos
        all_target_ids = set(req.target_device_ids)
        for gid in req.target_group_ids:
            for d in config.devices:
                if d.group == gid:
                    all_target_ids.add(d.id)

        for dev_id in all_target_ids:
            dev = config.get_device(dev_id)
            if dev:
                try:
                    await player_mgr.start_stream(dev, rtsp_url)
                    devices_started.append(dev_id)
                except Exception as e:
                    logger.warning("Falha ao abrir stream no TV Box %s: %s", dev_id, e)

    return {
        "success": True,
        "stream": res,
        "rtsp_url": rtsp_url,
        "devices_triggered": devices_started,
    }


@router.post("/stop")
async def stop_host_stream(req: StopStreamRequest, request: Request):
    """Encerra a captura e transmissão de uma janela."""
    mgr = _get_host_stream_manager(request)
    res = await mgr.stop_stream(req.stream_id)
    if not res.get("success"):
        raise HTTPException(status_code=404, detail=res.get("error", "Stream não encontrada"))
    return res


@router.post("/stop/{stream_id}")
async def stop_host_stream_by_param(stream_id: str, request: Request):
    """Encerra a captura e transmissão por parâmetro de rota."""
    mgr = _get_host_stream_manager(request)
    res = await mgr.stop_stream(stream_id)
    if not res.get("success"):
        raise HTTPException(status_code=404, detail=res.get("error", "Stream não encontrada"))
    return res
