import os
import re

from dotenv import dotenv_values

from app.core.config import ROOT_ENV_FILE
from app.modules.sources.connectors.base import ConnectorError, SourceConnector
from app.modules.sources.connectors.github import GitHubConnector

SUPPORTED_TYPES = {"github"}
# Chỉ đọc biến môi trường có tiền tố này để khai báo nguồn không trỏ được tới bí mật khác của hệ thống.
CREDENTIAL_PREFIX = "SOURCE_TOKEN_"
CREDENTIAL_RE = re.compile(r"^SOURCE_TOKEN_[A-Z0-9_]{1,80}$")


def _secret(name: str) -> str | None:
    """Giá trị trong .env gốc được ưu tiên (sửa file là có hiệu lực ngay, không bị biến export cũ của shell đè
    lên); không có thì lấy biến môi trường, như khi chạy trong Docker."""
    return dotenv_values(ROOT_ENV_FILE).get(name) or os.environ.get(name) or None


DEFAULT_CREDENTIALS = {"github": "GITHUB_TOKEN"}


def resolve_token(credential_name: str | None, source_type: str | None = None) -> str | None:
    if not credential_name:
        # Nguồn không khai báo bí mật thì dùng token mặc định của loại nguồn (nếu có) để khỏi bị hạn mức ẩn danh.
        default = DEFAULT_CREDENTIALS.get(source_type or "")
        return _secret(default) if default else None
    if not CREDENTIAL_RE.match(credential_name):
        raise ConnectorError("Tên bí mật không hợp lệ")
    token = _secret(credential_name)
    if not token:
        raise ConnectorError(f"Chưa cấu hình bí mật {credential_name}")
    return token


def build_connector(source_type: str, url: str, ref: str | None, credential_name: str | None) -> SourceConnector:
    """Điểm duy nhất tạo bộ kết nối; test thay hàm này bằng bản giả."""
    if source_type == "github":
        return GitHubConnector(url, ref, resolve_token(credential_name, source_type))
    raise ConnectorError(f"Loại nguồn {source_type} chưa được hỗ trợ")
