import logging
import uuid
from datetime import timedelta
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import Settings
from app.core.exceptions import NotFound
from app.modules.auth.exceptions import (
    AccountDisabled,
    InvalidOAuthState,
    SsoNotConfigured,
    TokenExchangeFailed,
)
from app.modules.auth.schemas import DevLoginRequest
from app.modules.users import service as users_service
from app.modules.users.models import User
from app.modules.users.schemas import UserProfile

logger = logging.getLogger(__name__)

SESSION_COOKIE = "skillmkt_session"
CSRF_COOKIE = "skillmkt_csrf"
OAUTH_COOKIE = "skillmkt_oauth"
OAUTH_TTL = timedelta(minutes=10)


def safe_next(value: str | None) -> str:
    """Chỉ cho chuyển hướng tới đường dẫn nội bộ, chống open redirect."""
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return "/"
    return value


def profile_from_claims(claims: dict) -> UserProfile:
    oid = claims.get("oid") or claims.get("sub")
    if not oid:
        raise InvalidOAuthState("Token thiếu định danh người dùng")
    email = claims.get("email") or claims.get("preferred_username") or claims.get("upn") or ""
    if "groups" not in claims and "groups" in (claims.get("_claim_names") or {}):
        # Vượt quá số nhóm trong token (groups overage): cần gọi Microsoft Graph.
        logger.warning("Token Entra bị groups overage, chưa hỗ trợ gọi Graph; coi như không có nhóm")
    return UserProfile(
        oid=str(oid),
        email=str(email).lower(),
        display_name=str(claims.get("name") or email or oid),
        groups=[str(g) for g in claims.get("groups", [])],
        department=claims.get("department"),
    )


def start_login(settings: Settings, next_url: str | None) -> tuple[str, str]:
    """Trả (URL chuyển hướng sang Entra, cookie trạng thái đã ký)."""
    if not settings.entra_configured:
        raise SsoNotConfigured()
    state = uuid.uuid4().hex
    nonce = uuid.uuid4().hex
    verifier, challenge = security.new_pkce_pair()
    params = {
        "client_id": settings.entra_client_id,
        "response_type": "code",
        "redirect_uri": settings.entra_redirect_uri,
        "response_mode": "query",
        "scope": "openid profile email",
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    url = f"{settings.entra_authority}/oauth2/v2.0/authorize?{urlencode(params)}"
    cookie = security.create_signed_token(
        {"state": state, "nonce": nonce, "verifier": verifier, "next": safe_next(next_url)},
        settings.session_secret.get_secret_value(),
        OAUTH_TTL,
    )
    return url, cookie


def _exchange_code(settings: Settings, code: str, verifier: str) -> str:
    data = {
        "client_id": settings.entra_client_id,
        "client_secret": settings.entra_client_secret.get_secret_value(),
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.entra_redirect_uri,
        "code_verifier": verifier,
        "scope": "openid profile email",
    }
    try:
        resp = httpx.post(f"{settings.entra_authority}/oauth2/v2.0/token", data=data, timeout=10)
    except httpx.HTTPError as exc:
        logger.warning("Không gọi được Entra ID: %s", type(exc).__name__)
        raise TokenExchangeFailed() from exc
    if resp.status_code != 200:
        logger.warning("Entra trả mã %s khi đổi code", resp.status_code)
        raise TokenExchangeFailed()
    id_token = resp.json().get("id_token")
    if not id_token:
        raise TokenExchangeFailed()
    return id_token


def complete_login(
    db: Session, settings: Settings, *, code: str, state: str, state_cookie: str | None
) -> tuple[User, str]:
    """Hoàn tất luồng code; trả (user, đường dẫn quay lại)."""
    payload = (
        security.decode_signed_token(state_cookie, settings.session_secret.get_secret_value())
        if state_cookie
        else None
    )
    if not payload or not security.tokens_match(payload.get("state"), state):
        raise InvalidOAuthState()
    id_token = _exchange_code(settings, code, payload["verifier"])
    claims = security.verify_id_token(settings, id_token, payload["nonce"])
    user = _login_user(db, settings, profile_from_claims(claims))
    return user, safe_next(payload.get("next"))


def _login_user(db: Session, settings: Settings, profile: UserProfile) -> User:
    user = users_service.sync_from_profile(db, profile, settings)
    if not user.is_active:
        raise AccountDisabled()
    users_service.record_login(user)
    return user


def user_from_bearer_claims(db: Session, settings: Settings, claims: dict) -> User:
    """Đường Bearer (CLI): đồng bộ user từ claim, không ghi last_login."""
    user = users_service.sync_from_profile(db, profile_from_claims(claims), settings)
    if not user.is_active:
        raise AccountDisabled()
    return user


def issue_session(user: User, settings: Settings) -> tuple[str, str]:
    """Trả (token phiên đã ký, token CSRF)."""
    ttl = timedelta(hours=settings.session_ttl_hours)
    token = security.create_signed_token(
        {"sub": str(user.id)}, settings.session_secret.get_secret_value(), ttl
    )
    return token, security.new_csrf_token()


def user_id_from_session(settings: Settings, token: str) -> int | None:
    payload = security.decode_signed_token(token, settings.session_secret.get_secret_value())
    if not payload:
        return None
    try:
        return int(payload["sub"])
    except (KeyError, ValueError):
        return None


def dev_login(db: Session, settings: Settings, req: DevLoginRequest) -> User:
    if not settings.dev_login_enabled or settings.environment == "production":
        raise NotFound()
    email = req.email.lower()
    oid = f"dev-{email}"
    # Gán vai trò trực tiếp (bỏ qua nhóm Entra) chỉ ở chế độ dev.
    profile = UserProfile(
        oid=oid, email=email, display_name=req.display_name or email, department=req.department
    )
    user = users_service.sync_from_profile(db, profile, settings)
    user.role = req.role.value
    users_service.record_login(user)
    return user
