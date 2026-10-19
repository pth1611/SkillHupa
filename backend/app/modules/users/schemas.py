from pydantic import BaseModel, ConfigDict

from app.modules.users.models import Role


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str
    role: Role
    department: str | None = None


class MeOut(UserOut):
    unread_notifications: int = 0


class UserProfile(BaseModel):
    """Thông tin lấy từ claim của Entra, đầu vào cho việc đồng bộ tài khoản."""

    oid: str
    email: str
    display_name: str
    groups: list[str] = []
    department: str | None = None
