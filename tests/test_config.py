"""Testes para ConfigurationManager e Models."""

import pytest
from pathlib import Path
import tempfile

from app.core.config import ConfigurationManager
from app.models.config import SystemConfig, WatchdogConfig, PlayersConfig
from app.models.device import DeviceConfig
from app.models.group import GroupConfig


class TestSystemConfig:
    def test_defaults(self):
        cfg = SystemConfig()
        assert cfg.wizard_completed is False
        assert cfg.server.port == 8080
        assert cfg.host.ip == "192.168.254.102"
        assert cfg.adb.default_port == 5555

    def test_from_dict(self):
        cfg = SystemConfig(**{"server": {"port": 9090}})
        assert cfg.server.port == 9090
        assert cfg.server.host == "0.0.0.0"  # default mantido


class TestDeviceConfig:
    def test_defaults(self):
        d = DeviceConfig(id="test-device")
        assert d.id == "test-device"
        assert d.adb_port == 5555
        assert d.player == "vlc"
        assert d.state.status == "unknown"

    def test_model_dump_safe_excludes_state(self):
        d = DeviceConfig(id="test", name="TV Test", ip="192.168.1.1")
        data = d.model_dump_safe()
        assert "state" not in data
        assert data["id"] == "test"
        assert data["name"] == "TV Test"


class TestWatchdogConfig:
    def test_defaults(self):
        w = WatchdogConfig()
        assert w.check_interval == 10
        assert w.recovery.cooldown_seconds == 15
        assert w.recovery.player_retry_max == 2
        assert w.recovery.reboot_max == 1


class TestConfigurationManager:
    def test_load_empty_configs(self):
        with tempfile.TemporaryDirectory() as tmp:
            cm = _make_cm(tmp)
            import asyncio

            asyncio.run(cm.load())
            assert cm.system is not None
            assert cm.wizard_completed is False
            assert len(cm.devices) == 0
            assert len(cm.groups) == 0

    def test_add_and_get_device(self):
        with tempfile.TemporaryDirectory() as tmp:
            cm = _make_cm(tmp)
            import asyncio

            asyncio.run(cm.load())

            d = DeviceConfig(id="box1", name="TV Box 1", ip="192.168.1.10", rtsp_path="BOX_1")
            cm.add_device(d)

            assert cm.get_device("box1") is not None
            assert cm.get_device("box1").name == "TV Box 1"
            assert len(cm.devices) == 1

    def test_add_device_writes_yaml(self):
        with tempfile.TemporaryDirectory() as tmp:
            cm = _make_cm(tmp)
            import asyncio

            asyncio.run(cm.load())

            d = DeviceConfig(id="box1", name="TV Box 1", ip="192.168.1.10")
            cm.add_device(d)

            yaml_path = Path(tmp) / "devices" / "box1.yml"
            assert yaml_path.is_file()

    def test_delete_device(self):
        with tempfile.TemporaryDirectory() as tmp:
            cm = _make_cm(tmp)
            import asyncio

            asyncio.run(cm.load())

            d = DeviceConfig(id="box1", name="TV Box 1", ip="192.168.1.10")
            cm.add_device(d)
            assert len(cm.devices) == 1

            cm.delete_device("box1")
            assert len(cm.devices) == 0
            assert cm.get_device("box1") is None

    def test_update_device(self):
        with tempfile.TemporaryDirectory() as tmp:
            cm = _make_cm(tmp)
            import asyncio

            asyncio.run(cm.load())

            d = DeviceConfig(id="box1", name="TV Box 1", ip="192.168.1.10")
            cm.add_device(d)

            updated = cm.update_device("box1", {"name": "Novo Nome", "location": "Sala A"})
            assert updated is not None
            assert updated.name == "Novo Nome"
            assert updated.location == "Sala A"
            assert updated.ip == "192.168.1.10"  # não mudou

    def test_unknown_device(self):
        with tempfile.TemporaryDirectory() as tmp:
            cm = _make_cm(tmp)
            import asyncio

            asyncio.run(cm.load())
            assert cm.get_device("inexistente") is None
            assert cm.update_device("inexistente", {"name": "x"}) is None
            assert cm.delete_device("inexistente") is False


def _make_cm(tmp: str) -> ConfigurationManager:
    """Cria ConfigurationManager com diretórios temporários."""
    import app.core.config as cfg_module

    original = cfg_module.PROJECT_ROOT
    cfg_module.PROJECT_ROOT = Path(tmp)
    cm = ConfigurationManager()
    cfg_module.PROJECT_ROOT = original
    # Override the dirs:
    cm.config_dir = Path(tmp) / "config"
    cm.devices_dir = Path(tmp) / "devices"
    cm.groups_dir = Path(tmp) / "groups"
    return cm
