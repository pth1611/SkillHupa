from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.core.dependencies import DbSession, SettingsDep
from app.core.exceptions import AppError, error_body
from app.core.storage import BlobStorage, get_storage
from app.modules.auth.dependencies import CurrentUser, require_roles
from app.modules.installs import repository as installs_repo
from app.modules.installs import service as installs_service
from app.modules.reviews import repository as reviews_repo
from app.modules.reviews import service as reviews_service
from app.modules.skills import repository, service, taxonomy
from app.modules.skills.models import SkillStatus, VersionStatus
from app.modules.skills.schemas import (
    AutoClassifyOut,
    AutoClassifyRequest,
    CategoryOut,
    ClassificationOut,
    ClassificationUpdate,
    CreateSkillResponse,
    DownloadOut,
    FacetsOut,
    FindingOut,
    SkillCard,
    SkillDetail,
    SkillMetadata,
    SkillMineItem,
    SkillOut,
    SkillUpdate,
    TagOut,
    TagProposal,
    TaxonomyOut,
    ValidationOut,
    VersionOut,
    VersionUpdate,
    VersionWithValidation,
)
from app.modules.users.models import Role, User
from app.shared.pagination import Page, PageParams
from app.shared.utils import utcnow

router = APIRouter(prefix="/api/skills", tags=["skills"])

CreatorUser = Annotated[User, Depends(require_roles(Role.CREATOR))]
Storage = Annotated[BlobStorage, Depends(get_storage)]
ManagerUser = Annotated[User, Depends(require_roles(Role.MANAGER))]
StaffUser = Annotated[User, Depends(require_roles(Role.MANAGER, Role.REVIEWER))]


class InvalidMetadata(AppError):
    status_code = 400
    code = "VALIDATION_ERROR"
    message = "Dữ liệu metadata không hợp lệ"


def _parse_metadata(raw: str | None) -> SkillMetadata:
    try:
        return SkillMetadata.model_validate_json(raw or "{}")
    except ValidationError as exc:
        raise InvalidMetadata(details={"errors": exc.errors(include_url=False, include_context=False)}) from exc


def _validation_out(phase: str, findings) -> ValidationOut:
    items = [
        FindingOut(
            check=getattr(f, "check", None) or f.check_name,
            result=f.result,
            detail=f.detail,
            file_path=f.file_path,
            line=f.line,
        )
        for f in findings
    ]
    return ValidationOut(phase=phase, ok=not any(i.result == "fail" for i in items), results=items)


def _owner_versions(db, versions) -> list[VersionOut]:
    """VersionOut kèm góp ý duyệt và người được giao (chỉ dùng cho chủ skill, mục Studio)."""
    reviews = reviews_repo.latest_reviews(db, [v.id for v in versions])
    out = []
    for v in versions:
        item = VersionOut.model_validate(v)
        if v.status in (VersionStatus.REJECTED.value, VersionStatus.PUBLISHED.value) and v.id in reviews:
            item.review_decision = reviews[v.id].decision
            item.review_comment = reviews[v.id].comment
        if v.status == VersionStatus.PENDING.value and v.assigned_to:
            assignee = db.get(User, v.assigned_to)
            item.assigned_to_name = assignee.display_name if assignee else None
        out.append(item)
    return out


def _skill_out(db, skill) -> SkillOut:
    out = SkillOut.model_validate(skill)
    facets = repository.facet_slugs_of(db, [skill.id]).get(skill.id, {})
    out.output_types = facets.get(taxonomy.OUTPUT_TYPE, [])
    out.ecosystems = facets.get(taxonomy.ECOSYSTEM, [])
    return out


def _read(upload: UploadFile | None, limit: int) -> bytes | None:
    if upload is None or not upload.filename:
        return None
    return service.read_limited(upload.file, limit)


# ---- Creator ---------------------------------------------------------------


