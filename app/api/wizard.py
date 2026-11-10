"""API routes para o Wizard de configuração inicial."""

from fastapi import APIRouter, HTTPException

from app.core.auth import create_session_token, set_admin, validate_credentials
from app.models.config import MediaMTXConfig, PlayersConfig, WatchdogConfig
from app.models.device import DeviceConfig
from app.models.group import GroupConfig
from app.models.wizard import WizardFinishRequest
from app.utils.system import is_safe_http_url_local, is_safe_id, is_safe_network_target, slugify

router = APIRouter(prefix="/api/wizard", tags=["wizard"])


def _get_config():
    import app.main

    return app.main.config


@router.get("/status")
async def wizard_status():
    """(Alias) Status do wizard."""
    from app.api.system import wizard_status as ws

    return await ws()


@router.post("/finish")
async def wizard_finish(data: WizardFinishRequest):
    """Finaliza o wizard: recebe config completa tipada e gera todos YAMLs.
    
    Protegido contra re-execução após wizard_completed = True.
    """
    config = _get_config()
    if config and getattr(config, "wizard_completed", False):
        raise HTTPException(status_code=403, detail="Wizard já concluído — configuração protegida")

    # ── Validação e Criação de Administrador Mandatório ──
    error = validate_credentials(data.admin.username, data.admin.password)
    if error:
        raise HTTPException(status_code=400, detail="Credenciais de administrador inválidas")
    set_admin(data.admin.username, data.admin.password)

    # ── Server config ──
    if data.server and config.system:
        if data.server.get("host"):
            config.system.server.host = data.server["host"]
        if data.server.get("port"):
            config.system.server.port = data.server["port"]
        if data.server.get("ip"):
            config.system.host.ip = data.server["ip"]

    # ── MediaMTX config (valida URL local — anti SSRF) ──
    if data.mediamtx and config.mediamtx:
        if data.mediamtx.get("api_url"):
            if not is_safe_http_url_local(data.mediamtx["api_url"]):
                raise HTTPException(400, "mediamtx.api_url precisa apontar para localhost/rede privada")
            config.mediamtx.api.url = data.mediamtx["api_url"]
        if data.mediamtx.get("rtsp_port"):
            config.mediamtx.server.rtsp_port = data.mediamtx["rtsp_port"]
        if data.mediamtx.get("rtmp_port"):
            config.mediamtx.server.rtmp_port = data.mediamtx["rtmp_port"]
    elif not config.mediamtx:
        config.mediamtx = MediaMTXConfig()

    # ── ADB config ──
    if data.adb and config.system:
        if data.adb.get("default_port"):
            config.system.adb.default_port = data.adb["default_port"]
        if data.adb.get("connect_timeout"):
            config.system.adb.connect_timeout = data.adb["connect_timeout"]

    # ── Players: se omitido/None, aplica defaults ──
    if data.players is not None:
        try:
            config.players = PlayersConfig(**data.players)
        except Exception as e:
            raise HTTPException(422, f"Erro na config de players: {e}")
    elif not config.players:
        config.players = PlayersConfig()

    # ── Watchdog: se omitido/None, aplica defaults ──
    if data.watchdog is not None:
        try:
            config.watchdog = WatchdogConfig(**data.watchdog)
        except Exception as e:
            raise HTTPException(422, f"Erro na config do watchdog: {e}")
    elif not config.watchdog:
        config.watchdog = WatchdogConfig()

    # ── Groups ──
    if data.groups:
        for g in data.groups:
            if not g.get("id"):
                g["id"] = slugify(g.get("name", "grupo"))
            try:
                config.add_group(GroupConfig(**g))
            except Exception as e:
                raise HTTPException(422, f"Erro no grupo '{g.get('id')}': {e}")

    # ── Devices (obrigatório pelo menos 1 via DTO) ──
    for d in data.devices:
        if not is_safe_network_target(d.ip):
            raise HTTPException(status_code=400, detail=f"Endereço IP inválido ou inseguro: {d.ip}")

        base_id = slugify(d.name) or "tvbox"
        if not is_safe_id(base_id):
            base_id = "tvbox"

        dev_id = base_id
        counter = 2
        existing_ids = {dev.id for dev in config.devices}
        while dev_id in existing_ids:
            dev_id = f"{base_id}-{counter}"
            counter += 1

        dev = DeviceConfig(
            id=dev_id,
            name=d.name,
            ip=d.ip,
            adb_port=d.adb_port,
            group=d.group or "",
            location=d.location or "",
            player=d.player or "vlc",
            rtsp_path=dev_id,
        )
        try:
            config.add_device(dev)
        except Exception as e:
            raise HTTPException(422, f"Erro no device '{dev_id}': {e}")

    # ── Finaliza ──
    config.finalize_wizard()

    session_token = create_session_token(data.admin.username)

    return {
        "success": True,
        "wizard_completed": True,
        "session_token": session_token,
        "username": data.admin.username,
        "files_created": {
            "configs": ["system.yml", "watchdog.yml", "players.yml", "mediamtx.yml", "mediamtx.generated.yml"],
            "devices": len(config.devices),
            "groups": len(config.groups),
        },
    }


@router.post("/validate-device")
async def wizard_validate_device(data: dict):
    """Testa conectividade ADB de um IP."""
    config = _get_config()
    if config and getattr(config, "wizard_completed", False):
        raise HTTPException(status_code=403, detail="Wizard já concluído — configuração protegida")

    ip = data.get("ip", "")
    port = data.get("adb_port", 5555)

    if not ip:
        raise HTTPException(400, "IP não informado")
    if not is_safe_network_target(ip):
        raise HTTPException(400, "IP inválido (bloqueado: loopback/link-local/multicast)")

    from app.managers.adb import ADBManager

    adb = ADBManager()
    result = await adb.is_reachable(ip, port)
    return result
