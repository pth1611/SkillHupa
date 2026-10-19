from app.core.exceptions import AppError, Conflict, NotFound


class InstallNotFound(NotFound):
    code = "INSTALL_NOT_FOUND"
    message = "Không có bản ghi cài đặt"


class InvalidTarget(AppError):
    status_code = 400
    code = "INVALID_TARGET"
    message = "Công cụ đích không hợp lệ"


class VersionNotInstallable(Conflict):
    code = "VERSION_NOT_INSTALLABLE"
    message = "Phiên bản này không còn được phép cài"
