"""API routes para o Wizard de configuração inicial."""

from fastapi import APIRouter, HTTPException

from app.models.config import PlayersConfig, WatchdogConfig
from app.models.device import DeviceConfig
from app.models.group import GroupConfig
from app.utils.system import slugify, is_safe_network_target, is_safe_http_url_local

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
async def wizard_finish(data: dict):
    """Finaliza o wizard: recebe config completa e gera todos YAMLs.
    Pode ser re-executado (permite adicionar novos dispositivos)."""
    config = _get_config()

    # ── Server config ──
    srv = data.get("server", {})
    if config.system:
        if srv.get("host"):
            config.system.server.host = srv["host"]
        if srv.get("port"):
            config.system.server.port = srv["port"]
        if srv.get("ip"):
            config.system.host.ip = srv["ip"]

    # ── MediaMTX config (valida URL local — anti SSRF) ──
    mtx = data.get("mediamtx", {})
    if config.mediamtx:
        if mtx.get("api_url"):
            if not is_safe_http_url_local(mtx["api_url"]):
                raise HTTPException(400, "mediamtx.api_url precisa apontar para localhost/rede privada")
            config.mediamtx.api.url = mtx["api_url"]
        if mtx.get("rtsp_port"):
            config.mediamtx.server.rtsp_port = mtx["rtsp_port"]
        if mtx.get("rtmp_port"):
            config.mediamtx.server.rtmp_port = mtx["rtmp_port"]

    # ── ADB config ──
    adb = data.get("adb", {})
    if config.system and adb.get("default_port"):
        config.system.adb.default_port = adb["default_port"]
    if config.system and adb.get("connect_timeout"):
        config.system.adb.connect_timeout = adb["connect_timeout"]

    # ── Players: null = usar defaults ──
    if data.get("players") is not None:
        try:
            config.players = PlayersConfig(**data["players"])
        except Exception as e:
            raise HTTPException(422, f"Erro na config de players: {e}")

    # ── Watchdog: null = usar defaults ──
    if data.get("watchdog") is not None:
        try:
            config.watchdog = WatchdogConfig(**data["watchdog"])
        except Exception as e:
            raise HTTPException(422, f"Erro na config do watchdog: {e}")

    # ── Groups ──
    for g in data.get("groups", []):
        if not g.get("id"):
            g["id"] = slugify(g.get("name", "grupo"))
        try:
            config.add_group(GroupConfig(**g))
        except Exception as e:
            raise HTTPException(422, f"Erro no grupo '{g.get('id')}': {e}")

    # ── Devices (obrigatório pelo menos 1) ──
    devices_data = data.get("devices", [])
    if not devices_data:
        raise HTTPException(400, "Pelo menos 1 dispositivo é obrigatório")

    for d in devices_data:
        if not d.get("id"):
            d["id"] = slugify(d.get("name", "tvbox"))
        try:
            config.add_device(DeviceConfig(**d))
        except Exception as e:
            raise HTTPException(422, f"Erro no device '{d.get('id')}': {e}")

    # ── Admin (criar administrador na 1ª execução — D-06/D-08) ──
    admin = data.get("admin") or {}
    created_admin = False
    from app.core.auth import admin_configured, set_admin

    if admin.get("username") and admin.get("password"):
        if not admin_configured():
            from app.core.auth import validate_credentials

            error = validate_credentials(str(admin["username"]), str(admin["password"]))
            if error:
                raise HTTPException(400, error)
            set_admin(str(admin["username"]), str(admin["password"]))
            created_admin = True
        # Se já existe admin, ignora (não sobrescreve em re-execução)

    # ── Finaliza ──
    config.finalize_wizard()

    result = {
        "success": True,
        "wizard_completed": True,
        "files_created": {
            "configs": ["system.yml", "watchdog.yml", "players.yml", "mediamtx.yml", "mediamtx.generated.yml"],
            "devices": len(config.devices),
            "groups": len(config.groups),
        },
    }
    if created_admin:
        # Auto-login: devolve token de sessão do admin recém-criado
        from app.core.auth import create_session_token

        result["session_token"] = create_session_token(admin["username"].strip())
    return result


@router.post("/validate-device")
async def wizard_validate_device(data: dict):
    """Testa conectividade ADB de um IP."""
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
