"""Testes para ADBManager."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
import asyncio


class TestADBManager:
    """Testes para o ADBManager."""

    @pytest.fixture
    def adb(self):
        from app.managers.adb import ADBManager
        return ADBManager(binary="adb", connect_timeout=5)

    @pytest.mark.asyncio
    async def test_shell_success(self, adb):
        with patch("asyncio.create_subprocess_exec") as mock_sub:
            proc = AsyncMock()
            proc.communicate.return_value = (b"ok\n", b"")
            proc.returncode = 0
            mock_sub.return_value = proc

            output, code = await adb.shell("192.168.1.1", "echo ok")
            assert "ok" in output
            assert code == 0

    @pytest.mark.asyncio
    async def test_shell_timeout(self, adb):
        with patch("asyncio.create_subprocess_exec") as mock_sub:
            proc = AsyncMock()
            proc.communicate.side_effect = asyncio.TimeoutError()
            proc.kill = MagicMock()
            mock_sub.return_value = proc

            output, code = await adb.shell("192.168.1.1", "echo ok", timeout=1)
            assert "timeout" in output.lower()
            assert code == -1

    @pytest.mark.asyncio
    async def test_connect_success(self, adb):
        with patch("asyncio.create_subprocess_exec") as mock_sub:
            proc = AsyncMock()
            proc.communicate.return_value = (b"connected to 192.168.1.1:5555\n", b"")
            proc.returncode = 0
            mock_sub.return_value = proc

            result = await adb.connect("192.168.1.1", 5555)
            assert result is True
            assert "192.168.1.1:5555" in adb._connected

    @pytest.mark.asyncio
    async def test_connect_failure(self, adb):
        with patch("asyncio.create_subprocess_exec") as mock_sub:
            proc = AsyncMock()
            proc.communicate.return_value = (b"cannot connect\n", b"error")
            proc.returncode = 1
            mock_sub.return_value = proc

            result = await adb.connect("192.168.1.1", 5555)
            assert result is False

    @pytest.mark.asyncio
    async def test_reboot(self, adb):
        with patch.object(adb, "shell", return_value=("", 0)) as mock_shell:
            await adb.reboot("192.168.1.1", 5555)
            mock_shell.assert_called_once()
            assert "reboot" in mock_shell.call_args[0][1]

    @pytest.mark.asyncio
    async def test_push(self, adb):
        with patch("asyncio.create_subprocess_exec") as mock_sub:
            proc = AsyncMock()
            proc.communicate.return_value = (b"pushed\n", b"")
            proc.returncode = 0
            mock_sub.return_value = proc

            result = await adb.push("192.168.1.1", "/local/file", "/remote/file")
            assert result is True


class TestADBServerIsolation:
    """Ideia 4: servidor ADB isolado do scrcpy via ADB_SERVER_PORT."""

    @pytest.mark.asyncio
    async def test_run_injects_adb_server_port(self, monkeypatch):
        from app.managers.adb import ADBManager

        captured = {}

        async def fake_exec(*args, **kwargs):
            captured["env"] = kwargs.get("env")
            class FakeProc:
                returncode = 0
                async def communicate(self):
                    return (b"ok", b"")
            return FakeProc()

        monkeypatch.setattr("asyncio.create_subprocess_exec", fake_exec)
        m = ADBManager(binary="adb", server_port=5038)
        await m._run("connect", "10.0.0.5:5555")
        assert captured["env"] is not None
        assert captured["env"]["ADB_SERVER_PORT"] == "5038"

    @pytest.mark.asyncio
    async def test_run_no_env_when_unset(self, monkeypatch):
        from app.managers.adb import ADBManager

        captured = {}

        async def fake_exec(*args, **kwargs):
            captured["env"] = kwargs.get("env")
            class FakeProc:
                returncode = 0
                async def communicate(self):
                    return (b"", b"")
            return FakeProc()

        monkeypatch.setattr("asyncio.create_subprocess_exec", fake_exec)
        m = ADBManager(binary="adb", server_port=None)
        await m._run("devices")
        assert captured["env"] is None

    @pytest.mark.asyncio
    async def test_server_port_from_env(self, monkeypatch):
        from app.managers.adb import ADBManager

        monkeypatch.setenv("PANEL_ADB_SERVER_PORT", "5042")
        m = ADBManager(binary="adb")
        assert m.server_port == 5042

    @pytest.mark.asyncio
    async def test_server_port_from_config_fallback(self, monkeypatch):
        """Sem env, cai na config adb.server_port (fonte única com o scrcpy)."""
        from app.managers.adb import ADBManager
        from app.utils.system import get_panel_adb_server_port

        monkeypatch.delenv("PANEL_ADB_SERVER_PORT", raising=False)

        class FakeADB:
            server_port = 5060

        class FakeSystem:
            adb = FakeADB()

        class FakeConfig:
            system = FakeSystem()

        import app.main

        monkeypatch.setattr(app.main, "config", FakeConfig())
        assert get_panel_adb_server_port() == 5060
        m = ADBManager(binary="adb")
        assert m.server_port == 5060
        monkeypatch.setattr(app.main, "config", None)
