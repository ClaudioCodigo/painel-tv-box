"""Testes para LogManager."""

import pytest
from pathlib import Path
from app.managers.log import LogManager


class TestLogManager:
    """Testes para o LogManager."""

    @pytest.fixture
    def log_mgr(self, tmp_path):
        return LogManager(log_dir=tmp_path / "logs")

    def test_setup_creates_log_files(self, log_mgr):
        log_mgr.setup()
        for src in ["system", "adb", "mediamtx", "watchdog", "user", "api"]:
            path = log_mgr.log_dir / f"{src}.log"
            assert path.exists()

    def test_log_writes_to_file(self, log_mgr):
        log_mgr.setup()
        log_mgr.info("system", "Teste de log")
        log_mgr.error("system", "Erro de teste", device_id="dev1")

        content = (log_mgr.log_dir / "system.log").read_text()
        assert "Teste de log" in content
        assert "Erro de teste" in content

    def test_search_returns_results(self, log_mgr):
        log_mgr.setup()
        log_mgr.info("system", "Primeira mensagem")
        log_mgr.info("system", "Segunda mensagem")
        log_mgr.error("system", "Erro crítico")

        result = log_mgr.search(source="system")
        assert result["total"] >= 3
        assert len(result["items"]) >= 3

    def test_search_by_level(self, log_mgr):
        log_mgr.setup()
        log_mgr.info("system", "Info msg")
        log_mgr.error("system", "Error msg")
        log_mgr.warning("system", "Warning msg")

        result = log_mgr.search(source="system", level="ERROR")
        assert all(item["level"] == "ERROR" for item in result["items"])

    def test_search_by_text(self, log_mgr):
        log_mgr.setup()
        log_mgr.info("system", "Mensagem com palavra-chave especial")
        log_mgr.info("system", "Outra mensagem")

        result = log_mgr.search(q="palavra-chave")
        assert result["total"] >= 1

    def test_tail_returns_recent(self, log_mgr):
        log_mgr.setup()
        log_mgr.info("system", "Primeira")
        log_mgr.info("system", "Última")

        items = log_mgr.tail(source="system", n=5)
        assert len(items) >= 2
        messages = [i["message"] for i in items]
        assert "Última" in messages

    def test_get_sources(self, log_mgr):
        log_mgr.setup()
        sources = log_mgr.get_sources()
        assert len(sources) == 6
        assert any(s["name"] == "system" for s in sources)

    def test_download_returns_path(self, log_mgr):
        log_mgr.setup()
        log_mgr.info("system", "Teste")

        path = log_mgr.download("system")
        assert path is not None
        assert path.is_file()

    def test_download_all(self, log_mgr):
        log_mgr.setup()
        log_mgr.info("system", "Sistema")
        log_mgr.info("adb", "ADB")

        path = log_mgr.download()
        assert path is not None
        assert path.is_file()
        content = path.read_text()
        assert "Sistema" in content

    def test_search_by_device_id(self, log_mgr):
        log_mgr.setup()
        log_mgr.info("system", "Msg device explícito", device_id="box-sala-1")
        log_mgr.info("adb", "Rebooting device box-sala-2 via adb")
        log_mgr.info("system", "Outro log sem device")

        res1 = log_mgr.search(device_id="box-sala-1")
        assert res1["total"] == 1
        assert "box-sala-1" in res1["items"][0]["device"]

        res2 = log_mgr.search(device_id="box-sala-2")
        assert res2["total"] == 1
        assert "box-sala-2" in res2["items"][0]["message"]

    def test_search_by_date_and_month(self, log_mgr):
        from datetime import datetime
        log_mgr.setup()
        today = datetime.now().strftime("%Y-%m-%d")
        month = datetime.now().strftime("%Y-%m")
        log_mgr.info("system", "Log de hoje")

        res_today = log_mgr.search(date=today)
        assert res_today["total"] >= 1

        res_month = log_mgr.search(date=month)
        assert res_month["total"] >= 1

        res_past = log_mgr.search(date="2020-01-01")
        assert res_past["total"] == 0
