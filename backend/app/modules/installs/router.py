from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.dependencies import DbSession
from app.modules.auth.dependencies import CurrentUser
from app.modules.installs import service
from app.modules.installs.schemas import (
    CheckRequest,
    CheckResult,
    InstallItem,
    InstallReport,
    State,
)
from app.shared.pagination import Page, PageParams

router = APIRouter(prefix="/api/installs", tags=["installs"])


@router.get("/me", response_model=Page[InstallItem])
def my_installs(
    db: DbSession,
    user: CurrentUser,
    page: Annotated[PageParams, Depends()],
    state: State | None = None,
) -> Page[InstallItem]:
    items = service.list_mine(db, user, state)
    window = items[page.offset : page.offset + page.page_size]
    return Page(items=window, total=len(items), page=page.page, page_size=page.page_size)


@router.post("", response_model=InstallItem, status_code=status.HTTP_200_OK)
def report_install(body: InstallReport, db: DbSession, user: CurrentUser) -> InstallItem:
    row = service.report_install(db, user, body)
    return next(
        i for i in service.list_mine(db, user, None)
        if i.skill_id == row.skill_id and i.target == row.target
    )


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
def report_uninstall(
    skill_id: int, db: DbSession, user: CurrentUser, target: Annotated[str | None, Query(max_length=16)] = None
) -> Response:
    service.report_uninstall(db, user, skill_id, target)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/check", response_model=list[CheckResult])
def check_installs(body: CheckRequest, db: DbSession, user: CurrentUser) -> list[CheckResult]:
    return service.check(db, user, body.items)