@router.get("/mine", response_model=list[SkillMineItem])
def my_skills(db: DbSession, user: CreatorUser) -> list[SkillMineItem]:
    items = []
    for skill in service.list_mine(db, user):
        versions = repository.list_versions(db, skill.id)
        latest = versions[-1] if versions else None
        item = SkillMineItem.model_validate(skill)
        facets = _skill_out(db, skill)
        item.output_types, item.ecosystems = facets.output_types, facets.ecosystems
        item.latest_draft_version = _owner_versions(db, [latest])[0] if latest else None
        items.append(item)
    return items


@router.post("", response_model=CreateSkillResponse, status_code=status.HTTP_201_CREATED)
def create_skill(
    db: DbSession,
    settings: SettingsDep,
    storage: Storage,
    user: CreatorUser,
    package: Annotated[UploadFile, File()],
    metadata: Annotated[str | None, Form()] = None,
    icon: Annotated[UploadFile | None, File()] = None,
) -> CreateSkillResponse:
    meta = _parse_metadata(metadata)
    data = _read(package, settings.max_package_bytes)
    if data is None:
        raise InvalidMetadata("Thiếu file gói")
    skill, analysis = service.create_skill(
        db, storage, settings, user, meta, data, _read(icon, settings.max_icon_bytes)
    )
    return CreateSkillResponse(
        skill=_skill_out(db, skill),
        version=VersionOut.model_validate(analysis.version),
        validation=_validation_out("preview", analysis.findings),
        prefill=analysis.prefill,
    )


@router.patch("/{skill_id}", response_model=SkillOut)
def update_skill(skill_id: int, body: SkillUpdate, db: DbSession, settings: SettingsDep, user: CreatorUser):
    skill, pending = service.update_skill(db, settings, user, skill_id, body)
    if pending is None:
        return _skill_out(db, skill)
    # Mở rộng phạm vi xem phải duyệt lại: tạo yêu cầu, giữ phạm vi cũ trong lúc chờ (D27).
    req = reviews_service.create_visibility_request(
        db,
        user,
        skill_id=skill.id,
        skill_name=skill.name,
        from_visibility=pending.from_visibility,
        to_visibility=pending.to_visibility,
        from_department=pending.from_department,
        to_department=pending.to_department,
    )
    return JSONResponse(
        {
            "skill": _skill_out(db, skill).model_dump(mode="json"),
            "visibility_request": {"id": req.id, "status": req.status, "to_visibility": req.to_visibility},
        },
        status_code=202,
    )


@router.post(
    "/{skill_id}/versions", response_model=VersionWithValidation, status_code=status.HTTP_201_CREATED
)
def add_version(
    skill_id: int,
    db: DbSession,
    settings: SettingsDep,
    storage: Storage,
    user: CreatorUser,
    version: Annotated[str, Form(max_length=32)],
    package: Annotated[UploadFile, File()],
    changelog: Annotated[str | None, Form()] = None,
    icon: Annotated[UploadFile | None, File()] = None,
) -> VersionWithValidation:
    data = _read(package, settings.max_package_bytes)
    if data is None:
        raise InvalidMetadata("Thiếu file gói")
    analysis = service.add_version(
        db, storage, settings, user, skill_id,
        version=version, changelog=changelog, package=data,
        icon=_read(icon, settings.max_icon_bytes),
    )
    return VersionWithValidation(
        version=VersionOut.model_validate(analysis.version),
        validation=_validation_out("preview", analysis.findings),
        prefill=analysis.prefill,
    )


@router.patch("/{skill_id}/versions/{version}", response_model=VersionWithValidation)
def update_version(
    skill_id: int,
    version: str,
    body: VersionUpdate,
    db: DbSession,
    settings: SettingsDep,
    storage: Storage,
    user: CreatorUser,
) -> VersionWithValidation:
    analysis = service.update_version(
        db, storage, settings, user, skill_id, version,
        new_version=body.version, changelog=body.changelog, changelog_set="changelog" in body.model_fields_set,
    )
    return VersionWithValidation(
        version=VersionOut.model_validate(analysis.version),
        validation=_validation_out("preview", analysis.findings),
        prefill=analysis.prefill,
    )


