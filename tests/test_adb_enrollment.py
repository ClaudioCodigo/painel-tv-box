"""Testes do núcleo de matrícula ADB para estações scrcpy."""

import base64
from unittest.mock import AsyncMock

import pytest

import app.managers.adb_enrollment as enrollment_module
from app.managers.adb_enrollment import ADBKeyProvisioner, EnrollmentStore, normalize_adb_public_key


def public_key(seed: int = 7) -> str:
    raw = bytes([seed]) * 524
    return base64.b64encode(raw).decode("ascii") + " original@client"


def test_public_key_is_normalized_and_fingerprinted():
    normalized, fingerprint = normalize_adb_public_key(public_key(), "PC Recepção")
    assert normalized.endswith("panel@PC_Recep__o")
    assert fingerprint.startswith("SHA256:")
    assert "original@client" not in normalized


@pytest.mark.parametrize("value", ["", "not-base64", "YWJjZA==", "abc\nsecond-line"])
def test_invalid_public_key_is_rejected(value):
    with pytest.raises(ValueError, match="Chave pública"):
        normalize_adb_public_key(value, "PC-01")


def test_enrollment_token_is_bound_and_single_use(tmp_path):
    EnrollmentStore._tokens.clear()
    store = EnrollmentStore(tmp_path / "enrollments.json")
    issued = store.issue_token("tv-sala", "admin")

    with pytest.raises(ValueError):
        store.consume_token(issued["token"], "tv-outra")
    # A tentativa incorreta também consome o bearer token para impedir replay.
    with pytest.raises(ValueError):
        store.consume_token(issued["token"], "tv-sala")


def test_register_and_remove_device_is_persistent(tmp_path):
    store = EnrollmentStore(tmp_path / "enrollments.json")
    normalized, fingerprint = normalize_adb_public_key(public_key(), "PC-01")
    client = store.register("tv-sala", "PC-01", normalized, fingerprint, "admin")
    store.register("tv-outra", "PC-01", normalized, fingerprint, "admin")

    loaded = store.get_client(client["id"])
    assert loaded["devices"] == ["tv-outra", "tv-sala"]
    assert store.remove_device(client["id"], "tv-sala") is not None
    assert store.get_client(client["id"])["devices"] == ["tv-outra"]


@pytest.mark.asyncio
async def test_provisioner_pushes_key_and_uses_static_root_command(tmp_path, monkeypatch):
    monkeypatch.setattr(enrollment_module, "get_data_dir", lambda: tmp_path)
    adb = AsyncMock()
    adb.push.return_value = True
    adb.shell.return_value = ("", 0)
    provisioner = ADBKeyProvisioner(adb)

    result = await provisioner.install("192.168.1.10", 5555, public_key())

    assert result["success"] is True
    assert adb.shell.await_count == 2
    command = adb.shell.await_args_list[0].args[1]
    assert "su -c" in command
    assert "/data/misc/adb/adb_keys" in command
    assert public_key().split()[0] not in command
    assert "setprop ctl.restart adbd" in adb.shell.await_args_list[1].args[1]


@pytest.mark.asyncio
async def test_provisioner_reports_root_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(enrollment_module, "get_data_dir", lambda: tmp_path)
    adb = AsyncMock()
    adb.push.return_value = True
    adb.shell.return_value = ("permission denied", 1)

    result = await ADBKeyProvisioner(adb).install("192.168.1.10", 5555, public_key())
    assert result["success"] is False
    assert "Magisk/root" in result["error"]
