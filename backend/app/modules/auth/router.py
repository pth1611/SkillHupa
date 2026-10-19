from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import RedirectResponse

from app.core.config import Settings
from app.core.dependencies import DbSession, SettingsDep
from app.modules.auth import service
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.schemas import DevLoginRequest
from app.modules.auth.service import CSRF_COOKIE, OAUTH_COOKIE, SESSION_COOKIE
from app.modules.notifications import service as notifications
from app.modules.users.models import User
from app.modules.users.schemas import MeOut, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_session_cookies(response: Response, user: User, settings: Settings) -> None:
    session_token, csrf_token = service.issue_session(user, settings)
    max_age = int(timedelta(hours=settings.session_ttl_hours).total_seconds())
    common = {"max_age": max_age, "secure": settings.cookie_secure, "samesite": "lax", "path": "/"}
    response.set_cookie(SESSION_COOKIE, session_token, httponly=True, **common)
    # Cookie CSRF cho JavaScript đọc để gửi lại qua header X-CSRF-Token.
    response.set_cookie(CSRF_COOKIE, csrf_token, httponly=False, **common)


@router.get("/cli-config")
def cli_config(settings: SettingsDep) -> dict[str, str | bool]:
    """Thông tin công khai để CLI đăng nhập bằng device code (không có bí mật)."""
    scope = settings.entra_cli_scope or (
        f"{settings.entra_api_audience}/.default" if settings.entra_api_audience else ""
    )
    return {
        "tenant_id": settings.entra_tenant_id,
        "client_id": settings.entra_cli_client_id or settings.entra_client_id,
        "scope": scope,
        "sso_configured": settings.entra_configured,
        "dev_login": settings.dev_login_enabled,
    }


@router.get("/login")
def login(settings: SettingsDep, next: Annotated[str | None, Query()] = None) -> RedirectResponse:
    url, state_cookie = service.start_login(settings, next)
    response = RedirectResponse(url, status_code=status.HTTP_302_FOUND)
    response.set_cookie(
        OAUTH_COOKIE,
        state_cookie,
        max_age=int(service.OAUTH_TTL.total_seconds()),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/api/auth",
    )
    return response


@router.get("/callback")
def callback(
    request: Request,
    db: DbSession,
    settings: SettingsDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    if error or not code or not state:
        return RedirectResponse("/login?error=sso", status_code=status.HTTP_303_SEE_OTHER)
    user, next_url = service.complete_login(
        db, settings, code=code, state=state, state_cookie=request.cookies.get(OAUTH_COOKIE)
    )
    response = RedirectResponse(next_url, status_code=status.HTTP_303_SEE_OTHER)
    _set_session_cookies(response, user, settings)
    response.delete_cookie(OAUTH_COOKIE, path="/api/auth")
    return response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(_: CurrentUser) -> Response:
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return response


@router.get("/me", response_model=MeOut)
def me(user: CurrentUser, db: DbSession) -> MeOut:
    out = MeOut.model_validate(user)
    out.unread_notifications = notifications.unread_count(db, user)
    return out


@router.post("/dev-login", response_model=UserOut, include_in_schema=False)
def dev_login(
    body: DevLoginRequest, response: Response, db: DbSession, settings: SettingsDep
) -> User:
    """Chỉ dùng khi phát triển cục bộ/test; trả 404 nếu DEV_LOGIN_ENABLED tắt."""
    user = service.dev_login(db, settings, body)
    db.flush()
    _set_session_cookies(response, user, settings)
    return user
