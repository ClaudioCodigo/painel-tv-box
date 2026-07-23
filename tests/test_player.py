"""Testes para PlayerManager."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.models.device import DeviceConfig
from app.managers.player import PlayerManager


class TestPlayerManager:
    """Testes para o PlayerManager."""

    @pytest.fixture
    def player(self):
        from app.models.config import PlayersConfig
        adb = AsyncMock()
        players = PlayersConfig()
        return PlayerManager(adb_manager=adb, players_config=players, host_ip="192.168.254.102", rtsp_port=8554)

    @pytest.fixture
    def device(self):
        return DeviceConfig(id="test", ip="192.168.1.1", rtsp_path="TV_BOX_1", player="vlc")

    def test_build_rtsp_url(self, player, device):
        url = player._build_rtsp_url(device)
        assert url == "rtsp://192.168.254.102:8554/TV_BOX_1"

    def test_build_rtsp_url_with_full_url(self, player):
        device = DeviceConfig(id="test", ip="192.168.1.1", rtsp_path="rtsp://other:8554/stream")
        url = player._build_rtsp_url(device)
        assert url == "rtsp://other:8554/stream"

    def test_get_player_def_vlc(self, player):
        pdef = player._get_player_def("vlc")
        assert pdef is not None
        assert "org.videolan.vlc" in pdef.package

    def test_get_player_def_mpv(self, player):
        pdef = player._get_player_def("mpv")
        assert pdef is not None
        assert "is.xyz.mpv" in pdef.package

    def test_get_player_def_unknown(self, player):
        pdef = player._get_player_def("nonexistent")
        assert pdef is None

    @pytest.mark.asyncio
    async def test_stop_stream_success(self, player, device):
        player.adb.shell = AsyncMock(return_value=("", 0))
        result = await player.stop_stream(device)
        assert result["success"] is True
        assert "org.videolan.vlc" in result["package"]

    @pytest.mark.asyncio
    async def test_stop_stream_no_adb(self, device):
        player = PlayerManager(adb_manager=None, players_config=None)
        result = await player.stop_stream(device)
        assert result["success"] is False
