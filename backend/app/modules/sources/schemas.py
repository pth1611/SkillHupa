from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Visibility = Literal["company", "department"]


class SourceCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    type: str = Field(max_length=16)
    url: str = Field(min_length=1, max_length=1000)
    ref: str | None = Field(None, max_length=100)
    path_glob: str = Field("", max_length=500)
    default_category: int
    default_department: str = Field(min_length=1, max_length=255)
    default_visibility: Visibility = "company"
    credential_name: str | None = Field(None, max_length=100)
    internal: bool = False
    name: str | None = Field(None, max_length=200)


class SourceUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(None, min_length=1, max_length=200)
    ref: str | None = Field(None, max_length=100)
    path_glob: str | None = Field(None, max_length=500)
    default_category: int | None = None
    default_department: str | None = Field(None, min_length=1, max_length=255)
    default_visibility: Visibility | None = None
    credential_name: str | None = Field(None, max_length=100)
    internal: bool | None = None
    is_enabled: bool | None = None


class SourceOut(BaseModel):
    id: int
    type: str
    name: str
    url: str
    ref: str | None
    path_glob: str
    default_category: int
    default_department: str
    default_visibility: str
    credential_name: str | None
    internal: bool
    is_enabled: bool
    last_scan_at: datetime | None
    last_scan_status: str | None
    last_scan_message: str | None
    skill_count: int = 0


class ScanItem(BaseModel):
    path: str
    outcome: str  # new_skill | new_version | unchanged | skipped | error
    reason: str | None = None
    version: str | None = None
    skill_id: int | None = None


class ScanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_id: int
    started_at: datetime
    finished_at: datetime | None
    status: str
    message: str | None
    commit: str | None
    counts: dict[str, int]
    items: list[dict[str, Any]]
