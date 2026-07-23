"""API routes para scrcpy — versões, download, ativar, rollback, mirroring."""

from fastapi import APIRouter, HTTPException

from app.managers.scrcpy import ScrcpyManager

router = APIRouter(prefix="/api/scrcpy", tags=["scrcpy"])


@router.get("/status")
async def scrcpy_status():
    """Status do scrcpy: versão atual, binário, metadata."""
    mgr = ScrcpyManager()
    current = mgr.get_current_version()
    versions = mgr.get_installed_versions()
    binary = mgr._get_scrcpy_bin()

    return {
        "current_version": current,
        "binary_path": str(binary) if binary else None,
        "binary_exists": binary is not None and binary.is_file() if binary else False,
        "installed_versions": versions,
        "versions_count": len(versions),
    }


@router.post("/check")
async def scrcpy_check():
    """Verifica GitHub por nova versão do scrcpy."""
    mgr = ScrcpyManager()
    result = await mgr.check_updates()
    return result


@router.post("/install")
async def scrcpy_install(data: dict = {}):
    """Baixa e instala versão específica (ou a latest se não informada)."""
    mgr = ScrcpyManager()

    version = data.get("version", "")
    if not version:
        # Busca latest first
        info = await mgr.check_updates()
        if info.get("error"):
            raise HTTPException(500, f"Erro ao buscar versão: {info['error']}")
        version = info.get("latest_version", "")
        if not version:
            raise HTTPException(500, "Não foi possível determinar a versão mais recente")

    # Download
    dl = await mgr.download(version)
    if not dl.get("success"):
        raise HTTPException(500, f"Download falhou: {dl.get('error')}")

    # Ativar
    act = await mgr.activate(version)
    if not act.get("success"):
        return {
            **dl,
            "activation_error": act.get("error"),
            "installed": True,
            "active": False,
        }

    return {
        **dl,
        "active": True,
        "previous": act.get("previous"),
    }


@router.post("/activate/{version}")
async def scrcpy_activate(version: str):
    """Ativa uma versão específica já instalada."""
    mgr = ScrcpyManager()
    result = await mgr.activate(version)
    if not result.get("success"):
        raise HTTPException(400, result.get("error", "Falha ao ativar"))
    return result


@router.post("/rollback")
async def scrcpy_rollback():
    """Rollback para a versão anterior."""
    mgr = ScrcpyManager()
    result = await mgr.rollback()
    if not result.get("success"):
        raise HTTPException(400, result.get("error", "Falha no rollback"))
    return result


@router.get("/versions")
async def scrcpy_versions():
    """Lista versões instaladas."""
    mgr = ScrcpyManager()
    return {"versions": mgr.get_installed_versions()}


@router.delete("/versions/{version}")
async def scrcpy_delete_version(version: str):
    """Remove uma versão específica."""
    mgr = ScrcpyManager()
    ver_dir = mgr.VERSIONS_DIR / version  # type: ignore
    if not ver_dir.is_dir():
        raise HTTPException(404, f"Versão {version} não encontrada")

    import shutil

    shutil.rmtree(ver_dir, ignore_errors=True)
    mgr._meta["versions"].pop(version, None)
    mgr._save_meta()
    return {"deleted": version}


# ── Mirroring ──────────────────────────────────


@router.post("/start/{device_id}")
async def scrcpy_start(device_id: str, data: dict = {}):
    """Inicia espelhamento scrcpy para um dispositivo."""
    config = None
    try:
        import app.main

        config = app.main.config
    except Exception:
        pass

    device = config.get_device(device_id) if config else None
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    mgr = ScrcpyManager()
    extra_args = data.get("extra_args", "")
    result = await mgr.start_mirroring(device.ip, device.adb_port, extra_args)
    return result


@router.post("/stream/{device_id}")
async def scrcpy_stream(device_id: str, data: dict = {}):
    """Inicia streaming do scrcpy via ffmpeg → RTMP → MediaMTX (modo headless)."""
    config = None
    try:
        import app.main

        config = app.main.config
    except Exception:
        pass

    device = config.get_device(device_id) if config else None
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    mgr = ScrcpyManager()
    rtmp_url = data.get("rtmp_url", "rtmp://localhost:1935/SCRCPY_DISPLAY")
    result = await mgr.start_streaming(device.ip, device.adb_port, rtmp_url)
    return result


@router.post("/stop")
async def scrcpy_stop():
    """Para todas as instâncias scrcpy em execução."""
    mgr = ScrcpyManager()
    result = await mgr.stop_mirroring()
    return result
