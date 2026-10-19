from fastapi import FastAPI, Response, status
from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import get_session_factory
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging
from app.modules.admin.router import router as admin_router
from app.modules.auth.router import router as auth_router
from app.modules.installs.router import router as installs_router
from app.modules.notifications.router import router as notifications_router
from app.modules.reviews.router import router as reviews_router
from app.modules.skills.router import catalog_router
from app.modules.skills.router import router as skills_router
from app.modules.sources.router import router as sources_router
from app.modules.users.router import router as users_router


def create_app() -> FastAPI:
    settings = get_settings()  # kiểm tra cấu hình ngay khi khởi động
    configure_logging()

    app = FastAPI(
        title="Skill Marketplace API",
        docs_url=None if settings.environment == "production" else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.environment == "production" else "/api/openapi.json",
    )
    register_exception_handlers(app)

    @app.get("/api/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/health/ready", tags=["system"])
    def ready(response: Response) -> dict[str, str]:
        try:
            with get_session_factory()() as db:
                db.execute(text("SELECT 1"))
        except Exception:  # noqa: BLE001  (mọi lỗi kết nối đều là 'chưa sẵn sàng')
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return {"status": "unavailable", "database": "down"}
        return {"status": "ok", "database": "up"}

    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(skills_router)
    app.include_router(catalog_router)
    app.include_router(admin_router)
    app.include_router(sources_router)
    app.include_router(installs_router)
    app.include_router(reviews_router)
    app.include_router(notifications_router)
    return app


app = create_app()
