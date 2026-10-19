from app.core.exceptions import AppError, Conflict


class InvalidOwner(AppError):
    status_code = 400
    code = "INVALID_OWNER"
    message = "Người nhận quyền sở hữu phải là Creator đang hoạt động"


class SkillNotRemovable(Conflict):
    code = "SKILL_NOT_REMOVABLE"
    message = "Chỉ gỡ được skill đang ở trạng thái đã đăng"


class SkillNotRestorable(Conflict):
    code = "SKILL_NOT_RESTORABLE"
    message = "Chỉ khôi phục được skill đã bị gỡ và còn ít nhất một phiên bản đang đăng"


class VersionNotRevocable(Conflict):
    code = "VERSION_NOT_REVOCABLE"
    message = "Chỉ thu hồi được phiên bản đang đăng"


class LastPublishedVersion(Conflict):
    code = "LAST_PUBLISHED_VERSION"
    message = "Đây là phiên bản đang đăng cuối cùng; hãy gỡ skill thay vì thu hồi"


class ImportedSkillHasNoOwner(Conflict):
    code = "IMPORTED_SKILL_NO_OWNER"
    message = "Skill thu thập từ nguồn ngoài không có chủ cá nhân"


class TagNotFound(AppError):
    status_code = 404
    code = "TAG_NOT_FOUND"
    message = "Không tìm thấy tag"


class TagExists(Conflict):
    code = "TAG_EXISTS"
    message = "Tag đã tồn tại"


class TagStateInvalid(Conflict):
    code = "TAG_STATE_INVALID"
    message = "Trạng thái tag không cho phép thao tác này"


class TagInUse(Conflict):
    code = "TAG_IN_USE"
    message = "Tag còn đang được gắn cho skill"


class InvalidMerge(AppError):
    status_code = 400
    code = "INVALID_MERGE"
    message = "Yêu cầu gộp tag không hợp lệ"


class ExportTooLarge(AppError):
    status_code = 413
    code = "EXPORT_TOO_LARGE"
    message = "Quá nhiều dòng để xuất; hãy thu hẹp bộ lọc hoặc khoảng thời gian"
