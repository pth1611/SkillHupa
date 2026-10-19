from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.users.models import User


def record(
    db: Session,
    actor: User | None,
    action: str,
    target_type: str,
    target_id: int | None,
    detail: dict[str, Any] | None = None,
) -> AuditLog:
    """Ghi một dòng nhật ký; `actor=None` nghĩa là hệ thống (ví dụ tự động chia việc)."""
    entry = AuditLog(
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else None,
        actor_name=actor.display_name if actor else "system",
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail=detail or {},
    )
    db.add(entry)
    db.flush()
    return entry


@dataclass
class AuditFilter:
    actor_id: int | None = None
    action: str | None = None
    target_type: str | None = None
    target_id: int | None = None
    since: datetime | None = None
    until: datetime | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            k: (v.isoformat() if isinstance(v, datetime) else v)
            for k, v in vars(self).items()
            if v is not None
        }


def _filtered(flt: AuditFilter):
    stmt = select(AuditLog)
    if flt.actor_id is not None:
        stmt = stmt.where(AuditLog.actor_id == flt.actor_id)
    if flt.action:
        stmt = stmt.where(AuditLog.action == flt.action)
    if flt.target_type:
        stmt = stmt.where(AuditLog.target_type == flt.target_type)
    if flt.target_id is not None:
        stmt = stmt.where(AuditLog.target_id == flt.target_id)
    if flt.since is not None:
        stmt = stmt.where(AuditLog.created_at >= flt.since)
    if flt.until is not None:
        stmt = stmt.where(AuditLog.created_at <= flt.until)
    return stmt


def count(db: Session, flt: AuditFilter) -> int:
    return db.scalar(select(func.count()).select_from(_filtered(flt).subquery())) or 0


def query(db: Session, flt: AuditFilter, *, offset: int = 0, limit: int | None = None) -> list[AuditLog]:
    stmt = _filtered(flt).order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)
    return list(db.scalars(stmt))


def purge_older_than(db: Session, cutoff: datetime) -> int:
    """Xoá nhật ký quá hạn lưu (D33). Đây là đường xoá duy nhất; không có thao tác xoá tay."""
    from sqlalchemy import delete

    result = db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff))
    return result.rowcount or 0


def recent(db: Session, actions: list[str], limit: int) -> list[AuditLog]:
    stmt = (
        select(AuditLog)
        .where(AuditLog.action.in_(actions))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt))
