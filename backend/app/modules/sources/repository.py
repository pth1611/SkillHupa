from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.skills.models import Skill
from app.modules.sources.models import SkillSource, SourceScan


def get(db: Session, source_id: int) -> SkillSource | None:
    return db.get(SkillSource, source_id)


def get_by_url(db: Session, url: str) -> SkillSource | None:
    return db.scalar(select(SkillSource).where(SkillSource.url == url))


def add(db: Session, source: SkillSource) -> SkillSource:
    db.add(source)
    db.flush()
    return source


def list_all(db: Session) -> list[SkillSource]:
    return list(db.scalars(select(SkillSource).order_by(SkillSource.name, SkillSource.id)))


def list_enabled(db: Session) -> list[SkillSource]:
    return list(db.scalars(select(SkillSource).where(SkillSource.is_enabled.is_(True)).order_by(SkillSource.id)))


def skill_counts(db: Session) -> dict[int, int]:
    stmt = select(Skill.source_id, func.count()).where(Skill.source_id.is_not(None)).group_by(Skill.source_id)
    return {sid: n for sid, n in db.execute(stmt)}


def add_scan(db: Session, scan: SourceScan) -> SourceScan:
    db.add(scan)
    db.flush()
    return scan


def scans_of(db: Session, source_id: int, offset: int, limit: int) -> tuple[list[SourceScan], int]:
    base = select(SourceScan).where(SourceScan.source_id == source_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(base.order_by(SourceScan.started_at.desc(), SourceScan.id.desc()).offset(offset).limit(limit))
    return list(rows), total


def delete_scans(db: Session, source_id: int) -> None:
    for scan in db.scalars(select(SourceScan).where(SourceScan.source_id == source_id)):
        db.delete(scan)
    db.flush()


def count_with_error(db: Session) -> int:
    stmt = select(func.count()).select_from(SkillSource).where(SkillSource.last_scan_status == "error")
    return db.scalar(stmt) or 0