@router.put("/{skill_id}/versions/{version}/package", response_model=VersionWithValidation)
def replace_package(
    skill_id: int,
    version: str,
    db: DbSession,
    settings: SettingsDep,
    storage: Storage,
    user: CreatorUser,
    package: Annotated[UploadFile, File()],
) -> VersionWithValidation:
    data = _read(package, settings.max_package_bytes)
    if data is None:
        raise InvalidMetadata("Thiếu file gói")
    analysis = service.replace_package(db, storage, settings, user, skill_id, version, data)
    return VersionWithValidation(
        version=VersionOut.model_validate(analysis.version),
        validation=_validation_out("preview", analysis.findings),
        prefill=analysis.prefill,
    )


@router.put("/{skill_id}/versions/{version}/icon", response_model=ValidationOut)
def replace_icon(
    skill_id: int,
    version: str,
    db: DbSession,
    settings: SettingsDep,
    storage: Storage,
    user: CreatorUser,
    icon: Annotated[UploadFile, File()],
) -> ValidationOut:
    data = _read(icon, settings.max_icon_bytes)
    if data is None:
        raise InvalidMetadata("Thiếu file ảnh")
    findings = service.replace_icon(db, storage, settings, user, skill_id, version, data)
    return _validation_out("preview", findings)


@router.delete("/{skill_id}/versions/{version}", status_code=status.HTTP_204_NO_CONTENT)
def delete_version(
    skill_id: int, version: str, db: DbSession, storage: Storage, user: CreatorUser
) -> Response:
    service.delete_version(db, storage, user, skill_id, version)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{skill_id}/versions/{version}/submit", response_model=VersionWithValidation)
def submit_version(
    skill_id: int,
    version: str,
    db: DbSession,
    settings: SettingsDep,
    storage: Storage,
    user: CreatorUser,
):
    analysis = service.submit(db, storage, settings, user, skill_id, version)
    validation = _validation_out("submit", analysis.findings)
    if not analysis.ok:
        # Không raise để giữ kết quả đã ghi (get_db chỉ rollback khi có ngoại lệ).
        body = error_body(
            "VALIDATION_FAILED",
            "Kiểm tra tự động phát hiện lỗi",
            {"results": [r.model_dump() for r in validation.results]},
        )
        return JSONResponse(body, status_code=422)
    return VersionWithValidation(
        version=VersionOut.model_validate(analysis.version), validation=validation, prefill=analysis.prefill
    )


@router.get("/{skill_id}/versions/{version}/validation", response_model=ValidationOut)
def get_validation(
    skill_id: int, version: str, db: DbSession, user: CurrentUser, phase: str | None = None
) -> ValidationOut:
    chosen, rows = service.get_validation(db, user, skill_id, version, phase)
    return _validation_out(chosen, rows)


# ---- Đọc và tìm kiếm --------------------------------------------------------

@router.get("", response_model=Page[SkillCard])
def search_skills(
    db: DbSession,
    user: CurrentUser,
    page: Annotated[PageParams, Depends()],
    q: str | None = Query(None, max_length=100),
    category: int | None = None,
    department: str | None = None,
    tag: Annotated[list[str] | None, Query()] = None,
    output_type: Annotated[list[str] | None, Query()] = None,
    ecosystem: Annotated[list[str] | None, Query()] = None,
    sort: Literal["newest", "popular", "name"] = "newest",
) -> Page[SkillCard]:
    items, total = service.search(
        db, user, q=q, category_id=category, department=department, tags=tag or [],
        output_types=output_type or [], ecosystems=ecosystem or [], sort=sort, offset=page.offset, limit=page.page_size,
    )
    return Page(items=items, total=total, page=page.page, page_size=page.page_size)


