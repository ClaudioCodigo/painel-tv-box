"""API routes para configuração do sistema."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/system", tags=["system"])

import os
import re
import subprocess
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel

_IPV4_RE = re.compile(r"^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$")


class HostIpBody(BaseModel):
    ip: str


def _is_valid_ipv4(ip: str) -> bool:
    m = _IPV4_RE.match(ip or "")
    if not m:
        return False
    return all(0 <= int(g) <= 255 for g in m.groups())


@router.put("/host-ip")
async def set_host_ip(body: HostIpBody):
    """Atualiza o IP do servidor (host) e salva o system.yml."""
    config = _get_config()
    if not config or not config.system:
        raise HTTPException(400, "Config indisponivel")
    ip = (body.ip or "").strip()
    if not _is_valid_ipv4(ip):
        raise HTTPException(400, "IP invalido")
    config.system.host.ip = ip
    config.save_system()
    return {"success": True, "ip": ip, "restart_required": True}


@router.post("/restart")
async def restart_panel():
    """Reinicia o servico do painel (sem esperar)."""
    try:
        if os.name == "nt":
            from app.utils.system import find_nssm
            nssm = find_nssm()
            if not nssm:
                raise HTTPException(500, "nssm.exe não encontrado")
            cmd = [nssm, "restart", "panel-tvbox"]
        else:
            cmd = ["systemctl", "restart", "panel"]
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {"success": True, "restarting": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, "Falha ao reiniciar: " + str(e))


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
