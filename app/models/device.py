"""Pydantic model para Device (TV Box)."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class DeviceCapabilities(BaseModel):
    wifi_restart: bool = True
    ethernet_restart: bool = True
    reboot: bool = True
    root: bool = False
    install_apk: bool = True
    shell: bool = True
    screenshot: bool = True
    volume: bool = False
    mute: bool = False


class DeviceState(BaseModel):
    status: str = "unknown"  # online | degraded | warning | offline | unknown
    last_seen: Optional[datetime] = None
    last_heartbeat: Optional[datetime] = None  # batida HTTP do device (sem ADB)
    last_recovery_time: Optional[datetime] = None
    reboot_count: int = 0
    current_activity: str = ""
    screenshot_path: Optional[str] = None
    reason: str = ""  # motivo do status (ex: "Sem stream ativa")


class DeviceSchedule(BaseModel):
    action: str
    cron: str


class DeviceConfig(BaseModel):
    id: str
    name: str = ""
    ip: str = ""
    mac: str = ""
    adb_port: int = 5555
    location: str = ""
    description: str = ""
    group: str = ""
    rtsp_path: str = ""
    player: str = "vlc"
    root: bool = False
    recovery_enabled: bool = True  # watchdog reabre stream em degraded/offline
    capabilities: DeviceCapabilities = Field(default_factory=DeviceCapabilities)
    player_extra_args: str = ""
    notes: str = ""
    watchdog_override: Optional[dict] = None
    schedule: list[DeviceSchedule] = Field(default_factory=list)
    state: DeviceState = Field(default_factory=DeviceState)

    def model_dump_safe(self) -> dict:
        """Dump sem o state (que é gerenciado pelo painel em memória)."""
        data = self.model_dump(exclude={"state"})
        return {k: v for k, v in data.items() if v or isinstance(v, bool)}
