"""Testes para o UpdateManager e API de atualização (Phase 2)."""

import asyncio
from pathlib import Path
import shutil
import pytest
import httpx

from app.managers.update import UpdateManager
from app.main import app
import app.core.auth as auth
import app.managers.update as update_module


@pytest.fixture
def dummy_project(tmp_path):
    """Cria uma estrutura de projeto simulada em tmp_path."""
    project_root = tmp_path / "project"
    project_root.mkdir()
    (project_root / "config").mkdir()
    (project_root / "config" / "system.yml").write_text("server: {port: 8080}", encoding="utf-8")
    (project_root / "app").mkdir()
    (project_root / "app" / "main.py").write_text("# dummy main", encoding="utf-8")
    return project_root


@pytest.fixture
def auth_header(tmp_path, monkeypatch):
    admin_file = tmp_path / "admin.json"
    secret_file = tmp_path / ".session_secret"
    monkeypatch.setattr(auth, "ADMIN_FILE", admin_file)
    monkeypatch.setattr(auth, "SESSION_SECRET_FILE", secret_file)
    monkeypatch.setattr(auth, "_secret_cache", "")
    monkeypatch.setattr(auth, "_token_cache", "")
    auth._reset_rate_limits()
    auth.set_admin("admin", "senha-admin-123")
    token = auth.create_session_token("admin")
    return {"Authorization": f"Bearer {token}"}


async def _client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_update_check_non_git(dummy_project):
    """Update check em diretório sem .git retorna erro controlado."""
    mgr = UpdateManager(project_root=dummy_project)
    res = await mgr.check()
    assert res["checked"] is True
    assert res["has_update"] is False
    assert "Não é um repositório git" in res["error"]


@pytest.mark.asyncio
async def test_update_check_with_changelog(dummy_project, monkeypatch):
    """Update check extrai commits pendentes para o changelog."""
    (dummy_project / ".git").mkdir()
    mgr = UpdateManager(project_root=dummy_project)

    async def mock_run_git(*args, timeout=None):
        cmd = args[0]
        if cmd == "fetch":
            return "", "", 0
        elif cmd == "rev-parse" and args[2] == "HEAD":
            return "abc1234\n", "", 0
        elif cmd == "rev-parse" and args[2] == "origin/main":
            return "def5678\n", "", 0
        elif cmd == "log":
            return "def5678 fix: resolver bug\n1234567 feat: nova feature\n", "", 0
        return "", "", 0

    monkeypatch.setattr(mgr, "_run_git", mock_run_git)

    res = await mgr.check()
    assert res["has_update"] is True
    assert res["current"] == "abc1234"
    assert res["remote"] == "def5678"
    assert len(res["changelog"]) == 2
    assert "def5678 fix: resolver bug" in res["changelog"]


@pytest.mark.asyncio
async def test_update_apply_success(dummy_project, monkeypatch):
    """Update apply preserva locais, sincroniza origin/main, valida e recarrega."""
    (dummy_project / ".git").mkdir()
    mgr = UpdateManager(project_root=dummy_project)

    calls = []

    async def mock_run_git(*args, timeout=None):
        calls.append(args)
        if args[0] == "rev-parse":
            return "abc123\n", "", 0
        return "Updated to origin/main.\n", "", 0

    async def mock_validate():
        return {"ok": True}

    monkeypatch.setattr(mgr, "_run_git", mock_run_git)
    monkeypatch.setattr(mgr, "_validate_post_update", mock_validate)
    monkeypatch.setattr(mgr, "_schedule_restart", lambda: asyncio.sleep(0, result="Restart agendado"))

    res = await mgr.apply()
    assert res["success"] is True
    assert "backup" in res
    backup_path = Path(res["backup"])
    assert backup_path.is_dir()
    assert (backup_path / "config" / "system.yml").is_file()
    assert any(call[:2] == ("fetch", "origin") for call in calls)
    assert ("reset", "--hard", "origin/main") in calls
    assert not any(call[0] == "pull" for call in calls)


@pytest.mark.asyncio
async def test_update_apply_sync_failure_rolls_back_exact_previous_head(dummy_project, monkeypatch):
    """Falha ao sincronizar restaura o SHA exato anterior, sem merge."""
    (dummy_project / ".git").mkdir()
    mgr = UpdateManager(project_root=dummy_project)

    calls = []

    async def mock_run_git(*args, timeout=None):
        calls.append(args)
        cmd = args[0]
        if cmd == "rev-parse":
            return "local123\n", "", 0
        if args == ("reset", "--hard", "origin/main"):
            return "", "disk error\n", 1
        return "", "", 0

    monkeypatch.setattr(mgr, "_run_git", mock_run_git)

    res = await mgr.apply()
    assert res["success"] is False
    assert res["rolled_back"] is True
    assert ("reset", "--hard", "local123") in calls
    assert "origin/main" in res["error"]
    assert not any(call[0] == "pull" for call in calls)


