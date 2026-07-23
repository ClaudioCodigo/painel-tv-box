"""Pydantic model para Group."""

from typing import Optional

from pydantic import BaseModel, Field


class GroupSchedule(BaseModel):
    action: str
    cron: str


class GroupConfig(BaseModel):
    id: str
    name: str = ""
    description: str = ""
    color: str = "#3fb950"
    schedule: list[GroupSchedule] = Field(default_factory=list)
    watchdog_override: Optional[dict] = None

    def model_dump_safe(self) -> dict:
        return {k: v for k, v in self.model_dump().items() if v or isinstance(v, bool)}
