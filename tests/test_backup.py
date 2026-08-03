"""Testes do BackupManager: data dir (fora do repo), export e zip-slip."""

import asyncio
import os
import zipfile
from pathlib import Path

import pytest

from app.managers.backup import BackupManager
from app.utils.system import get_data_dir


@pytest.fixture
def anyio_backend():
    return "asyncio"


class TestDataDir:
    def test_respects_env_var(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PANEL_DATA_DIR", str(tmp_path / "data"))
        assert get_data_dir() == tmp_path / "data"

    def test_default_outside_repo(self):
        data = get_data_dir()
        # Nunca deve estar dentro do repositório do projeto
        assert not data.is_relative_to(Path(__file__).resolve().parent.parent)


class TestBackupManager:
    @pytest.mark.asyncio
    async def test_export_creates_zip_in_data_dir(self, tmp_path):
        backups = tmp_path / "backups"
        mgr = BackupManager(project_root=tmp_path, backups_dir=backups)
        # Cria um device fake no project_root para o export incluir
        (tmp_path / "devices").mkdir()
        (tmp_path / "devices" / "qa.yml").write_text("id: qa\nname: QA\n", encoding="utf-8")

        path = await mgr.export()
        assert path.exists()
        assert path.suffix == ".zip"
        assert backups in path.parents  # backup foi para o data dir

        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            assert any(n.startswith("devices/") for n in names)

    @pytest.mark.asyncio
    async def test_import_rejects_zip_slip(self, tmp_path):
        project_root = tmp_path / "proj"
        project_root.mkdir()
        (project_root / "config").mkdir()

        zip_path = tmp_path / "evil.zip"
        with zipfile.ZipFile(zip_path, "w") as zf:
            # Entrada com traversal — deve ser rejeitada
            zf.writestr("backup_manifest.json", "{}")
            zf.writestr("config/../../../../tmp/evil.yml", "pwned: true")

        mgr = BackupManager(project_root=project_root, backups_dir=tmp_path / "backups")
        result = await mgr.import_backup(zip_path)

        assert not result.get("success")
        assert any("fora do diretório permitido" in e for e in result.get("errors", []))
        assert not (tmp_path / "tmp" / "evil.yml").exists()

    @pytest.mark.asyncio
    async def test_restore_validates_backup_name(self, tmp_path):
        mgr = BackupManager(project_root=tmp_path, backups_dir=tmp_path / "backups")
        # Nome com traversal não deve ser aceito
        result = await mgr.restore("../../etc/passwd")
        assert not result.get("success")
        assert "não encontrado" in result.get("error", "")
