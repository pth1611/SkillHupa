"""Lưu trữ nhị phân (gói .zip, ảnh): thư mục cục bộ cho dev/test, Azure Blob Storage ở production.

Hai bản cùng giao diện `BlobStorage`. Tải gói cho người dùng đi qua `presign`: Azure trả SAS URL
ngắn hạn (chỉ đọc) để trình duyệt/CLI tải thẳng từ Blob; bản cục bộ trả `None` và backend tự phát file.
"""
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PresignedUrl:
    url: str
    expires_at: datetime


class BlobStorage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...
    def presign(self, key: str, *, filename: str, ttl: timedelta) -> PresignedUrl | None: ...


class LocalStorage:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("Khoá lưu trữ không hợp lệ")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def presign(self, key: str, *, filename: str, ttl: timedelta) -> PresignedUrl | None:
        return None  # không có URL ký sẵn; backend tự phát file


class AzureBlobStorage:
    """Azure Blob Storage. Dev/Azurite dùng connection string (khoá tài khoản); production dùng
    Managed Identity và ký SAS bằng user delegation key nên không có khoá nào nằm trong cấu hình."""

    def __init__(self, service, container: str, *, account_key: str | None = None):
        from azure.storage.blob import BlobServiceClient

        self._service: BlobServiceClient = service
        self._container = container
        self._client = service.get_container_client(container)
        self._account_key = account_key
        self._delegation = None  # (key, hết hạn) được dùng lại cho nhiều lần ký

    @classmethod
    def from_settings(cls, settings: Settings) -> "AzureBlobStorage":
        from azure.storage.blob import BlobServiceClient

        conn = settings.azure_storage_connection_string.get_secret_value()
        if conn:
            service = BlobServiceClient.from_connection_string(conn)
            key = getattr(service.credential, "account_key", None)
            return cls(service, settings.azure_storage_container, account_key=key)
        from azure.identity import DefaultAzureCredential

        service = BlobServiceClient(settings.azure_storage_account_url, credential=DefaultAzureCredential())
        return cls(service, settings.azure_storage_container)

    def ensure_container(self) -> None:
        from azure.core.exceptions import HttpResponseError

        try:
            self._client.create_container()
        except HttpResponseError:
            # Đã tồn tại (409), hoặc danh tính không có quyền tạo container: IaC lo việc này.
            logger.info("Không tạo container %s (đã có hoặc không đủ quyền)", self._container)

    def put(self, key: str, data: bytes) -> None:
        self._client.upload_blob(key, data, overwrite=True)

    def get(self, key: str) -> bytes:
        return self._client.download_blob(key).readall()

    def delete(self, key: str) -> None:
        from azure.core.exceptions import ResourceNotFoundError

        try:
            self._client.delete_blob(key)
        except ResourceNotFoundError:
            pass

    def exists(self, key: str) -> bool:
        return self._client.get_blob_client(key).exists()

    def _delegation_key(self, now: datetime):
        if self._delegation is None or self._delegation[1] - now < timedelta(minutes=30):
            expiry = now + timedelta(hours=1)
            key = self._service.get_user_delegation_key(now - timedelta(minutes=5), expiry)
            self._delegation = (key, expiry)
        return self._delegation[0]

    def presign(self, key: str, *, filename: str, ttl: timedelta) -> PresignedUrl | None:
        from azure.storage.blob import BlobSasPermissions, generate_blob_sas

        now = datetime.now(UTC)
        expires = now + ttl
        blob = self._client.get_blob_client(key)
        common = {
            "account_name": self._service.account_name,
            "container_name": self._container,
            "blob_name": key,
            "permission": BlobSasPermissions(read=True),
            "start": now - timedelta(minutes=5),  # chịu lệch đồng hồ
            "expiry": expires,
            "content_disposition": f'attachment; filename="{filename}"',
        }
        if self._account_key:
            sas = generate_blob_sas(account_key=self._account_key, **common)
        else:
            sas = generate_blob_sas(user_delegation_key=self._delegation_key(now), **common)
        return PresignedUrl(f"{blob.url}?{sas}", expires)


@lru_cache
def get_storage() -> BlobStorage:
    settings = get_settings()
    if settings.storage_backend == "azure":
        storage = AzureBlobStorage.from_settings(settings)
        storage.ensure_container()
        return storage
    return LocalStorage(settings.storage_dir)
