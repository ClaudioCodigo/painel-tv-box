"""Testes para o script de desativação de validação RSA (Abordagem B — Magisk resetprop)."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest

from app.models.device import DeviceConfig
from app.services.provision import ProvisionService, MANIFEST, SCRIPTS_DIR

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ANDROID_SCRIPTS_DIR = PROJECT_ROOT / "scripts" / "android"


def test_adb_insecure_script_exists_and_format():
    """Valida existência, formato POSIX e ausência de CRLF em 99-adb-insecure.sh."""
    script_path = ANDROID_SCRIPTS_DIR / "99-adb-insecure.sh"
    assert script_path.is_file(), "scripts/android/99-adb-insecure.sh deve existir"

    raw = script_path.read_bytes()
    assert b"\r\n" not in raw, "Script Android não pode conter quebras de linha Windows CRLF"
    assert raw.startswith(b"#!/system/bin/sh\n"), "Script deve iniciar com #!/system/bin/sh"

    content = raw.decode("utf-8")
    # Propriedades Android e Magisk
    assert "ro.adb.secure 0" in content
    assert "ro.debuggable 1" in content
    assert "service.adb.tcp.port 5555" in content
    assert "persist.adb.tcp.port 5555" in content
    assert "resetprop" in content
    assert "adbd" in content
    assert "sys.boot_completed" in content
    assert "now" in content and "status" in content


def test_setup_adb_insecure_script_exists_and_format():
    """Valida existência e formato de setup_adb_insecure.sh."""
    setup_path = ANDROID_SCRIPTS_DIR / "setup_adb_insecure.sh"
    assert setup_path.is_file(), "scripts/android/setup_adb_insecure.sh deve existir"

    raw = setup_path.read_bytes()
    assert b"\r\n" not in raw, "Script Android não pode conter quebras de linha Windows CRLF"
    assert raw.startswith(b"#!/system/bin/sh\n"), "Script deve iniciar com #!/system/bin/sh"

    content = raw.decode("utf-8")
    assert "/data/adb/service.d" in content
    assert "99-adb-insecure.sh" in content
    assert "chmod 755" in content
    assert "su" in content


def test_manifest_includes_insecure_scripts():
    """Garante que os scripts de ADB inseguro estão no MANIFEST de provisionamento."""
    assert "99-adb-insecure.sh" in MANIFEST
    assert "setup_adb_insecure.sh" in MANIFEST


@pytest.mark.asyncio
async def test_provision_deploys_and_activates_insecure_magisk(monkeypatch, tmp_path):
    """Verifica se o ProvisionService copia e ativa 99-adb-insecure.sh no Magisk service.d."""
    import app.main as main_module

    config_mock = SimpleNamespace(
        system=SimpleNamespace(
            host=SimpleNamespace(ip="192.168.1.10"),
            server=SimpleNamespace(port=8080),
            security=SimpleNamespace(heartbeat_key="test_key"),
        )
    )
    monkeypatch.setattr(main_module, "config", config_mock)
    monkeypatch.setattr("app.services.provision.SCRIPTS_DIR", tmp_path)

    for name in MANIFEST:
        (tmp_path / name).write_text("#!/system/bin/sh\necho ok\n", encoding="utf-8")

    class FakeADB:
        def __init__(self):
            self.shell = AsyncMock(side_effect=lambda *a, **k: ("MAGISK 26.4", 0))

        async def push(self, ip, local, remote, port=5555, timeout=30):
            return True

    adb = FakeADB()
    prov = ProvisionService(adb_manager=adb)
    device = DeviceConfig(id="tv-sala", ip="192.168.1.50", adb_port=5555, root=True)

    result = await prov.provision(device)
    assert result["success"] is True
    assert "adb_insecure_magisk" in result["scripts_pushed"]
    assert "99-adb-insecure.sh" in result["scripts_pushed"]
    assert "setup_adb_insecure.sh" in result["scripts_pushed"]

    service_calls = [c.args[1] for c in adb.shell.await_args_list if "service.d" in c.args[1]]
    assert len(service_calls) == 1
    magisk_cmd = service_calls[0]
    assert "99-adb-insecure.sh" in magisk_cmd
    assert "/data/adb/service.d/99-adb-insecure.sh" in magisk_cmd
    assert "chmod 755" in magisk_cmd
    assert "sh /data/adb/service.d/99-adb-insecure.sh now" in magisk_cmd
