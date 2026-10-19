from sqlalchemy.orm import Session

from app.core.config import Settings
from app.modules.admin.exceptions import (
    ExportTooLarge,
    ImportedSkillHasNoOwner,
    InvalidMerge,
    InvalidOwner,
    LastPublishedVersion,
    SkillNotRemovable,
    SkillNotRestorable,
    TagExists,
    TagInUse,
    TagNotFound,
    TagStateInvalid,
    VersionNotRevocable,
)
from app.modules.admin.schemas import (
    AdminSkillItem,
    AdminTag,
    Dashboard,
    Impact,
    MergeResult,
    RecentEvent,
)
from app.modules.audit import service as audit
from app.modules.installs import repository as installs_repo
from app.modules.notifications import service as notifications
from app.modules.reviews import service as reviews_service
from app.modules.skills import import_api as skills_import
from app.modules.skills import review_api as skills_api
from app.modules.skills import tags_api
from app.modules.skills.exceptions import SkillNotFound, VersionNotFound
from app.modules.skills.models import (
    Origin,
    Skill,
    SkillStatus,
    SkillVersion,
    Tag,
    TagStatus,
    VersionStatus,
)
from app.modules.sources import repository as sources_repo
from app.modules.users import service as users_service
from app.modules.users.models import Role, User
from app.shared.utils import utcnow


def _skill(db: Session, skill_id: int) -> Skill:
    skill = skills_api.get_skill(db, skill_id)
    if skill is None:
        raise SkillNotFound()
    return skill


def _version(skill: Skill, version: str) -> SkillVersion:
    ver = skills_api.find_version(skill, version)
    if ver is None:
        raise VersionNotFound()
    return ver


def _latest_str(skill: Skill) -> str | None:
    return next((v.version for v in skill.versions if v.id == skill.latest_version_id), None)


def _audience(db: Session, skill: Skill, version: str | None = None) -> set[int]:
    users = installs_repo.affected_users(db, skill.id, version)
    return set().union(*users.values())


def _notify(db: Session, skill: Skill, ids: set[int], type_: str, message: str, *, owner: bool = True) -> None:
    targets = set(ids)
    if owner and skill.owner_id is not None:
        targets.add(skill.owner_id)
    elif owner:  # skill thu thập không có chủ: báo mọi Manager (D48)
        targets.update(m.id for m in users_service.active_by_role(db, Role.MANAGER))
    notifications.notify(db, targets, type_, message, link=f"/skills/{skill.id}")


# ---- đọc ----------------------------------------------------------------------


def list_skills(db: Session, *, status, q, owner_id, offset: int, limit: int):
    skills, total = skills_api.list_skills(
        db, status=status, q=q, owner_id=owner_id, offset=offset, limit=limit
    )
    counts = installs_repo.install_counts(db, [s.id for s in skills])
    items = [
        AdminSkillItem(
            id=s.id, name=s.name, status=s.status, origin=s.origin, owner_id=s.owner_id,
            department=s.department, visibility=s.visibility, latest_version=_latest_str(s),
            download_count=s.download_count, install_count=counts.get(s.id, 0), updated_at=s.updated_at,
        )
        for s in skills
    ]
    return items, total


def impact(db: Session, skill_id: int, version: str | None) -> Impact:
    skill = _skill(db, skill_id)
    after = None
    if version is not None:
        ver = _version(skill, version)
        best = skills_api.highest_published(skill, exclude_id=ver.id)
        after = best.version if best else None
    users = installs_repo.affected_users(db, skill.id, version)
    return Impact(
        installed_users=len(users[installs_repo.SOURCE_CLI]),
        zip_users=len(users[installs_repo.SOURCE_ZIP]),
        latest_after_revoke=after,
    )


# ---- thao tác -----------------------------------------------------------------


def remove(db: Session, manager: User, skill_id: int, reason: str) -> Skill:
    skill = _skill(db, skill_id)
    if skill.status != SkillStatus.PUBLISHED.value:
        raise SkillNotRemovable()
    affected = _audience(db, skill)
    skill.status = SkillStatus.REMOVED.value
    audit.record(db, manager, "skill.remove", "skill", skill.id,
                 {"reason": reason, "name": skill.name, "affected_users": len(affected)})
    _notify(db, skill, affected, "skill.removed", f"Skill {skill.name} đã bị gỡ: {reason}")
    db.flush()
    return skill


def restore(db: Session, manager: User, skill_id: int) -> Skill:
    skill = _skill(db, skill_id)
    best = skills_api.highest_published(skill)
    if skill.status != SkillStatus.REMOVED.value or best is None:
        raise SkillNotRestorable()
    skill.status = SkillStatus.PUBLISHED.value
    skill.latest_version_id = best.id  # bản `revoked` trong lúc bị gỡ không được quay lại
    audit.record(db, manager, "skill.restore", "skill", skill.id,
                 {"name": skill.name, "latest_version": best.version})
    _notify(db, skill, _audience(db, skill), "skill.restored", f"Skill {skill.name} đã được khôi phục")
    db.flush()
    return skill


