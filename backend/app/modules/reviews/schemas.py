from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class QueueItem(BaseModel):
    kind: Literal["version", "visibility"]
    id: int
    skill_id: int
    skill_name: str
    origin: str
    version: str | None = None
    from_visibility: str | None = None
    to_visibility: str | None = None
    submitted_at: datetime
    assigned_to: int | None = None
    assigned_to_name: str | None = None
    overdue: bool
    unassigned_overdue: bool


class AssignRequest(BaseModel):
    reviewer_id: int


class DecisionRequest(BaseModel):
    decision: Literal["approved", "rejected"]
    comment: str | None = None


class FileEntryOut(BaseModel):
    path: str
    status: Literal["added", "modified", "removed", "unchanged"]
    size: int
    is_text: bool
    warnings: int


class FileContentOut(BaseModel):
    path: str
    is_text: bool
    size: int
    sha256: str
    too_large: bool
    new: str | None = None
    old: str | None = None
    diff: str | None = None
    warnings: list[dict]


class ReviewFinding(BaseModel):
    check: str
    result: str
    detail: str
    file_path: str | None = None
    line: int | None = None


class VersionReviewDetail(BaseModel):
    version_id: int
    version: str
    status: str
    skill_id: int
    skill_name: str
    summary: str | None
    origin: str
    department: str | None
    visibility: str
    changelog: str | None
    skill_md: str | None
    submitted_at: datetime | None
    assigned_to: int | None
    assigned_by_name: str | None = None
    owner_name: str | None = None
    has_icon: bool = False
    base_version: str | None
    validation: list[ReviewFinding]


class VisibilityRequestDetail(BaseModel):
    id: int
    skill_id: int
    skill_name: str
    summary: str | None
    status: str
    from_visibility: str
    to_visibility: str
    from_department: str | None
    to_department: str | None
    created_at: datetime
    assigned_to: int | None
    comment: str | None = None


class HistoryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: Literal["version", "visibility"]
    id: int
    skill_id: int
    skill_name: str
    version: str | None = None
    decision: str
    comment: str | None
    decided_at: datetime
