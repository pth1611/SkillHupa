from app.core.exceptions import AppError, Conflict, NotFound


class SourceNotFound(NotFound):
    code = "SOURCE_NOT_FOUND"
    message = "Không tìm thấy nguồn"


class SourceExists(Conflict):
    code = "SOURCE_EXISTS"
    message = "Nguồn này đã được khai báo"


class InvalidSource(AppError):
    status_code = 400
    code = "INVALID_SOURCE"
    message = "Khai báo nguồn không hợp lệ"


class ScanInProgress(Conflict):
    code = "SCAN_IN_PROGRESS"
    message = "Nguồn đang được quét"
