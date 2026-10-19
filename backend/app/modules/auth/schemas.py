from pydantic import BaseModel

from app.modules.users.models import Role


class DevLoginRequest(BaseModel):
    email: str
    display_name: str | None = None
    role: Role = Role.USER
    department: str | None = None
