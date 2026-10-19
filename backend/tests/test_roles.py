import pytest

from app.core.config import Settings
from app.modules.users.models import Role
from app.modules.users.service import derive_role


@pytest.fixture
def settings():
    return Settings(
        session_secret="x" * 40,
        entra_group_managers="g-m",
        entra_group_reviewers="g-r",
        entra_group_creators="g-c",
    )


def test_no_groups_is_user(settings):
    assert derive_role([], settings) is Role.USER
    assert derive_role(["unrelated"], settings) is Role.USER


def test_single_group(settings):
    assert derive_role(["g-c"], settings) is Role.CREATOR
    assert derive_role(["g-r"], settings) is Role.REVIEWER
    assert derive_role(["g-m"], settings) is Role.MANAGER


def test_highest_role_wins(settings):
    assert derive_role(["g-c", "g-r"], settings) is Role.REVIEWER
    assert derive_role(["g-c", "g-m", "g-r"], settings) is Role.MANAGER


def test_unconfigured_group_never_matches_empty_string():
    s = Settings(session_secret="x" * 40)
    assert derive_role([""], s) is Role.USER


def test_role_follows_group_changes(client, monkeypatch):
    from app.core import security

    claims = {"oid": "o1", "email": "a@example.com", "name": "A", "groups": ["g-creators"]}
    monkeypatch.setattr(security, "verify_access_token", lambda s, t: dict(claims))
    h = {"Authorization": "Bearer t"}
    assert client.get("/api/auth/me", headers=h).json()["role"] == "creator"
    claims["groups"] = []
    assert client.get("/api/auth/me", headers=h).json()["role"] == "user"


def test_production_rejects_dev_login():
    with pytest.raises(ValueError):
        Settings(
            session_secret="x" * 40,
            environment="production",
            dev_login_enabled=True,
            cookie_secure=True,
        )


def test_short_session_secret_is_rejected():
    with pytest.raises(ValueError):
        Settings(session_secret="short")
