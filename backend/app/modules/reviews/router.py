from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.dependencies import DbSession, SettingsDep
from app.core.storage import BlobStorage, get_storage
from app.modules.auth.dependencies import require_roles
from app.modules.reviews import service
from app.modules.reviews.exceptions import ReviewItemNotFound
from app.modules.reviews.schemas import (
    AssignRequest,
    DecisionRequest,
    FileContentOut,
    FileEntryOut,
    HistoryItem,
    QueueItem,
    ReviewFinding,
    VersionReviewDetail,
    VisibilityRequestDetail,
)
from app.modules.skills import review_api as skills_api
from app.modules.users.models import Role, User
from app.shared.pagination import Page, PageParams

router = APIRouter(prefix="/api/reviews", tags=["reviews"])

Reviewer = Annotated[User, Depends(require_roles(Role.REVIEWER))]
Manager = Annotated[User, Depends(require_roles(Role.MANAGER))]
ReviewerOrManager = Annotated[User, Depends(require_roles(Role.REVIEWER, Role.MANAGER))]
Storage = Annotated[BlobStorage, Depends(get_storage)]


@router.get("/queue", response_model=Page[QueueItem])
def queue(
    db: DbSession,
    settings: SettingsDep,
    user: ReviewerOrManager,
    params: Annotated[PageParams, Depends()],
    type: Annotated[str | None, Query(pattern="^(version|visibility)$")] = None,
    assigned: bool | None = None,
    reviewer_id: int | None = None,
    overdue: bool | None = None,
) -> Page[QueueItem]:
    flt = service.QueueFilter(kind=type, assigned=assigned, reviewer_id=reviewer_id, overdue=overdue)
    return service.queue(db, user, settings, flt, params)


@router.get("/history", response_model=Page[HistoryItem])
def history(db: DbSession, user: Reviewer, params: Annotated[PageParams, Depends()]) -> Page[HistoryItem]:
    return service.history(db, user, params)


# ---- phiên bản --------------------------------------------------------------


@router.get("/versions/{version_id}", response_model=VersionReviewDetail)
def version_detail(version_id: int, db: DbSession, user: ReviewerOrManager) -> VersionReviewDetail:
    version, skill = service.load_version(db, user, version_id)
    base = skills_api.base_version(skill, exclude_id=version.id)
    return VersionReviewDetail(
        version_id=version.id,
        version=version.version,
        status=version.status,
        skill_id=skill.id,
        skill_name=skill.name,
        summary=skill.summary,
        origin=skill.origin,
        department=skill.department,
        visibility=skill.visibility,
        changelog=version.changelog,
        skill_md=version.skill_md,
        submitted_at=version.submitted_at,
        assigned_to=version.assigned_to,
        assigned_by_name=service._name(db, version.assigned_by),
        owner_name=service._name(db, skill.owner_id),
        has_icon=bool(version.icon_key),
        base_version=base.version if base else None,
        validation=[
            ReviewFinding(
                check=r.check_name, result=r.result, detail=r.detail, file_path=r.file_path, line=r.line
            )
            for r in skills_api.submit_results(version)
        ],
    )


@router.get("/versions/{version_id}/icon")
def version_icon(version_id: int, db: DbSession, storage: Storage, user: ReviewerOrManager) -> Response:
    version, _ = service.load_version(db, user, version_id)
    data = skills_api.icon_bytes(storage, version)
    if data is None:
        raise ReviewItemNotFound("Phiên bản không có ảnh biểu tượng")
    return Response(data, media_type="image/webp", headers={"Cache-Control": "private, max-age=300"})


@router.get("/versions/{version_id}/files", response_model=list[FileEntryOut])
def version_files(version_id: int, db: DbSession, user: ReviewerOrManager) -> list[FileEntryOut]:
    version, skill = service.load_version(db, user, version_id)
    base = skills_api.base_version(skill, exclude_id=version.id)
    return [FileEntryOut(**e.__dict__) for e in skills_api.file_tree(version, base)]


@router.get("/versions/{version_id}/files/content", response_model=FileContentOut)
def version_file_content(
    version_id: int, db: DbSession, storage: Storage, user: ReviewerOrManager, path: str = Query(..., max_length=1000)
) -> FileContentOut:
    version, skill = service.load_version(db, user, version_id)
    base = skills_api.base_version(skill, exclude_id=version.id)
    content = skills_api.file_content(storage, version, base, path)
    if content is None:
        raise ReviewItemNotFound("Không có file này trong gói")
    return FileContentOut(**content)


@router.get("/versions/{version_id}/package")
def version_package(version_id: int, db: DbSession, storage: Storage, user: ReviewerOrManager) -> Response:
    # Bản cục bộ trả trực tiếp; trên Azure sẽ trả SAS URL ngắn hạn.
    version, skill = service.load_version(db, user, version_id)
    data = skills_api.package_bytes(storage, version)
    filename = f"{skill.name}-{version.version}.zip".replace('"', "")
    return Response(
        data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename.encode("ascii", "ignore").decode() or "skill.zip"}"'},
    )


@router.put("/versions/{version_id}/assignment", status_code=status.HTTP_204_NO_CONTENT)
def assign_version(version_id: int, body: AssignRequest, db: DbSession, user: Manager) -> Response:
    service.assign_version(db, user, version_id, body.reviewer_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/versions/{version_id}/assignment", status_code=status.HTTP_204_NO_CONTENT)
def unassign_version(version_id: int, db: DbSession, user: Manager) -> Response:
    service.unassign_version(db, user, version_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/versions/{version_id}/decision", status_code=status.HTTP_204_NO_CONTENT)
def decide_version(
    version_id: int, body: DecisionRequest, db: DbSession, storage: Storage, user: Reviewer
) -> Response:
    service.decide_version(db, storage, user, version_id, body.decision, body.comment)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- yêu cầu đổi phạm vi xem ------------------------------------------------------------


@router.get("/visibility-requests/{request_id}", response_model=VisibilityRequestDetail)
def request_detail(request_id: int, db: DbSession, user: ReviewerOrManager) -> VisibilityRequestDetail:
    req = service.load_request(db, user, request_id)
    skill = skills_api.get_skill(db, req.skill_id)
    return VisibilityRequestDetail(
        id=req.id,
        skill_id=req.skill_id,
        skill_name=skill.name if skill else "?",
        summary=skill.summary if skill else None,
        status=req.status,
        from_visibility=req.from_visibility,
        to_visibility=req.to_visibility,
        from_department=req.from_department,
        to_department=req.to_department,
        created_at=req.created_at,
        assigned_to=req.assigned_to,
        comment=req.comment,
    )


@router.put("/visibility-requests/{request_id}/assignment", status_code=status.HTTP_204_NO_CONTENT)
def assign_request(request_id: int, body: AssignRequest, db: DbSession, user: Manager) -> Response:
    service.assign_request(db, user, request_id, body.reviewer_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/visibility-requests/{request_id}/decision", status_code=status.HTTP_204_NO_CONTENT)
def decide_request(request_id: int, body: DecisionRequest, db: DbSession, user: Reviewer) -> Response:
    service.decide_request(db, user, request_id, body.decision, body.comment)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
