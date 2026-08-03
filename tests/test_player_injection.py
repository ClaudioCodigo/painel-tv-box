"""Testes da proteção contra injeção de comando no PlayerManager."""

from unittest.mock import AsyncMock

import pytest

from app.managers.player import PlayerManager
from app.models.device import DeviceConfig


class TestPlayerInjection:
    @pytest.mark.asyncio
    async def test_start_stream_quotes_all_args(self):
        adb = AsyncMock()
        # Script não existe no device → retorna erro para cair no fallback
        adb.shell = AsyncMock(return_value=("No such file", 1))
        pm = PlayerManager(adb_manager=adb)

        # Valores maliciosos: aspas simples + ponto-e-vírgula + expansão
        evil = DeviceConfig(
            id="qa",
            name="x'; reboot #",
            rtsp_path="p' ; id",
            player_extra_args="'; touch /tmp/pwned #",
        )
        await pm.start_stream(evil)

        # shlex.split reparseia o comando como o shell do device faria:
        # cada argumento deve permanecer UM token — payload malicioso NÃO vira comando.
        import shlex

        for call in adb.shell.call_args_list:
            cmd = call.args[1]
            tokens = shlex.split(cmd)
            # Nenhum payload quebrou em comando separado
            assert "reboot" not in tokens
            assert "id" not in tokens
            assert "touch" not in tokens
            if cmd.startswith("sh "):
                # Chamada do script: título e extra intactos DENTRO de um token
                assert any("reboot #" in t for t in tokens)
                assert any("touch /tmp/pwned" in t for t in tokens)
            else:
                # Fallback intent: URL maliciosa intacta num único token
                assert any("rtsp://" in t and "; id" in t for t in tokens)

    @pytest.mark.asyncio
    async def test_stop_stream_quotes_package(self):
        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("", 0))
        pm = PlayerManager(adb_manager=adb)
        evil = DeviceConfig(id="qa", ip="10.0.0.5", player="vlc")
        await pm.stop_stream(evil)
        cmd = adb.shell.call_args.args[1]
        assert "force-stop" in cmd
        assert cmd.count("'") % 2 == 0
