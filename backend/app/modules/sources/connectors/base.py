"""Giao diện bộ kết nối nguồn. Bộ kết nối chỉ tải file về, không bao giờ chạy mã của nguồn (D45)."""
from dataclasses import dataclass
from typing import Protocol


class ConnectorError(Exception):
    """Lỗi tạm thời hoặc quyền truy cập: ghi `last_scan_status = error`, không đổi trạng thái skill (D51)."""


@dataclass
class RepoInfo:
    commit: str
    archived: bool = False
    license: str | None = None  # mã SPDX, None nếu không có/không xác định
    semver_tag: str | None = None  # tag semver trỏ đúng commit đang quét (D49)


@dataclass
class RemoteFile:
    path: str  # tương đối so với gốc repo
    size: int


class SourceConnector(Protocol):
    def repo_info(self) -> RepoInfo: ...
    def list_files(self, commit: str) -> list[RemoteFile]: ...
    def fetch(self, commit: str, path: str) -> bytes: ...
