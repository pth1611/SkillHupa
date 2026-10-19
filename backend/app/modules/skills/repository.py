from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.skills.models import (
    Category,
    Skill,
    SkillFacet,
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
from app.modules.skills.taxonomy import ECOSYSTEM, OUTPUT_TYPE


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


def _filtered(
    *,
    viewer_id: int,
    viewer_department: str | None,
    is_manager: bool,
    q: str | None,
    category_id: int | None,
    department: str | None,
    tags: list[str],
    output_types: list[str],
    ecosystems: list[str],
    skip: str | None = None,
):
    """Truy vấn skill đã đăng mà người xem được thấy, kèm bộ lọc. `skip` bỏ một chiều lọc
    (`category`, `output_type`, `ecosystem`) để đếm facet kiểu "chọn thêm giá trị khác"."""
    stmt = select(Skill).where(Skill.status == SkillStatus.PUBLISHED.value)
    if not is_manager:
        allowed = [Skill.visibility == Visibility.COMPANY.value, Skill.owner_id == viewer_id]
        if viewer_department:
            allowed.append(Skill.department == viewer_department)
        stmt = stmt.where(or_(*allowed))
    if category_id is not None and skip != "category":
        stmt = stmt.where(Skill.category_id == category_id)
    if department:
        stmt = stmt.where(Skill.department == department)
    for kind, slugs in ((OUTPUT_TYPE, output_types), (ECOSYSTEM, ecosystems)):
        if slugs and skip != kind:  # nhiều giá trị trong cùng một chiều: khớp một trong số đó (OR)
            stmt = stmt.where(
                Skill.id.in_(select(SkillFacet.skill_id).where(SkillFacet.kind == kind, SkillFacet.slug.in_(slugs)))
            )
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
    return stmt


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
    output_types: list[str] | None = None,
    ecosystems: list[str] | None = None,
    sort: str,
    offset: int,
    limit: int,
) -> tuple[list[Skill], int]:
    stmt = _filtered(
        viewer_id=viewer_id, viewer_department=viewer_department, is_manager=is_manager, q=q,
        category_id=category_id, department=department, tags=tags,
        output_types=output_types or [], ecosystems=ecosystems or [],
    )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = {
        "popular": (Skill.download_count.desc(), Skill.published_at.desc()),
        "name": (func.lower(Skill.name).asc(),),
    }.get(sort, (Skill.published_at.desc(), Skill.id.desc()))
    rows = db.scalars(stmt.order_by(*order, Skill.id.asc()).offset(offset).limit(limit))
    return list(rows), total


def facet_counts(
    db: Session,
    *,
    viewer_id: int,
    viewer_department: str | None,
    is_manager: bool,
    q: str | None,
    category_id: int | None,
    department: str | None,
    tags: list[str],
    output_types: list[str],
    ecosystems: list[str],
) -> dict[str, dict]:
    """Số skill khớp cho từng giá trị của mỗi chiều phân loại, áp dụng mọi bộ lọc khác và phạm vi xem."""
    common = {
        "viewer_id": viewer_id, "viewer_department": viewer_department, "is_manager": is_manager, "q": q,
        "category_id": category_id, "department": department, "tags": tags,
        "output_types": output_types, "ecosystems": ecosystems,
    }
    out: dict[str, dict] = {}
    base = _filtered(**common, skip="category").subquery()
    out["category"] = {
        cid: n
        for cid, n in db.execute(
            select(base.c.category_id, func.count()).where(base.c.category_id.is_not(None)).group_by(base.c.category_id)
        )
    }
    for kind in (OUTPUT_TYPE, ECOSYSTEM):
        sub = _filtered(**common, skip=kind).subquery()
        out[kind] = dict(
            db.execute(
                select(SkillFacet.slug, func.count())
                .join(sub, sub.c.id == SkillFacet.skill_id)
                .where(SkillFacet.kind == kind)
                .group_by(SkillFacet.slug)
            ).all()
        )
    out["total"] = db.scalar(select(func.count()).select_from(_filtered(**common).subquery())) or 0
    return out


def facet_slugs_of(db: Session, skill_ids: list[int]) -> dict[int, dict[str, list[str]]]:
    if not skill_ids:
        return {}
    stmt = (
        select(SkillFacet.skill_id, SkillFacet.kind, SkillFacet.slug)
        .where(SkillFacet.skill_id.in_(skill_ids))
        .order_by(SkillFacet.slug)
    )
    out: dict[int, dict[str, list[str]]] = {}
    for skill_id, kind, slug in db.execute(stmt):
        out.setdefault(skill_id, {OUTPUT_TYPE: [], ECOSYSTEM: []})[kind].append(slug)
    return out


FACET_MANUAL = "manual"
FACET_AUTO = "auto"


def set_skill_facets(
    db: Session, skill_id: int, kind: str, slugs: list[str], *, source: str = FACET_MANUAL,
    scores: dict[str, int] | None = None,
) -> None:
    db.query(SkillFacet).filter(SkillFacet.skill_id == skill_id, SkillFacet.kind == kind).delete()
    for slug in sorted(set(slugs)):
        db.add(SkillFacet(skill_id=skill_id, kind=kind, slug=slug, source=source, score=(scores or {}).get(slug)))
    db.flush()


def manual_facet_kinds(db: Session, skill_id: int) -> set[str]:
    stmt = select(SkillFacet.kind).where(SkillFacet.skill_id == skill_id, SkillFacet.source == FACET_MANUAL).distinct()
    return set(db.scalars(stmt))


def auto_facet_slugs(db: Session, skill_id: int) -> dict[str, list[str]]:
    stmt = (
        select(SkillFacet.kind, SkillFacet.slug)
        .where(SkillFacet.skill_id == skill_id, SkillFacet.source == FACET_AUTO)
        .order_by(SkillFacet.slug)
    )
    out: dict[str, list[str]] = {OUTPUT_TYPE: [], ECOSYSTEM: []}
    for kind, slug in db.execute(stmt):
        out[kind].append(slug)
    return out


def skill_ids_without_manual_facets(db: Session, *, only_empty: bool) -> list[int]:
    """Skill cần backfill: chưa có facet nào (only_empty) hoặc chưa có facet do người chọn."""
    has_any = select(SkillFacet.skill_id)
    if not only_empty:
        has_any = has_any.where(SkillFacet.source == FACET_MANUAL)
    return list(db.scalars(select(Skill.id).where(Skill.id.not_in(has_any)).order_by(Skill.id)))


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


def category_id_by_slug(db: Session, slug: str | None) -> int | None:
    return db.scalar(select(Category.id).where(Category.slug == slug)) if slug else None


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
