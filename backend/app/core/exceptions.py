import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Lỗi nghiệp vụ gốc; module kế thừa và đặt status_code/code riêng."""

    status_code = 400
    code = "BAD_REQUEST"
    message = "Yêu cầu không hợp lệ"

    def __init__(self, message: str | None = None, details: dict[str, Any] | None = None):
        super().__init__(message or self.message)
        self.message = message or self.message
        self.details = details or {}


class NotAuthenticated(AppError):
    status_code = 401
    code = "NOT_AUTHENTICATED"
    message = "Chưa đăng nhập hoặc phiên đã hết hạn"


class Forbidden(AppError):
    status_code = 403
    code = "FORBIDDEN"
    message = "Bạn không có quyền thực hiện thao tác này"


class NotFound(AppError):
    status_code = 404
    code = "NOT_FOUND"
    message = "Không tìm thấy"


class Conflict(AppError):
    status_code = 409
    code = "CONFLICT"
    message = "Trạng thái hiện tại không cho phép thao tác này"


def error_body(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, exc.message, exc.details), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [
            {"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]}
            for e in exc.errors()
        ]
        return JSONResponse(
            error_body("VALIDATION_ERROR", "Dữ liệu không hợp lệ", {"fields": fields}),
            status_code=400,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        return JSONResponse(error_body(code, str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Lỗi không xử lý", exc_info=exc)
        return JSONResponse(error_body("INTERNAL_ERROR", "Lỗi hệ thống"), status_code=500)
