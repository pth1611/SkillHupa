from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.dependencies import DbSession
from app.modules.auth.dependencies import require_roles
from app.modules.users import service
from app.modules.users.models import Role
from app.modules.users.schemas import UserOut
from app.shared.pagination import Page, PageParams

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get(
    "",
    response_model=Page[UserOut],
    dependencies=[Depends(require_roles(Role.MANAGER))],
)
def list_users(
    db: DbSession,
    params: Annotated[PageParams, Depends()],
    q: str | None = Query(None, max_length=100),
    role: Role | None = None,
    department: str | None = Query(None, max_length=255),
) -> Page[UserOut]:
    return service.search_users(db, q=q, role=role, department=department, params=params)
