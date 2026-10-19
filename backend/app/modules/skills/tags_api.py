"""Giao diện của module `skills` dành cho module `admin` quản lý tag (D30)."""
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.modules.skills.models import Skill, SkillTag, Tag, TagStatus


def normalize(name: str) -> str:
    return " ".join(name.lower().split())


def get(db: Session, tag_id: int) -> Tag | None:
    return db.get(Tag, tag_id)


def find_by_name(db: Session, name: str) -> Tag | None:
    return db.scalar(select(Tag).where(func.lower(Tag.name) == name.lower()))


def add(db: Session, tag: Tag) -> Tag:
    db.add(tag)
    db.flush()
    return tag


def usage(db: Session, tag_ids: list[int]) -> dict[int, int]:
    if not tag_ids:
        return {}
    stmt = select(SkillTag.tag_id, func.count()).where(SkillTag.tag_id.in_(tag_ids)).group_by(SkillTag.tag_id)
    return {tag_id: n for tag_id, n in db.execute(stmt)}


def list_tags(
    db: Session, *, status: str | None, q: str | None, offset: int, limit: int
) -> tuple[list[Tag], int]:
    stmt = select(Tag)
    if status:
        stmt = stmt.where(Tag.status == status)
    if q and q.strip():
        stmt = stmt.where(func.lower(Tag.name).like(f"%{q.strip().lower()}%"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Tag.name, Tag.id).offset(offset).limit(limit))
    return list(rows), total


def owners_of_skills_with_tag(db: Session, tag_id: int) -> list[int]:
    stmt = (
        select(Skill.owner_id)
        .join(SkillTag, SkillTag.skill_id == Skill.id)
        .where(SkillTag.tag_id == tag_id, Skill.owner_id.is_not(None))
        .distinct()
    )
    return list(db.scalars(stmt))


def detach_all(db: Session, tag_id: int) -> int:
    result = db.execute(delete(SkillTag).where(SkillTag.tag_id == tag_id))
    return result.rowcount or 0


def merge_into(db: Session, from_ids: list[int], into_id: int) -> int:
    """Chuyển mọi skill từ các tag cũ sang tag đích (bỏ trùng), rồi xoá tag cũ. Trả số skill được chuyển."""
    already = set(db.scalars(select(SkillTag.skill_id).where(SkillTag.tag_id == into_id)))
    moved = 0
    rows = db.scalars(select(SkillTag.skill_id).where(SkillTag.tag_id.in_(from_ids)).distinct())
    for skill_id in rows:
        if skill_id not in already:
            db.add(SkillTag(skill_id=skill_id, tag_id=into_id))
            already.add(skill_id)
            moved += 1
    db.execute(delete(SkillTag).where(SkillTag.tag_id.in_(from_ids)))
    db.execute(delete(Tag).where(Tag.id.in_(from_ids)))
    db.flush()
    return moved


def delete_tag(db: Session, tag: Tag) -> None:
    db.delete(tag)
    db.flush()


def count_by_status(db: Session, status: TagStatus) -> int:
    return db.scalar(select(func.count()).select_from(Tag).where(Tag.status == status.value)) or 0


def skill_counts(db: Session) -> dict[str, int]:
    return {status: n for status, n in db.execute(select(Skill.status, func.count()).group_by(Skill.status))}


def count_upstream_problems(db: Session) -> int:
    stmt = select(func.count()).select_from(Skill).where(Skill.upstream_status != "ok")
    return db.scalar(stmt) or 0

