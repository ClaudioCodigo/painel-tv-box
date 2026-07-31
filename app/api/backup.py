"""API routes para Backup — export, import, restore."""

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from app.managers.backup import BackupManager

router = APIRouter(prefix="/api/backup", tags=["backup"])


@router.get("/list")
async def backup_list():
    """Lista backups disponíveis."""
    mgr = BackupManager()
    backups = mgr.list_backups()
    return {"backups": backups}


@router.post("/export")
async def backup_export():
    """Exporta configuração como ZIP."""
    mgr = BackupManager()
    try:
        zip_path = await mgr.export()
        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename=zip_path.name,
        )
    except Exception as e:
        raise HTTPException(500, f"Falha ao exportar: {e}")


@router.post("/import")
async def backup_import(file: UploadFile = File(...)):
    """Importa configuração de ZIP."""
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(400, "Arquivo precisa ser .zip")

    import tempfile

    mgr = BackupManager()
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        from pathlib import Path

        result = await mgr.import_backup(Path(tmp_path))
        return result
    finally:
        import os

        os.unlink(tmp_path)


@router.get("/download/{backup_name}")
async def backup_download(backup_name: str):
    """Baixa um backup ZIP específico (nome validado contra traversal)."""
    mgr = BackupManager()
    path = mgr.get_backup_path(backup_name)
    if not path:
        raise HTTPException(404, "Backup não encontrado")
    return FileResponse(
        path,
        media_type="application/zip",
        filename=path.name,
    )


@router.post("/restore/{backup_name}")
async def backup_restore(backup_name: str):
    """Restaura de um backup específico pelo nome."""
    mgr = BackupManager()
    result = await mgr.restore(backup_name)
    if not result.get("success"):
        raise HTTPException(400, result.get("error", "Falha ao restaurar"))
    return result


@router.post("/cleanup")
async def backup_cleanup(keep_last: int = 10):
    """Remove backups antigos."""
    mgr = BackupManager()
    result = await mgr.cleanup(keep_last=keep_last)
    return result
