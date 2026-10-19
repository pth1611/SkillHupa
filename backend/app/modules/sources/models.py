from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.shared.utils import utcnow


class SkillSource(Base):
    """Nguồn thu thập do Manager khai báo (D46). `credential_name` là tên biến môi trường, không phải giá trị."""

    __tablename__ = "skill_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), unique=True, nullable=False)
    ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    path_glob: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    # None = tự động phân loại danh mục khi thu thập
    default_category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    default_department: Mapped[str] = mapped_column(String(255), nullable=False)
    default_visibility: Mapped[str] = mapped_column(String(16), default="company", nullable=False)
    credential_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_scan_status: Mapped[str | None] = mapped_column(String(8), nullable=True)  # ok|error
    last_scan_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    scan_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SourceScan(Base):
    """Một lần quét: kết quả từng thư mục skill nằm trong `items` (JSON)."""

    __tablename__ = "source_scans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("skill_sources.id"), index=True, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(8), nullable=False)  # running|ok|error
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    triggered_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    commit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    counts: Mapped[dict[str, int]] = mapped_column(JSON, default=dict, nullable=False)
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    total: Mapped[int | None] = mapped_column(Integer, nullable=True)  # số thư mục skill cần xử lý
