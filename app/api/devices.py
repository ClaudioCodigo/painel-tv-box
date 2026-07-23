"""API routes para dispositivos (TV Boxes)."""

from fastapi import APIRouter, HTTPException

from app.models.device import DeviceConfig
from app.utils.system import slugify

router = APIRouter(prefix="/api/devices", tags=["devices"])


def _get_config():
    import app.main

    return app.main.config


@router.get("")
async def list_devices():
    config = _get_config()
    return [d.model_dump() for d in config.devices]


@router.get("/{device_id}")
async def get_device(device_id: str):
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")
    return device.model_dump()


@router.post("", status_code=201)
async def create_device(data: dict):
    config = _get_config()

    # gera id se não informado
    if not data.get("id"):
        data["id"] = slugify(data.get("name", "tvbox") or "tvbox")

    if config.get_device(data["id"]):
        raise HTTPException(409, f"Dispositivo '{data['id']}' já existe")

    try:
        device = DeviceConfig(**data)
    except Exception as e:
        raise HTTPException(422, f"Erro de validação: {e}")

    config.add_device(device)

    # Auto-provision: tenta enviar scripts para o TV Box
    try:
        from app.managers.adb import ADBManager
        from app.services.provision import ProvisionService

        adb = ADBManager()
        provision = ProvisionService(adb_manager=adb)
        prov_result = await provision.provision(device)
    except Exception:
        prov_result = {"success": False, "error": "provision_auto_failed"}

    return {
        **device.model_dump(),
        "provision": prov_result,
    }


@router.put("/{device_id}")
async def update_device(device_id: str, data: dict):
    config = _get_config()
    if not config.get_device(device_id):
        raise HTTPException(404, "Dispositivo não encontrado")

    try:
        updated = config.update_device(device_id, data)
    except Exception as e:
        raise HTTPException(422, f"Erro de validação: {e}")

    if updated is None:
        raise HTTPException(500, "Falha ao atualizar dispositivo")
    return updated.model_dump()


@router.delete("/{device_id}")
async def delete_device(device_id: str):
    config = _get_config()
    if not config.get_device(device_id):
        raise HTTPException(404, "Dispositivo não encontrado")
    config.delete_device(device_id)
    return {"deleted": device_id}


# ── Stream actions ────────────────────────────────


@router.post("/{device_id}/start-stream")
async def device_start_stream(device_id: str):
    """Abre stream no dispositivo."""
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    from app.managers.adb import ADBManager
    from app.managers.player import PlayerManager

    adb = ADBManager()

    player = PlayerManager(
        adb_manager=adb,
        players_config=config.players,
        host_ip=config.system.host.ip if config.system else "192.168.254.102",
        rtsp_port=config.mediamtx.server.rtsp_port if config.mediamtx and hasattr(config.mediamtx, "server") else 8554,
    )

    result = await player.start_stream(device)
    return result


@router.post("/{device_id}/stop-stream")
async def device_stop_stream(device_id: str):
    """Fecha stream no dispositivo."""
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    from app.managers.adb import ADBManager
    from app.managers.player import PlayerManager

    adb = ADBManager()
    player = PlayerManager(adb_manager=adb, players_config=config.players)

    result = await player.stop_stream(device)
    return result


@router.get("/{device_id}/current-player")
async def device_current_player(device_id: str):
    """Verifica qual Activity está em foco no device."""
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    from app.managers.adb import ADBManager
    from app.managers.player import PlayerManager

    adb = ADBManager()
    player = PlayerManager(adb_manager=adb, players_config=config.players)

    result = await player.get_current_player(device)
    return result


@router.post("/{device_id}/provision")
async def device_provision(device_id: str):
    """(Re-)instala scripts Android no dispositivo."""
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    from app.managers.adb import ADBManager
    from app.services.provision import ProvisionService

    adb = ADBManager()
    provision = ProvisionService(adb_manager=adb)
    result = await provision.provision(device)
    return result


@router.get("/{device_id}/provision/verify")
async def device_provision_verify(device_id: str):
    """Verifica se scripts estão instalados no dispositivo."""
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    from app.managers.adb import ADBManager
    from app.services.provision import ProvisionService

    adb = ADBManager()
    provision = ProvisionService(adb_manager=adb)
    result = await provision.verify(device)
    return result


@router.get("/{device_id}/status")
async def device_status(device_id: str):
    """Retorna status completo do device via ADB (ping, ADB, root, modelo, Android)."""
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    from app.managers.adb import ADBManager

    adb = ADBManager(
        binary=config.system.adb.binary if config.system else "adb",
        connect_timeout=config.system.adb.connect_timeout if config.system else 10,
    )

    status = await adb.is_reachable(device.ip, device.adb_port)

    # Atualiza state em memória
    if status["adb_connected"]:
        from datetime import datetime

        device.state.status = "online"
        device.state.last_seen = datetime.now()
        device.state.current_activity = f"Android {status['android']}"

    return {
        "device_id": device_id,
        "ip": device.ip,
        "adb_port": device.adb_port,
        **status,
    }


@router.post("/{device_id}/shell")
async def device_shell(device_id: str, data: dict):
    """Executa comando adb shell no dispositivo."""
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    command = data.get("command", "")
    if not command:
        raise HTTPException(400, "Comando não informado")

    from app.managers.adb import ADBManager

    adb = ADBManager(binary=config.system.adb.binary if config.system else "adb")
    output, code = await adb.shell(device.ip, command, port=device.adb_port)

    return {"success": code == 0, "device_id": device_id, "command": command, "output": output, "exit_code": code}


