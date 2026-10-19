from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.skills.models import (
    Category,
    Skill,
    SkillStatus,
    SkillTag,
    SkillVersion,
    SkillVersionFile,
    Tag,
    TagStatus,
    ValidationResult,
    VersionStatus,
    Visibility,
)


def get_skill(db: Session, skill_id: int) -> Skill | None:
    return db.get(Skill, skill_id)


def add_skill(db: Session, skill: Skill) -> Skill:
    db.add(skill)
    db.flush()
    return skill


def list_by_owner(db: Session, owner_id: int) -> list[Skill]:
    return list(db.scalars(select(Skill).where(Skill.owner_id == owner_id).order_by(Skill.updated_at.desc())))


def name_key_taken(db: Session, key: str, *, exclude_skill_id: int) -> bool:
    stmt = select(Skill.id).where(Skill.name_key == key, Skill.id != exclude_skill_id)
    return db.scalar(stmt) is not None


def get_version(db: Session, skill_id: int, version: str) -> SkillVersion | None:
    stmt = select(SkillVersion).where(SkillVersion.skill_id == skill_id, SkillVersion.version == version)
    return db.scalar(stmt)


def add_version(db: Session, version: SkillVersion) -> SkillVersion:
    db.add(version)
    db.flush()
    return version


def list_versions(db: Session, skill_id: int) -> list[SkillVersion]:
    return list(db.scalars(select(SkillVersion).where(SkillVersion.skill_id == skill_id).order_by(SkillVersion.id)))


def released_version_numbers(db: Session, skill_id: int) -> list[str]:
    """Số phiên bản đã từng được đăng (published/revoked); phiên bản mới phải lớn hơn tất cả."""
    stmt = select(SkillVersion.version).where(
        SkillVersion.skill_id == skill_id,
        SkillVersion.status.in_([VersionStatus.PUBLISHED.value, VersionStatus.REVOKED.value]),
    )
    return list(db.scalars(stmt))


def replace_files(db: Session, version: SkillVersion, files: list[SkillVersionFile]) -> None:
    version.files.clear()
    db.flush()
    version.files.extend(files)


def replace_results(
    db: Session, version: SkillVersion, phase: str, results: list[ValidationResult]
) -> None:
    for old in [r for r in version.results if r.phase == phase]:
        version.results.remove(old)
    db.flush()
    version.results.extend(results)


def get_tags(db: Session, tag_ids: list[int]) -> list[Tag]:
    if not tag_ids:
        return []
    return list(db.scalars(select(Tag).where(Tag.id.in_(tag_ids))))


def tag_ids_of(db: Session, skill_id: int) -> list[int]:
    return list(db.scalars(select(SkillTag.tag_id).where(SkillTag.skill_id == skill_id).order_by(SkillTag.tag_id)))


def set_skill_tags(db: Session, skill_id: int, tag_ids: list[int]) -> None:
    db.query(SkillTag).filter(SkillTag.skill_id == skill_id).delete()
    for tag_id in sorted(set(tag_ids)):
        db.add(SkillTag(skill_id=skill_id, tag_id=tag_id))
    db.flush()


# ---- tìm kiếm và danh mục ---------------------------------------------------


def _like(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped.lower()}%"


def search_published(
    db: Session,
    *,
    viewer_id: int,
    viewer_department: str | None,
    is_manager: bool,
    q: str | None,
    category_id: int | None,
    department: str | None,
    tags: list[str],
    sort: str,
    offset: int,
    limit: int,
) -> tuple[list[Skill], int]:
    stmt = select(Skill).where(Skill.status == SkillStatus.PUBLISHED.value)
    if not is_manager:
        allowed = [Skill.visibility == Visibility.COMPANY.value, Skill.owner_id == viewer_id]
        if viewer_department:
            allowed.append(Skill.department == viewer_department)
        stmt = stmt.where(or_(*allowed))
    if category_id is not None:
        stmt = stmt.where(Skill.category_id == category_id)
    if department:
        stmt = stmt.where(Skill.department == department)
    if q and q.strip():
        pattern = _like(q.strip())
        tag_match = (
            select(SkillTag.skill_id)
            .join(Tag, Tag.id == SkillTag.tag_id)
            .where(Tag.status == TagStatus.APPROVED.value, func.lower(Tag.name).like(pattern, escape="\\"))
        )
        stmt = stmt.where(
            or_(
                func.lower(Skill.name).like(pattern, escape="\\"),
                func.lower(func.coalesce(Skill.summary, "")).like(pattern, escape="\\"),
                Skill.id.in_(tag_match),
            )
        )
    for name in tags:  # mọi tag đều phải khớp (AND)
        stmt = stmt.where(
            Skill.id.in_(
                select(SkillTag.skill_id)
                .join(Tag, Tag.id == SkillTag.tag_id)
                .where(Tag.status == TagStatus.APPROVED.value, func.lower(Tag.name) == name.lower())
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = {
        "popular": (Skill.download_count.desc(), Skill.published_at.desc()),
        "name": (func.lower(Skill.name).asc(),),
    }.get(sort, (Skill.published_at.desc(), Skill.id.desc()))
    rows = db.scalars(stmt.order_by(*order, Skill.id.asc()).offset(offset).limit(limit))
    return list(rows), total


def approved_tag_names(db: Session, skill_ids: list[int]) -> dict[int, list[str]]:
    if not skill_ids:
        return {}
    stmt = (
        select(SkillTag.skill_id, Tag.name)
        .join(Tag, Tag.id == SkillTag.tag_id)
        .where(SkillTag.skill_id.in_(skill_ids), Tag.status == TagStatus.APPROVED.value)
        .order_by(Tag.name)
    )
    out: dict[int, list[str]] = {}
    for skill_id, name in db.execute(stmt):
        out.setdefault(skill_id, []).append(name)
    return out


def versions_by_id(db: Session, version_ids: list[int]) -> dict[int, SkillVersion]:
    ids = [i for i in version_ids if i is not None]
    if not ids:
        return {}
    return {v.id: v for v in db.scalars(select(SkillVersion).where(SkillVersion.id.in_(ids)))}


def list_categories(db: Session) -> list[Category]:
    return list(db.scalars(select(Category).order_by(Category.name)))


def list_approved_tags(db: Session, q: str | None, limit: int) -> list[tuple[Tag, int]]:
    usage = func.count(SkillTag.skill_id)
    stmt = (
        select(Tag, usage)
        .outerjoin(SkillTag, SkillTag.tag_id == Tag.id)
        .where(Tag.status == TagStatus.APPROVED.value)
        .group_by(Tag.id)
        .order_by(usage.desc(), Tag.name)
        .limit(limit)
    )
    if q and q.strip():
        stmt = stmt.where(func.lower(Tag.name).like(_like(q.strip()), escape="\\"))
    return [(t, n) for t, n in db.execute(stmt)]


def find_tag_by_name(db: Session, name: str) -> Tag | None:
    return db.scalar(select(Tag).where(func.lower(Tag.name) == name.lower()))


def add_tag(db: Session, tag: Tag) -> Tag:
    db.add(tag)
    db.flush()
    return tag


def tags_proposed_by(db: Session, user_id: int) -> list[Tag]:
    return list(db.scalars(select(Tag).where(Tag.proposed_by == user_id).order_by(Tag.id.desc())))
