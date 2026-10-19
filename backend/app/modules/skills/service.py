from dataclasses import dataclass
from datetime import UTC, timedelta

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.exceptions import Conflict
from app.core.storage import BlobStorage
from app.modules.installs import repository as installs_repo
from app.modules.skills import packaging, repository, validation
from app.modules.skills.exceptions import (
    InvalidPackage,
    PackageTooLarge,
    SkillNotFound,
    SubmissionIncomplete,
    UnknownDepartment,
    VersionAlreadyExists,
    VersionNotDownloadable,
    VersionNotEditable,
    VersionNotFound,
)
from app.modules.skills.models import (
    Origin,
    Phase,
    Skill,
    SkillStatus,
    SkillVersion,
    SkillVersionFile,
    Tag,
    TagStatus,
    ValidationResult,
    VersionStatus,
    Visibility,
)
from app.modules.skills.schemas import Prefill, SkillCard, SkillMetadata, SkillUpdate
from app.modules.users.models import Role, User
from app.shared.utils import utcnow

EDITABLE = {VersionStatus.DRAFT.value, VersionStatus.REJECTED.value}


@dataclass
class Analysis:
    version: SkillVersion
    findings: list[validation.Finding]
    prefill: Prefill

    @property
    def ok(self) -> bool:
        return not any(f.result == validation.FAIL for f in self.findings)


# ---- truy cập và quyền xem ------------------------------------------------


def check_department(settings: Settings, department: str | None) -> None:
    """Phòng ban Creator nhập phải thuộc danh sách chuẩn; danh sách rỗng thì không ràng buộc."""
    allowed = settings.department_list
    if department and allowed and department not in allowed:
        raise UnknownDepartment(details={"allowed": allowed})


def _owned_skill(db: Session, user: User, skill_id: int) -> Skill:
    skill = repository.get_skill(db, skill_id)
    # Trả 404 cho cả "không tồn tại" lẫn "không phải của bạn" (không lộ sự tồn tại).
    if skill is None or skill.owner_id != user.id:
        raise SkillNotFound()
    return skill


def _owned_version(db: Session, user: User, skill_id: int, version: str) -> tuple[Skill, SkillVersion]:
    skill = _owned_skill(db, user, skill_id)
    ver = repository.get_version(db, skill.id, version)
    if ver is None:
        raise VersionNotFound()
    return skill, ver


def can_view(skill: Skill, user: User) -> bool:
    if user.role == Role.MANAGER.value or skill.owner_id == user.id:
        return True
    if skill.status != SkillStatus.PUBLISHED.value:
        return False
    if skill.visibility == Visibility.COMPANY.value:
        return True
    return bool(user.department) and user.department == skill.department


def get_visible_skill(db: Session, user: User, skill_id: int) -> Skill:
    skill = repository.get_skill(db, skill_id)
    if skill is None or not can_view(skill, user):
        raise SkillNotFound()
    return skill


# ---- phân tích gói ------------------------------------------------------


def read_limited(stream, limit: int) -> bytes:
    data = stream.read(limit + 1)
    if len(data) > limit:
        raise PackageTooLarge(f"Gói vượt giới hạn {limit} byte")
    return data


def _rules_limits() -> dict:
    return validation.load_rules()["limits"]


def _inspect(settings: Settings, data: bytes) -> packaging.PackageInfo:
    limits = _rules_limits()
    try:
        return packaging.inspect(
            data,
            max_files=limits["max_files"],
            max_total_bytes=settings.max_package_bytes,
            max_skill_md_bytes=limits["max_skill_md_bytes"],
            max_scan_bytes=limits["max_scan_bytes_per_file"],
        )
    except packaging.NotAZipError as exc:
        raise InvalidPackage(str(exc)) from exc


def _validate(
    db: Session,
    settings: Settings,
    info: packaging.PackageInfo,
    *,
    skill_id: int | None,
    summary: str | None,
    changelog: str | None,
    version: str,
) -> list[validation.Finding]:
    existing = repository.released_version_numbers(db, skill_id) if skill_id else []
    return validation.validate_package(
        info,
        max_total_bytes=settings.max_package_bytes,
        summary=summary,
        changelog=changelog,
        version=version,
        existing_versions=existing,
    )


def _prefill(info: packaging.PackageInfo) -> Prefill:
    fm = info.frontmatter
    version = fm.get("version")
    return Prefill(
        name=str(fm["name"]).strip() if fm.get("name") else None,
        description=str(fm["description"]).strip() if fm.get("description") else None,
        version=str(version) if version else None,
    )


