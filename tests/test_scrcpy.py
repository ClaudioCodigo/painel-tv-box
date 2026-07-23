"""Testes para ScrcpyManager."""

import pytest
import shutil
from pathlib import Path
from app.managers.scrcpy import ScrcpyManager


class TestScrcpyManager:
    """Testes para o ScrcpyManager."""

    @pytest.fixture
    def mgr(self, tmp_path):
        """Cria ScrcpyManager com diretórios temporários."""
        from unittest.mock import patch
        with patch("app.managers.scrcpy.SCRCPY_DIR", tmp_path / "scrcpy"):
            with patch("app.managers.scrcpy.VERSIONS_DIR", tmp_path / "scrcpy" / "versions"):
                with patch("app.managers.scrcpy.DOWNLOADS_DIR", tmp_path / "scrcpy" / "downloads"):
                    with patch("app.managers.scrcpy.META_FILE", tmp_path / "scrcpy" / "version.json"):
                        m = ScrcpyManager()
                        yield m

    def test_platform_info_windows(self):
        import os
        if os.name == "nt":
            info = ScrcpyManager._platform_info("4.1")
            assert info["asset"] == "scrcpy-win64-v4.1.zip"
            assert info["binary"] == "scrcpy.exe"
            assert info["type"] == "zip"

    def test_platform_info_linux(self):
        info = ScrcpyManager._platform_info("4.1")
        # No Windows, retorna win64. No Linux retorna linux.
        import os
        if os.name == "nt":
            assert "win64" in info["asset"]
        else:
            assert "linux" in info["asset"]

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
