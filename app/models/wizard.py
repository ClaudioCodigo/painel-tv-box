"""Modelos Pydantic v2 para o Wizard de configuração inicial."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class WizardAdminDTO(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=8, max_length=256)


class WizardDeviceDTO(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    ip: str = Field(..., min_length=1, max_length=64)
    adb_port: int = Field(default=5555, ge=1, le=65535)
    group: Optional[str] = Field(default="")
    location: Optional[str] = Field(default="")
    player: Optional[str] = Field(default="vlc")


class WizardFinishRequest(BaseModel):
    admin: WizardAdminDTO
    devices: List[WizardDeviceDTO] = Field(..., min_length=1)
    server: Optional[Dict[str, Any]] = None
    mediamtx: Optional[Dict[str, Any]] = None
    adb: Optional[Dict[str, Any]] = None
    players: Optional[Dict[str, Any]] = None
    watchdog: Optional[Dict[str, Any]] = None
    groups: Optional[List[Dict[str, Any]]] = None
