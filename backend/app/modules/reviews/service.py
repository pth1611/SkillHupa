from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.storage import BlobStorage
from app.modules.audit import service as audit
from app.modules.notifications import service as notifications
from app.modules.reviews import repository
from app.modules.reviews.exceptions import (
    CommentRequired,
    InvalidAssignee,
    NotPending,
    ReviewItemNotFound,
    VisibilityRequestExists,
)
from app.modules.reviews.models import (
    Decision,
    RequestStatus,
    Review,
    VisibilityRequest,
)
from app.modules.reviews.schemas import (
    HistoryItem,
    QueueItem,
)
from app.modules.skills import review_api as skills_api
from app.modules.skills.models import VersionStatus
from app.modules.users import service as users_service
from app.modules.users.models import Role, User
from app.shared.pagination import Page, PageParams
from app.shared.utils import utcnow
from app.shared.workcalendar import WorkCalendar, calendar_from_settings

VERSION, VISIBILITY = "version", "visibility"


# ---- tiện ích ---------------------------------------------------------------


def _notify_owner(db: Session, owner_id: int | None, type_: str, message: str, link: str) -> None:
    """Skill thu thập không có chủ nên thông báo đi tới mọi Manager (D48)."""
    if owner_id is None:
        notifications.notify_managers(db, type_, message, link=link)
    else:
        notifications.notify(db, [owner_id], type_, message, link=link)


def _name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    user = users_service.find_user(db, user_id)
    return user.display_name if user else None


def _active_reviewer(db: Session, reviewer_id: int) -> User:
    user = users_service.find_user(db, reviewer_id)
    if user is None or not user.is_active or user.role != Role.REVIEWER.value:
        raise InvalidAssignee()
    return user


def _pending_load(db: Session) -> dict[int, tuple[int, datetime | None]]:
    """Với mỗi Reviewer: (số việc đang giữ, thời điểm được giao gần nhất)."""
    load: dict[int, tuple[int, datetime | None]] = {}

    def bump(user_id: int | None, at: datetime | None) -> None:
        if user_id is None:
            return
        count, last = load.get(user_id, (0, None))
        stamps = [t for t in (last, _aware(at) if at else None) if t is not None]
        load[user_id] = (count + 1, max(stamps, default=None))

    for version, _ in skills_api.pending_versions(db):
        bump(version.assigned_to, version.assigned_at)
    for req in repository.pending_requests(db):
        bump(req.assigned_to, req.assigned_at)
    return load


def _least_loaded(db: Session) -> User | None:
    reviewers = users_service.active_by_role(db, Role.REVIEWER)
    if not reviewers:
        return None
    load = _pending_load(db)
    return min(
        reviewers,
        key=lambda r: (load.get(r.id, (0, None))[0], load.get(r.id, (0, None))[1] or _EPOCH, r.id),
    )


_EPOCH = datetime.min.replace(tzinfo=UTC)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


# ---- hàng đợi -----------------------------------------------------------------


@dataclass
class QueueFilter:
    kind: str | None = None
    assigned: bool | None = None
    reviewer_id: int | None = None
    overdue: bool | None = None


def _build_items(db: Session, settings: Settings, cal: WorkCalendar, now: datetime) -> list[QueueItem]:
    items: list[QueueItem] = []
    for version, skill in skills_api.pending_versions(db):
        submitted = _aware(version.submitted_at or version.created_at)
        items.append(
            QueueItem(
                kind=VERSION,
                id=version.id,
                skill_id=skill.id,
                skill_name=skill.name,
                origin=skill.origin,
                version=version.version,
                submitted_at=submitted,
                assigned_to=version.assigned_to,
                assigned_to_name=_name(db, version.assigned_to),
                overdue=cal.is_overdue(submitted, now, settings.review_overdue_days),
                unassigned_overdue=version.assigned_to is None
                and cal.is_overdue(submitted, now, settings.unassigned_remind_days),
            )
        )
    for req in repository.pending_requests(db):
        skill = skills_api.get_skill(db, req.skill_id)
        submitted = _aware(req.created_at)
        items.append(
            QueueItem(
                kind=VISIBILITY,
                id=req.id,
                skill_id=req.skill_id,
                skill_name=skill.name if skill else "?",
                origin=skill.origin if skill else "internal",
                from_visibility=req.from_visibility,
                to_visibility=req.to_visibility,
                submitted_at=submitted,
                assigned_to=req.assigned_to,
                assigned_to_name=_name(db, req.assigned_to),
                overdue=cal.is_overdue(submitted, now, settings.review_overdue_days),
                unassigned_overdue=req.assigned_to is None
                and cal.is_overdue(submitted, now, settings.unassigned_remind_days),
            )
        )
    return sorted(items, key=lambda i: (i.submitted_at, i.id))


