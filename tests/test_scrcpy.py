"""Testes para ScrcpyManager."""

import pytest
import shutil
from pathlib import Path
from app.managers.scrcpy import ScrcpyManager


@pytest.fixture
def mgr(tmp_path):
    """Cria ScrcpyManager com diretórios temporários."""
    from unittest.mock import patch
    with patch("app.managers.scrcpy.SCRCPY_DIR", tmp_path / "scrcpy"):
        with patch("app.managers.scrcpy.VERSIONS_DIR", tmp_path / "scrcpy" / "versions"):
            with patch("app.managers.scrcpy.DOWNLOADS_DIR", tmp_path / "scrcpy" / "downloads"):
                with patch("app.managers.scrcpy.META_FILE", tmp_path / "scrcpy" / "version.json"):
                    m = ScrcpyManager()
                    yield m


class TestScrcpyManager:
    """Testes para o ScrcpyManager."""

    def test_platform_info_windows(self):
        # Windows-only: sempre win64
        info = ScrcpyManager._platform_info("4.1")
        assert info["asset"] == "scrcpy-win64-v4.1.zip"
        assert info["binary"] == "scrcpy.exe"
        assert info["type"] == "zip"

    def test_platform_binary_name_windows(self):
        assert ScrcpyManager._platform_binary_name() == "scrcpy.exe"

    def test_get_current_version_empty(self, mgr):
        assert mgr.get_current_version() is None

    def test_get_installed_versions_empty(self, mgr):
        assert mgr.get_installed_versions() == []

    def test_save_and_load_meta(self, mgr):
        mgr._meta["current"] = "4.1"
        mgr._save_meta()

        # Reload
        mgr._meta = mgr._load_meta()
        assert mgr._meta["current"] == "4.1"

    def test_check_updates_returns_dict(self, mgr):
        """check_updates retorna dict (pode falhar em ambiente de teste)."""
        import asyncio
        result = asyncio.run(mgr.check_updates())
        assert isinstance(result, dict)
        # Pode ter "error" ou "latest_version"
        assert "error" in result or "latest_version" in result


class TestScrcpyCrossOS:
    """Meta vindo de outra máquina/SO não conta como instalado nesta plataforma."""

    def test_current_version_ignored_without_platform_binary(self, mgr, tmp_path):
        # Meta diz que 4.1 está ativo (ex.: vindo do Windows via git/backup)
        import json
        from app.managers.scrcpy import META_FILE, VERSIONS_DIR
        META_FILE.write_text(json.dumps({"current": "4.1", "versions": {"4.1": {"size_bytes": 1}}}))
        mgr._meta = json.loads(META_FILE.read_text())

        # Sem o binário desta plataforma (scrcpy / scrcpy.exe) no diretório
        assert mgr.get_current_version() is None
        # Nenhuma versão "instalada" de verdade
        versions = mgr.get_installed_versions()
        assert not any(v["exists"] for v in versions)

    def test_current_version_valid_with_platform_binary(self, mgr, tmp_path):
        import json
        from app.managers.scrcpy import META_FILE, VERSIONS_DIR, ScrcpyManager
        META_FILE.write_text(json.dumps({"current": "4.1", "versions": {"4.1": {"size_bytes": 1}}}))
        mgr._meta = json.loads(META_FILE.read_text())

        # Cria o diretório com o binário CORRETO da plataforma
        ver_dir = VERSIONS_DIR / "4.1"
        ver_dir.mkdir(parents=True)
        bin_name = ScrcpyManager._platform_binary_name()
        (ver_dir / bin_name).write_text("binary")

        assert mgr.get_current_version() == "4.1"
        versions = mgr.get_installed_versions()
        assert any(v["version"] == "4.1" and v["exists"] and v["current"] for v in versions)
