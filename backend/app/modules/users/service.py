import logging

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.modules.users import repository
from app.modules.users.exceptions import UserNotFound
from app.modules.users.models import ROLE_PRIORITY, Role, User
from app.modules.users.schemas import UserOut, UserProfile
from app.shared.pagination import Page, PageParams
from app.shared.utils import utcnow

logger = logging.getLogger(__name__)


def derive_role(groups: list[str], settings: Settings) -> Role:
    """Suy ra vai trò từ nhóm Entra; nhiều nhóm thì lấy vai trò cao nhất (D1, D2)."""
    mapping = {
        settings.entra_group_managers: Role.MANAGER,
        settings.entra_group_reviewers: Role.REVIEWER,
        settings.entra_group_creators: Role.CREATOR,
    }
    roles = [mapping[g] for g in groups if g and g in mapping]
    return max(roles, key=lambda r: ROLE_PRIORITY[r], default=Role.USER)


def sync_from_profile(db: Session, profile: UserProfile, settings: Settings) -> User:
    """Tạo hoặc cập nhật tài khoản theo claim Entra; chỉ ghi DB khi có thay đổi."""
    role = derive_role(profile.groups, settings)
    user = repository.get_by_oid(db, profile.oid)
    if user is None:
        user = User(
            entra_oid=profile.oid,
            email=profile.email,
            display_name=profile.display_name,
            role=role.value,
            department=profile.department,
        )
        return repository.add(db, user)

    if user.role != role.value:
        # Nhật ký kiểm toán (module audit) sẽ ghi sự kiện này khi module đó có mặt.
        logger.info("Đổi vai trò user_id=%s: %s -> %s", user.id, user.role, role.value)
        user.role = role.value
    if user.email != profile.email:
        user.email = profile.email
    if user.display_name != profile.display_name:
        user.display_name = profile.display_name
    if user.department != profile.department:
        user.department = profile.department
    return user


def record_login(user: User) -> None:
    user.last_login_at = utcnow()


def find_user(db: Session, user_id: int) -> User | None:
    return repository.get(db, user_id)


def active_by_role(db: Session, role: Role) -> list[User]:
    return repository.active_by_role(db, role)


def get_user(db: Session, user_id: int) -> User:
    user = repository.get(db, user_id)
    if user is None:
        raise UserNotFound()
    return user


def search_users(
    db: Session,
    *,
    q: str | None,
    role: Role | None,
    department: str | None,
    params: PageParams,
) -> Page[UserOut]:
    items, total = repository.search(
        db, q=q, role=role, department=department, offset=params.offset, limit=params.page_size
    )
    return Page[UserOut](
        items=[UserOut.model_validate(u) for u in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )
