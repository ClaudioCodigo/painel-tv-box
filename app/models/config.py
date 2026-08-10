"""Pydantic models para todas as configurações do painel."""

from pydantic import BaseModel, Field
from typing import Optional


# ── system.yml ──────────────────────────────────────────


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8080
    workers: int = 1


class HostConfig(BaseModel):
    ip: str = "192.168.254.102"


class ADBConfig(BaseModel):
    binary: str = "adb"
    default_port: int = 5555
    connect_timeout: int = 10
    command_delay: float = 0.5
    server_port: Optional[int] = None  # Ideia 4: servidor ADB isolado do scrcpy


class PathsConfig(BaseModel):
    devices_dir: str = "devices"
    groups_dir: str = "groups"
    config_dir: str = "config"
    logs_dir: str = "logs"
    backups_dir: str = "backups"
    scripts_dir: str = "scripts/android"
    remote_scripts_dir: str = "/data/local/tmp/panel"


class MediaMTXGlobalConfig(BaseModel):
    api_url: str = "http://localhost:9997"
    timeout: int = 5


class SecurityConfig(BaseModel):
    """Configuração de acesso ao painel."""
    enabled: bool = True
    heartbeat_key: str = ""  # chave dedicada do heartbeat device→servidor


class SystemConfig(BaseModel):
    server: ServerConfig = Field(default_factory=ServerConfig)
    host: HostConfig = Field(default_factory=HostConfig)
    adb: ADBConfig = Field(default_factory=ADBConfig)
    paths: PathsConfig = Field(default_factory=PathsConfig)
    mediamtx: MediaMTXGlobalConfig = Field(default_factory=MediaMTXGlobalConfig)
    security: SecurityConfig = Field(default_factory=SecurityConfig)
    wizard_completed: bool = False


# ── watchdog.yml ───────────────────────────────────────


class WatchdogPingConfig(BaseModel):
    count: int = 1
    timeout_ms: int = 800


class WatchdogADBConfig(BaseModel):
    timeout: int = 5


class WatchdogRecoveryConfig(BaseModel):
    cooldown_seconds: int = 15
    player_retry_max: int = 2
    player_retry_delay: int = 10
    wifi_restart: bool = True
    wifi_reconnect_timeout: int = 30
    eth_restart: bool = True
    eth_reconnect_timeout: int = 30
    reboot_max: int = 1
    reboot_boot_timeout: int = 120
    critical_alert_cooldown: int = 300


class WatchdogGuardianConfig(BaseModel):
    """Guardião do watchdog — ressuscita heartbeat.sh/netwatch.sh mortos.

    Regra ADB×scrcpy (docs/09 §3.3): só toca ADB quando o heartbeat expirou
    E não há sessão scrcpy ativa no device.
    """
    enabled: bool = True
    check_interval: int = 300  # s entre verificações por device
    adb_timeout: int = 10


class WatchdogConfig(BaseModel):
    check_interval: int = 10
    heartbeat_timeout: int = 60  # heartbeat fresco = device na rede (sem ADB)
    ping: WatchdogPingConfig = Field(default_factory=WatchdogPingConfig)
    adb: WatchdogADBConfig = Field(default_factory=WatchdogADBConfig)
    activity_check: bool = True
    mediamtx_check: bool = True
    recovery: WatchdogRecoveryConfig = Field(default_factory=WatchdogRecoveryConfig)
    guardian: WatchdogGuardianConfig = Field(default_factory=WatchdogGuardianConfig)


# ── players.yml ────────────────────────────────────────


class PlayerDef(BaseModel):
    package: str
    activity: str
    force_stop: str
    intent_template: str


class PlayersConfig(BaseModel):
    players: dict[str, PlayerDef] = Field(default_factory=lambda: {
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
    })
    default: str = "vlc"


# ── mediamtx.yml (config do painel, não o yml do mediaMTX) ─


class MediaMTXAPIConfig(BaseModel):
    url: str = "http://localhost:9997"
    timeout: int = 5


class MediaMTXServerConfig(BaseModel):
    rtsp_port: int = 8554
    rtmp_port: int = 1935
    api_port: int = 9997
    metrics_port: int = 9998


class MediaMTXConfig(BaseModel):
    api: MediaMTXAPIConfig = Field(default_factory=MediaMTXAPIConfig)
    server: MediaMTXServerConfig = Field(default_factory=MediaMTXServerConfig)
    logLevel: str = "warn"
    writeQueueSize: int = 2048
    readTimeout: str = "10s"
    writeTimeout: str = "10s"
    rtspTransports: list[str] = Field(default_factory=lambda: ["udp", "tcp"])
    hls: bool = False
    webrtc: bool = False
    metrics: bool = False
    api_allowed_network: str = "192.168.254.0/24"
