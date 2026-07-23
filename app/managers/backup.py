"""BackupManager — export/import ZIP de configuração."""

import json
import logging
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger("backup")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BACKUPS_DIR = PROJECT_ROOT / "backups"


class BackupManager:
    """Gerencia export e import de configuração em ZIP."""

    def __init__(self, project_root: Optional[Path] = None, backups_dir: Optional[Path] = None):
        self.project_root = project_root or PROJECT_ROOT
        self.backups_dir = backups_dir or BACKUPS_DIR
        self.backups_dir.mkdir(parents=True, exist_ok=True)

    def list_backups(self) -> list[dict]:
        """Lista backups disponíveis."""
        backups = []
        for p in sorted(self.backups_dir.glob("backup-*.zip"), reverse=True):
            backups.append({
                "name": p.name,
                "path": str(p),
                "size_bytes": p.stat().st_size,
                "created": datetime.fromtimestamp(p.stat().st_mtime).isoformat() if p.stat().st_mtime else "",
            })
        return backups

    async def export(self) -> Path:
        """Cria backup ZIP de toda configuração."""
        timestamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
        zip_path = self.backups_dir / f"backup-{timestamp}.zip"

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            # Manifest
            manifest = {
                "created": datetime.now().isoformat(),
                "version": "0.1.0",
                "files": [],
            }

            # config/
            config_dir = self.project_root / "config"
            if config_dir.is_dir():
                for p in sorted(config_dir.glob("*.yml")):
                    zf.write(p, f"config/{p.name}")
                    manifest["files"].append(f"config/{p.name}")

            # devices/
            devices_dir = self.project_root / "devices"
            if devices_dir.is_dir():
                for p in sorted(devices_dir.glob("*.yml")):
                    zf.write(p, f"devices/{p.name}")
                    manifest["files"].append(f"devices/{p.name}")

            # groups/
            groups_dir = self.project_root / "groups"
            if groups_dir.is_dir():
                for p in sorted(groups_dir.glob("*.yml")):
                    zf.write(p, f"groups/{p.name}")
                    manifest["files"].append(f"groups/{p.name}")

            # Escreve manifest
            zf.writestr("backup_manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))

        logger.info("Backup exportado: %s (%d arquivos)", zip_path.name, len(manifest["files"]))
        return zip_path

    async def import_backup(self, zip_path: Path) -> dict:
        """Importa configuração de um arquivo ZIP."""
        if not zip_path.is_file():
            return {"success": False, "error": "Arquivo não encontrado"}

        # Cria backup automático antes de importar
        pre_backup = await self.export()
        logger.info("Backup pré-import: %s", pre_backup.name)

        files_restored = []
        errors = []

        with zipfile.ZipFile(zip_path, "r") as zf:
            # Valida estrutura
            names = zf.namelist()
            if "backup_manifest.json" not in names:
                return {"success": False, "error": "ZIP inválido: backup_manifest.json não encontrado"}

            for name in names:
                if name == "backup_manifest.json":
                    continue
                if not (name.startswith("config/") or name.startswith("devices/") or name.startswith("groups/")):
                    continue
                if not name.endswith(".yml"):
                    continue

                try:
                    dest = self.project_root / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(name) as src, open(dest, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    files_restored.append(name)
                except Exception as e:
                    errors.append(f"{name}: {e}")

        logger.info("Backup importado: %d arquivos restaurados, %d erros", len(files_restored), len(errors))
        return {
            "success": len(errors) == 0,
            "files_restored": files_restored,
            "count": len(files_restored),
            "errors": errors,
            "pre_backup": pre_backup.name,
        }

    async def restore(self, backup_name: str) -> dict:
        """Restaura de um backup específico."""
        zip_path = self.backups_dir / backup_name
        return await self.import_backup(zip_path)

    async def cleanup(self, keep_last: int = 10):
        """Remove backups antigos, mantendo os N mais recentes."""
        backups = sorted(self.backups_dir.glob("backup-*.zip"), reverse=True)
        to_delete = backups[keep_last:]
        for p in to_delete:
            p.unlink()
            logger.info("Backup antigo removido: %s", p.name)
        return {"deleted": len(to_delete), "kept": min(len(backups), keep_last)}
