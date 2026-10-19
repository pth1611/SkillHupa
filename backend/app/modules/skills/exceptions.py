from app.core.exceptions import AppError, Conflict, NotFound


class SkillNotFound(NotFound):
    code = "SKILL_NOT_FOUND"
    message = "Không tìm thấy skill"


class VersionNotFound(NotFound):
    code = "VERSION_NOT_FOUND"
    message = "Không tìm thấy phiên bản"


class InvalidPackage(AppError):
    status_code = 400
    code = "INVALID_PACKAGE"
    message = "Gói không hợp lệ"


class PackageTooLarge(AppError):
    status_code = 413
    code = "PACKAGE_TOO_LARGE"
    message = "Gói vượt giới hạn kích thước"


class VersionNotEditable(Conflict):
    code = "VERSION_NOT_EDITABLE"
    message = "Chỉ sửa được phiên bản đang ở trạng thái nháp"


class VersionAlreadyExists(Conflict):
    code = "VERSION_ALREADY_EXISTS"
    message = "Phiên bản này đã tồn tại"


class ValidationFailed(AppError):
    status_code = 422
    code = "VALIDATION_FAILED"
    message = "Kiểm tra tự động phát hiện lỗi"


class SubmissionIncomplete(AppError):
    status_code = 422
    code = "SUBMISSION_INCOMPLETE"
    message = "Thiếu thông tin bắt buộc để gửi duyệt"


class VersionNotDownloadable(Conflict):
    code = "VERSION_NOT_DOWNLOADABLE"
    message = "Phiên bản này không còn được phép tải"


class UnknownDepartment(AppError):
    status_code = 400
    code = "UNKNOWN_DEPARTMENT"
    message = "Phòng ban không thuộc danh sách chuẩn"
