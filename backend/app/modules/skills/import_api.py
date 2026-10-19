"""Giao diện của module `skills` dành cho module `sources` (nhập skill từ nguồn ngoài, D45–D51).

Skill nhập vào đi chung đường duyệt với skill nội bộ (D47): tạo phiên bản, kiểm tra tự động
đồng bộ, rồi vào hàng đợi `pending`. Không có đường đăng thẳng.
"""
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.exceptions import Conflict
from app.core.storage import BlobStorage
from app.modules.skills import packaging, repository, service, validation
from app.modules.skills.models import (
    Origin,
    Phase,
    Skill,
    SkillStatus,
    SkillVersion,
    TagStatus,
    VersionStatus,
    Visibility,
)
from app.modules.skills.validation import parse_semver


@dataclass
class ImportOutcome:
    skill: Skill
    version: SkillVersion
    findings: list[validation.Finding]
    created_skill: bool

    @property
    def ok(self) -> bool:
        return not any(f.result == validation.FAIL for f in self.findings)


def find_by_source_path(db: Session, source_id: int, path: str) -> Skill | None:
    stmt = select(Skill).where(Skill.source_id == source_id, Skill.source_path == path)
    return db.scalar(stmt)


def list_for_source(db: Session, source_id: int) -> list[Skill]:
    return list(db.scalars(select(Skill).where(Skill.source_id == source_id)))


def detach_source(db: Session, source_id: int) -> None:
    """Xoá nguồn: giữ skill đã nhập, chỉ ngừng đồng bộ (api.md, DELETE sources)."""
    db.execute(update(Skill).where(Skill.source_id == source_id).values(source_id=None))


def latest_file_hashes(skill: Skill) -> dict[str, str] | None:
    """Băm file của phiên bản gần nhất (mọi trạng thái); dùng để biết nội dung có đổi không."""
    if not skill.versions:
        return None
    return {f.path: f.sha256 for f in skill.versions[-1].files}


def version_numbers(skill: Skill) -> list[str]:
    return [v.version for v in skill.versions]


def highest_released(skill: Skill) -> tuple[int, int, int] | None:
    keys = [
        parse_semver(v.version)
        for v in skill.versions
        if v.status in (VersionStatus.PUBLISHED.value, VersionStatus.REVOKED.value)
    ]
    keys = [k for k in keys if k]
    return max(keys) if keys else None


def next_internal_version(skill: Skill | None) -> str:
    """Số nội bộ `0.0.N` tăng dần theo thứ tự phát hiện (D49)."""
    top = 0
    for number in version_numbers(skill) if skill else []:
        key = parse_semver(number)
        if key and key[0] == 0 and key[1] == 0:
            top = max(top, key[2])
    return f"0.0.{top + 1}"


def import_version(
    db: Session,
    storage: BlobStorage,
    settings: Settings,
    *,
    skill: Skill | None,
    source_id: int,
    source_name: str,
    source_url: str,
    path: str,
    package: bytes,
    version: str,
    source_ref: str | None,
    source_commit: str,
    upstream_author: str | None,
    license_id: str | None,
    category_id: int,
    department: str,
    visibility: str,
    now: datetime,
) -> ImportOutcome:
    """Tạo (skill và) phiên bản từ gói đã đóng, chạy kiểm tra tự động, đưa vào hàng đợi nếu đạt."""
    info = service._inspect(settings, package)
    prefill = service._prefill(info)
    created = skill is None
    if skill is None:
        name = (prefill.name or path.rsplit("/", 1)[-1] or source_name).strip()[:100]
        if repository.name_key_taken(db, name.lower(), exclude_skill_id=-1):
            name = f"{name} ({source_name})"[:100]
        skill = repository.add_skill(
            db,
            Skill(
                name=name,
                summary=(prefill.description or "")[:200] or None,
                category_id=category_id,
                department=department,
                visibility=Visibility(visibility).value,
                owner_id=None,
                origin=Origin.IMPORTED.value,
                source_id=source_id,
                source_url=source_url,
                source_path=path,
                source_name=source_name,
                upstream_author=upstream_author,
                license=license_id,
                status=SkillStatus.DRAFT.value,
                last_synced_at=now,
            ),
        )
    else:
        skill.license = license_id
        skill.source_url = source_url
        skill.upstream_author = upstream_author
        skill.last_synced_at = now

    changelog = f"Nhập tự động từ {source_url} tại commit {source_commit[:7]}"
    ver = repository.add_version(
        db,
        SkillVersion(
            skill_id=skill.id,
            version=version,
            status=VersionStatus.VALIDATING.value,
            changelog=changelog,
            source_ref=source_ref,
            source_commit=source_commit,
        ),
    )
    service._store_package(db, storage, ver, package, info)
    findings = service._validate(
        db, settings, info, skill_id=skill.id, summary=skill.summary, changelog=changelog, version=version
    )
    key = skill.name.strip().lower()
    taken = skill.name_key != key and repository.name_key_taken(db, key, exclude_skill_id=skill.id)
    findings.append(
        validation.Finding("name.unique", validation.FAIL, "Tên skill đã được dùng")
        if taken
        else validation.Finding("name.unique", validation.PASS, "Tên skill hợp lệ")
    )
    repository.replace_results(db, ver, Phase.SUBMIT.value, service._result_rows(findings, Phase.SUBMIT))
    outcome = ImportOutcome(skill, ver, findings, created)
    if not outcome.ok:
        ver.status = VersionStatus.DRAFT.value  # không ai sửa được; đã báo Manager
        return outcome
    ver.status = VersionStatus.PENDING.value
    ver.submitted_at = now
    ver.checksum = packaging.sha256_hex(package)
    skill.name_key = key
    db.flush()
    return outcome


def set_upstream_status(skill: Skill, status: str, now: datetime) -> bool:
    """Trả True nếu trạng thái thật sự đổi (để chỉ cảnh báo Manager một lần)."""
    changed = skill.upstream_status != status
    skill.upstream_status = status
    skill.last_synced_at = now
    return changed


def update_display(db: Session, skill: Skill, data: dict, tag_ids: list[int] | None) -> Skill:
    """Manager sửa thông tin hiển thị của skill thu thập; không đụng tới nội dung gói (D48)."""
    if skill.origin != Origin.IMPORTED.value:
        raise Conflict("Chỉ sửa thông tin hiển thị của skill thu thập; skill nội bộ do chủ skill sửa")
    for key, value in data.items():
        setattr(skill, key, value.value if isinstance(value, Visibility) else value)
    if tag_ids is not None:
        tags = repository.get_tags(db, list(set(tag_ids)))
        bad = sorted(set(tag_ids) - {t.id for t in tags if t.status == TagStatus.APPROVED.value})
        if bad:
            raise Conflict("Chỉ gắn được tag đã duyệt", {"tag_ids": bad})
        repository.set_skill_tags(db, skill.id, tag_ids)
    db.flush()
    return skill