@router.put("/{skill_id}/classification", response_model=ClassificationOut)
def classify_manual(skill_id: int, body: ClassificationUpdate, db: DbSession, staff: StaffUser) -> ClassificationOut:
    facets = service.staff_classify_manual(db, staff, skill_id, body.output_types, body.ecosystems)
    return ClassificationOut(output_types=facets[taxonomy.OUTPUT_TYPE], ecosystems=facets[taxonomy.ECOSYSTEM])


@router.post("/{skill_id}/classification/auto", response_model=AutoClassifyOut)
def classify_auto(
    skill_id: int, body: AutoClassifyRequest, db: DbSession, settings: SettingsDep, storage: Storage,
    manager: ManagerUser,
) -> AutoClassifyOut:
    return AutoClassifyOut(**service.staff_classify_auto(db, settings, storage, manager, skill_id, force=body.force))


@router.get("/facets", response_model=FacetsOut)
def skill_facets(
    db: DbSession,
    user: CurrentUser,
    q: str | None = Query(None, max_length=100),
    category: int | None = None,
    department: str | None = None,
    tag: Annotated[list[str] | None, Query()] = None,
    output_type: Annotated[list[str] | None, Query()] = None,
    ecosystem: Annotated[list[str] | None, Query()] = None,
) -> FacetsOut:
    return service.facets(
        db, user, q=q, category_id=category, department=department, tags=tag or [],
        output_types=output_type or [], ecosystems=ecosystem or [],
    )


@router.get("/featured", response_model=list[SkillCard])
def featured_skills(
    db: DbSession, user: CurrentUser, limit: Annotated[int, Query(ge=1, le=24)] = 12
) -> list[SkillCard]:
    return service.featured(db, user, limit)


@router.get("/{skill_id}/icon")
def skill_icon(
    skill_id: int, db: DbSession, storage: Storage, user: CurrentUser, version: str | None = None
) -> Response:
    data, ver = service.icon_for(db, storage, user, skill_id, version)
    return Response(
        content=data,
        media_type="image/webp",
        headers={"Cache-Control": "private, max-age=300", "ETag": f'"{ver.id}-{ver.icon_key}"'},
    )


@router.get("/{skill_id}/download", response_model=DownloadOut)
def download(
    skill_id: int,
    db: DbSession,
    settings: SettingsDep,
    storage: Storage,
    user: CurrentUser,
    version: str = "latest",
    intent: Literal["install", "zip"] = "install",
) -> DownloadOut:
    ver = service.prepare_download(db, user, skill_id, version, intent)
    if intent == "zip":
        installs_service.record_zip_download(db, user, skill_id, ver.version)
    ttl = timedelta(minutes=settings.download_url_ttl_minutes)
    # Azure: SAS URL ngắn hạn, chỉ đọc, sau khi đã kiểm tra quyền. Bản cục bộ: phát qua backend.
    signed = storage.presign(ver.package_key, filename=f"skill-{skill_id}-{ver.version}.zip", ttl=ttl)
    return DownloadOut(
        url=signed.url if signed else f"/api/skills/{skill_id}/versions/{ver.version}/package",
        expires_at=signed.expires_at if signed else utcnow() + ttl,
        version=ver.version,
        checksum=f"sha256:{ver.checksum}" if ver.checksum else None,
    )


@router.get("/{skill_id}/versions/{version}/package")
def download_package(
    skill_id: int, version: str, db: DbSession, storage: Storage, user: CurrentUser
) -> Response:
    data, ver = service.package_for(db, storage, user, skill_id, version)
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="skill-{skill_id}-{ver.version}.zip"'},
    )


