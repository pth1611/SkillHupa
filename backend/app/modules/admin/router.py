import csv
import io
import json
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.dependencies import DbSession, SettingsDep
from app.modules.admin import service
from app.modules.admin.schemas import (
    AdminSkillItem,
    AdminSkillState,
    AdminTag,
    AuditItem,
    Dashboard,
    Impact,
    ImportedSkillUpdate,
    MergeResult,
    Reason,
    TagCreate,
    TagMerge,
    TransferBody,
)
from app.modules.audit.service import AuditFilter
from app.modules.auth.dependencies import require_roles
from app.modules.skills.models import SkillStatus
from app.modules.users.models import Role, User
from app.shared.pagination import Page, PageParams

router = APIRouter(prefix="/api/admin", tags=["admin"])

ManagerUser = Annotated[User, Depends(require_roles(Role.MANAGER))]


def _state(skill) -> AdminSkillState:
    return AdminSkillState(
        id=skill.id, status=skill.status, owner_id=skill.owner_id,
        latest_version=next((v.version for v in skill.versions if v.id == skill.latest_version_id), None),
    )


@router.get("/skills", response_model=Page[AdminSkillItem])
def list_skills(
    db: DbSession,
    _: ManagerUser,
    page: Annotated[PageParams, Depends()],
    status_: Annotated[SkillStatus | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    owner_id: int | None = None,
) -> Page[AdminSkillItem]:
    items, total = service.list_skills(
        db, status=status_.value if status_ else None, q=q, owner_id=owner_id,
        offset=page.offset, limit=page.page_size,
    )
    return Page(items=items, total=total, page=page.page, page_size=page.page_size)


@router.patch("/skills/{skill_id}", response_model=AdminSkillState)
def update_imported_skill(
    skill_id: int, body: ImportedSkillUpdate, db: DbSession, settings: SettingsDep, manager: ManagerUser
) -> AdminSkillState:
    return _state(service.update_imported_display(db, settings, manager, skill_id, body))


@router.get("/skills/{skill_id}/impact", response_model=Impact)
def impact(skill_id: int, db: DbSession, _: ManagerUser, version: str | None = None) -> Impact:
    return service.impact(db, skill_id, version)


@router.post("/skills/{skill_id}/remove", response_model=AdminSkillState)
def remove(skill_id: int, body: Reason, db: DbSession, manager: ManagerUser) -> AdminSkillState:
    return _state(service.remove(db, manager, skill_id, body.reason))


@router.post("/skills/{skill_id}/restore", response_model=AdminSkillState)
def restore(skill_id: int, db: DbSession, manager: ManagerUser) -> AdminSkillState:
    return _state(service.restore(db, manager, skill_id))


@router.post("/skills/{skill_id}/transfer", response_model=AdminSkillState)
def transfer(skill_id: int, body: TransferBody, db: DbSession, manager: ManagerUser) -> AdminSkillState:
    return _state(service.transfer(db, manager, skill_id, body.new_owner_id))


@router.post("/skills/{skill_id}/versions/{version}/revoke", response_model=AdminSkillState)
def revoke(skill_id: int, version: str, body: Reason, db: DbSession, manager: ManagerUser) -> AdminSkillState:
    return _state(service.revoke(db, manager, skill_id, version, body.reason))


# ---- tag -----------------------------------------------------------------------


@router.get("/tags", response_model=Page[AdminTag])
def list_tags(
    db: DbSession,
    _: ManagerUser,
    page: Annotated[PageParams, Depends()],
    status_: Annotated[Literal["pending", "approved", "rejected"] | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=50)] = None,
) -> Page[AdminTag]:
    items, total = service.list_tags(db, status=status_, q=q, offset=page.offset, limit=page.page_size)
    return Page(items=items, total=total, page=page.page, page_size=page.page_size)


@router.post("/tags", response_model=AdminTag, status_code=status.HTTP_201_CREATED)
def create_tag(body: TagCreate, db: DbSession, manager: ManagerUser) -> AdminTag:
    return service.create_tag(db, manager, body.name)


@router.post("/tags/merge", response_model=MergeResult)
def merge_tags(body: TagMerge, db: DbSession, manager: ManagerUser) -> MergeResult:
    return service.merge_tags(db, manager, body.from_ids, body.into)


@router.post("/tags/{tag_id}/approve", response_model=AdminTag)
def approve_tag(tag_id: int, db: DbSession, manager: ManagerUser) -> AdminTag:
    return service.approve_tag(db, manager, tag_id)


@router.post("/tags/{tag_id}/reject", response_model=AdminTag)
def reject_tag(tag_id: int, body: Reason, db: DbSession, manager: ManagerUser) -> AdminTag:
    return service.reject_tag(db, manager, tag_id, body.reason)


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: int, db: DbSession, manager: ManagerUser) -> Response:
    service.delete_tag(db, manager, tag_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- nhật ký và bảng điều khiển -------------------------------------------------------


def _audit_filter(
    actor_id: int | None = None,
    action: Annotated[str | None, Query(max_length=64)] = None,
    target_type: Annotated[str | None, Query(max_length=32)] = None,
    target_id: int | None = None,
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: datetime | None = None,
) -> AuditFilter:
    return AuditFilter(
        actor_id=actor_id, action=action, target_type=target_type, target_id=target_id,
        since=from_, until=to,
    )


AuditFilterDep = Annotated[AuditFilter, Depends(_audit_filter)]


@router.get("/audit-logs", response_model=Page[AuditItem])
def audit_logs(
    db: DbSession, _: ManagerUser, flt: AuditFilterDep, page: Annotated[PageParams, Depends()]
) -> Page[AuditItem]:
    rows, total = service.audit_page(db, flt, offset=page.offset, limit=page.page_size)
    return Page(
        items=[AuditItem.model_validate(r) for r in rows], total=total, page=page.page, page_size=page.page_size
    )


_CSV_COLUMNS = ["id", "created_at", "actor_id", "actor_email", "actor_name", "action",
                "target_type", "target_id", "detail"]


def _csv_cell(value) -> str:
    text = "" if value is None else str(value)
    # Chống CSV injection khi mở bằng Excel/Sheets.
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@router.get("/audit-logs/export")
def export_audit_logs(db: DbSession, manager: ManagerUser, flt: AuditFilterDep) -> Response:
    rows = service.audit_export_rows(db, manager, flt)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_CSV_COLUMNS)
    for r in rows:
        writer.writerow([
            r.id, r.created_at.isoformat(), r.actor_id, _csv_cell(r.actor_email), _csv_cell(r.actor_name),
            r.action, r.target_type, r.target_id, _csv_cell(json.dumps(r.detail, ensure_ascii=False)),
        ])
    return Response(
        content="\ufeff" + buf.getvalue(),  # BOM để Excel đọc đúng tiếng Việt
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="audit-logs.csv"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/dashboard", response_model=Dashboard)
def dashboard(db: DbSession, settings: SettingsDep, _: ManagerUser) -> Dashboard:
    return service.dashboard(db, settings)
