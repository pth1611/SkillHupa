import os
import tempfile
from pathlib import Path

import pytest

_DB_DIR = tempfile.mkdtemp(prefix="skillmkt-test-")

# Phải đặt trước khi import app (Settings được đọc lúc khởi động).
os.environ.update(
    ENVIRONMENT="test",
    # TEST_DATABASE_URL cho phép chạy cả bộ test trên PostgreSQL thật (xem README).
    DATABASE_URL=os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{Path(_DB_DIR) / 'test.db'}",
    STORAGE_DIR=str(Path(_DB_DIR) / "blobs"),
    SESSION_SECRET="test-secret-test-secret-test-secret-0123456789",
    COOKIE_SECURE="false",
    DEV_LOGIN_ENABLED="true",
    ENTRA_TENANT_ID="tenant-test",
    ENTRA_CLIENT_ID="client-test",
    ENTRA_CLIENT_SECRET="secret-test",
    ENTRA_API_AUDIENCE="api://client-test",
    ENTRA_REDIRECT_URI="http://testserver/api/auth/callback",
    ENTRA_GROUP_MANAGERS="g-managers",
    ENTRA_GROUP_REVIEWERS="g-reviewers",
    ENTRA_GROUP_CREATORS="g-creators",
)


def _reset_app_state() -> None:
    from app.core import config, database

    config.get_settings.cache_clear()
    from app.core import storage

    storage.get_storage.cache_clear()
    database.get_engine.cache_clear()
    database.get_session_factory.cache_clear()


@pytest.fixture
def app():
    _reset_app_state()
    import app.db_models  # noqa: F401
    from app.core.database import Base, get_engine
    from app.main import create_app

    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    return create_app()


@pytest.fixture
def client(app):
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c


def login(client, email="a@example.com", role="user", department=None, name=None):
    resp = client.post(
        "/api/auth/dev-login",
        json={"email": email, "role": role, "department": department, "display_name": name},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def csrf_headers(client) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies.get("skillmkt_csrf", "")}


@pytest.fixture
def make_app(monkeypatch):
    """Tạo app với biến môi trường tuỳ chỉnh (ví dụ tắt dev login)."""

    def factory(**env: str):
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        _reset_app_state()
        from app import main
        from app.core.database import Base, get_engine

        Base.metadata.create_all(get_engine())
        return main.create_app()

    return factory