def revoke(db: Session, manager: User, skill_id: int, version: str, reason: str) -> Skill:
    skill = _skill(db, skill_id)
    ver = _version(skill, version)
    if ver.status != VersionStatus.PUBLISHED.value:
        raise VersionNotRevocable()
    fallback = skills_api.highest_published(skill, exclude_id=ver.id)
    if fallback is None:
        raise LastPublishedVersion()
    affected = _audience(db, skill, ver.version)
    ver.status = VersionStatus.REVOKED.value
    skill.latest_version_id = fallback.id
    audit.record(db, manager, "version.revoke", "skill_version", ver.id,
                 {"skill_id": skill.id, "version": ver.version, "reason": reason,
                  "latest_after": fallback.version, "affected_users": len(affected)})
    _notify(db, skill, affected, "version.revoked",
            f"Phiên bản {ver.version} của skill {skill.name} đã bị thu hồi: {reason}. Hãy cập nhật lên {fallback.version}")
    db.flush()
    return skill


def transfer(db: Session, manager: User, skill_id: int, new_owner_id: int) -> Skill:
    skill = _skill(db, skill_id)
    if skill.origin == Origin.IMPORTED.value:
        raise ImportedSkillHasNoOwner()
    target = users_service.find_user(db, new_owner_id)
    if target is None or not target.is_active or target.role != Role.CREATOR.value:
        raise InvalidOwner()
    previous = skill.owner_id
    skill.owner_id = target.id
    audit.record(db, manager, "skill.transfer", "skill", skill.id,
                 {"name": skill.name, "from_owner_id": previous, "to_owner_id": target.id})
    if previous is not None and previous != target.id:
        notifications.notify(db, [previous], "skill.transferred_out",
                             f"Quyền sở hữu skill {skill.name} đã được chuyển cho người khác", link="/studio")
    notifications.notify(db, [target.id], "skill.transferred_in",
                         f"Bạn được giao quyền sở hữu skill {skill.name}", link=f"/skills/{skill.id}")
    db.flush()
    return skill


# ---- tag (D30) ----------------------------------------------------------------


def _admin_tag(db: Session, tag, usage: dict[int, int] | None = None) -> AdminTag:
    counts = usage if usage is not None else tags_api.usage(db, [tag.id])
    return AdminTag(
        id=tag.id, name=tag.name, status=tag.status, usage_count=counts.get(tag.id, 0),
        proposed_by=tag.proposed_by, decided_by=tag.decided_by, decided_at=tag.decided_at,
    )


def _tag(db: Session, tag_id: int):
    tag = tags_api.get(db, tag_id)
    if tag is None:
        raise TagNotFound()
    return tag


def list_tags(db: Session, *, status, q, offset: int, limit: int):
    rows, total = tags_api.list_tags(db, status=status, q=q, offset=offset, limit=limit)
    usage = tags_api.usage(db, [t.id for t in rows])
    return [_admin_tag(db, t, usage) for t in rows], total


def create_tag(db: Session, manager: User, name: str) -> AdminTag:
    clean = tags_api.normalize(name)
    if not clean:
        raise TagExists("Tên tag trống")
    existing = tags_api.find_by_name(db, clean)
    if existing is not None:
        raise TagExists(details={"tag_id": existing.id, "status": existing.status})
    tag = tags_api.add(
        db,
        Tag(name=clean, status=TagStatus.APPROVED.value, decided_by=manager.id, decided_at=utcnow()),
    )
    audit.record(db, manager, "tag.create", "tag", tag.id, {"name": tag.name})
    return _admin_tag(db, tag)


def approve_tag(db: Session, manager: User, tag_id: int) -> AdminTag:
    tag = _tag(db, tag_id)
    if tag.status != TagStatus.PENDING.value:
        raise TagStateInvalid()
    tag.status = TagStatus.APPROVED.value
    tag.decided_by, tag.decided_at = manager.id, utcnow()
    audit.record(db, manager, "tag.approve", "tag", tag.id, {"name": tag.name})
    if tag.proposed_by is not None:
        notifications.notify(db, [tag.proposed_by], "tag.approved", f"Tag \"{tag.name}\" đã được duyệt")
    db.flush()
    return _admin_tag(db, tag)