def queue(
    db: Session, user: User, settings: Settings, flt: QueueFilter, params: PageParams, now: datetime | None = None
) -> Page[QueueItem]:
    now = now or utcnow()
    items = _build_items(db, settings, calendar_from_settings(settings), now)
    if user.role == Role.REVIEWER.value:
        items = [i for i in items if i.assigned_to == user.id]
    elif flt.reviewer_id is not None:
        items = [i for i in items if i.assigned_to == flt.reviewer_id]
    if flt.kind:
        items = [i for i in items if i.kind == flt.kind]
    if flt.assigned is not None:
        items = [i for i in items if (i.assigned_to is not None) == flt.assigned]
    if flt.overdue is not None:
        items = [i for i in items if (i.overdue or i.unassigned_overdue) == flt.overdue]
    total = len(items)
    page = items[params.offset : params.offset + params.page_size]
    return Page[QueueItem](items=page, total=total, page=params.page, page_size=params.page_size)


# ---- truy cập một mục -------------------------------------------------------------


def load_version(db: Session, user: User, version_id: int):
    found = skills_api.get_version(db, version_id)
    if found is None:
        raise ReviewItemNotFound()
    version, skill = found
    if user.role == Role.REVIEWER.value and version.assigned_to != user.id:
        raise ReviewItemNotFound()  # không lộ việc của người khác
    return version, skill


def load_request(db: Session, user: User, request_id: int) -> VisibilityRequest:
    req = repository.get_request(db, request_id)
    if req is None or (user.role == Role.REVIEWER.value and req.assigned_to != user.id):
        raise ReviewItemNotFound()
    return req


# ---- phân công ---------------------------------------------------------------------


def assign_version(db: Session, manager: User, version_id: int, reviewer_id: int, now: datetime | None = None) -> None:
    found = skills_api.get_version(db, version_id)
    if found is None:
        raise ReviewItemNotFound()
    version, skill = found
    if version.status != VersionStatus.PENDING.value:
        raise NotPending()
    reviewer = _active_reviewer(db, reviewer_id)
    previous = version.assigned_to
    skills_api.assign(version, reviewer.id, manager.id, now or utcnow())
    audit.record(db, manager, "review.assign", "skill_version", version.id,
                 {"skill_id": skill.id, "reviewer_id": reviewer.id, "previous": previous})
    link = f"/reviews/{version.id}"
    notifications.notify(db, [reviewer.id], "review.assigned",
                         f"Bạn được giao duyệt skill {skill.name} {version.version}", link=link)
    if previous and previous != reviewer.id:
        notifications.notify(db, [previous], "review.unassigned",
                             f"Việc duyệt skill {skill.name} {version.version} đã được giao cho người khác")


def unassign_version(db: Session, manager: User, version_id: int) -> None:
    found = skills_api.get_version(db, version_id)
    if found is None:
        raise ReviewItemNotFound()
    version, skill = found
    if version.status != VersionStatus.PENDING.value:
        raise NotPending()
    previous = version.assigned_to
    skills_api.unassign(version)
    audit.record(db, manager, "review.unassign", "skill_version", version.id,
                 {"skill_id": skill.id, "previous": previous})


def assign_request(db: Session, manager: User, request_id: int, reviewer_id: int, now: datetime | None = None) -> None:
    req = repository.get_request(db, request_id)
    if req is None:
        raise ReviewItemNotFound()
    if req.status != RequestStatus.PENDING.value:
        raise NotPending()
    reviewer = _active_reviewer(db, reviewer_id)
    previous = req.assigned_to
    req.assigned_to, req.assigned_by, req.assigned_at = reviewer.id, manager.id, now or utcnow()
    audit.record(db, manager, "visibility.assign", "visibility_request", req.id,
                 {"skill_id": req.skill_id, "reviewer_id": reviewer.id, "previous": previous})
    notifications.notify(db, [reviewer.id], "visibility.assigned",
                         "Bạn được giao duyệt một yêu cầu mở rộng phạm vi xem",
                         link=f"/reviews/visibility/{req.id}")