def _result_rows(findings: list[validation.Finding], phase: Phase) -> list[ValidationResult]:
    return [
        ValidationResult(
            phase=phase.value,
            check_name=f.check,
            result=f.result,
            file_path=f.file_path,
            line=f.line,
            detail=f.detail,
        )
        for f in findings
    ]


def _store_package(
    db: Session,
    storage: BlobStorage,
    version: SkillVersion,
    data: bytes,
    info: packaging.PackageInfo,
) -> None:
    key = f"packages/{version.skill_id}/{version.id}.zip"
    storage.put(key, data)
    version.package_key = key
    version.size_bytes = len(data)
    version.skill_md = packaging.strip_frontmatter(info.skill_md) if info.skill_md else None
    repository.replace_files(
        db,
        version,
        [
            SkillVersionFile(path=f.path, size=f.size, sha256=f.sha256, is_text=f.is_text)
            for f in info.files
        ],
    )


def _apply_icon(
    storage: BlobStorage,
    version: SkillVersion,
    icon: bytes | None,
    settings: Settings,
    findings: list[validation.Finding],
) -> None:
    if icon is None:
        return
    processed, icon_findings = validation.process_icon(icon, max_bytes=settings.max_icon_bytes)
    findings.extend(icon_findings)
    if processed is not None:
        key = f"icons/{version.skill_id}/{version.id}.webp"
        storage.put(key, processed)
        version.icon_key = key


def _finish_preview(
    db: Session,
    storage: BlobStorage,
    settings: Settings,
    version: SkillVersion,
    data: bytes,
    info: packaging.PackageInfo,
    findings: list[validation.Finding],
    icon: bytes | None,
) -> Analysis:
    _store_package(db, storage, version, data, info)
    _apply_icon(storage, version, icon, settings, findings)
    repository.replace_results(db, version, Phase.PREVIEW.value, _result_rows(findings, Phase.PREVIEW))
    return Analysis(version, findings, _prefill(info))


# ---- tạo và sửa -----------------------------------------------------------


def create_skill(
    db: Session,
    storage: BlobStorage,
    settings: Settings,
    user: User,
    meta: SkillMetadata,
    package: bytes,
    icon: bytes | None,
) -> tuple[Skill, Analysis]:
    check_department(settings, meta.department)
    info = _inspect(settings, package)
    prefill = _prefill(info)
    version_no = meta.version or prefill.version or "0.1.0"
    findings = _validate(
        db, settings, info, skill_id=None, summary=meta.summary, changelog=meta.changelog, version=version_no
    )
    skill = repository.add_skill(
        db,
        Skill(
            name=(meta.name or prefill.name or "Chưa đặt tên").strip(),
            summary=meta.summary,
            category_id=meta.category_id,
            department=meta.department or user.department,
            visibility=(meta.visibility or Visibility.COMPANY).value,
            owner_id=user.id,
            origin=Origin.INTERNAL.value,
            status=SkillStatus.DRAFT.value,
        ),
    )
    version = repository.add_version(
        db,
        SkillVersion(
            skill_id=skill.id,
            version=version_no,
            status=VersionStatus.DRAFT.value,
            changelog=meta.changelog,
        ),
    )
    if meta.tag_ids:
        _set_tags(db, user, skill, meta.tag_ids)
    return skill, _finish_preview(db, storage, settings, version, package, info, findings, icon)


def add_version(
    db: Session,
    storage: BlobStorage,
    settings: Settings,
    user: User,
    skill_id: int,
    *,
    version: str,
    changelog: str | None,
    package: bytes,
    icon: bytes | None,
) -> Analysis:
    skill = _owned_skill(db, user, skill_id)
    if repository.get_version(db, skill.id, version) is not None:
        raise VersionAlreadyExists()
    info = _inspect(settings, package)
    findings = _validate(
        db, settings, info, skill_id=skill.id, summary=skill.summary, changelog=changelog, version=version
    )
    ver = repository.add_version(
        db,
        SkillVersion(skill_id=skill.id, version=version, status=VersionStatus.DRAFT.value, changelog=changelog),
    )
    return _finish_preview(db, storage, settings, ver, package, info, findings, icon)


def replace_package(
    db: Session,
    storage: BlobStorage,
    settings: Settings,
    user: User,
    skill_id: int,
    version: str,
    package: bytes,
    icon: bytes | None = None,
) -> Analysis:
    skill, ver = _owned_version(db, user, skill_id, version)
    if ver.status not in EDITABLE:
        raise VersionNotEditable()
    info = _inspect(settings, package)
    findings = _validate(
        db, settings, info, skill_id=skill.id, summary=skill.summary, changelog=ver.changelog, version=ver.version
    )
    ver.status = VersionStatus.DRAFT.value  # bản bị từ chối được sửa lại thì quay về nháp
    return _finish_preview(db, storage, settings, ver, package, info, findings, icon)


