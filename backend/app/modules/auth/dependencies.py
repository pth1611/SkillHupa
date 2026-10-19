from typing import Annotated

from fastapi import Depends, Request

from app.core import security
from app.core.dependencies import DbSession, SettingsDep
from app.core.exceptions import Forbidden, NotAuthenticated
from app.modules.auth import service
from app.modules.auth.service import CSRF_COOKIE, SESSION_COOKIE
from app.modules.users import service as users_service
from app.modules.users.models import Role, User

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_HEADER = "x-csrf-token"


def get_current_user(request: Request, db: DbSession, settings: SettingsDep) -> User:
    """Xác thực bằng Bearer (CLI) hoặc cookie phiên (website); xem architecture.md, mục 4."""
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        claims = security.verify_access_token(settings, header[7:].strip())
        return service.user_from_bearer_claims(db, settings, claims)

    session = request.cookies.get(SESSION_COOKIE)
    if not session:
        raise NotAuthenticated()
    user_id = service.user_id_from_session(settings, session)
    if user_id is None:
        raise NotAuthenticated()

    if request.method not in SAFE_METHODS and not security.tokens_match(
        request.headers.get(CSRF_HEADER), request.cookies.get(CSRF_COOKIE)
    ):
        raise Forbidden("Thiếu hoặc sai CSRF token")

    user = users_service.find_user(db, user_id)
    if user is None or not user.is_active:
        raise NotAuthenticated()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: Role):
    allowed = {r.value for r in roles}

    def dependency(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise Forbidden()
        return user

    return dependency