# ---- quyết định ----------------------------------------------------------------------


def decide_version(
    db: Session,
    storage: BlobStorage,
    reviewer: User,
    version_id: int,
    decision: str,
    comment: str | None,
    now: datetime | None = None,
) -> Review:
    version, skill = load_version(db, reviewer, version_id)
    if version.status != VersionStatus.PENDING.value:
        raise NotPending()
    comment = (comment or "").strip() or None
    if decision == Decision.REJECTED.value and not comment:
        raise CommentRequired()
    now = now or utcnow()
    if decision == Decision.APPROVED.value:
        skills_api.approve(skill, version, storage, now)
    else:
        skills_api.reject(version)
    review = repository.add_review(
        db,
        Review(version_id=version.id, reviewer_id=reviewer.id, decision=decision, comment=comment, decided_at=now),
    )
    audit.record(db, reviewer, f"review.{decision}", "skill_version", version.id,
                 {"skill_id": skill.id, "version": version.version, "comment": comment})
    if decision == Decision.APPROVED.value:
        msg = f"Skill {skill.name} {version.version} đã được duyệt và đăng"
        kind = "review.approved"
    else:
        msg = f"Skill {skill.name} {version.version} bị từ chối: {comment}"
        kind = "review.rejected"
    _notify_owner(db, skill.owner_id, kind, msg, f"/skills/{skill.id}")
    return review


def decide_request(
    db: Session, reviewer: User, request_id: int, decision: str, comment: str | None, now: datetime | None = None
) -> VisibilityRequest:
    req = load_request(db, reviewer, request_id)
    if req.status != RequestStatus.PENDING.value:
        raise NotPending()
    comment = (comment or "").strip() or None
    if decision == Decision.REJECTED.value and not comment:
        raise CommentRequired()
    now = now or utcnow()
    skill = skills_api.get_skill(db, req.skill_id)
    req.status = RequestStatus.APPROVED.value if decision == Decision.APPROVED.value else RequestStatus.REJECTED.value
    req.decided_by, req.decided_at, req.comment = reviewer.id, now, comment
    if decision == Decision.APPROVED.value and skill is not None:
        skills_api.apply_visibility(skill, req.to_visibility, req.to_department)
    audit.record(db, reviewer, f"visibility.{decision}", "visibility_request", req.id,
                 {"skill_id": req.skill_id, "to": req.to_visibility, "comment": comment})
    if skill is not None:
        text = "được áp dụng" if decision == Decision.APPROVED.value else f"bị từ chối: {comment}"
        _notify_owner(db, skill.owner_id, f"visibility.{decision}",
                      f"Yêu cầu đổi phạm vi xem của skill {skill.name} {text}", f"/skills/{skill.id}")
    return req


def create_visibility_request(
    db: Session,
    user: User,
    *,
    skill_id: int,
    skill_name: str,
    from_visibility: str,
    to_visibility: str,
    from_department: str | None,
    to_department: str | None,
) -> VisibilityRequest:
    if repository.pending_request_for_skill(db, skill_id) is not None:
        raise VisibilityRequestExists()
    req = repository.add_request(
        db,
        VisibilityRequest(
            skill_id=skill_id,
            requested_by=user.id,
            from_visibility=from_visibility,
            to_visibility=to_visibility,
            from_department=from_department,
            to_department=to_department,
        ),
    )
    audit.record(db, user, "visibility.request", "visibility_request", req.id,
                 {"skill_id": skill_id, "from": from_visibility, "to": to_visibility})
    notifications.notify_managers(
        db, "visibility.requested", f"Yêu cầu mở rộng phạm vi xem của skill {skill_name} đang chờ phân công",
        link="/admin/assignments",
    )
    return req


def history(db: Session, reviewer: User, params: PageParams) -> Page[HistoryItem]:
    items: list[HistoryItem] = []
    for review in repository.reviews_by_reviewer(db, reviewer.id):
        found = skills_api.get_version(db, review.version_id)
        if found is None:
            continue
        version, skill = found
        items.append(HistoryItem(kind=VERSION, id=version.id, skill_id=skill.id, skill_name=skill.name,
                                 version=version.version, decision=review.decision,
                                 comment=review.comment, decided_at=_aware(review.decided_at)))
    for req in repository.decided_requests_by(db, reviewer.id):
        skill = skills_api.get_skill(db, req.skill_id)
        items.append(HistoryItem(kind=VISIBILITY, id=req.id, skill_id=req.skill_id,
                                 skill_name=skill.name if skill else "?", decision=req.status,
                                 comment=req.comment, decided_at=_aware(req.decided_at or req.created_at)))
    items.sort(key=lambda i: i.decided_at, reverse=True)
    page = items[params.offset : params.offset + params.page_size]
    return Page[HistoryItem](items=page, total=len(items), page=params.page, page_size=params.page_size)


