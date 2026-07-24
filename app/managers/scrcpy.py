"""ScrcpyManager — download, versionamento, instalação e rollback do scrcpy."""

import asyncio
import json
import logging
import os
import shutil
import tarfile
import time
import zipfile
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger("scrcpy")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SCRCPY_DIR = PROJECT_ROOT / "scrcpy"
VERSIONS_DIR = SCRCPY_DIR / "versions"
DOWNLOADS_DIR = SCRCPY_DIR / "downloads"
META_FILE = SCRCPY_DIR / "version.json"
MAX_KEEP_VERSIONS = 3
GITHUB_API = "https://api.github.com/repos/genymobile/scrcpy/releases"


class ScrcpyManager:
    _sessions: dict[str, dict] = {}
    _recent_events = deque(maxlen=50)
    _metrics = {
        "starts": 0,
        "start_failures": 0,
        "early_exits": 0,
        "unexpected_exits": 0,
        "stops": 0,
        "last_error": "",
    }

    def __init__(self):
        self._ensure_dirs()
        self._meta = self._load_meta()

    def _ensure_dirs(self):
        for d in [SCRCPY_DIR, VERSIONS_DIR, DOWNLOADS_DIR]:
            d.mkdir(parents=True, exist_ok=True)

    def _load_meta(self) -> dict:
        if META_FILE.is_file():
            try:
                return json.loads(META_FILE.read_text())
            except Exception:
                pass
        return {"current": None, "previous": None, "versions": {}, "updated_at": None}

    def _save_meta(self):
        self._meta["updated_at"] = datetime.now(timezone.utc).isoformat()
        META_FILE.write_text(json.dumps(self._meta, indent=2, ensure_ascii=False))

    def get_current_version(self) -> Optional[str]:
        return self._meta.get("current")

    def get_installed_versions(self) -> list[dict]:
        result = []
        for ver, info in self._meta.get("versions", {}).items():
            path = VERSIONS_DIR / ver
            binary_name = self._platform_binary_name()
            current = self._meta.get("current") == ver
            result.append({
                "version": ver, "current": current,
                "installed_at": info.get("installed_at", ""),
                "size_bytes": info.get("size_bytes", 0),
                "exists": path.is_dir() and (path / binary_name).is_file(),
            })
        return sorted(result, key=lambda x: x["version"], reverse=True)

    @classmethod
    def _record_event(cls, event: str, **data):
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": event,
            **data,
        }
        cls._recent_events.appendleft(payload)
        if event.endswith("failed") or event.endswith("exit"):
            cls._metrics["last_error"] = str(data.get("error") or data.get("stderr") or event)[:500]

    @classmethod
    def is_device_active(cls, target: str) -> bool:
        session = cls._sessions.get(target)
        return bool(session and session.get("running"))

    @classmethod
    def get_diagnostics(cls) -> dict:
        sessions = []
        now = time.monotonic()
        for target, session in cls._sessions.items():
            started_mono = session.get("started_mono", now)
            sessions.append({
                "target": target,
                "pid": session.get("pid"),
                "running": session.get("running", False),
                "started_at": session.get("started_at"),
                "uptime_seconds": max(0, int(now - started_mono)),
                "args": session.get("args", []),
                "last_stderr": session.get("last_stderr", ""),
                "exit_code": session.get("exit_code"),
            })
        return {
            "metrics": dict(cls._metrics),
            "active_sessions": [s for s in sessions if s["running"]],
            "sessions": sessions,
            "recent_events": list(cls._recent_events),
        }

    # ── Platform detection ─────────────────────────────

    @staticmethod
    def _platform_info(version: str) -> dict:
        """Retorna asset, binário e tipo de archive conforme SO."""
        import platform as pf
        s = pf.system().lower()
        m = pf.machine().lower()

        if s == "linux" and "x86_64" in m:
            return {"asset": f"scrcpy-linux-x86_64-v{version}.tar.gz", "binary": "scrcpy", "type": "tar.gz"}
        if s == "linux" and "aarch64" in m:
            return {"asset": f"scrcpy-linux-aarch64-v{version}.tar.gz", "binary": "scrcpy", "type": "tar.gz"}
        if s == "windows":
            return {"asset": f"scrcpy-win64-v{version}.zip", "binary": "scrcpy.exe", "type": "zip"}
        if s == "darwin":
            arch = "aarch64" if ("arm" in m or "aarch64" in m) else "x86_64"
            return {"asset": f"scrcpy-macos-{arch}-v{version}.tar.gz", "binary": "scrcpy", "type": "tar.gz"}
        return {"asset": f"scrcpy-linux-x86_64-v{version}.tar.gz", "binary": "scrcpy", "type": "tar.gz"}

    @staticmethod
    def _platform_binary_name() -> str:
        return "scrcpy.exe" if os.name == "nt" else "scrcpy"

    # ── Check updates ─────────────────────────────────

    async def check_updates(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{GITHUB_API}?per_page=5",
                    headers={"Accept": "application/vnd.github+json", "User-Agent": "panel-tvbox/1.0"},
                )
                resp.raise_for_status()
                releases = resp.json()

            latest, latest_tag = None, ""
            for rel in releases:
                if rel.get("prerelease") or rel.get("draft"):
                    continue
                latest = rel
                latest_tag = rel["tag_name"].lstrip("v")
                break

            current = self._meta.get("current")
            has_update = bool(current and latest_tag and latest_tag != current)
            platform_info = self._platform_info(latest_tag or "0")
            assets = []
            if latest:
                for asset in latest.get("assets", []):
                    is_our = platform_info["asset"] in asset["name"] or asset["name"] == platform_info["asset"]
                    assets.append({
                        "name": asset["name"], "size": asset["size"],
                        "url": asset["browser_download_url"],
                        "is_our_platform": is_our,
                    })

            return {
                "current_version": current, "latest_version": latest_tag,
                "has_update": has_update, "release_url": latest.get("html_url", "") if latest else "",
                "published_at": latest.get("published_at", "") if latest else "",
                "platform_asset": platform_info["asset"], "assets": assets,
            }
        except Exception as e:
            logger.error("Check updates failed: %s", e)
            return {"error": str(e), "current_version": self._meta.get("current")}

    # ── Download + Install ────────────────────────────

    async def download(self, version: str) -> dict:
        ver_dir = VERSIONS_DIR / version
        bin_name = self._platform_binary_name()

        if ver_dir.is_dir() and (ver_dir / bin_name).is_file():
            return {"success": True, "version": version, "message": "já instalado"}
        if ver_dir.is_dir():
            shutil.rmtree(ver_dir, ignore_errors=True)

        try:
            pinfo = self._platform_info(version)
            asset_name = pinfo["asset"]
            binary_name = pinfo["binary"]
            archive_type = pinfo["type"]
            download_url = f"https://github.com/Genymobile/scrcpy/releases/download/v{version}/{asset_name}"
            dl_path = DOWNLOADS_DIR / asset_name

            logger.info("Baixando scrcpy v%s [%s]: %s", version, os.name, asset_name)

            async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
                async with client.stream("GET", download_url) as resp:
                    resp.raise_for_status()
                    with open(dl_path, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=65536):
                            f.write(chunk)

            logger.info("Download: %s (%.1f MB)", dl_path.name, dl_path.stat().st_size / (1024 * 1024))

            # Extrai
            ver_dir.mkdir(parents=True, exist_ok=True)
            if archive_type == "zip":
                with zipfile.ZipFile(dl_path, "r") as zf:
                    zf.extractall(ver_dir)
            else:
                with tarfile.open(dl_path, "r:gz") as tf:
                    tf.extractall(ver_dir)

            dl_path.unlink(missing_ok=True)

            # Flatten: move tudo da subpasta extraída pra raiz
            # O zip/tar.gz do scrcpy extrai como: versions/4.1/scrcpy-{platform}-v{version}/*
            for subdir in [d for d in ver_dir.iterdir() if d.is_dir()]:
                for item in subdir.iterdir():
                    dest = ver_dir / item.name
                    if not dest.exists():
                        shutil.move(str(item), str(dest))
                try:
                    subdir.rmdir()
                except OSError:
                    pass  # não vazio, ok

            # Verifica binário
            bin_path = ver_dir / binary_name
            if not bin_path.is_file():
                content = [str(p.relative_to(ver_dir)) for p in sorted(ver_dir.rglob("*")) if p.is_file()]
                return {"success": False, "error": f"Binário '{binary_name}' não encontrado. Conteúdo: {content[:15]}"}

            try:
                bin_path.chmod(0o755)
            except Exception:
                pass

            size = sum(f.stat().st_size for f in ver_dir.rglob("*") if f.is_file())
            self._meta.setdefault("versions", {})[version] = {
                "installed_at": datetime.now(timezone.utc).isoformat(),
                "size_bytes": size, "asset": asset_name,
            }
            self._save_meta()
            logger.info("scrcpy v%s instalado (%s, %.1f MB)", version, asset_name, size / (1024 * 1024))
            return {"success": True, "version": version, "path": str(ver_dir), "size_bytes": size, "platform": os.name}

        except Exception as e:
            logger.error("Download scrcpy v%s falhou: %s", version, e)
            shutil.rmtree(ver_dir, ignore_errors=True)
            return {"success": False, "error": str(e)}

    # ── Activate / Rollback ───────────────────────────

    async def activate(self, version: str) -> dict:
        ver_dir = VERSIONS_DIR / version
        bin_name = self._platform_binary_name()
        if not ver_dir.is_dir() or not (ver_dir / bin_name).is_file():
            return {"success": False, "error": f"Versão {version} não encontrada"}

        # Copia TODOS os arquivos da versão para SCRCPY_DIR (não só o binário)
        for item in ver_dir.iterdir():
            dest = SCRCPY_DIR / item.name
            if dest.is_dir():
                shutil.rmtree(dest, ignore_errors=True)
            if item.is_file():
                shutil.copy2(str(item), str(dest))
                try:
                    dest.chmod(0o755)
                except Exception:
                    pass

        old = self._meta.get("current")
        self._meta["current"] = version
        if old and old != version:
            self._meta["previous"] = old
        self._save_meta()
        logger.info("scrcpy ativado: %s -> %s", old or "(nenhum)", version)
        await self._cleanup_old()
        return {"success": True, "version": version, "previous": old, "binary": str(SCRCPY_DIR / bin_name)}

    async def rollback(self) -> dict:
        previous = self._meta.get("previous")
        if not previous:
            return {"success": False, "error": "Nenhuma versão anterior disponível"}
        ver_dir = VERSIONS_DIR / previous
        bin_name = self._platform_binary_name()
        if not ver_dir.is_dir() or not (ver_dir / bin_name).is_file():
            return {"success": False, "error": f"Versão {previous} não encontrada no disco"}

        old = self._meta.get("current")
        current_bin = SCRCPY_DIR / bin_name
        if current_bin.is_file() or current_bin.is_symlink():
            current_bin.unlink()
        shutil.copy2(str(ver_dir / bin_name), str(current_bin))
        self._meta["previous"] = old
        self._meta["current"] = previous
        self._save_meta()
        logger.warning("scrcpy rollback: %s -> %s", old, previous)
        return {"success": True, "version": previous, "rolled_back_from": old}

    # ── Mirroring ─────────────────────────────────────
    async def start_mirroring(self, device_ip: str, device_port: int = 5555, extra_args: str = "") -> dict:
        scrcpy_bin = self._get_scrcpy_bin()
        if not scrcpy_bin:
            return {"success": False, "error": "scrcpy não instalado"}

        import shlex
        from app.managers.adb import ADBManager

        target = f"{device_ip}:{device_port}"
        if self.is_device_active(target):
            session = self._sessions[target]
            return {"success": True, "pid": session.get("pid"), "device": target, "already_running": True}

        adb_bin = SCRCPY_DIR / ("adb.exe" if os.name == "nt" else "adb")
        adb = ADBManager(binary=str(adb_bin) if adb_bin.is_file() else "adb", connect_timeout=8)
        if not await adb.connect(device_ip, device_port):
            self._metrics["start_failures"] += 1
            error = adb.metrics.get("last_error") or "ADB não conectou"
            self._record_event("start_failed", target=target, error=error)
            return {"success": False, "error": f"ADB não conectou em {target}: {error}"}

        cmd = [str(scrcpy_bin), "-s", target]
        if extra_args:
            cmd.extend(shlex.split(extra_args))

        try:
            self._metrics["starts"] += 1
            logger.info("Iniciando scrcpy target=%s cmd=%s", target, " ".join(cmd))
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            try:
                await asyncio.wait_for(proc.wait(), timeout=3)
                stdout, stderr = await proc.communicate()
                self._metrics["early_exits"] += 1
                stderr_text = stderr.decode(errors="replace")[:1000] if stderr else ""
                self._record_event("early_exit", target=target, exit_code=proc.returncode, stderr=stderr_text)
                logger.warning("scrcpy encerrou cedo target=%s exit=%s stderr=%s", target, proc.returncode, stderr_text[:300])
                return {"success": False, "error": f"scrcpy encerrou (exit={proc.returncode})",
                        "stderr": stderr_text[:500]}
            except asyncio.TimeoutError:
                self._sessions[target] = {
                    "pid": proc.pid,
                    "process": proc,
                    "running": True,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "started_mono": time.monotonic(),
                    "args": cmd[1:],
                    "last_stderr": "",
                    "exit_code": None,
                }
                self._record_event("started", target=target, pid=proc.pid, args=cmd[1:])
                asyncio.create_task(self._watch_process(target, proc))
                return {"success": True, "pid": proc.pid, "device": target}
        except FileNotFoundError:
            self._metrics["start_failures"] += 1
            self._record_event("start_failed", target=target, error=f"Binário não encontrado: {scrcpy_bin}")
            return {"success": False, "error": f"Binário não encontrado: {scrcpy_bin}"}
        except Exception as e:
            self._metrics["start_failures"] += 1
            self._record_event("start_failed", target=target, error=str(e))
            return {"success": False, "error": str(e)}

    async def _watch_process(self, target: str, proc: asyncio.subprocess.Process):
        stderr_text = ""
        try:
            stderr = await proc.stderr.read() if proc.stderr else b""
            stderr_text = stderr.decode(errors="replace")[-2000:] if stderr else ""
            await proc.wait()
        except Exception as e:
            stderr_text = str(e)

        session = self._sessions.get(target, {})
        session["running"] = False
        session["exit_code"] = proc.returncode
        session["last_stderr"] = stderr_text
        self._sessions[target] = session
        self._metrics["unexpected_exits"] += 1
        self._record_event("process_exit", target=target, exit_code=proc.returncode, stderr=stderr_text[:1000])
        logger.warning("scrcpy saiu target=%s exit=%s stderr=%s", target, proc.returncode, stderr_text[:300])

    async def start_streaming(self, device_ip: str, device_port: int = 5555,
                              rtmp_url: str = "rtmp://localhost:1935/SCRCPY_DISPLAY") -> dict:
        """Inicia scrcpy com output via pipe para ffmpeg → RTMP → MediaMTX.
        
        Este modo funciona em servidores headless (sem display).
        O stream RTMP é servido pelo MediaMTX como RTSP.
        """
        scrcpy_bin = self._get_scrcpy_bin()
        if not scrcpy_bin:
            return {"success": False, "error": "scrcpy não instalado"}

        if os.name == "nt":
            return {"success": False, "error": "Streaming via pipe suportado apenas no Linux. No Windows, use o modo normal."}

        from app.managers.adb import ADBManager

        target = f"{device_ip}:{device_port}"
        adb_bin = SCRCPY_DIR / ("adb.exe" if os.name == "nt" else "adb")
        adb = ADBManager(binary=str(adb_bin) if adb_bin.is_file() else "adb", connect_timeout=8)
        if not await adb.connect(device_ip, device_port):
            error = adb.metrics.get("last_error") or "ADB não conectou"
            self._record_event("stream_failed", target=target, error=error)
            return {"success": False, "error": f"ADB não conectou em {target}: {error}"}

        # Pipe: scrcpy --no-window --record=- → ffmpeg → RTMP
        scrcpy_cmd = [str(scrcpy_bin), "-s", target,
                      "--no-window", "--no-audio", "--max-size", "1024",
                      "--record=-", "--stay-awake"]

        # Detecta ffmpeg
        import shutil as sh
        ffmpeg_bin = sh.which("ffmpeg")
        if not ffmpeg_bin:
            return {"success": False, "error": "ffmpeg não encontrado — necessário para streaming via pipe"}

        ffmpeg_cmd = [ffmpeg_bin, "-re", "-i", "pipe:0", "-c", "copy",
                      "-f", "flv", rtmp_url]

        try:
            proc_scrcpy = await asyncio.create_subprocess_exec(
                *scrcpy_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            proc_ffmpeg = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdin=proc_scrcpy.stdout,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # Aguarda 5s para ver se crasha
            await asyncio.sleep(5)
            if proc_scrcpy.returncode is not None:
                stderr = await proc_scrcpy.stderr.read() if proc_scrcpy.stderr else b""
                return {"success": False, "error": "scrcpy encerrou cedo",
                        "stderr": stderr.decode(errors="replace")[:300]}
            if proc_ffmpeg.returncode is not None:
                stderr = await proc_ffmpeg.stderr.read() if proc_ffmpeg.stderr else b""
                return {"success": False, "error": "ffmpeg encerrou cedo",
                        "stderr": stderr.decode(errors="replace")[:300]}

            return {
                "success": True,
                "scrcpy_pid": proc_scrcpy.pid,
                "ffmpeg_pid": proc_ffmpeg.pid,
                "device": target,
                "rtmp_url": rtmp_url,
                "rtsp_url": rtmp_url.replace("rtmp://", "rtsp://").replace(":1935/", ":8554/"),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def stop_mirroring(self) -> dict:
        try:
            import subprocess
            cmd = ["pkill", "-f", "scrcpy"] if os.name != "nt" else ["taskkill", "/F", "/IM", "scrcpy.exe"]
            proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            await proc.wait()
            self._metrics["stops"] += 1
            for session in self._sessions.values():
                session["running"] = False
            self._record_event("stopped", exit_code=proc.returncode)
            return {"success": True, "message": "scrcpy parado"}
        except Exception as e:
            self._record_event("stop_failed", error=str(e))
            return {"success": False, "error": str(e)}

    # ── Helpers ───────────────────────────────────────

    def _get_scrcpy_bin(self) -> Optional[Path]:
        bin_name = self._platform_binary_name()
        current_bin = SCRCPY_DIR / bin_name
        if current_bin.is_file():
            return current_bin
        for ver in sorted(VERSIONS_DIR.iterdir(), reverse=True):
            p = ver / bin_name
            if p.is_file():
                return p
        return None

    async def _cleanup_old(self):
        bin_name = self._platform_binary_name()
        versions = sorted(
            [d for d in VERSIONS_DIR.iterdir() if d.is_dir() and (d / bin_name).is_file()],
            key=lambda p: p.name, reverse=True,
        )
        current = self._meta.get("current")
        kept = {v.name for v in versions[:MAX_KEEP_VERSIONS]}
        if current:
            kept.add(current)
        to_delete = [v for v in versions if v.name not in kept]
        for v in to_delete:
            shutil.rmtree(v, ignore_errors=True)
            self._meta["versions"].pop(v.name, None)
        if to_delete:
            self._save_meta()
