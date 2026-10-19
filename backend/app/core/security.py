"""Ký/kiểm tra token phiên và token Entra ID. Không import từ `modules/`."""
import base64
import hashlib
import hmac
import secrets
from datetime import timedelta
from functools import lru_cache
from typing import Any

import jwt
from jwt import PyJWKClient

from app.core.config import Settings
from app.core.exceptions import NotAuthenticated
from app.shared.utils import utcnow

_SIGNED_ALG = "HS256"


def create_signed_token(payload: dict[str, Any], secret: str, ttl: timedelta) -> str:
    now = utcnow()
    body = {**payload, "iat": now, "exp": now + ttl}
    return jwt.encode(body, secret, algorithm=_SIGNED_ALG)


def decode_signed_token(token: str, secret: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, secret, algorithms=[_SIGNED_ALG], options={"require": ["exp"]})
    except jwt.PyJWTError:
        return None


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def tokens_match(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    return hmac.compare_digest(a.encode(), b.encode())


def new_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


@lru_cache
def _jwks_client(jwks_uri: str) -> PyJWKClient:
    # PyJWKClient cache khoá công khai; khi Entra lỗi vẫn dùng khoá đã cache (D23).
    return PyJWKClient(jwks_uri, cache_keys=True, lifespan=3600)


def _verify_entra_token(
    settings: Settings, token: str, *, audience: str, nonce: str | None = None
) -> dict[str, Any]:
    if not settings.entra_configured:
        raise NotAuthenticated("Chưa cấu hình đăng nhập Entra ID")
    try:
        key = _jwks_client(settings.entra_jwks_uri).get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=audience,
            issuer=settings.entra_issuer,
            options={"require": ["exp", "iat", "iss", "aud"]},
        )
    except jwt.PyJWTError as exc:
        raise NotAuthenticated("Token không hợp lệ") from exc
    if nonce is not None and not hmac.compare_digest(str(claims.get("nonce", "")), nonce):
        raise NotAuthenticated("Token không hợp lệ")
    return claims


def verify_id_token(settings: Settings, token: str, nonce: str) -> dict[str, Any]:
    return _verify_entra_token(settings, token, audience=settings.entra_client_id, nonce=nonce)


def verify_access_token(settings: Settings, token: str) -> dict[str, Any]:
    """Access token do CLI gửi lên (audience là API của website)."""
    audience = settings.entra_api_audience or settings.entra_client_id
    return _verify_entra_token(settings, token, audience=audience)
