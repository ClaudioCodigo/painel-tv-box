"""Testes do provision — especialmente o push do heartbeat.conf (Ideia 3)."""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.provision import ProvisionService, MANIFEST, SCRIPTS_DIR
from app.models.device import DeviceConfig


@pytest.fixture
def anyio_backend():
    return "asyncio"


def make_config():
    return SimpleNamespace(
        system=SimpleNamespace(
            host=SimpleNamespace(ip="192.168.254.102"),
            server=SimpleNamespace(port=8080),
            security=SimpleNamespace(heartbeat_key="k123"),
        )
    )


class TestHeartbeatConf:
    def test_heartbeat_conf_content(self, monkeypatch):
        import app.main as main_module

        monkeypatch.setattr(main_module, "config", make_config())
        prov = ProvisionService(adb_manager=None)
        device = DeviceConfig(id="qa", ip="10.0.0.5")
        conf = prov._heartbeat_conf(device)
        assert conf is not None
        assert "PANEL_URL=http://192.168.254.102:8080" in conf
        assert "DEVICE_ID=qa" in conf
        assert "KEY=k123" in conf
        assert "INTERVAL=" in conf

    def test_heartbeat_conf_none_without_config(self, monkeypatch):
        import app.main as main_module

        monkeypatch.setattr(main_module, "config", None)
        prov = ProvisionService(adb_manager=None)
        device = DeviceConfig(id="qa", ip="10.0.0.5")
        assert prov._heartbeat_conf(device) is None


class TestProvisionHeartbeatPush:
    @pytest.mark.asyncio
    async def test_pushes_heartbeat_conf_from_real_file(self, monkeypatch, tmp_path):
        import app.main as main_module

        monkeypatch.setattr(main_module, "config", make_config())
        monkeypatch.setattr("app.services.provision.SCRIPTS_DIR", tmp_path)

        # Cria os scripts do MANIFEST no tmp dir
        for name in MANIFEST:
            (tmp_path / name).write_text("#!/system/bin/sh\necho ok\n", encoding="utf-8")

        class FakeADB:
            def __init__(self):
                self.push_calls = []
                self.shell = AsyncMock(return_value=("", 0))

            async def push(self, ip, local, remote, port=5555, timeout=30):
                # Captura o conteúdo NO MOMENTO do push (o temp é apagado depois)
                try:
                    content = open(local, encoding="utf-8").read()
                except Exception:
                    content = None
                self.push_calls.append((local, remote, content))
                return True

        adb = FakeADB()
        prov = ProvisionService(adb_manager=adb)
        device = DeviceConfig(id="qa", ip="10.0.0.5", adb_port=5555)
        result = await prov.provision(device)

        # O heartbeat.conf foi enviado (sem erro de push)
        assert result["success"] is True
        assert "heartbeat.conf" in result["scripts_pushed"]
        assert not any("heartbeat" in e for e in result["errors"])

        # O push recebeu um CAMINHO de arquivo real com o conteúdo certo
        conf_push = [c for c in adb.push_calls if c[1].endswith("heartbeat.conf")]
        assert len(conf_push) == 1
        local_path, remote_path, content = conf_push[0]
        assert content is not None, "local deve ser um arquivo legível no host"
        assert "PANEL_URL=" in content
        assert "DEVICE_ID=qa" in content

        # O script de start foi invocado no device
        start_calls = [c for c in adb.shell.call_args_list if "heartbeat.sh start" in c.args[1]]
        assert len(start_calls) == 1
