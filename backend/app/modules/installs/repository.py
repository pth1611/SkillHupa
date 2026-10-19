from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.installs.models import Install

SOURCE_CLI = "cli"
SOURCE_ZIP = "zip"


def get(db: Session, user_id: int, skill_id: int, target: str) -> Install | None:
    stmt = select(Install).where(
        Install.user_id == user_id, Install.skill_id == skill_id, Install.target == target
    )
    return db.scalar(stmt)


def active_for_skill(db: Session, user_id: int, skill_id: int, target: str | None) -> list[Install]:
    stmt = select(Install).where(
        Install.user_id == user_id, Install.skill_id == skill_id, Install.uninstalled_at.is_(None)
    )
    if target:
        stmt = stmt.where(Install.target == target)
    return list(db.scalars(stmt))


def active_for_user(db: Session, user_id: int) -> list[Install]:
    stmt = (
        select(Install)
        .where(Install.user_id == user_id, Install.uninstalled_at.is_(None))
        .order_by(Install.installed_at.desc(), Install.id.desc())
    )
    return list(db.scalars(stmt))


def upsert(
    db: Session, *, user_id: int, skill_id: int, target: str, source: str, version: str, now: datetime
) -> Install:
    row = get(db, user_id, skill_id, target)
    if row is None:
        row = Install(user_id=user_id, skill_id=skill_id, target=target, source=source,
                      installed_version=version, installed_at=now)
        db.add(row)
    else:
        row.installed_version = version
        row.source = source
        row.installed_at = now
        row.uninstalled_at = None
    db.flush()
    return row


def install_counts(db: Session, skill_ids: list[int], *, since: datetime | None = None) -> dict[int, int]:
    """Số người khác nhau đang có skill qua CLI (D21); `since` chỉ tính lượt cài/cập nhật gần đây."""
    if not skill_ids:
        return {}
    stmt = (
        select(Install.skill_id, func.count(func.distinct(Install.user_id)))
        .where(
            Install.skill_id.in_(skill_ids),
            Install.source == SOURCE_CLI,
            Install.uninstalled_at.is_(None),
        )
        .group_by(Install.skill_id)
    )
    if since is not None:
        stmt = stmt.where(Install.installed_at >= since)
    return {skill_id: n for skill_id, n in db.execute(stmt)}


def affected_users(db: Session, skill_id: int, version: str | None = None) -> dict[str, set[int]]:
    """Người đang có skill (hoặc đúng bản `version`), tách theo nguồn: {"cli": {...}, "zip": {...}}."""
    stmt = select(Install.user_id, Install.source).where(
        Install.skill_id == skill_id, Install.uninstalled_at.is_(None)
    )
    if version is not None:
        stmt = stmt.where(Install.installed_version == version)
    out: dict[str, set[int]] = {SOURCE_CLI: set(), SOURCE_ZIP: set()}
    for user_id, source in db.execute(stmt):
        out.setdefault(source, set()).add(user_id)
    return out