@router.get("/{skill_id}", response_model=SkillDetail)
def skill_detail(
    skill_id: int, db: DbSession, user: CurrentUser, version: str | None = Query(None, max_length=32)
) -> SkillDetail:
    skill = service.get_visible_skill(db, user, skill_id)
    detail = SkillDetail.model_validate(skill)
    detail.tag_ids = repository.tag_ids_of(db, skill.id)
    facets = repository.facet_slugs_of(db, [skill.id]).get(skill.id, {})
    detail.output_types = facets.get(taxonomy.OUTPUT_TYPE, [])
    detail.ecosystems = facets.get(taxonomy.ECOSYSTEM, [])
    auto = repository.auto_facet_slugs(db, skill.id)
    detail.auto_output_types = auto[taxonomy.OUTPUT_TYPE]
    detail.auto_ecosystems = auto[taxonomy.ECOSYSTEM]
    detail.tags = repository.approved_tag_names(db, [skill.id]).get(skill.id, [])
    detail.install_count = installs_repo.install_counts(db, [skill.id]).get(skill.id, 0)
    if skill.owner_id is not None:
        owner = db.get(User, skill.owner_id)
        detail.owner_name = owner.display_name if owner else None
    latest = next((v for v in skill.versions if v.id == skill.latest_version_id), None)
    if latest is not None and skill.status == SkillStatus.PUBLISHED.value:
        detail.latest_version = VersionOut.model_validate(latest)
    viewing = service.version_for_view(db, skill, user, version)
    if viewing is not None:
        detail.viewing_version = VersionOut.model_validate(viewing)
        detail.skill_md = viewing.skill_md
        # Ảnh phục vụ qua /icon của bản đang đăng mới nhất; chỉ báo có ảnh khi đúng bản đó có ảnh.
        detail.has_icon = bool(latest is not None and latest.icon_key and skill.status == SkillStatus.PUBLISHED.value)
    return detail


@router.get("/{skill_id}/versions", response_model=list[VersionOut])
def list_versions(skill_id: int, db: DbSession, user: CurrentUser) -> list[VersionOut]:
    skill = service.get_visible_skill(db, user, skill_id)
    privileged = user.role == Role.MANAGER.value or skill.owner_id == user.id
    visible = {VersionStatus.PUBLISHED.value, VersionStatus.REVOKED.value}
    versions = [v for v in repository.list_versions(db, skill.id) if privileged or v.status in visible]
    if skill.owner_id == user.id:
        return _owner_versions(db, versions)
    return [VersionOut.model_validate(v) for v in versions]


# ---- Danh mục, phòng ban, tag ---------------------------------------------------

catalog_router = APIRouter(prefix="/api", tags=["catalog"])


@catalog_router.get("/categories", response_model=list[CategoryOut])
def categories(db: DbSession, user: CurrentUser) -> list[CategoryOut]:
    return [CategoryOut.model_validate(c) for c in repository.list_categories(db)]


@catalog_router.get("/taxonomy", response_model=TaxonomyOut)
def get_taxonomy(user: CurrentUser) -> TaxonomyOut:
    return TaxonomyOut(output_types=taxonomy.allowed(taxonomy.OUTPUT_TYPE), ecosystems=taxonomy.allowed(taxonomy.ECOSYSTEM))


@catalog_router.get("/departments", response_model=list[str])
def departments(settings: SettingsDep, user: CurrentUser) -> list[str]:
    return settings.department_list


@catalog_router.get("/tags", response_model=list[TagOut])
def tags(
    db: DbSession, user: CurrentUser, q: str | None = Query(None, max_length=50),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[TagOut]:
    return [
        TagOut(id=t.id, name=t.name, status=t.status, usage_count=n)
        for t, n in repository.list_approved_tags(db, q, limit)
    ]


@catalog_router.post("/tags/proposals", response_model=TagOut)
def propose_tag(body: TagProposal, db: DbSession, user: CreatorUser, response: Response) -> TagOut:
    tag, created = service.propose_tag(db, user, body.name)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return TagOut.model_validate(tag)


@catalog_router.get("/tags/proposals/mine", response_model=list[TagOut])
def my_tag_proposals(db: DbSession, user: CreatorUser) -> list[TagOut]:
    return [TagOut.model_validate(t) for t in repository.tags_proposed_by(db, user.id)]
