"""Testes da recuperação de stream em degraded (ADB-safe + stream_only)."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.device import DeviceConfig
from app.services.recovery import RecoveryService
from app.managers.watchdog import WatchdogManager


@pytest.fixture(autouse=True)
def clean_queue():
    from app.services import command_queue as cq

    cq._QUEUE.clear()
    cq._RESULTS.clear()
    yield
    cq._QUEUE.clear()
    cq._RESULTS.clear()


def make_cfg():
    return SimpleNamespace(
        recovery=SimpleNamespace(
            cooldown_seconds=0,
            player_retry_max=2,
            player_retry_delay=0,
            wifi_restart=True,
            wifi_reconnect_timeout=1,
            eth_restart=True,
            eth_reconnect_timeout=1,
            reboot_max=1,
            reboot_boot_timeout=1,
        ),
        heartbeat_timeout=60,
    )


def make_device():
    dev = DeviceConfig(id="qa", ip="10.0.0.5", player="vlc")
    dev.state.last_heartbeat = None
    return dev


class TestRecoveryStreamOnly:
    @pytest.mark.asyncio
    async def test_stream_only_does_not_wifi_or_reboot(self):
        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("", 0))
        player = AsyncMock()
        player.start_stream = AsyncMock(return_value={"success": True, "method": "player_retry"})

        svc = RecoveryService(adb_manager=adb, player_manager=player, watchdog_config=make_cfg())
        result = await svc.recover(make_device(), stream_only=True)

        assert result["success"] is True
        assert result["method"] == "player_retry"
        # stream_only → NUNCA toca wifi/eth/reboot (sem adb.shell)
        adb.shell.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_stream_only_exhausted_stops_before_wifi(self):
        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("", 0))
        player = AsyncMock()
        player.start_stream = AsyncMock(return_value={"success": False})

        svc = RecoveryService(adb_manager=adb, player_manager=player, watchdog_config=make_cfg())
        result = await svc.recover(make_device(), stream_only=True)

        assert result["success"] is False
        assert result["method"] == "exhausted"
        adb.shell.assert_not_awaited()  # sem escalada p/ wifi/reboot


class TestReopenStreamAdbSafe:
    @pytest.mark.asyncio
    async def test_heartbeat_fresh_uses_adb_when_no_scrcpy(self, monkeypatch):
        """Heartbeat fresco SEM scrcpy → ADB direto (caminho confiável histórico).

        Regressão 13/08: quando o heartbeat passou a funcionar (grupo inet),
        a recuperação migrou para o canal de comandos (latência ~20s + sem
        verificação) e as streams não subiam — voltar ao ADB é o comportamento
        esperado; o canal de comandos fica só para o caso scrcpy ativo.
        """
        from app.managers.scrcpy import ScrcpyManager

        monkeypatch.setattr(ScrcpyManager, "is_device_active", lambda target: False)

        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("", 0))
        player = AsyncMock()
        player.start_stream = AsyncMock(return_value={"success": True, "method": "script"})

        dev = make_device()
        dev.state.last_heartbeat = datetime.now()  # fresco

        svc = RecoveryService(adb_manager=adb, player_manager=player, watchdog_config=make_cfg())
        result = await svc._reopen_stream(dev)

        assert result.get("success") is True
        player.start_stream.assert_awaited()  # ADB direto, não enfileira

    @pytest.mark.asyncio
    async def test_scrcpy_active_enqueues_command_no_adb(self, monkeypatch):
        """scrcpy ativo → canal de comandos (zero ADB — não derruba o mirror)."""
        from app.managers.scrcpy import ScrcpyManager
        from app.services import command_queue as cq

        monkeypatch.setattr(ScrcpyManager, "is_device_active", lambda target: True)

        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("", 0))
        player = AsyncMock()
        player.build_start_cmd = MagicMock(return_value="am start -a android.intent.action.VIEW -d 'rtsp://x'")

        dev = make_device()  # sem heartbeat — scrcpy ativo basta para enfileirar
        svc = RecoveryService(adb_manager=adb, player_manager=player, watchdog_config=make_cfg())
        result = await svc._reopen_stream(dev)

        assert result["method"] == "heartbeat_queue"
        assert result["queued"]
        adb.shell.assert_not_awaited()  # zero ADB painel→device
        pending = await cq.pop_pending("qa")
        assert len(pending) == 1
        assert pending[0]["action"] == "start_stream"

    @pytest.mark.asyncio
    async def test_scrcpy_active_no_duplicate_enqueue(self, monkeypatch):
        """Já há start_stream pendente → não enfileira outro (evita force-stop loop)."""
        from app.managers.scrcpy import ScrcpyManager
        from app.services import command_queue as cq

        monkeypatch.setattr(ScrcpyManager, "is_device_active", lambda target: True)

        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("", 0))
        player = AsyncMock()
        player.build_start_cmd = MagicMock(return_value="am start -a android.intent.action.VIEW -d 'rtsp://x'")

        dev = make_device()
        svc = RecoveryService(adb_manager=adb, player_manager=player, watchdog_config=make_cfg())

        first = await svc._reopen_stream(dev)
        assert first.get("queued")
        second = await svc._reopen_stream(dev)
        assert second.get("already_queued") is True
        pending = await cq.pop_pending("qa")
        assert len(pending) == 1  # continua só 1 pendente

    @pytest.mark.asyncio
    async def test_no_heartbeat_falls_back_to_adb(self):
        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("", 0))
        player = AsyncMock()
        player.start_stream = AsyncMock(return_value={"success": True})

        dev = make_device()  # sem heartbeat
        svc = RecoveryService(adb_manager=adb, player_manager=player, watchdog_config=make_cfg())
        result = await svc._reopen_stream(dev)

        assert result.get("success") is True  # fallback ADB
        player.start_stream.assert_awaited()


class TestIsStreamIssue:
    def test_reasons(self):
        assert WatchdogManager._is_stream_issue("Sem stream ativa") is True
        assert WatchdogManager._is_stream_issue("Player offline") is True
        assert WatchdogManager._is_stream_issue("Conexão instável") is False
        assert WatchdogManager._is_stream_issue("") is False
