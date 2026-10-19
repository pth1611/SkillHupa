"""Giao diện của module `skills` dành cho tác vụ dọn dẹp định kỳ (app/jobs/cleanup.py)."""
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.storage import BlobStorage
from app.modules.skills.models import (
    Origin,
    Skill,
    SkillStatus,
    SkillVersion,
    VersionStatus,
)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def stale_drafts(db: Session, *, before: datetime) -> list[tuple[SkillVersion, Skill, datetime]]:
    """Bản nháp của skill nội bộ không có hoạt động từ trước `before`.

    "Hoạt động" là mốc muộn hơn giữa lúc tạo phiên bản và lần cập nhật gần nhất của skill
    (sửa thông tin skill cũng được tính). Skill thu thập không có chủ nên không dọn ở đây.
    """
    stmt = (
        select(SkillVersion, Skill)
        .join(Skill, Skill.id == SkillVersion.skill_id)
        .where(
            SkillVersion.status == VersionStatus.DRAFT.value,
            Skill.origin == Origin.INTERNAL.value,
            Skill.owner_id.is_not(None),
        )
    )
    out = []
    for version, skill in db.execute(stmt):
        last = max(_aware(version.created_at), _aware(skill.updated_at))
        if last <= before:
            out.append((version, skill, last))
    return out


def delete_draft(db: Session, storage: BlobStorage, version: SkillVersion, skill: Skill) -> bool:
    """Xoá một bản nháp cùng gói/ảnh; xoá luôn skill nếu đó là skill nháp và không còn phiên bản nào.

    Trả True nếu skill cũng bị xoá. Bản ghi liên quan (tag gắn, lịch sử duyệt) bị DB xoá theo
    (ON DELETE CASCADE).
    """
    for key in (version.package_key, version.icon_key):
        if key:
            storage.delete(key)
    db.delete(version)
    db.flush()
    db.refresh(skill)
    if skill.status == SkillStatus.DRAFT.value and not skill.versions:
        db.delete(skill)
        db.flush()
        return True
    return False
