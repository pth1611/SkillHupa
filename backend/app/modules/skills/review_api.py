"""Giao diện của module `skills` dành cho module `reviews`.

Module `reviews` chỉ gọi các hàm ở đây, không truy cập model/repository của `skills`.
"""
import difflib
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import Conflict
from app.core.storage import BlobStorage
from app.modules.skills import packaging, validation
from app.modules.skills.models import (
    Phase,
    Skill,
    SkillStatus,
    SkillVersion,
    VersionStatus,
    Visibility,
)

DISPLAY_LIMIT = 256 * 1024


@dataclass
class FileEntry:
    path: str
    status: str  # added | modified | removed | unchanged
    size: int
    is_text: bool
    warnings: int


def get_version(db: Session, version_id: int) -> tuple[SkillVersion, Skill] | None:
    version = db.get(SkillVersion, version_id)
    if version is None:
        return None
    return version, version.skill


def pending_versions(db: Session) -> list[tuple[SkillVersion, Skill]]:
    stmt = (
        select(SkillVersion, Skill)
        .join(Skill, Skill.id == SkillVersion.skill_id)
        .where(SkillVersion.status == VersionStatus.PENDING.value)
        .order_by(SkillVersion.submitted_at, SkillVersion.id)
    )
    return [(v, s) for v, s in db.execute(stmt)]


def get_skill(db: Session, skill_id: int) -> Skill | None:
    return db.get(Skill, skill_id)


def base_version(skill: Skill, *, exclude_id: int) -> SkillVersion | None:
    """Bản đang phục vụ để so sánh; phiên bản đầu tiên không có bản gốc."""
    for v in skill.versions:
        if v.id == skill.latest_version_id and v.id != exclude_id:
            return v
    return None


def submit_results(version: SkillVersion) -> list:
    return [r for r in version.results if r.phase == Phase.SUBMIT.value]


def file_tree(version: SkillVersion, base: SkillVersion | None) -> list[FileEntry]:
    warn_by_path: dict[str, int] = {}
    for r in submit_results(version):
        if r.file_path and r.result == validation.WARN:
            warn_by_path[r.file_path] = warn_by_path.get(r.file_path, 0) + 1
    base_files = {f.path: f for f in base.files} if base else {}
    entries: list[FileEntry] = []
    for f in version.files:
        old = base_files.get(f.path)
        if old is None:
            status = "added"
        elif old.sha256 != f.sha256:
            status = "modified"
        else:
            status = "unchanged"
        entries.append(FileEntry(f.path, status, f.size, f.is_text, warn_by_path.get(f.path, 0)))
    new_paths = {f.path for f in version.files}
    for path, old in base_files.items():
        if path not in new_paths:
            entries.append(FileEntry(path, "removed", old.size, old.is_text, 0))
    return sorted(entries, key=lambda e: e.path)


def package_bytes(storage: BlobStorage, version: SkillVersion) -> bytes:
    if not version.package_key:
        raise Conflict("Phiên bản chưa có gói")
    return storage.get(version.package_key)


