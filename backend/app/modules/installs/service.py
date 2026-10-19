from datetime import timedelta

from sqlalchemy.orm import Session

from app.modules.installs import repository
from app.modules.installs.exceptions import (
    InstallNotFound,
    InvalidTarget,
    VersionNotInstallable,
)
from app.modules.installs.models import Install
from app.modules.installs.schemas import (
    CheckEntry,
    CheckResult,
    InstallItem,
    InstallReport,
)
from app.modules.skills import repository as skills_repo
from app.modules.skills import service as skills_service
from app.modules.skills.exceptions import VersionNotFound
from app.modules.skills.models import Skill, SkillStatus, SkillVersion, VersionStatus
from app.modules.skills.validation import parse_semver
from app.modules.users.models import User
from app.shared.utils import utcnow

CLI_TARGETS = {"claude-code", "cursor"}
ZIP_TARGET = "zip"
FEATURED_WINDOW = timedelta(days=30)


def _latest(skill: Skill) -> SkillVersion | None:
    return next((v for v in skill.versions if v.id == skill.latest_version_id), None)


def compute_state(skill: Skill | None, user: User, installed_version: str) -> str:
    """Trạng thái một bản cài so với những gì server đang phục vụ (mục 7)."""
    if skill is None or skill.status == SkillStatus.REMOVED.value:
        return "removed"
    if not skills_service.can_view(skill, user):
        return "no_access"
    mine = next((v for v in skill.versions if v.version == installed_version), None)
    if mine is not None and mine.status == VersionStatus.REVOKED.value:
        return "revoked"
    latest = _latest(skill)
    if latest is None or latest.version == installed_version:
        return "up_to_date"
    have, newest = parse_semver(installed_version), parse_semver(latest.version)
    if have and newest and have > newest:
        return "up_to_date"  # đang giữ bản mới hơn bản phục vụ (vd. sau khi thu hồi)
    return "update_available"


# ---- ghi nhận ----------------------------------------------------------------


def report_install(db: Session, user: User, body: InstallReport) -> Install:
    """CLI báo đã cài/cập nhật (source = cli). Bản `zip` do download?intent=zip tạo."""
    if body.target not in CLI_TARGETS:
        raise InvalidTarget(details={"allowed": sorted(CLI_TARGETS)})
    skill = skills_service.get_visible_skill(db, user, body.skill_id)
    ver = skills_repo.get_version(db, skill.id, body.version)
    if ver is None or ver.status not in (VersionStatus.PUBLISHED.value, VersionStatus.REVOKED.value):
        raise VersionNotFound()
    if ver.status == VersionStatus.REVOKED.value:
        raise VersionNotInstallable()
    return repository.upsert(
        db, user_id=user.id, skill_id=skill.id, target=body.target,
        source=repository.SOURCE_CLI, version=ver.version, now=utcnow(),
    )


def record_zip_download(db: Session, user: User, skill_id: int, version: str) -> None:
    repository.upsert(
        db, user_id=user.id, skill_id=skill_id, target=ZIP_TARGET,
        source=repository.SOURCE_ZIP, version=version, now=utcnow(),
    )


def report_uninstall(db: Session, user: User, skill_id: int, target: str | None) -> None:
    rows = repository.active_for_skill(db, user.id, skill_id, target)
    if not rows:
        raise InstallNotFound()
    now = utcnow()
    for row in rows:
        row.uninstalled_at = now
    db.flush()


# ---- đọc ---------------------------------------------------------------------


def list_mine(db: Session, user: User, state: str | None) -> list[InstallItem]:
    rows = repository.active_for_user(db, user.id)
    skills = {s.id: s for s in (skills_repo.get_skill(db, i) for i in {r.skill_id for r in rows}) if s}
    items = []
    for row in rows:
        skill = skills.get(row.skill_id)
        st = compute_state(skill, user, row.installed_version)
        if state and st != state:
            continue
        latest = _latest(skill) if skill else None
        items.append(
            InstallItem(
                skill_id=row.skill_id,
                name=skill.name if skill else "",
                summary=skill.summary if skill else None,
                has_icon=bool(latest and latest.icon_key),
                source=row.source,
                target=row.target,
                installed_version=row.installed_version,
                latest_version=latest.version if latest and st not in ("removed", "no_access") else None,
                state=st,
                installed_at=row.installed_at,
            )
        )
    return items


def check(db: Session, user: User, entries: list[CheckEntry]) -> list[CheckResult]:
    results = []
    for e in entries:
        skill = skills_repo.get_skill(db, e.skill_id)
        if skill is None:
            state, latest = "removed", None
        else:
            state = compute_state(skill, user, e.version)
            lv = _latest(skill)
            latest = lv.version if lv and state not in ("removed", "no_access") else None
        results.append(CheckResult(skill_id=e.skill_id, version=e.version, latest_version=latest, state=state))
    return results
