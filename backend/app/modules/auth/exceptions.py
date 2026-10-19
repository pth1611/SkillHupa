from app.core.exceptions import AppError, Forbidden


class InvalidOAuthState(AppError):
    status_code = 400
    code = "INVALID_OAUTH_STATE"
    message = "Phiên đăng nhập không hợp lệ hoặc đã hết hạn, hãy thử lại"


class AccountDisabled(Forbidden):
    code = "ACCOUNT_DISABLED"
    message = "Tài khoản đã bị vô hiệu hoá"


class SsoNotConfigured(AppError):
    status_code = 503
    code = "SSO_NOT_CONFIGURED"
    message = "Chưa cấu hình đăng nhập Entra ID"


class TokenExchangeFailed(AppError):
    status_code = 502
    code = "TOKEN_EXCHANGE_FAILED"
    message = "Không thể hoàn tất đăng nhập với Entra ID"