def file_content(
    storage: BlobStorage, version: SkillVersion, base: SkillVersion | None, path: str
) -> dict | None:
    """Nội dung văn bản và diff của một file; file nhị phân/quá lớn chỉ trả metadata."""
    meta = next((f for f in version.files if f.path == path), None)
    base_meta = next((f for f in base.files if f.path == path), None) if base else None
    if meta is None and base_meta is None:
        return None
    new_text = old_text = None
    truncated = False
    is_text = (meta or base_meta).is_text

    def load(v: SkillVersion | None, m) -> str | None:
        nonlocal truncated
        if v is None or m is None or not m.is_text or not v.package_key:
            return None
        raw = packaging.read_member(storage.get(v.package_key), path, max_bytes=DISPLAY_LIMIT)
        if raw is None:
            return None
        if len(raw) > DISPLAY_LIMIT:
            truncated = True
            return None
        return raw.decode("utf-8", errors="replace")

    new_text = load(version, meta)
    old_text = load(base, base_meta)
    diff = None
    if is_text and not truncated and (new_text is not None or old_text is not None):
        diff = "".join(
            difflib.unified_diff(
                (old_text or "").splitlines(keepends=True),
                (new_text or "").splitlines(keepends=True),
                fromfile=f"a/{path}",
                tofile=f"b/{path}",
            )
        )
    warnings = [
        {"check": r.check_name, "line": r.line, "detail": r.detail}
        for r in submit_results(version)
        if r.file_path == path and r.result in (validation.WARN, validation.FAIL)
    ]
    return {
        "path": path,
        "is_text": is_text,
        "size": (meta or base_meta).size,
        "sha256": (meta or base_meta).sha256,
        "too_large": truncated,
        "new": new_text,
        "old": old_text,
        "diff": diff,
        "warnings": warnings,
    }


def assign(version: SkillVersion, reviewer_id: int, by_id: int | None, now: datetime) -> None:
    version.assigned_to = reviewer_id
    version.assigned_by = by_id
    version.assigned_at = now


def unassign(version: SkillVersion) -> None:
    version.assigned_to = None
    version.assigned_by = None
    version.assigned_at = None


def _highest_published(skill: Skill) -> SkillVersion | None:
    best, best_key = None, None
    for v in skill.versions:
        if v.status != VersionStatus.PUBLISHED.value:
            continue
        key = validation.parse_semver(v.version) or (-1, -1, -1)
        if best_key is None or key > best_key:
            best, best_key = v, key
    return best


def approve(skill: Skill, version: SkillVersion, storage: BlobStorage, now: datetime) -> None:
    data = package_bytes(storage, version)
    if packaging.sha256_hex(data) != version.checksum:
        raise Conflict("Gói đã bị thay đổi so với lúc gửi duyệt (checksum không khớp)")
    version.status = VersionStatus.PUBLISHED.value
    best = _highest_published(skill)
    skill.latest_version_id = best.id if best else version.id
    if skill.status == SkillStatus.DRAFT.value:
        skill.status = SkillStatus.PUBLISHED.value
    if skill.published_at is None:
        skill.published_at = now


def reject(version: SkillVersion) -> None:
    version.status = VersionStatus.REJECTED.value


def apply_visibility(skill: Skill, visibility: str, department: str | None) -> None:
    skill.visibility = Visibility(visibility).value
    if department:
        skill.department = department


# ---- dành cho module `admin` (gỡ, khôi phục, thu hồi, chuyển quyền) -------------


def highest_published(skill: Skill, *, exclude_id: int | None = None) -> SkillVersion | None:
    best, best_key = None, None
    for v in skill.versions:
        if v.status != VersionStatus.PUBLISHED.value or v.id == exclude_id:
            continue
        key = validation.parse_semver(v.version) or (-1, -1, -1)
        if best_key is None or key > best_key:
            best, best_key = v, key
    return best


def list_skills(
    db: Session, *, status: str | None, q: str | None, owner_id: int | None, offset: int, limit: int
) -> tuple[list[Skill], int]:
    from sqlalchemy import func

    stmt = select(Skill)
    if status:
        stmt = stmt.where(Skill.status == status)
    if owner_id is not None:
        stmt = stmt.where(Skill.owner_id == owner_id)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(func.lower(Skill.name).like(like))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Skill.updated_at.desc(), Skill.id.desc()).offset(offset).limit(limit))
    return list(rows), total


def find_version(skill: Skill, version: str) -> SkillVersion | None:
    return next((v for v in skill.versions if v.version == version), None)


def icon_bytes(storage: BlobStorage, version: SkillVersion) -> bytes | None:
    """Ảnh biểu tượng của một phiên bản (Reviewer xem khi duyệt, D39)."""
    if not version.icon_key or not storage.exists(version.icon_key):
        return None
    return storage.get(version.icon_key)