@pytest.mark.asyncio
async def test_update_apply_validation_failure_rollback(dummy_project, monkeypatch):
    """Se a validação pós-update falhar, executa rollback e restaura backup."""
    (dummy_project / ".git").mkdir()
    mgr = UpdateManager(project_root=dummy_project)

    async def mock_run_git(*args, timeout=None):
        if args[0] == "rev-parse":
            return "previous456\n", "", 0
        return "Update pulled.\n", "", 0

    async def mock_validate():
        return {"ok": False, "error": "SyntaxError em main.py"}

    monkeypatch.setattr(mgr, "_run_git", mock_run_git)
    monkeypatch.setattr(mgr, "_validate_post_update", mock_validate)

    res = await mgr.apply()
    assert res["success"] is False
    assert res["rolled_back"] is True
    assert "SyntaxError" in res["error"]


@pytest.mark.asyncio
async def test_schedule_restart_uses_system_task_outside_service_tree(tmp_path, monkeypatch):
    """Restart usa tarefa SYSTEM e script independente, não filho atrasado do painel."""
    monkeypatch.setattr("app.utils.system.find_nssm", lambda: r"C:\PanelTVBox\bin\nssm.exe")
    monkeypatch.setattr("app.utils.system.get_data_dir", lambda: tmp_path)
    calls = []

    class FakeProcess:
        returncode = 0

        async def communicate(self):
            return b"SUCCESS", b""

    async def fake_exec(*args, **kwargs):
        calls.append(args)
        return FakeProcess()

    monkeypatch.setattr(update_module.asyncio, "create_subprocess_exec", fake_exec)
    result = await UpdateManager(dummy_project)._schedule_restart()

    assert "externamente" in result
    assert calls[0][0:2] == ("schtasks.exe", "/create")
    assert "SYSTEM" in calls[0]
    assert "ONSTART" in calls[0]
    assert calls[1][0:2] == ("schtasks.exe", "/run")
    scripts = list((tmp_path / "update").glob("*.cmd"))
    assert len(scripts) == 1
    content = scripts[0].read_text(encoding="utf-8")
    assert 'nssm.exe" stop panel-tvbox' in content
    assert "ping.exe -n 6 127.0.0.1" in content
    assert "timeout.exe" not in content
    assert 'nssm.exe" start panel-tvbox' in content
    assert "schtasks.exe /delete" in content


@pytest.mark.asyncio
async def test_schedule_restart_cleans_script_when_task_creation_fails(tmp_path, monkeypatch):
    monkeypatch.setattr("app.utils.system.find_nssm", lambda: r"C:\PanelTVBox\bin\nssm.exe")
    monkeypatch.setattr("app.utils.system.get_data_dir", lambda: tmp_path)

    class FailedProcess:
        returncode = 1

        async def communicate(self):
            return b"", b"Access denied"

    async def fake_exec(*args, **kwargs):
        return FailedProcess()

    monkeypatch.setattr(update_module.asyncio, "create_subprocess_exec", fake_exec)
    result = await UpdateManager(dummy_project)._schedule_restart()

    assert "Falha ao agendar" in result
    assert list((tmp_path / "update").glob("*.cmd")) == []


@pytest.mark.asyncio
async def test_update_api_endpoints(auth_header, monkeypatch):
    """Verifica rotas /api/update: status, changelog, check, apply, rollback."""
    test_mgr = UpdateManager()

    async def mock_check():
        return {"checked": True, "has_update": True, "current": "111", "remote": "222", "changelog": ["commit 1"]}

    async def mock_apply():
        return {"success": True, "output": "Updated", "restart": "ok"}

    async def mock_rollback():
        return {"success": True, "output": "Rolled back", "restart": "ok"}

    monkeypatch.setattr(test_mgr, "check", mock_check)
    monkeypatch.setattr(test_mgr, "apply", mock_apply)
    monkeypatch.setattr(test_mgr, "rollback", mock_rollback)
    monkeypatch.setattr(test_mgr, "get_changelog", lambda: ["commit 1"])

    import app.api.update as update_api
    monkeypatch.setattr(update_api, "_get_manager", lambda req=None: test_mgr)

    async with await _client() as c:
        # Check
        r = await c.post("/api/update/check", headers=auth_header)
        assert r.status_code == 200
        assert r.json()["has_update"] is True

        # Changelog
        r = await c.get("/api/update/changelog", headers=auth_header)
        assert r.status_code == 200
        assert r.json()["changelog"] == ["commit 1"]

        # Apply
        r = await c.post("/api/update/apply", headers=auth_header)
        assert r.status_code == 200
        assert r.json()["success"] is True

        # Rollback
        r = await c.post("/api/update/rollback", headers=auth_header)
        assert r.status_code == 200
        assert r.json()["success"] is True
