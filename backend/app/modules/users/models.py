import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.shared.utils import utcnow


class Role(str, enum.Enum):
    USER = "user"
    CREATOR = "creator"
    REVIEWER = "reviewer"
    MANAGER = "manager"


# Khi một người ở nhiều nhóm Entra, lấy vai trò cao nhất (architecture.md, mục 4).
ROLE_PRIORITY: dict[Role, int] = {
    Role.USER: 0,
    Role.CREATOR: 1,
    Role.REVIEWER: 2,
    Role.MANAGER: 3,
}


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entra_oid: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(320), index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), index=True, default=Role.USER.value, nullable=False)
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def role_enum(self) -> Role:
        return Role(self.role)
