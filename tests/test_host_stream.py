"""Testes unitários para HostStreamManager e endpoints de Host Streaming (Office/Janelas)."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.managers.host_stream import HostStreamManager
from app.utils.system import resolve_binary


def test_resolve_binary_python():
    """Valida que resolve_binary localiza o executável python."""
    py = resolve_binary("python")
    assert py is not None
    assert "python" in py.lower()


def test_resolve_binary_nonexistent():
    """Valida retorno None para binário inexistente."""
    res = resolve_binary("binario_inexistente_xyz_123")
    assert res is None


def test_host_stream_manager_list_windows():
    """Valida listagem de janelas e identificação de apps."""
    mgr = HostStreamManager()
    windows = mgr.list_windows()
    assert isinstance(windows, list)
    if windows:
        assert "title" in windows[0]
        assert "app" in windows[0]


@pytest.mark.asyncio
async def test_host_stream_manager_lifecycle():
    """Valida início e parada de streaming simulado."""
    mock_mtx = AsyncMock()
    mock_mtx.add_path.return_value = {"success": True}
    mock_mtx.delete_path.return_value = {"success": True}

    mgr = HostStreamManager(mediamtx_manager=mock_mtx)

    with patch("asyncio.create_subprocess_exec") as mock_proc_exec, \
         patch("app.managers.host_stream.resolve_binary", return_value="ffmpeg.exe"), \
         patch("shutil.which", return_value="ffmpeg.exe"):

        fake_proc = MagicMock()
        fake_proc.returncode = None
        fake_proc.terminate = MagicMock()
        fake_proc.wait = AsyncMock()
        mock_proc_exec.return_value = fake_proc

        # Start stream no modo loop (30 fps)
        start_res = await mgr.start_stream(
            stream_id="mural-loop",
            window_title="PowerPoint - Apresentacao.pptx",
            profile="loop",
        )
        assert start_res["success"] is True
        assert start_res["fps"] == 30
        assert start_res["rtsp_path"] == "live/mural-loop"
        mock_mtx.add_path.assert_called_with("live/mural-loop")

        # Verifica stream ativa
        active = await mgr.list_active_streams()
        assert len(active) == 1
        assert active[0]["stream_id"] == "mural-loop"

        # Start stream no modo fixo/estático (2 fps para slide do mês)
        start_fixed = await mgr.start_stream(
            stream_id="slide-mes",
            window_title="PowerPoint - Metas_Outubro.pptx",
            profile="fixed",
        )
        assert start_fixed["success"] is True
        assert start_fixed["fps"] == 2

        # Stop stream
        stop_res = await mgr.stop_stream("mural-loop")
        assert stop_res["success"] is True
        mock_mtx.delete_path.assert_called_with("live/mural-loop")


def test_api_host_stream_endpoints():
    """Valida rotas HTTP de host stream."""
    from app.core.auth import require_auth

    app.dependency_overrides[require_auth] = lambda: True
    try:
        client = TestClient(app)

        # List windows
        resp = client.get("/api/host-stream/windows")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "windows" in data

        # List streams
        resp_s = client.get("/api/host-stream/streams")
        assert resp_s.status_code == 200
        assert resp_s.json()["success"] is True
    finally:
        app.dependency_overrides.pop(require_auth, None)