def reject_tag(db: Session, manager: User, tag_id: int, reason: str) -> AdminTag:
    tag = _tag(db, tag_id)
    if tag.status != TagStatus.PENDING.value:
        raise TagStateInvalid()
    owners = tags_api.owners_of_skills_with_tag(db, tag.id)
    detached = tags_api.detach_all(db, tag.id)
    tag.status = TagStatus.REJECTED.value
    tag.decided_by, tag.decided_at = manager.id, utcnow()
    audit.record(db, manager, "tag.reject", "tag", tag.id,
                 {"name": tag.name, "reason": reason, "skills_detached": detached})
    targets = set(owners)
    if tag.proposed_by is not None:
        targets.add(tag.proposed_by)
    notifications.notify(db, targets, "tag.rejected",
                         f"Tag \"{tag.name}\" bị từ chối: {reason}. Hãy chọn tag khác")
    db.flush()
    return _admin_tag(db, tag)


def merge_tags(db: Session, manager: User, from_ids: list[int], into_id: int) -> MergeResult:
    sources = list(dict.fromkeys(from_ids))
    if into_id in sources:
        raise InvalidMerge("Tag đích không được nằm trong danh sách gộp")
    target = _tag(db, into_id)
    if target.status != TagStatus.APPROVED.value:
        raise InvalidMerge("Tag đích phải đã được duyệt")
    found = [tags_api.get(db, i) for i in sources]
    missing = [i for i, t in zip(sources, found, strict=True) if t is None]
    if missing:
        raise InvalidMerge("Có tag không tồn tại", {"tag_ids": missing})
    names = [t.name for t in found if t is not None]
    moved = tags_api.merge_into(db, sources, into_id)
    audit.record(db, manager, "tag.merge", "tag", target.id,
                 {"into": target.name, "from": names, "from_ids": sources, "skills_moved": moved})
    return MergeResult(into=_admin_tag(db, target), merged=len(sources), skills_moved=moved)


def delete_tag(db: Session, manager: User, tag_id: int) -> None:
    tag = _tag(db, tag_id)
    if tags_api.usage(db, [tag.id]).get(tag.id):
        raise TagInUse()
    audit.record(db, manager, "tag.delete", "tag", tag.id, {"name": tag.name, "status": tag.status})
    tags_api.delete_tag(db, tag)


# ---- nhật ký và bảng điều khiển ---------------------------------------------------

EXPORT_LIMIT = 50_000
RECENT_ACTIONS = ["skill.remove", "skill.restore", "version.revoke", "skill.transfer"]


def audit_page(db: Session, flt: audit.AuditFilter, *, offset: int, limit: int):
    return audit.query(db, flt, offset=offset, limit=limit), audit.count(db, flt)


def audit_export_rows(db: Session, manager: User, flt: audit.AuditFilter):
    total = audit.count(db, flt)
    if total > EXPORT_LIMIT:
        raise ExportTooLarge(details={"rows": total, "limit": EXPORT_LIMIT})
    rows = audit.query(db, flt)
    audit.record(db, manager, "audit.export", "audit_log", None, {"filter": flt.as_dict(), "rows": len(rows)})
    return rows


def dashboard(db: Session, settings: Settings) -> Dashboard:
    work = reviews_service.work_summary(db, settings)
    skill_counts = tags_api.skill_counts(db)
    overview = {
        "skills_published": skill_counts.get("published", 0),
        "skills_removed": skill_counts.get("removed", 0),
        "skills_draft": skill_counts.get("draft", 0),
        "versions_pending": work["pending_total"],
    }
    events = [
        RecentEvent(
            action=e.action, target_type=e.target_type, target_id=e.target_id,
            actor_name=e.actor_name, created_at=e.created_at, detail=e.detail,
        )
        for e in audit.recent(db, RECENT_ACTIONS, 10)
    ]
    return Dashboard(
        unassigned=work["unassigned"],
        unassigned_overdue=work["unassigned_overdue"],
        review_overdue=work["review_overdue"],
        tags_pending=tags_api.count_by_status(db, TagStatus.PENDING),
        visibility_requests_pending=work["visibility_requests_pending"],
        sources_with_problems=tags_api.count_upstream_problems(db) + sources_repo.count_with_error(db),
        recent_events=events,
        overview=overview,
    )


# ---- sửa thông tin hiển thị skill thu thập (D48) -------------------------------------


def update_imported_display(db: Session, settings: Settings, manager: User, skill_id: int, body) -> Skill:
    from app.modules.skills import repository as skills_repo
    from app.modules.skills import service as skills_service

    skill = _skill(db, skill_id)
    data = body.model_dump(exclude_unset=True)
    tag_ids = data.pop("tag_ids", None)
    if data.get("category_id") is not None and not any(
        c.id == data["category_id"] for c in skills_repo.list_categories(db)
    ):
        raise InvalidMerge("Danh mục không tồn tại")
    skills_service.check_department(settings, data.get("department"))
    skills_import.update_display(db, skill, data, tag_ids)
    audit.record(db, manager, "skill.update_display", "skill", skill.id,
                 {"fields": sorted(data) + (["tag_ids"] if tag_ids is not None else [])})
    return skill
