from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Reason(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    reason: str = Field(min_length=1, max_length=1000)


class TransferBody(BaseModel):
    new_owner_id: int


class Impact(BaseModel):
    installed_users: int
    zip_users: int
    latest_after_revoke: str | None = None


class AdminSkillItem(BaseModel):
    id: int
    name: str
    status: str
    origin: str
    owner_id: int | None
    department: str | None
    visibility: str
    latest_version: str | None
    download_count: int
    install_count: int
    updated_at: datetime


class AdminSkillState(BaseModel):
    id: int
    status: str
    latest_version: str | None
    owner_id: int | None


class TagCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=50)


class TagMerge(BaseModel):
    from_ids: list[int] = Field(alias="from", min_length=1, max_length=50)
    into: int

    model_config = ConfigDict(populate_by_name=True)


class AdminTag(BaseModel):
    id: int
    name: str
    status: str
    usage_count: int
    proposed_by: int | None = None
    decided_by: int | None = None
    decided_at: datetime | None = None


class MergeResult(BaseModel):
    into: AdminTag
    merged: int
    skills_moved: int


class AuditItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    actor_id: int | None
    actor_email: str | None
    actor_name: str | None
    action: str
    target_type: str
    target_id: int | None
    detail: dict[str, Any]


class RecentEvent(BaseModel):
    action: str
    target_type: str
    target_id: int | None
    actor_name: str | None
    created_at: datetime
    detail: dict[str, Any]


class Dashboard(BaseModel):
    unassigned: int
    unassigned_overdue: int
    review_overdue: int
    tags_pending: int
    visibility_requests_pending: int
    sources_with_problems: int
    recent_events: list[RecentEvent]
    overview: dict[str, int]


class ImportedSkillUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    summary: str | None = Field(None, max_length=1000)
    category_id: int | None = None
    department: str | None = Field(None, min_length=1, max_length=255)
    visibility: Literal["company", "department"] | None = None
    tag_ids: list[int] | None = None
    output_types: list[str] | None = None
    ecosystems: list[str] | None = None
