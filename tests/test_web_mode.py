"""Testes unitários e de integração para o modo Web Signage."""

import asyncio
from datetime import datetime, timedelta
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.models.device import DeviceConfig, DeviceState
from app.managers.player import PlayerManager
from app.managers.health import HealthManager
from app.services.recovery import RecoveryService
from app.models.config import WatchdogConfig


@pytest.mark.asyncio
async def test_device_config_web_mode_validation():
    """DeviceConfig aceita mode='web' e target_url."""
    dev = DeviceConfig(
        id="tv-web-test",
        name="TV Web Test",
        ip="192.168.1.50",
        mode="web",
        target_url="https://app.powerbi.com/view",
        web_browser="chrome",
    )
    assert dev.mode == "web"
    assert dev.target_url == "https://app.powerbi.com/view"
    assert dev.web_browser == "chrome"


@pytest.mark.asyncio
async def test_player_start_web():
    """PlayerManager.start_web executa intent do Chrome apontando para o wrapper."""
    adb_mock = AsyncMock()
    adb_mock.shell.return_value = ("Events injected: 1", 0)

    player = PlayerManager(adb_manager=adb_mock, host_ip="192.168.1.10", panel_port=8080)
    dev = DeviceConfig(
        id="box-web",
        ip="192.168.1.55",
        mode="web",
        target_url="https://painel.local/dashboard",
        web_browser="chrome",
    )

    res = await player.start(dev, panel_url="http://192.168.1.10:8080")
    assert res["success"] is True
    assert res["method"] == "web_intent"
    assert res["url"] == "http://192.168.1.10:8080/signage/box-web"
    assert res["browser"] == "com.android.chrome"

    # Confirma que adb.shell foi chamado com intent do chrome
    adb_mock.shell.assert_called_once()
    called_cmd = adb_mock.shell.call_args[0][1]
    assert "com.android.chrome" in called_cmd
    assert "signage/box-web" in called_cmd


@pytest.mark.asyncio
async def test_player_stop_web():
    """PlayerManager.stop_web executa am force-stop no pacote do browser."""
    adb_mock = AsyncMock()
    adb_mock.shell.return_value = ("", 0)

    player = PlayerManager(adb_manager=adb_mock)
    dev = DeviceConfig(
        id="box-web",
        ip="192.168.1.55",
        mode="web",
        target_url="https://painel.local/dashboard",
        web_browser="chrome",
    )

    res = await player.stop(dev)
    assert res["success"] is True
    assert res["package"] == "com.android.chrome"
    called_cmd = adb_mock.shell.call_args[0][1]
    assert "am force-stop com.android.chrome" in called_cmd


@pytest.mark.asyncio
async def test_health_check_web_mode_online():
    """HealthManager reporta 'online' para device em modo web com ping de signage recente."""
    adb_mock = AsyncMock()
    health = HealthManager(adb_manager=adb_mock)

    dev = DeviceConfig(
        id="box-signage",
        ip="192.168.1.60",
        mode="web",
        target_url="https://app.powerbi.com",
    )
    # Simula ping recente
    dev.state.last_signage_ping = datetime.now()

    # Ping mock
    async def mock_ping(*args, **kwargs):
        mock_proc = MagicMock()
        mock_proc.wait = AsyncMock(return_value=0)
        return mock_proc

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(asyncio, "create_subprocess_exec", mock_ping)
        res = await health.check(dev)

    assert res["status"] == "online"
    assert "Página web ativa" in res["reason"]
    assert res["signage_fresh"] is True


@pytest.mark.asyncio
async def test_health_check_web_mode_degraded():
    """HealthManager reporta 'degraded' para device em modo web sem ping de signage."""
    adb_mock = AsyncMock()
    adb_mock.shell.return_value = (
        "mResumedActivity: ActivityRecord{123 u0 com.android.chrome/com.google.android.apps.chrome.Main}",
        0,
    )
    health = HealthManager(adb_manager=adb_mock)

    dev = DeviceConfig(
        id="box-signage",
        ip="192.168.1.60",
        mode="web",
        target_url="https://app.powerbi.com",
    )
    # Ping antigo (> 30s)
    dev.state.last_signage_ping = datetime.now() - timedelta(seconds=60)
    dev.state.current_activity = "com.android.chrome/com.google.android.apps.chrome.Main"

    async def mock_ping(*args, **kwargs):
        mock_proc = MagicMock()
        mock_proc.wait = AsyncMock(return_value=0)
        return mock_proc

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(asyncio, "create_subprocess_exec", mock_ping)
        res = await health.check(dev)

    assert res["status"] == "degraded"
    assert "Browser aberto mas página sem resposta" in res["reason"]
    assert res["signage_fresh"] is False


@pytest.mark.asyncio
async def test_recovery_service_web_mode():
    """RecoveryService recupera device web executando player.start_web."""
    adb_mock = AsyncMock()
    adb_mock.shell.return_value = ("", 0)

    player_mock = AsyncMock()
    player_mock.start_web = AsyncMock(return_value={"success": True, "method": "web_intent"})

    cfg = WatchdogConfig()
    cfg.recovery.cooldown_seconds = 0
    recovery = RecoveryService(adb_manager=adb_mock, player_manager=player_mock, watchdog_config=cfg)

    dev = DeviceConfig(
        id="box-web",
        ip="192.168.1.55",
        mode="web",
        target_url="https://painel.local/dashboard",
    )

    res = await recovery.recover(dev, stream_only=True)
    assert res["success"] is True
    player_mock.start_web.assert_called_once_with(dev)
