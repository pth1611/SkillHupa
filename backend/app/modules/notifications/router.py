from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.core.dependencies import DbSession
from app.core.exceptions import NotFound
from app.modules.auth.dependencies import CurrentUser
from app.modules.notifications import service
from app.modules.notifications.schemas import NotificationOut
from app.shared.pagination import Page, PageParams

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=Page[NotificationOut])
def list_notifications(
    db: DbSession, user: CurrentUser, params: Annotated[PageParams, Depends()], unread: bool = False
) -> Page[NotificationOut]:
    items, total = service.list_for(db, user, unread=unread, params=params)
    return Page[NotificationOut](
        items=[NotificationOut.model_validate(n) for n in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def read(notification_id: int, db: DbSession, user: CurrentUser) -> Response:
    if not service.mark_read(db, user, notification_id):
        raise NotFound("Không tìm thấy thông báo")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def read_all(db: DbSession, user: CurrentUser) -> Response:
    service.mark_all_read(db, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
