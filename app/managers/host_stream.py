"""HostStreamManager — Gerencia captura de janelas/desktop do Windows e streaming via FFmpeg -> MediaMTX."""

import asyncio
from datetime import datetime
import logging
import os
import shutil
from typing import Optional

from app.utils.system import is_safe_id, resolve_binary

logger = logging.getLogger("host_stream")


class HostStreamManager:
    """Gerencia captura de janelas locais no Windows (ex: PowerPoint, Excel)

    e streaming em tempo real via FFmpeg (gdigrab) para o MediaMTX (RTMP/RTSP).
    """

    def __init__(self, mediamtx_manager=None, rtmp_base_url: str = "rtmp://127.0.0.1:1935"):
        self.mediamtx = mediamtx_manager
        self.rtmp_base_url = rtmp_base_url.rstrip("/")
        self._streams: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    def list_windows(self) -> list[dict]:
        """Enumera janelas visíveis no Windows (com título não vazio)."""
        windows = []
        if os.name != "nt":
            # Fallback para ambientes não-Windows (ex: testes ou dev isolado)
            return [
                {"hwnd": 1001, "title": "Apresentação do PowerPoint - [Mural_Loop.pptx]", "app": "powerpoint"},
                {"hwnd": 1002, "title": "PowerPoint - [Metas_Outubro.pptx]", "app": "powerpoint"},
                {"hwnd": 1003, "title": "Microsoft Excel - Dashboard.xlsx", "app": "excel"},
            ]

        try:
            import ctypes
            from ctypes import wintypes

            user32 = ctypes.windll.user32
            WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

            def enum_proc(hwnd, lparam):
                if not user32.IsWindowVisible(hwnd):
                    return True
                length = user32.GetWindowTextLengthW(hwnd)
                if length == 0:
                    return True

                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                title = buf.value.strip()

                # Ignora títulos vazios ou de janelas utilitárias de sistema
                if title and title not in ("Program Manager", "Settings", "Microsoft Text Input Application"):
                    app_type = "other"
                    t_lower = title.lower()
                    if "powerpoint" in t_lower:
                        app_type = "powerpoint"
                    elif "excel" in t_lower:
                        app_type = "excel"
                    elif "word" in t_lower:
                        app_type = "word"

                    windows.append({
                        "hwnd": int(hwnd),
                        "title": title,
                        "app": app_type,
                    })
                return True

            cb = WNDENUMPROC(enum_proc)
            user32.EnumWindows(cb, 0)
        except Exception as e:
            logger.error("Erro ao enumerar janelas no Windows: %s", e)

        return windows

    async def list_active_streams(self) -> list[dict]:
        """Retorna a lista de streams de janelas ativas."""
        async with self._lock:
            active = []
            for stream_id, info in list(self._streams.items()):
                proc = info.get("process")
                # Verifica se o processo ainda está vivo
                if proc and proc.returncode is None:
                    active.append({
                        "stream_id": stream_id,
                        "window_title": info.get("window_title"),
                        "profile": info.get("profile"),
                        "fps": info.get("fps"),
                        "rtmp_url": info.get("rtmp_url"),
                        "rtsp_path": f"live/{stream_id}",
                        "started_at": info.get("started_at"),
                    })
                else:
                    # Processo morreu inesperadamente
                    self._streams.pop(stream_id, None)
            return active

    async def start_stream(
        self,
        stream_id: str,
        window_title: str,
        profile: str = "loop",
        custom_fps: Optional[int] = None,
    ) -> dict:
        """Inicia um processo FFmpeg capturando a janela indicada via gdigrab e transmitindo via RTMP.

        profile:
          - 'loop': para apresentações animadas/slides em transição (default: 30 fps).
          - 'fixed': para slide fixado do mês / imagem estática (default: 2 fps, super econômico).
        """
        if not is_safe_id(stream_id):
            return {"success": False, "error": f"ID de stream inválido: {stream_id}"}

        async with self._lock:
            if stream_id in self._streams:
                proc = self._streams[stream_id].get("process")
                if proc and proc.returncode is None:
                    return {"success": False, "error": f"Stream '{stream_id}' já está em execução"}

            ffmpeg_bin = resolve_binary("ffmpeg") or "ffmpeg"
            if not shutil.which(ffmpeg_bin) and not os.path.exists(ffmpeg_bin):
                return {"success": False, "error": "Binário FFmpeg não encontrado no sistema"}

            # Define taxa de quadros (FPS)
            if custom_fps and custom_fps > 0:
                fps = min(custom_fps, 60)
            elif profile == "fixed":
                fps = 2  # slide estático / mês: consumo residual de CPU
            else:
                fps = 30  # loop contínuo de slides com transições suaves

            rtmp_url = f"{self.rtmp_base_url}/live/{stream_id}"

            # Monta argumentos do FFmpeg
            # Suporta captura de janela específica ou desktop
            if window_title.lower() == "desktop":
                input_args = ["-i", "desktop"]
            else:
                input_args = ["-i", f"title={window_title}"]

            cmd = [
                ffmpeg_bin,
                "-y",
                "-f", "gdigrab",
                "-framerate", str(fps),
                *input_args,
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-tune", "zerolatency",
                "-pix_fmt", "yuv420p",
                "-f", "flv",
                rtmp_url,
            ]

            # Registra o path no MediaMTX caso o manager esteja disponível
            if self.mediamtx:
                try:
                    await self.mediamtx.add_path(f"live/{stream_id}")
                except Exception as e:
                    logger.warning("Falha ao registrar path no MediaMTX via API: %s", e)

            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
            except Exception as e:
                logger.error("Erro ao iniciar FFmpeg para stream '%s': %s", stream_id, e)
                return {"success": False, "error": str(e)}

            # Dá um breve tempo para validar se o processo não encerrou imediatamente
            await asyncio.sleep(0.5)
            if proc.returncode is not None:
                stderr = await proc.stderr.read()
                err_msg = stderr.decode(errors="replace")[:300] if stderr else "Processo encerrou prematuramente"
                return {"success": False, "error": f"FFmpeg falhou: {err_msg}"}

            self._streams[stream_id] = {
                "process": proc,
                "window_title": window_title,
                "profile": profile,
                "fps": fps,
                "rtmp_url": rtmp_url,
                "started_at": datetime.now().isoformat(),
            }

            logger.info("Host stream iniciado: id=%s janela='%s' fps=%d", stream_id, window_title, fps)
            return {
                "success": True,
                "stream_id": stream_id,
                "rtmp_url": rtmp_url,
                "rtsp_path": f"live/{stream_id}",
                "fps": fps,
                "profile": profile,
            }

    async def stop_stream(self, stream_id: str) -> dict:
        """Encerra uma stream ativa e remove o path correspondente."""
        async with self._lock:
            info = self._streams.pop(stream_id, None)
            if not info:
                return {"success": False, "error": f"Stream '{stream_id}' não encontrada"}

            proc = info.get("process")
            if proc and proc.returncode is None:
                try:
                    proc.terminate()
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=3.0)
                    except asyncio.TimeoutError:
                        proc.kill()
                        await proc.wait()
                except Exception as e:
                    logger.warning("Erro ao finalizar processo FFmpeg da stream '%s': %s", stream_id, e)

            # Remove o path do MediaMTX
            if self.mediamtx:
                try:
                    await self.mediamtx.delete_path(f"live/{stream_id}")
                except Exception as e:
                    logger.warning("Falha ao deletar path no MediaMTX: %s", e)

            logger.info("Host stream finalizado: id=%s", stream_id)
            return {"success": True, "stream_id": stream_id}

    async def stop_all(self):
        """Encerra todas as streams ativas no shutdown da aplicação."""
        stream_ids = list(self._streams.keys())
        for sid in stream_ids:
            await self.stop_stream(sid)