def update_version(
    db: Session,
    storage: BlobStorage,
    settings: Settings,
    user: User,
    skill_id: int,
    version: str,
    *,
    new_version: str | None,
    changelog: str | None,
    changelog_set: bool,
) -> Analysis:
    """Sửa số phiên bản/changelog của bản nháp hoặc bị từ chối (wizard bước 2, D42)."""
    skill, ver = _owned_version(db, user, skill_id, version)
    if ver.status not in EDITABLE:
        raise VersionNotEditable()
    target = (new_version or ver.version).strip()
    if target != ver.version and repository.get_version(db, skill.id, target) is not None:
        raise VersionAlreadyExists()
    if not ver.package_key:
        raise Conflict("Phiên bản chưa có gói")
    new_changelog = changelog if changelog_set else ver.changelog
    info = _inspect(settings, storage.get(ver.package_key))
    findings = _validate(
        db, settings, info, skill_id=skill.id, summary=skill.summary, changelog=new_changelog, version=target
    )
    ver.version = target
    ver.changelog = new_changelog
    ver.status = VersionStatus.DRAFT.value  # bản bị từ chối được sửa thì quay về nháp
    repository.replace_results(db, ver, Phase.PREVIEW.value, _result_rows(findings, Phase.PREVIEW))
    db.flush()
    return Analysis(ver, findings, _prefill(info))


def replace_icon(
    db: Session, storage: BlobStorage, settings: Settings, user: User, skill_id: int, version: str, icon: bytes
) -> list[validation.Finding]:
    _, ver = _owned_version(db, user, skill_id, version)
    if ver.status not in EDITABLE:
        raise VersionNotEditable()
    findings: list[validation.Finding] = []
    _apply_icon(storage, ver, icon, settings, findings)
    return findings


def delete_version(db: Session, storage: BlobStorage, user: User, skill_id: int, version: str) -> None:
    skill, ver = _owned_version(db, user, skill_id, version)
    if ver.status not in EDITABLE:
        raise VersionNotEditable()
    for key in (ver.package_key, ver.icon_key):
        if key:
            storage.delete(key)
    db.delete(ver)
    db.flush()
    if skill.status == SkillStatus.DRAFT.value and not repository.list_versions(db, skill.id):
        db.delete(skill)


def _set_tags(db: Session, user: User, skill: Skill, tag_ids: list[int]) -> None:
    tags = repository.get_tags(db, list(set(tag_ids)))
    found = {t.id for t in tags}
    missing = sorted(set(tag_ids) - found)
    if missing:
        raise Conflict("Tag không tồn tại", {"tag_ids": missing})
    for tag in tags:
        usable = tag.status == TagStatus.APPROVED.value or (
            tag.status == TagStatus.PENDING.value and tag.proposed_by == user.id
        )
        if not usable:
            raise Conflict("Chỉ được gắn tag đã duyệt hoặc tag do bạn đề xuất", {"tag_ids": [tag.id]})
    repository.set_skill_tags(db, skill.id, tag_ids)


@dataclass
class PendingVisibilityChange:
    """Thay đổi phạm vi xem cần duyệt lại (D27); module `reviews` tạo yêu cầu."""

    from_visibility: str
    to_visibility: str
    from_department: str | None
    to_department: str | None


def _widens(skill: Skill, visibility: str, department: str | None) -> bool:
    """Mở rộng phạm vi: department → company, hoặc sang phòng ban khác (D27)."""
    if visibility == Visibility.COMPANY.value:
        return skill.visibility == Visibility.DEPARTMENT.value
    return skill.visibility == Visibility.DEPARTMENT.value and department != skill.department


def update_skill(
    db: Session, settings: Settings, user: User, skill_id: int, body: SkillUpdate
) -> tuple[Skill, PendingVisibilityChange | None]:
    check_department(settings, body.department)
    skill = _owned_skill(db, user, skill_id)
    data = body.model_dump(exclude_unset=True)
    published = skill.status != SkillStatus.DRAFT.value
    if published and "name" in data and data["name"] != skill.name:
        raise Conflict("Không đổi được tên skill đã đăng")
    tag_ids = data.pop("tag_ids", None)

    pending: PendingVisibilityChange | None = None
    if published and ("visibility" in data or "department" in data):
        new_vis = (data.get("visibility") or Visibility(skill.visibility)).value
        new_dept = data.get("department", skill.department)
        if _widens(skill, new_vis, new_dept):
            pending = PendingVisibilityChange(skill.visibility, new_vis, skill.department, new_dept)
            data.pop("visibility", None)
            data.pop("department", None)

    for key, value in data.items():
        setattr(skill, key, value.value if isinstance(value, Visibility) else value)
    if tag_ids is not None:
        _set_tags(db, user, skill, tag_ids)
    db.flush()
    return skill, pending


