from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.users.models import Role, User


def get(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def get_by_oid(db: Session, oid: str) -> User | None:
    return db.scalar(select(User).where(User.entra_oid == oid))


def add(db: Session, user: User) -> User:
    db.add(user)
    db.flush()
    return user


def search(
    db: Session,
    *,
    q: str | None,
    role: Role | None,
    department: str | None,
    offset: int,
    limit: int,
) -> tuple[list[User], int]:
    stmt = select(User)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            func.lower(User.email).like(like) | func.lower(User.display_name).like(like)
        )
    if role:
        stmt = stmt.where(User.role == role.value)
    if department:
        stmt = stmt.where(User.department == department)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = list(db.scalars(stmt.order_by(User.display_name, User.id).offset(offset).limit(limit)))
    return items, total


def active_by_role(db: Session, role: Role) -> list[User]:
    stmt = select(User).where(User.role == role.value, User.is_active.is_(True)).order_by(User.id)
    return list(db.scalars(stmt))
