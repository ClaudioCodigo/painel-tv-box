"""API routes para Grupos — CRUD + ações coletivas."""

from fastapi import APIRouter, HTTPException

from app.models.group import GroupConfig
from app.utils.system import slugify

router = APIRouter(prefix="/api/groups", tags=["groups"])


def _get_config():
    import app.main

    return app.main.config


@router.get("")
async def list_groups():
    """Lista todos os grupos."""
    config = _get_config()
    result = []
    for g in config.groups:
        group_data = g.model_dump()
        # Conta devices do grupo
        devices_in_group = [d.model_dump() for d in config.devices if d.group == g.id]
        group_data["device_count"] = len(devices_in_group)
        group_data["devices"] = [{"id": d["id"], "name": d.get("name", d["id"]), "ip": d.get("ip", ""), "status": d.get("state", {}).get("status", "unknown")} for d in devices_in_group]
        result.append(group_data)
    return result


@router.get("/{group_id}")
async def get_group(group_id: str):
    config = _get_config()
    group = config.get_group(group_id)
    if not group:
        raise HTTPException(404, "Grupo não encontrado")

    data = group.model_dump()
    devices_in_group = [d for d in config.devices if d.group == group_id]
    data["device_count"] = len(devices_in_group)
    data["devices"] = [{"id": d.id, "name": d.name or d.id, "ip": d.ip, "status": d.state.status} for d in devices_in_group]
    return data


@router.post("", status_code=201)
async def create_group(data: dict):
    config = _get_config()
    if not data.get("id"):
        data["id"] = slugify(data.get("name", "grupo"))
    if config.get_group(data["id"]):
        raise HTTPException(409, f"Grupo '{data['id']}' já existe")
    try:
        group = GroupConfig(**data)
    except Exception as e:
        raise HTTPException(422, f"Erro de validação: {e}")
    try:
        config.add_group(group)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return group.model_dump_safe()


@router.put("/{group_id}")
async def update_group(group_id: str, data: dict):
    config = _get_config()
    if not config.get_group(group_id):
        raise HTTPException(404, "Grupo não encontrado")
    try:
        updated = config.update_group(group_id, data)
    except Exception as e:
        raise HTTPException(422, f"Erro de validação: {e}")
    if updated is None:
        raise HTTPException(500, "Falha ao atualizar grupo")
    return updated.model_dump_safe()


@router.delete("/{group_id}")
async def delete_group(group_id: str):
    config = _get_config()
    if not config.get_group(group_id):
        raise HTTPException(404, "Grupo não encontrado")
    try:
        config.delete_group(group_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"deleted": group_id}


# ── Ações coletivas ──────────────────────────────


@router.post("/{group_id}/start-stream")
async def group_start_stream(group_id: str):
    """Abre stream em TODOS os devices do grupo."""
    config = _get_config()
    group = config.get_group(group_id)
    if not group:
        raise HTTPException(404, "Grupo não encontrado")

    from app.managers.adb import ADBManager
    from app.managers.player import PlayerManager

    adb = ADBManager()
    player = PlayerManager(
        adb_manager=adb,
        players_config=config.players,
        host_ip=config.system.host.ip if config.system else "192.168.254.102",
        rtsp_port=config.mediamtx.server.rtsp_port if config.mediamtx and hasattr(config.mediamtx, "server") else 8554,
    )

    results = []
    for device in config.devices:
        if device.group == group_id:
            try:
                result = await player.start_stream(device)
                results.append({"device_id": device.id, "success": result.get("success"), "method": result.get("method")})
            except Exception as e:
                results.append({"device_id": device.id, "success": False, "error": str(e)})

    return {"group_id": group_id, "results": results, "total": len(results), "success_count": sum(1 for r in results if r.get("success"))}


@router.post("/{group_id}/stop-stream")
async def group_stop_stream(group_id: str):
    """Para stream em TODOS os devices do grupo."""
    config = _get_config()
    group = config.get_group(group_id)
    if not group:
        raise HTTPException(404, "Grupo não encontrado")

    from app.managers.adb import ADBManager
    from app.managers.player import PlayerManager

    adb = ADBManager()
    player = PlayerManager(adb_manager=adb, players_config=config.players)

    results = []
    for device in config.devices:
        if device.group == group_id:
            try:
                result = await player.stop_stream(device)
                results.append({"device_id": device.id, "success": result.get("success")})
            except Exception as e:
                results.append({"device_id": device.id, "success": False, "error": str(e)})

    return {"group_id": group_id, "results": results, "total": len(results), "success_count": sum(1 for r in results if r.get("success"))}


@router.post("/{group_id}/reboot")
async def group_reboot(group_id: str):
    """Reinicia TODOS os devices do grupo."""
    config = _get_config()
    group = config.get_group(group_id)
    if not group:
        raise HTTPException(404, "Grupo não encontrado")

    from app.managers.adb import ADBManager

    adb = ADBManager()

    results = []
    for device in config.devices:
        if device.group == group_id:
            try:
                await adb.reboot(device.ip, port=device.adb_port)
                results.append({"device_id": device.id, "success": True})
            except Exception as e:
                results.append({"device_id": device.id, "success": False, "error": str(e)})

    return {"group_id": group_id, "results": results, "total": len(results), "success_count": sum(1 for r in results if r.get("success"))}