# ---- gửi duyệt --------------------------------------------------------------


def _missing_fields(skill: Skill) -> list[str]:
    missing = []
    if not (skill.name or "").strip():
        missing.append("name")
    if not (skill.summary or "").strip():
        missing.append("summary")
    if skill.category_id is None:
        missing.append("category_id")
    if not (skill.department or "").strip():
        missing.append("department")
    return missing


def submit(
    db: Session, storage: BlobStorage, settings: Settings, user: User, skill_id: int, version: str
) -> Analysis:
    skill, ver = _owned_version(db, user, skill_id, version)
    if ver.status != VersionStatus.DRAFT.value:
        raise Conflict("Chỉ gửi duyệt được phiên bản đang ở trạng thái nháp")
    missing = _missing_fields(skill)
    if missing:
        raise SubmissionIncomplete(details={"fields": missing})
    if not ver.package_key:
        raise Conflict("Phiên bản chưa có gói")

    ver.status = VersionStatus.VALIDATING.value
    ver.validation_started_at = utcnow()
    data = storage.get(ver.package_key)
    info = _inspect(settings, data)
    findings = _validate(
        db, settings, info, skill_id=skill.id, summary=skill.summary, changelog=ver.changelog, version=ver.version
    )
    key = skill.name.strip().lower()
    if repository.name_key_taken(db, key, exclude_skill_id=skill.id):
        findings.append(validation.Finding("name.unique", validation.FAIL, "Tên skill đã được dùng"))
    else:
        findings.append(validation.Finding("name.unique", validation.PASS, "Tên skill hợp lệ"))
    repository.replace_results(db, ver, Phase.SUBMIT.value, _result_rows(findings, Phase.SUBMIT))
    analysis = Analysis(ver, findings, _prefill(info))
    if not analysis.ok:
        ver.status = VersionStatus.DRAFT.value
        return analysis

    ver.status = VersionStatus.PENDING.value
    ver.submitted_at = utcnow()
    ver.checksum = packaging.sha256_hex(data)
    skill.name_key = key
    db.flush()
    return analysis


def get_validation(db: Session, user: User, skill_id: int, version: str, phase: str | None) -> tuple[str, list]:
    skill = repository.get_skill(db, skill_id)
    if skill is None or (skill.owner_id != user.id and user.role != Role.MANAGER.value):
        raise SkillNotFound()
    ver = repository.get_version(db, skill_id, version)
    if ver is None:
        raise VersionNotFound()
    rows = list(ver.results)
    chosen = phase or (Phase.SUBMIT.value if any(r.phase == Phase.SUBMIT.value for r in rows) else Phase.PREVIEW.value)
    return chosen, [r for r in rows if r.phase == chosen]


# ---- đọc ------------------------------------------------------------------


def list_mine(db: Session, user: User) -> list[Skill]:
    return repository.list_by_owner(db, user.id)


def _cards(db: Session, skills: list[Skill]) -> list[SkillCard]:
    tags = repository.approved_tag_names(db, [s.id for s in skills])
    versions = repository.versions_by_id(db, [s.latest_version_id for s in skills])
    counts = installs_repo.install_counts(db, [s.id for s in skills])
    cards = []
    for skill in skills:
        latest = versions.get(skill.latest_version_id)
        card = SkillCard.model_validate(skill)
        card.latest_version = latest.version if latest else None
        card.has_icon = bool(latest and latest.icon_key)
        card.tags = tags.get(skill.id, [])
        card.install_count = counts.get(skill.id, 0)
        cards.append(card)
    return cards


def search(
    db: Session,
    user: User,
    *,
    q: str | None,
    category_id: int | None,
    department: str | None,
    tags: list[str],
    sort: str,
    offset: int,
    limit: int,
) -> tuple[list[SkillCard], int]:
    skills, total = repository.search_published(
        db,
        viewer_id=user.id,
        viewer_department=user.department,
        is_manager=user.role == Role.MANAGER.value,
        q=q,
        category_id=category_id,
        department=department,
        tags=tags,
        sort=sort,
        offset=offset,
        limit=limit,
    )
    return _cards(db, skills), total


