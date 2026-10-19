from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from tests.conftest import csrf_headers, login


def test_me_requires_login(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "NOT_AUTHENTICATED"


def test_dev_login_then_me(client):
    created = login(client, "an@example.com", role="creator", department="Kế toán", name="An")
    assert created["role"] == "creator"
    me = client.get("/api/auth/me").json()
    assert me["email"] == "an@example.com"
    assert me["department"] == "Kế toán"
    assert me["display_name"] == "An"


def test_session_cookie_is_httponly_and_csrf_is_readable(client):
    resp = client.post("/api/auth/dev-login", json={"email": "a@example.com"})
    set_cookie = resp.headers.get_list("set-cookie")
    session = next(c for c in set_cookie if c.startswith("skillmkt_session="))
    csrf = next(c for c in set_cookie if c.startswith("skillmkt_csrf="))
    assert "HttpOnly" in session
    assert "HttpOnly" not in csrf
    assert "SameSite=lax" in session


def test_logout_requires_csrf_header(client):
    login(client)
    assert client.post("/api/auth/logout").status_code == 403
    resp = client.post("/api/auth/logout", headers=csrf_headers(client))
    assert resp.status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_inactive_user_is_rejected(client):
    login(client, "x@example.com")
    from app.core.database import get_session_factory
    from app.modules.users.models import User

    with get_session_factory()() as db:
        user = db.query(User).filter_by(email="x@example.com").one()
        user.is_active = False
        db.commit()
    assert client.get("/api/auth/me").status_code == 401


def test_dev_login_disabled_returns_404(make_app):
    app = make_app(DEV_LOGIN_ENABLED="false")
    with TestClient(app) as client:
        resp = client.post("/api/auth/dev-login", json={"email": "a@example.com"})
        assert resp.status_code == 404


def test_bearer_token_path(client, monkeypatch):
    from app.core import security

    claims = {"oid": "oid-1", "email": "Cli@Example.com", "name": "Cli", "groups": ["g-reviewers"]}
    monkeypatch.setattr(security, "verify_access_token", lambda settings, token: claims)
    resp = client.get("/api/auth/me", headers={"Authorization": "Bearer abc"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "cli@example.com"
    assert body["role"] == "reviewer"


def test_bearer_invalid_token_is_401(client, monkeypatch):
    from app.core import security
    from app.core.exceptions import NotAuthenticated

    def boom(settings, token):
        raise NotAuthenticated("Token không hợp lệ")

    monkeypatch.setattr(security, "verify_access_token", boom)
    resp = client.get("/api/auth/me", headers={"Authorization": "Bearer bad"})
    assert resp.status_code == 401


def test_bearer_skips_csrf(client, monkeypatch):
    from app.core import security

    monkeypatch.setattr(
        security, "verify_access_token", lambda s, t: {"oid": "o2", "email": "b@example.com", "name": "B"}
    )
    resp = client.post("/api/auth/logout", headers={"Authorization": "Bearer abc"})
    assert resp.status_code == 204


def test_login_redirects_to_entra_with_pkce(client):
    resp = client.get("/api/auth/login?next=/skills", follow_redirects=False)
    assert resp.status_code == 302
    url = urlparse(resp.headers["location"])
    assert url.netloc == "login.microsoftonline.com"
    qs = parse_qs(url.query)
    assert qs["code_challenge_method"] == ["S256"]
    assert qs["client_id"] == ["client-test"]
    assert "skillmkt_oauth" in resp.headers["set-cookie"]


def test_callback_rejects_bad_state(client):
    resp = client.get("/api/auth/callback?code=abc&state=nope", follow_redirects=False)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_OAUTH_STATE"


def test_callback_happy_path(client, monkeypatch):
    from app.core import security
    from app.modules.auth import service

    login_resp = client.get("/api/auth/login?next=/my-skills", follow_redirects=False)
    state = parse_qs(urlparse(login_resp.headers["location"]).query)["state"][0]

    monkeypatch.setattr(service, "_exchange_code", lambda settings, code, verifier: "id-token")
    monkeypatch.setattr(
        security,
        "verify_id_token",
        lambda settings, token, nonce: {
            "oid": "oid-9",
            "preferred_username": "Mgr@Example.com",
            "name": "Mgr",
            "groups": ["g-managers"],
            "department": "IT",
        },
    )
    resp = client.get(f"/api/auth/callback?code=abc&state={state}", follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/my-skills"
    me = client.get("/api/auth/me").json()
    assert (me["email"], me["role"], me["department"]) == ("mgr@example.com", "manager", "IT")


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, "/"),
        ("", "/"),
        ("/skills/3", "/skills/3"),
        ("//evil.com", "/"),
        ("https://evil.com", "/"),
        ("/\\evil.com", "/"),
    ],
)
def test_safe_next(value, expected):
    from app.modules.auth.service import safe_next

    assert safe_next(value) == expected


def test_cli_config_is_public_and_has_no_secrets(client):
    r = client.get("/api/auth/cli-config")
    assert r.status_code == 200
    body = r.json()
    assert body["tenant_id"] == "tenant-test" and body["client_id"] == "client-test"
    assert body["scope"] == "api://client-test/.default"
    assert body["dev_login"] is True
    assert "secret" not in str(body).lower()
