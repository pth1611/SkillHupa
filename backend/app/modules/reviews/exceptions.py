from app.core.exceptions import AppError, Conflict, NotFound


class ReviewItemNotFound(NotFound):
    code = "REVIEW_ITEM_NOT_FOUND"
    message = "Không tìm thấy mục cần duyệt"


class NotPending(Conflict):
    code = "NOT_PENDING"
    message = "Mục này không còn ở trạng thái chờ duyệt"


class CommentRequired(AppError):
    status_code = 422
    code = "COMMENT_REQUIRED"
    message = "Từ chối phải kèm góp ý"


class InvalidAssignee(AppError):
    status_code = 422
    code = "INVALID_ASSIGNEE"
    message = "Người được giao phải là Reviewer đang hoạt động"


class VisibilityRequestExists(Conflict):
    code = "VISIBILITY_REQUEST_EXISTS"
    message = "Skill đang có yêu cầu đổi phạm vi chờ duyệt"