FEATURED_POOL = 500
NEW_SKILL_BOOST = 5


def featured(db: Session, user: User, limit: int) -> list[SkillCard]:
    """Lượt cài CLI 30 ngày gần đây, cộng điểm cho skill mới đăng để có cơ hội xuất hiện (D21)."""
    now = utcnow()
    skills, _ = repository.search_published(
        db, viewer_id=user.id, viewer_department=user.department,
        is_manager=user.role == Role.MANAGER.value, q=None, category_id=None, department=None,
        tags=[], sort="newest", offset=0, limit=FEATURED_POOL,
    )
    recent = installs_repo.install_counts(db, [s.id for s in skills], since=now - timedelta(days=30))

    def score(s: Skill) -> int:
        published = s.published_at
        if published is not None and published.tzinfo is None:  # SQLite trả datetime không múi giờ
            published = published.replace(tzinfo=UTC)
        fresh = published is not None and now - published <= timedelta(days=30)
        return recent.get(s.id, 0) + (NEW_SKILL_BOOST if fresh else 0)

    ranked = sorted(skills, key=score, reverse=True)  # ổn định: giữ thứ tự mới đăng khi hoà điểm
    return _cards(db, ranked[:limit])


def _servable_version(db: Session, skill: Skill, user: User, version: str | None) -> SkillVersion:
    """Phiên bản được phục vụ: mặc định bản mới nhất đang đăng; chỉ chủ/Manager xem bản chưa đăng."""
    privileged = user.role == Role.MANAGER.value or skill.owner_id == user.id
    if version in (None, "latest"):
        ver = next((v for v in skill.versions if v.id == skill.latest_version_id), None)
        if ver is None or skill.status != SkillStatus.PUBLISHED.value:
            raise VersionNotFound()
        return ver
    ver = repository.get_version(db, skill.id, version)
    if ver is None:
        raise VersionNotFound()
    if ver.status not in (VersionStatus.PUBLISHED.value, VersionStatus.REVOKED.value) and not privileged:
        raise VersionNotFound()
    return ver


def version_for_view(db: Session, skill: Skill, user: User, version: str | None) -> SkillVersion | None:
    """Phiên bản hiển thị trên trang chi tiết: mặc định bản đang phục vụ (None nếu chưa có)."""
    if version in (None, "latest"):
        latest = next((v for v in skill.versions if v.id == skill.latest_version_id), None)
        return latest if latest is not None and skill.status == SkillStatus.PUBLISHED.value else None
    return _servable_version(db, skill, user, version)


def icon_for(
    db: Session, storage: BlobStorage, user: User, skill_id: int, version: str | None
) -> tuple[bytes, SkillVersion]:
    skill = get_visible_skill(db, user, skill_id)
    if version is not None and not (user.role == Role.MANAGER.value or skill.owner_id == user.id):
        version = None
    ver = _servable_version(db, skill, user, version)
    if not ver.icon_key or not storage.exists(ver.icon_key):
        raise VersionNotFound("Phiên bản không có ảnh biểu tượng")
    return storage.get(ver.icon_key), ver


def prepare_download(
    db: Session, user: User, skill_id: int, version: str | None, intent: str
) -> SkillVersion:
    skill = get_visible_skill(db, user, skill_id)
    if skill.status != SkillStatus.PUBLISHED.value:
        raise VersionNotFound()
    ver = _servable_version(db, skill, user, version)
    if ver.status == VersionStatus.REVOKED.value:
        raise VersionNotDownloadable()
    if ver.status != VersionStatus.PUBLISHED.value or not ver.package_key:
        raise VersionNotFound()
    if intent == "zip":
        skill.download_count += 1
        db.flush()
    return ver


def package_for(db: Session, storage: BlobStorage, user: User, skill_id: int, version: str) -> tuple[bytes, SkillVersion]:
    skill = get_visible_skill(db, user, skill_id)
    ver = _servable_version(db, skill, user, version)
    if ver.status != VersionStatus.PUBLISHED.value or not ver.package_key:
        raise VersionNotFound()
    return storage.get(ver.package_key), ver


# ---- tag --------------------------------------------------------------------


def propose_tag(db: Session, user: User, raw_name: str) -> tuple[Tag, bool]:
    name = " ".join(raw_name.lower().split())
    if not name:
        raise Conflict("Tên tag trống")
    existing = repository.find_tag_by_name(db, name)
    if existing is not None:
        return existing, False
    tag = repository.add_tag(
        db, Tag(name=name, status=TagStatus.PENDING.value, proposed_by=user.id)
    )
    return tag, True
