"""PlayerManager — abrir/fechar streams nos TV Boxes via ADB."""

import logging
import shlex
from typing import Optional

from app.models.device import DeviceConfig

logger = logging.getLogger("player")

# Aspas simples/duplas e $() são neutralizados em todo argumento enviado ao
# shell do device (anti injeção de comando — auditoria).
_q = shlex.quote


class PlayerManager:
    """Gerencia players de vídeo nos TV Boxes (VLC, MPV)."""

    def __init__(self, adb_manager=None, players_config=None, host_ip: str = "192.168.254.102", rtsp_port: int = 8554):
        self.adb = adb_manager
        self.players_config = players_config
        self.host_ip = host_ip
        self.rtsp_port = rtsp_port

    def set_config(self, adb_manager, players_config, host_ip: str, rtsp_port: int):
        self.adb = adb_manager
        self.players_config = players_config
        self.host_ip = host_ip
        self.rtsp_port = rtsp_port

    def _get_player_def(self, player_name: str) -> Optional["PlayerDef"]:
        """Retorna a definição do player do config/players.yml."""
        try:
            from app.models.config import PlayerDef
        except ImportError:
            return None

        if self.players_config:
            player = self.players_config.players.get(player_name)
            if player:
                return player

        # Fallback: defaults inline
        FALLBACK = {
            "vlc": PlayerDef(
                package="org.videolan.vlc",
                activity="org.videolan.vlc.gui.video.VideoPlayerActivity",
                force_stop="org.videolan.vlc",
                intent_template="am start -a android.intent.action.VIEW -d \"{URL}\" -n {PACKAGE}/{ACTIVITY} --activity-clear-task",
            ),
            "mpv": PlayerDef(
                package="is.xyz.mpv",
                activity="is.xyz.mpv.MPVActivity",
                force_stop="is.xyz.mpv",
                intent_template="am start -a android.intent.action.VIEW -d \"{URL}\" -n {PACKAGE}/{ACTIVITY} --activity-clear-task",
            ),
        }
        return FALLBACK.get(player_name)

    def _build_rtsp_url(self, device: DeviceConfig) -> str:
        """Monta URL RTSP: rtsp://{host}:{port}/{path}"""
        path = device.rtsp_path or device.id
        if path.startswith("rtsp://"):
            return path
        return f"rtsp://{self.host_ip}:{self.rtsp_port}/{path}"

    def build_start_cmd(self, device: DeviceConfig, extra_args: str = "") -> str:
        """Retorna o comando shell para abrir o stream SEM executar ADB.

        Usado pelo canal de comandos via heartbeat (Ideia 3): o device executa
        este comando localmente no próprio shell — zero transporte ADB painel→device.
        """
        player_name = device.player or "vlc"
        player_def = self._get_player_def(player_name)
        if not player_def:
            return ""
        rtsp_url = self._build_rtsp_url(device)
        title = device.name or device.id or "Stream"
        extra = device.player_extra_args or extra_args
        return (
            f"sh /data/local/tmp/panel/start_stream.sh {_q(rtsp_url)} {_q(player_def.package)} "
            f"{_q(player_def.activity)} {_q(title)} {_q(extra)}"
        )

    async def start_stream(self, device: DeviceConfig, extra_args: str = "") -> dict:
        """Abre stream no TV Box via intent ADB."""
        if not self.adb:
            return {"success": False, "error": "ADBManager não configurado"}

        player_name = device.player or "vlc"
        player_def = self._get_player_def(player_name)
        if not player_def:
            return {"success": False, "error": f"Player '{player_name}' não encontrado em players.yml"}

        rtsp_url = self._build_rtsp_url(device)
        package = player_def.package
        activity = player_def.activity

        title = device.name or device.id or "Stream"
        extra = device.player_extra_args or extra_args

        # Tenta usar script no TV Box primeiro (todos os args quote-ados)
        script_cmd = self.build_start_cmd(device, extra_args)
        output, code = await self.adb.shell(device.ip, script_cmd, port=device.adb_port)

        # Se script não existe, cai no fallback
        if "No such file" not in output and "not found" not in output.lower():
            logger.info("Stream started via script: %s -> %s", device.id, rtsp_url)
            return {"success": True, "method": "script", "rtsp_url": rtsp_url, "output": output.strip()}

        # Fallback: intent direto via ADB
        intent = player_def.intent_template.format(
            URL=rtsp_url,
            PACKAGE=package,
            ACTIVITY=activity,
            TITLE=title,
        )

        # Fallback: intent direto via ADB (args quote-ados)
        output, code = await self.adb.shell(
            device.ip,
            f"am start -a android.intent.action.VIEW -d {_q(rtsp_url)} -n {_q(package)}/{_q(activity)} --activity-clear-task",
            port=device.adb_port,
        )

        logger.info("Stream started via intent: %s -> %s (code=%d)", device.id, rtsp_url, code)
        return {"success": code == 0, "method": "intent", "rtsp_url": rtsp_url, "output": output.strip(), "exit_code": code}

    async def stop_stream(self, device: DeviceConfig) -> dict:
        """Fecha player no TV Box via force-stop."""
        if not self.adb:
            return {"success": False, "error": "ADBManager não configurado"}

        player_name = device.player or "vlc"
        player_def = self._get_player_def(player_name)
        package = player_def.force_stop if player_def else (device.player or "org.videolan.vlc")

        output, code = await self.adb.shell(device.ip, f"am force-stop {_q(package)}", port=device.adb_port)

        logger.info("Stream stopped: %s -> %s (code=%d)", device.id, package, code)
        return {"success": code == 0, "package": package, "output": output.strip(), "exit_code": code}

    async def get_current_player(self, device: DeviceConfig) -> dict:
        """Verifica qual Activity está em foco no momento."""
        if not self.adb:
            return {"success": False, "error": "ADBManager não configurado"}

        output, code = await self.adb.shell(
            device.ip,
            "dumpsys activity 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -1",
            port=device.adb_port,
        )

        if code != 0 or not output:
            return {"success": False, "current_activity": "", "error": output.strip()}

        return {"success": True, "current_activity": output.strip()}
