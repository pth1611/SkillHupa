from collections.abc import Iterable

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.modules.notifications.models import Notification
from app.modules.users import service as users_service
from app.modules.users.models import Role, User
from app.shared.pagination import PageParams


def notify(
    db: Session,
    user_ids: Iterable[int],
    type_: str,
    message: str,
    *,
    link: str | None = None,
    dedupe_key: str | None = None,
) -> int:
    """Tạo thông báo cho nhiều người; bỏ qua người đã nhận cùng `dedupe_key`. Trả số thông báo mới."""
    created = 0
    for user_id in dict.fromkeys(user_ids):
        if dedupe_key:
            exists = db.scalar(
                select(Notification.id).where(
                    Notification.user_id == user_id, Notification.dedupe_key == dedupe_key
                )
            )
            if exists:
                continue
        db.add(
            Notification(
                user_id=user_id, type=type_, message=message[:500], link=link, dedupe_key=dedupe_key
            )
        )
        created += 1
    db.flush()
    return created


def notify_managers(db: Session, type_: str, message: str, **kwargs) -> int:
    managers = users_service.active_by_role(db, Role.MANAGER)
    return notify(db, [m.id for m in managers], type_, message, **kwargs)


def unread_count(db: Session, user: User) -> int:
    stmt = select(func.count()).select_from(Notification).where(
        Notification.user_id == user.id, Notification.is_read.is_(False)
    )
    return db.scalar(stmt) or 0


def list_for(db: Session, user: User, *, unread: bool, params: PageParams) -> tuple[list[Notification], int]:
    base = select(Notification).where(Notification.user_id == user.id)
    if unread:
        base = base.where(Notification.is_read.is_(False))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = list(
        db.scalars(base.order_by(Notification.created_at.desc(), Notification.id.desc()).offset(params.offset).limit(params.page_size))
    )
    return items, total


def mark_read(db: Session, user: User, notification_id: int) -> bool:
    result = db.execute(
        update(Notification)
        .where(Notification.id == notification_id, Notification.user_id == user.id)
        .values(is_read=True)
    )
    return result.rowcount > 0


def mark_all_read(db: Session, user: User) -> None:
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
