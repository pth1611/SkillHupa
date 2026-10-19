from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.shared.utils import utcnow


class Install(Base):
    """Skill một người đang có (hoặc từng có). Gỡ chỉ đặt `uninstalled_at`, không xoá dòng."""

    __tablename__ = "installs"
    __table_args__ = (UniqueConstraint("user_id", "skill_id", "target", name="uq_install_user_skill_target"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    skill_id: Mapped[int] = mapped_column(ForeignKey("skills.id"), index=True, nullable=False)
    installed_version: Mapped[str] = mapped_column(String(32), nullable=False)
    source: Mapped[str] = mapped_column(String(8), nullable=False)  # cli|zip
    target: Mapped[str] = mapped_column(String(16), nullable=False)  # claude-code|cursor|zip
    installed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    uninstalled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
