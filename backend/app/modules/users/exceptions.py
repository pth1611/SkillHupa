from app.core.exceptions import NotFound


class UserNotFound(NotFound):
    code = "USER_NOT_FOUND"
    message = "Không tìm thấy người dùng"
