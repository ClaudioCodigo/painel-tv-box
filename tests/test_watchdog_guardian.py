"""Testes do guardião do watchdog (ressuscita heartbeat.sh/netwatch.sh).

Cobre a regra ADB×scrcpy (docs/09 §3.3): o guardião só toca ADB quando o
heartbeat expirou E não há sessão scrcpy ativa no device.
"""

from datetime import datetime, timedelta

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.device import DeviceConfig, DeviceState
from app.models.config import WatchdogConfig, WatchdogGuardianConfig


def _device() -> DeviceConfig:
    return DeviceConfig(
        id="test",
        name="Test",
        ip="192.168.254.200",
        adb_port=5555,
        state=DeviceState(),
    )


def _watchdog(adb=None, heartbeat_fresh=True):
    """Monta WatchdogManager com cfg guardian padrão e health mockado."""
    from app.managers.watchdog import WatchdogManager

    health = MagicMock()
    if adb is None:
        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("heartbeat: ATIVO (PID 1)\n", 0))
    health.adb = adb
    cfg = WatchdogConfig(
        guardian=WatchdogGuardianConfig(enabled=True, check_interval=60, adb_timeout=10)
    )
    w = WatchdogManager(health_manager=health, recovery_service=None, config=cfg)
    return w


class TestGuardian:
    @pytest.mark.asyncio
    async def test_heartbeat_fresh_nao_toca_adb(self):
        """Heartbeat fresco → guardião não faz nenhuma shell (scripts vivos)."""
        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("", 0))
        w = _watchdog(adb=adb)
        dev = _device()
        dev.state.last_heartbeat = datetime.now()
        await w._guardian_check(dev)
        adb.shell.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_scrcpy_ativo_nao_toca_adb(self):
        """scrcpy ativo → zero ADB mesmo com heartbeat expirado (regra §3.3)."""
        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("", 0))
        w = _watchdog(adb=adb)
        dev = _device()
        dev.state.last_heartbeat = datetime.now() - timedelta(minutes=10)
        with patch("app.managers.scrcpy.ScrcpyManager.is_device_active", return_value=True):
            await w._guardian_check(dev)
        adb.shell.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_heartbeat_expirado_reinicia_parado(self):
        """Heartbeat expirado e script PARADO → reinicia heartbeat.sh e netwatch.sh."""
        adb = AsyncMock()
        adb.shell = AsyncMock(side_effect=[
            ("heartbeat: PARADO\n", 1),   # status heartbeat
            ("", 0),                      # start heartbeat
            ("netwatch: PARADO\n", 1),    # status netwatch
            ("", 0),                      # start netwatch
        ])
        w = _watchdog(adb=adb)
        dev = _device()
        dev.state.last_heartbeat = datetime.now() - timedelta(minutes=10)
        events = []
        w.set_event_broadcast(lambda ev: events.append(ev) or _noop_async())

        await w._guardian_check(dev)

        calls = [c.args[1] for c in adb.shell.await_args_list]
        assert any("heartbeat.sh status" in c for c in calls)
        assert any("heartbeat.sh start" in c for c in calls)
        assert any("netwatch.sh status" in c for c in calls)
        assert any("netwatch.sh start" in c for c in calls)
        assert events, "deve publicar eventos do guardião"

    @pytest.mark.asyncio
    async def test_heartbeat_expirado_nao_reinicia_ativos(self):
        """Heartbeat expirado mas scripts ATIVOS → nenhum start."""
        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("heartbeat: ATIVO (PID 5)\nnetwatch: ATIVO (PID 6)\n", 0))
        w = _watchdog(adb=adb)
        dev = _device()
        dev.state.last_heartbeat = datetime.now() - timedelta(minutes=10)
        await w._guardian_check(dev)
        for c in adb.shell.await_args_list:
            assert "start" not in c.args[1], f"não deveria chamar start: {c.args[1]}"

    @pytest.mark.asyncio
    async def test_guardian_disabled(self):
        """Guardian desabilitado → nada de ADB."""
        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("", 0))
        w = _watchdog(adb=adb)
        w.cfg.guardian.enabled = False
        dev = _device()
        dev.state.last_heartbeat = datetime.now() - timedelta(minutes=10)
        await w._guardian_check(dev)
        adb.shell.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_cooldown_respeitado(self):
        """Segundo check dentro do intervalo → pula (sem ADB)."""
        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("", 0))
        w = _watchdog(adb=adb)
        dev = _device()
        dev.state.last_heartbeat = datetime.now() - timedelta(minutes=10)
        w._guardian_last[dev.id] = __import__("time").monotonic()  # check "agora"
        await w._guardian_check(dev)
        adb.shell.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_device_offline_nao_toca_adb(self):
        """Device offline → guardião pula (recovery já cuida)."""
        adb = AsyncMock()
        adb.shell = AsyncMock(return_value=("", 0))
        w = _watchdog(adb=adb)
        dev = _device()
        dev.state.last_heartbeat = datetime.now() - timedelta(minutes=10)
        dev.state.status = "offline"
        await w._guardian_check(dev)
        adb.shell.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_sem_adb_manager_nao_falha(self):
        """Sem ADBManager no health → guardião retorna sem erro."""
        w = _watchdog(adb=None)
        # remove o adb para simular health sem adb
        w.health.adb = None
        dev = _device()
        dev.state.last_heartbeat = datetime.now() - timedelta(minutes=10)
        await w._guardian_check(dev)  # não deve lançar

    @pytest.mark.asyncio
    async def test_excecao_adb_nao_propaga(self):
        """ADB lança exceção → guardião loga e continua (não propaga)."""
        adb = AsyncMock()
        adb.shell = AsyncMock(side_effect=Exception("ADB timeout"))
        w = _watchdog(adb=adb)
        dev = _device()
        dev.state.last_heartbeat = datetime.now() - timedelta(minutes=10)
        await w._guardian_check(dev)  # não deve lançar


async def _noop_async():
    return None
