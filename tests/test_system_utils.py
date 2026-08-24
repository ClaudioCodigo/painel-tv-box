"""Testes para utilitários de sistema (app.utils.system)."""

import os
from pathlib import Path

from app.utils.system import find_nssm, get_metrics, get_data_dir


def test_find_nssm_fallback_which(monkeypatch):
    """find_nssm faz fallback para shutil.which se não estiver em bin."""
    monkeypatch.setattr("pathlib.Path.is_file", lambda self: False)
    monkeypatch.setattr("shutil.which", lambda cmd: r"C:\Windows\System32\nssm.exe" if cmd == "nssm" else None)

    found = find_nssm()
    assert found == r"C:\Windows\System32\nssm.exe"


def test_get_metrics_windows_disk():
    """get_metrics retorna métricas válidas no host."""
    metrics = get_metrics()
    assert "cpu_percent" in metrics
    assert "ram_percent" in metrics
    assert "disk_percent" in metrics
    assert "disk_total_gb" in metrics
    assert metrics["disk_total_gb"] > 0
    assert "uptime_seconds" in metrics
