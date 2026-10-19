from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from fastapi.responses import JSONResponse

from app.core.dependencies import DbSession, SettingsDep
from app.core.storage import BlobStorage, get_storage
from app.modules.auth.dependencies import require_roles
from app.modules.sources import repository, service
from app.modules.sources.schemas import ScanOut, SourceCreate, SourceOut, SourceUpdate
from app.modules.users.models import Role, User
from app.shared.pagination import Page, PageParams

router = APIRouter(prefix="/api/admin/sources", tags=["sources"])

ManagerUser = Annotated[User, Depends(require_roles(Role.MANAGER))]
Storage = Annotated[BlobStorage, Depends(get_storage)]


@router.get("", response_model=list[SourceOut])
def list_sources(db: DbSession, _: ManagerUser) -> list[SourceOut]:
    return service.list_sources(db)


@router.post("", response_model=SourceOut, status_code=status.HTTP_201_CREATED)
def create_source(body: SourceCreate, db: DbSession, settings: SettingsDep, manager: ManagerUser) -> SourceOut:
    return service.create_source(db, settings, manager, body)


@router.patch("/{source_id}", response_model=SourceOut)
def update_source(
    source_id: int, body: SourceUpdate, db: DbSession, settings: SettingsDep, manager: ManagerUser
) -> SourceOut:
    return service.update_source(db, settings, manager, source_id, body)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(source_id: int, db: DbSession, manager: ManagerUser) -> Response:
    service.delete_source(db, manager, source_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{source_id}/scan", status_code=status.HTTP_202_ACCEPTED)
def scan_now(
    source_id: int, db: DbSession, settings: SettingsDep, storage: Storage, manager: ManagerUser
) -> JSONResponse:
    source = service._get(db, source_id)
    scan = service.scan_source(db, settings, storage, source, triggered_by=manager)
    body = {"scan_id": scan.id, "status": scan.status, "message": scan.message, "counts": scan.counts}
    return JSONResponse(body, status_code=status.HTTP_202_ACCEPTED)


@router.get("/{source_id}/scans", response_model=Page[ScanOut])
def scan_history(
    source_id: int, db: DbSession, _: ManagerUser, page: Annotated[PageParams, Depends()]
) -> Page[ScanOut]:
    service._get(db, source_id)
    rows, total = repository.scans_of(db, source_id, page.offset, page.page_size)
    return Page(
        items=[ScanOut.model_validate(r) for r in rows], total=total, page=page.page, page_size=page.page_size
    )
