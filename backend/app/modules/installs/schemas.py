from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

State = Literal["up_to_date", "update_available", "revoked", "removed", "no_access"]
CliTarget = Literal["claude-code", "cursor"]


class InstallReport(BaseModel):
    skill_id: int
    version: str = Field(max_length=32)
    target: str = Field(max_length=16)


class InstallItem(BaseModel):
    skill_id: int
    name: str
    summary: str | None = None
    has_icon: bool = False
    source: str
    target: str
    installed_version: str
    latest_version: str | None = None
    state: State
    installed_at: datetime


class CheckEntry(BaseModel):
    skill_id: int
    version: str = Field(max_length=32)


class CheckRequest(BaseModel):
    items: list[CheckEntry] = Field(max_length=200)


class CheckResult(BaseModel):
    skill_id: int
    version: str
    latest_version: str | None = None
    state: State
