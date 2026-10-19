from datetime import date
from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+psycopg://skillmkt:skillmkt@localhost:5432/skillmkt"

    # Phiên của website (cookie)
    session_secret: SecretStr
    session_ttl_hours: int = 8
    cookie_secure: bool = True

    # Microsoft Entra ID
    entra_tenant_id: str = ""
    entra_client_id: str = ""
    entra_client_secret: SecretStr = SecretStr("")
    entra_api_audience: str = ""
    # App registration (public client, bật device code) của CLI và scope CLI xin token
    entra_cli_client_id: str = ""
    entra_cli_scope: str = ""
    entra_redirect_uri: str = "http://localhost:5173/api/auth/callback"

    # Object ID của nhóm Entra tương ứng với từng vai trò (D2)
    entra_group_managers: str = ""
    entra_group_reviewers: str = ""
    entra_group_creators: str = ""

    # Lịch ngày làm việc (D31) và ngưỡng duyệt (D18, D28)
    work_timezone: str = "Asia/Ho_Chi_Minh"
    work_saturday_anchor: date | None = None  # một thứ bảy làm việc; các thứ bảy làm việc cách nhau 14 ngày
    work_holidays: str = ""  # các ngày lễ dạng YYYY-MM-DD, phân tách bằng dấu phẩy
    review_overdue_days: int = 5
    unassigned_remind_days: int = 1
    auto_assign_days: int = 3

    # Thu thập skill từ nguồn ngoài (D46): khoảng cách giữa hai lần quét tự động
    source_scan_interval_hours: int = 24

    # Dọn dẹp định kỳ: bản nháp không được gửi duyệt quá lâu bị xoá (có thông báo trước),
    # nhật ký kiểm toán quá hạn lưu bị xoá (D33)
    draft_retention_days: int = 30
    draft_warn_days: int = 7
    audit_retention_years: int = 3

    # Danh sách phòng ban chuẩn (phân tách bằng dấu phẩy); rỗng = không ràng buộc
    standard_departments: str = ""

    # Lưu trữ gói và ảnh (Blob Storage ở production, thư mục cục bộ khi dev/test)
    storage_backend: Literal["local", "azure"] = "local"
    storage_dir: str = ".data/blobs"
    # Azure: dev/Azurite dùng connection string; production dùng account URL + Managed Identity
    azure_storage_connection_string: SecretStr = SecretStr("")
    azure_storage_account_url: str = ""
    azure_storage_container: str = "skills"
    download_url_ttl_minutes: int = 10

    # Giới hạn tải lên (D15); quy tắc chi tiết nằm trong validation_rules.yaml (D32)
    max_package_bytes: int = 10 * 1024 * 1024
    max_icon_bytes: int = 512 * 1024

    # Chỉ cho phát triển cục bộ và test
    dev_login_enabled: bool = False

    @model_validator(mode="after")
    def _check_production(self) -> "Settings":
        if self.environment == "production":
            if self.dev_login_enabled:
                raise ValueError("DEV_LOGIN_ENABLED không được bật ở production")
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE phải bật ở production")
        if self.storage_backend == "azure" and not (
            self.azure_storage_connection_string.get_secret_value() or self.azure_storage_account_url
        ):
            raise ValueError("STORAGE_BACKEND=azure cần AZURE_STORAGE_ACCOUNT_URL hoặc AZURE_STORAGE_CONNECTION_STRING")
        if self.environment == "production" and self.storage_backend != "azure":
            raise ValueError("Production phải dùng STORAGE_BACKEND=azure (thư mục cục bộ mất khi container khởi động lại)")
        if len(self.session_secret.get_secret_value()) < 32:
            raise ValueError("SESSION_SECRET phải dài ít nhất 32 ký tự")
        return self

    @property
    def department_list(self) -> list[str]:
        return [d.strip() for d in self.standard_departments.split(",") if d.strip()]

    @property
    def entra_authority(self) -> str:
        return f"https://login.microsoftonline.com/{self.entra_tenant_id}"

    @property
    def entra_issuer(self) -> str:
        return f"{self.entra_authority}/v2.0"

    @property
    def entra_jwks_uri(self) -> str:
        return f"{self.entra_authority}/discovery/v2.0/keys"

    @property
    def entra_configured(self) -> bool:
        return bool(self.entra_tenant_id and self.entra_client_id)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