@router.post("/{device_id}/reboot")
async def device_reboot(device_id: str):
    """Reinicia o dispositivo Android."""
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    from app.managers.adb import ADBManager

    adb = ADBManager()
    await adb.reboot(device.ip, port=device.adb_port)
    return {"success": True, "message": f"Reboot enviado para {device.ip}"}


@router.get("/{device_id}/apps")
async def device_apps(device_id: str):
    """Lista apps de terceiros instalados no dispositivo."""
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    from app.managers.adb import ADBManager
    adb = ADBManager()
    output, code = await adb.shell(device.ip, "pm list packages -3", port=device.adb_port, timeout=15)

    packages = []
    if code == 0 and output:
        for line in output.split("\n"):
            line = line.strip()
            if line.startswith("package:"):
                pkg = line.replace("package:", "").strip()
                packages.append({"package": pkg, "name": pkg.split(".")[-1] if "." in pkg else pkg})

    return {"success": code == 0, "packages": sorted(packages, key=lambda x: x["name"]), "count": len(packages)}


@router.post("/{device_id}/uninstall-app")
async def device_uninstall_app(device_id: str, data: dict):
    """Desinstala um app do dispositivo."""
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    package = (data.get("package") or "").strip()
    if not package:
        raise HTTPException(400, "Package name é obrigatório")

    from app.managers.adb import ADBManager
    adb = ADBManager()
    output, code = await adb.shell(device.ip, f"pm uninstall {package}", port=device.adb_port, timeout=15)

    return {"success": code == 0, "package": package, "output": output.strip(), "exit_code": code}


# ── Screenshot ──────────────────────────────────

import uuid
from pathlib import Path
from fastapi.responses import FileResponse
from fastapi import UploadFile, File as FastAPIFile

SCREENSHOTS_DIR = Path(__file__).resolve().parent.parent.parent / "backups" / "screenshots"


@router.post("/{device_id}/screenshot")
async def device_screenshot_capture(device_id: str):
    """Captura screenshot do dispositivo e retorna o caminho."""
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    from app.managers.adb import ADBManager

    adb = ADBManager()

    # 1. Executa capture.sh no TV Box
    remote_path = ""
    output, code = await adb.shell(
        device.ip,
        "sh /data/local/tmp/panel/capture.sh",
        port=device.adb_port,
        timeout=15,
    )

    # Parse output pra achar onde o screenshot foi salvo
    if "screenshot: salvo em " in output:
        remote_path = output.split("screenshot: salvo em ")[-1].strip()
    else:
        remote_path = "/sdcard/panel/screenshot.png"

    # 2. Pull para o servidor
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    local_path = SCREENSHOTS_DIR / f"{device_id}.png"

    # Remove antigo
    if local_path.is_file():
        local_path.unlink()

    success = await adb.pull(device.ip, remote_path, str(local_path), port=device.adb_port, timeout=15)

    if success and local_path.is_file() and local_path.stat().st_size > 100:
        device.state.screenshot_path = str(local_path)
        return {
            "success": True,
            "screenshot_url": f"/api/devices/{device_id}/screenshot",
            "size_bytes": local_path.stat().st_size,
        }

    return {"success": False, "error": "Falha ao capturar screenshot"}


@router.get("/{device_id}/screenshot")
async def device_screenshot_get(device_id: str):
    """Retorna a última screenshot capturada."""
    from app.managers.adb import ADBManager

    config = _get_config()
    device = config.get_device(device_id)

    # Tenta path salvo no state
    if device and device.state.screenshot_path:
        p = Path(device.state.screenshot_path)
        if p.is_file():
            return FileResponse(p, media_type="image/png")

    # Tenta arquivo local
    local_path = SCREENSHOTS_DIR / f"{device_id}.png"
    if local_path.is_file():
        return FileResponse(local_path, media_type="image/png")

    raise HTTPException(404, "Nenhum screenshot encontrado. Capture um primeiro.")


# ── APK Install ─────────────────────────────────


@router.post("/{device_id}/install-apk")
async def device_install_apk(device_id: str, file: UploadFile = FastAPIFile(...)):
    """Faz upload e instala um APK no dispositivo."""
    config = _get_config()
    device = config.get_device(device_id)
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    if not file.filename or not file.filename.endswith(".apk"):
        raise HTTPException(400, "Arquivo precisa ser .apk")

    from app.managers.adb import ADBManager

    adb = ADBManager()

    # Salva APK temporariamente
    apk_dir = Path(__file__).resolve().parent.parent.parent / "backups" / "apks"
    apk_dir.mkdir(parents=True, exist_ok=True)
    apk_path = apk_dir / f"{device_id}_{uuid.uuid4().hex[:8]}.apk"

    content = await file.read()
    apk_path.write_bytes(content)

    # Push para o TV Box
    remote_apk = f"/data/local/tmp/panel/{apk_path.name}"
    push_ok = await adb.push(device.ip, str(apk_path), remote_apk, port=device.adb_port, timeout=60)

    if not push_ok:
        apk_path.unlink(missing_ok=True)
        raise HTTPException(500, "Falha ao enviar APK para o dispositivo")

    # Instala via script
    output, code = await adb.shell(
        device.ip,
        f"sh /data/local/tmp/panel/install_apk.sh {remote_apk}",
        port=device.adb_port,
        timeout=120,
    )

    # Limpa APK remoto
    await adb.shell(device.ip, f"rm {remote_apk}", port=device.adb_port)

    # Limpa APK local
    apk_path.unlink(missing_ok=True)

    success = code == 0 and "success" in output.lower()
    return {
        "success": success,
        "filename": file.filename,
        "output": output.strip(),
        "exit_code": code,
    }