# ---- tác vụ định kỳ (D18, D28) -------------------------------------------------------


def run_scheduled(db: Session, settings: Settings, now: datetime | None = None) -> dict[str, int]:
    """Nhắc Manager việc chưa giao, tự chia việc quá ngưỡng, nhắc việc quá hạn duyệt.

    Idempotent: thông báo có `dedupe_key`, việc đã giao không bị giao lại.
    """
    now = now or utcnow()
    cal = calendar_from_settings(settings)
    summary = {"reminded": 0, "auto_assigned": 0, "overdue_notified": 0}

    def candidates():
        for version, skill in skills_api.pending_versions(db):
            yield (VERSION, version, skill.name, f"{skill.name} {version.version}",
                   _aware(version.submitted_at or version.created_at), f"/reviews/{version.id}")
        for req in repository.pending_requests(db):
            skill = skills_api.get_skill(db, req.skill_id)
            name = skill.name if skill else "?"
            yield (VISIBILITY, req, name, f"yêu cầu đổi phạm vi của {name}", _aware(req.created_at),
                   f"/reviews/visibility/{req.id}")

    for kind, obj, _name_, label, since, link in list(candidates()):
        key = f"{kind}:{obj.id}"
        if obj.assigned_to is None:
            if cal.is_overdue(since, now, settings.unassigned_remind_days):
                summary["reminded"] += notifications.notify_managers(
                    db, "review.unassigned_overdue", f"{label} chưa được phân công người duyệt",
                    link="/admin/assignments", dedupe_key=f"unassigned:{key}")
            if cal.is_overdue(since, now, settings.auto_assign_days):
                reviewer = _least_loaded(db)
                if reviewer is None:
                    notifications.notify_managers(
                        db, "review.no_reviewer", f"Không có Reviewer để tự động giao {label}",
                        link="/admin/assignments", dedupe_key=f"noreviewer:{key}")
                    continue
                if kind == VERSION:
                    skills_api.assign(obj, reviewer.id, None, now)
                else:
                    obj.assigned_to, obj.assigned_by, obj.assigned_at = reviewer.id, None, now
                audit.record(db, None, f"{kind}.auto_assign" if kind == VISIBILITY else "review.auto_assign",
                             "skill_version" if kind == VERSION else "visibility_request", obj.id,
                             {"reviewer_id": reviewer.id})
                notifications.notify(db, [reviewer.id], "review.assigned",
                                     f"Hệ thống giao cho bạn duyệt {label}", link=link)
                notifications.notify_managers(db, "review.auto_assigned",
                                              f"{label} đã được tự động giao cho {reviewer.display_name}",
                                              link="/admin/assignments")
                summary["auto_assigned"] += 1
        elif cal.is_overdue(since, now, settings.review_overdue_days):
            summary["overdue_notified"] += notifications.notify(
                db, [obj.assigned_to], "review.overdue", f"{label} đã quá hạn duyệt",
                link=link, dedupe_key=f"overdue:{key}")
            notifications.notify_managers(db, "review.overdue", f"{label} đã quá hạn duyệt",
                                          link="/admin/assignments", dedupe_key=f"overdue:{key}")
    return summary


def work_summary(db: Session, settings: Settings, now: datetime | None = None) -> dict[str, int]:
    """Số liệu hàng đợi cho bảng điều khiển quản trị."""
    items = _build_items(db, settings, calendar_from_settings(settings), now or utcnow())
    return {
        "pending_total": len(items),
        "unassigned": sum(1 for i in items if i.assigned_to is None),
        "unassigned_overdue": sum(1 for i in items if i.unassigned_overdue),
        "review_overdue": sum(1 for i in items if i.assigned_to is not None and i.overdue),
        "visibility_requests_pending": sum(
            1 for i in items if i.kind == VISIBILITY and i.assigned_to is None
        ),
    }
