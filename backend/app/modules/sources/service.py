import io
import logging
import zipfile
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path, PurePosixPath
from zoneinfo import ZoneInfo

import yaml
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.exceptions import AppError
from app.core.storage import BlobStorage
from app.modules.audit import service as audit
from app.modules.notifications import service as notifications
from app.modules.skills import import_api, packaging, validation
from app.modules.skills import service as skills_service
from app.modules.skills.models import Skill, SkillStatus
from app.modules.skills.validation import parse_semver
from app.modules.sources import connectors, repository
from app.modules.sources.connectors.base import (
    ConnectorError,
    RemoteFile,
    RepoInfo,
    SourceConnector,
)
from app.modules.sources.connectors.github import parse_repo_url
from app.modules.sources.exceptions import (
    InvalidSource,
    ScanInProgress,
    SourceExists,
    SourceNotFound,
)
from app.modules.sources.models import SkillSource, SourceScan
from app.modules.sources.schemas import SourceCreate, SourceOut, SourceUpdate
from app.modules.users.models import User
from app.shared.utils import utcnow

logger = logging.getLogger(__name__)

LICENSES_PATH = Path(__file__).with_name("allowed_licenses.yaml")
SCAN_LOCK_TTL = timedelta(minutes=30)
SKILL_MD = "SKILL.md"


@lru_cache
def allowed_licenses() -> frozenset[str]:
    with LICENSES_PATH.open(encoding="utf-8") as fh:
        return frozenset(yaml.safe_load(fh).get("allowed", []))


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


# ---- khai báo nguồn ---------------------------------------------------------------


def _clean_path(raw: str) -> str:
    path = raw.strip().strip("/")
    parts = PurePosixPath(path).parts if path else ()
    if ".." in parts or "\\" in path or path.startswith("~"):
        raise InvalidSource("Thư mục quét không hợp lệ")
    return path


def _clean_ref(ref: str | None) -> str | None:
    if ref is None or not ref.strip():
        return None
    ref = ref.strip()
    if ".." in ref or not all(c.isalnum() or c in "._/-" for c in ref):
        raise InvalidSource("Nhánh hoặc tag không hợp lệ")
    return ref


def _check_credential(name: str | None) -> str | None:
    if not name:
        return None
    if not connectors.CREDENTIAL_RE.match(name):
        raise InvalidSource(f"Tên bí mật phải có dạng {connectors.CREDENTIAL_PREFIX}<TEN_VIET_HOA>")
    return name


def _check_category(db: Session, category_id: int) -> None:
    from app.modules.skills import repository as skills_repo

    if not any(c.id == category_id for c in skills_repo.list_categories(db)):
        raise InvalidSource("Danh mục mặc định không tồn tại")


def _out(source: SkillSource, counts: dict[int, int]) -> SourceOut:
    return SourceOut(
        id=source.id, type=source.type, name=source.name, url=source.url, ref=source.ref,
        path_glob=source.path_glob, default_category=source.default_category_id,
        default_department=source.default_department, default_visibility=source.default_visibility,
        credential_name=source.credential_name, internal=source.is_internal, is_enabled=source.is_enabled,
        last_scan_at=source.last_scan_at, last_scan_status=source.last_scan_status,
        last_scan_message=source.last_scan_message, skill_count=counts.get(source.id, 0),
    )


def _get(db: Session, source_id: int) -> SkillSource:
    source = repository.get(db, source_id)
    if source is None:
        raise SourceNotFound()
    return source


def list_sources(db: Session) -> list[SourceOut]:
    counts = repository.skill_counts(db)
    return [_out(s, counts) for s in repository.list_all(db)]


def create_source(db: Session, settings: Settings, manager: User, body: SourceCreate) -> SourceOut:
    if body.type not in connectors.SUPPORTED_TYPES:
        raise InvalidSource(
            f"Loại nguồn {body.type} chưa được hỗ trợ", {"supported": sorted(connectors.SUPPORTED_TYPES)}
        )
    parsed = parse_repo_url(body.url)
    if parsed is None:
        raise InvalidSource("Địa chỉ phải có dạng https://github.com/<owner>/<repo>")
    url = f"https://github.com/{parsed[0]}/{parsed[1]}"
    if repository.get_by_url(db, url) is not None:
        raise SourceExists()
    skills_service.check_department(settings, body.default_department)
    _check_category(db, body.default_category)
    source = repository.add(
        db,
        SkillSource(
            type=body.type, name=body.name or f"{parsed[0]}/{parsed[1]}", url=url,
            ref=_clean_ref(body.ref), path_glob=_clean_path(body.path_glob),
            default_category_id=body.default_category, default_department=body.default_department,
            default_visibility=body.default_visibility,
            credential_name=_check_credential(body.credential_name),
            is_internal=body.internal, created_by=manager.id,
        ),
    )
    audit.record(db, manager, "source.create", "source", source.id, {"url": url, "internal": body.internal})
    return _out(source, {})


def update_source(
    db: Session, settings: Settings, manager: User, source_id: int, body: SourceUpdate
) -> SourceOut:
    source = _get(db, source_id)
    data = body.model_dump(exclude_unset=True)
    if "ref" in data:
        source.ref = _clean_ref(data["ref"])
    if "path_glob" in data and data["path_glob"] is not None:
        source.path_glob = _clean_path(data["path_glob"])
    if data.get("default_category") is not None:
        _check_category(db, data["default_category"])
        source.default_category_id = data["default_category"]
    if data.get("default_department") is not None:
        skills_service.check_department(settings, data["default_department"])
        source.default_department = data["default_department"]
    if "credential_name" in data:
        source.credential_name = _check_credential(data["credential_name"])
    for field_name, attr in (
        ("name", "name"), ("default_visibility", "default_visibility"),
        ("internal", "is_internal"), ("is_enabled", "is_enabled"),
    ):
        if data.get(field_name) is not None:
            setattr(source, attr, data[field_name])
    audit.record(db, manager, "source.update", "source", source.id,
                 {"changed": sorted(k for k in data if data[k] is not None or k in ("ref", "credential_name"))})
    db.flush()
    return _out(source, repository.skill_counts(db))


def delete_source(db: Session, manager: User, source_id: int) -> None:
    source = _get(db, source_id)
    import_api.detach_source(db, source.id)
    repository.delete_scans(db, source.id)
    audit.record(db, manager, "source.delete", "source", source.id, {"url": source.url})
    db.delete(source)
    db.flush()


# ---- quét -------------------------------------------------------------------------


@dataclass
class _Run:
    items: list[dict] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)
    connector_errors: int = 0

    def add(self, path: str, outcome: str, reason: str | None = None, **extra) -> None:
        self.items.append({"path": path, "outcome": outcome, "reason": reason, **extra})
        self.counts[outcome] = self.counts.get(outcome, 0) + 1


def _skill_dirs(files: list[RemoteFile], prefix: str) -> dict[str, list[RemoteFile]]:
    """Mỗi thư mục chứa SKILL.md là một skill; file thuộc thư mục skill gần nhất."""
    def under_prefix(path: str) -> bool:
        return not prefix or path == prefix or path.startswith(prefix + "/")

    dirs = sorted(
        {
            str(PurePosixPath(f.path).parent) if "/" in f.path else ""
            for f in files
            if PurePosixPath(f.path).name == SKILL_MD and under_prefix(f.path)
        },
        key=len,
        reverse=True,
    )
    dirs = [d if d != "." else "" for d in dirs]
    owned: dict[str, list[RemoteFile]] = {d: [] for d in dirs}
    for f in files:
        for d in dirs:  # dài nhất trước => khớp thư mục skill gần nhất
            if not d or f.path.startswith(d + "/"):
                owned[d].append(f)
                break
    return dict(sorted(owned.items()))


def _build_zip(contents: dict[str, bytes]) -> bytes:
    """Gói xác định (thứ tự và thời gian cố định) để cùng nội dung cho cùng băm."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in sorted(contents):
            info = zipfile.ZipInfo(rel, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, contents[rel])
    return buf.getvalue()


def _license_problem(source: SkillSource, info: RepoInfo) -> str | None:
    if source.is_internal:
        return None
    if info.license is None:
        return "Repo không có giấy phép được xác định"
    if info.license not in allowed_licenses():
        return f"Giấy phép {info.license} không nằm trong danh sách cho phép"
    return None


def _import_dir(
    db: Session, settings: Settings, storage: BlobStorage, source: SkillSource, connector: SourceConnector,
    info: RepoInfo, directory: str, members: list[RemoteFile], license_problem: str | None,
    existing: Skill | None, run: _Run, now: datetime, notes: list[str],
) -> None:
    label = directory or "."
    if existing is not None and existing.status == SkillStatus.REMOVED.value:
        run.add(label, "skipped", "Skill đã bị gỡ khỏi marketplace", skill_id=existing.id)
        return
    if license_problem:
        run.add(label, "skipped", license_problem + "; không nhập thêm phiên bản", skill_id=existing.id if existing else None)
        return
    limits = skills_service._rules_limits()
    if len(members) > limits["max_files"] or sum(m.size for m in members) > settings.max_package_bytes:
        run.add(label, "skipped", "Thư mục vượt giới hạn số file hoặc dung lượng gói")
        return
    contents: dict[str, bytes] = {}
    base = f"{directory}/" if directory else ""
    for m in members:
        contents[m.path[len(base):]] = connector.fetch(info.commit, m.path)
    package = _build_zip(contents)

    try:
        peek = packaging.inspect(
            package, max_files=limits["max_files"], max_total_bytes=settings.max_package_bytes,
            max_skill_md_bytes=limits["max_skill_md_bytes"], max_scan_bytes=limits["max_scan_bytes_per_file"],
        )
    except packaging.NotAZipError as exc:
        run.add(label, "error", str(exc))
        return
    fm = peek.frontmatter
    if not fm.get("name") or not fm.get("description"):
        run.add(label, "skipped", "SKILL.md thiếu name hoặc description")
        return

    hashes = {f.path: f.sha256 for f in peek.files}
    if existing is not None and import_api.latest_file_hashes(existing) == hashes:
        run.add(label, "unchanged", skill_id=existing.id)
        return

    if info.semver_tag:
        version, ref = info.semver_tag.removeprefix("v"), info.semver_tag
    else:
        version, ref = import_api.next_internal_version(existing), None
    if existing is not None:
        top = import_api.highest_released(existing)
        key = parse_semver(version)
        if top is not None and key is not None and key <= top:
            reason = f"Phiên bản {version} ở nguồn không lớn hơn bản đã đăng"
            run.add(label, "skipped", reason, skill_id=existing.id)
            notes.append(f"{label}: {reason}")
            return
        if version in import_api.version_numbers(existing):
            run.add(label, "skipped", f"Phiên bản {version} đã tồn tại nhưng nội dung ở nguồn đã đổi",
                    skill_id=existing.id)
            return

    owner = (parse_repo_url(source.url) or ("", ""))[0] or None
    try:
        outcome = import_api.import_version(
            db, storage, settings, skill=existing, source_id=source.id, source_name=source.name,
            source_url=f"{source.url}/tree/{info.commit}/{directory}".rstrip("/"), path=directory, package=package,
            version=version, source_ref=ref, source_commit=info.commit, upstream_author=owner,
            license_id=info.license, category_id=source.default_category_id,
            department=source.default_department, visibility=source.default_visibility, now=now,
        )
    except AppError as exc:
        run.add(label, "error", exc.message)
        return
    if not outcome.ok:
        failed = "; ".join(f.detail for f in outcome.findings if f.result == validation.FAIL)
        run.add(label, "error", f"Kiểm tra tự động không đạt: {failed}", version=version,
                skill_id=outcome.skill.id)
        return
    run.add(label, "new_skill" if outcome.created_skill else "new_version", version=version,
            skill_id=outcome.skill.id)


def _sync_upstream_status(
    db: Session, source: SkillSource, info: RepoInfo, license_problem: str | None,
    found: set[str], now: datetime, scan_id: int,
) -> int:
    changed = 0
    for skill in import_api.list_for_source(db, source.id):
        if info.archived:
            status = "archived"
        elif license_problem:
            status = "license_changed"
        elif skill.source_path not in found:
            status = "missing"
        else:
            status = "ok"
        if import_api.set_upstream_status(skill, status, now) and status != "ok":
            changed += 1
            notifications.notify_managers(
                db, "source.upstream_problem",
                f"Skill {skill.name} có vấn đề ở nguồn {source.name}: {status}",
                link=f"/admin/skills/{skill.id}", dedupe_key=f"upstream:{skill.id}:{status}:{scan_id}",
            )
    return changed


def _wait_reporter(db: Session, settings: Settings, source: SkillSource, scan: SourceScan):
    """Báo đang chờ hạn mức GitHub và giữ khoá quét để lần quét khác không chen vào."""
    def report(left: int, until: int) -> None:
        at = datetime.fromtimestamp(until, ZoneInfo(settings.work_timezone)).strftime("%H:%M:%S %d/%m")
        message = f"Đang chờ GitHub đặt lại hạn mức, sẽ quét tiếp lúc {at} (còn khoảng {max(left // 60, 1)} phút)"
        source.scan_started_at = utcnow()
        source.last_scan_message = message
        notifications.notify_managers(
            db, "source.rate_limit_wait", f"Nguồn {source.name}: {message}",
            link=f"/admin/sources/{source.id}", dedupe_key=f"scan-wait:{scan.id}",
        )
        db.commit()
    return report


def scan_source(
    db: Session,
    settings: Settings,
    storage: BlobStorage,
    source: SkillSource,
    *,
    triggered_by: User | None = None,
    connector: SourceConnector | None = None,
    now: datetime | None = None,
) -> SourceScan:
    now = now or utcnow()
    if source.scan_started_at and now - _aware(source.scan_started_at) < SCAN_LOCK_TTL:
        raise ScanInProgress()
    source.scan_started_at = now
    db.commit()  # khoá hiện ngay với request khác

    run = _Run()
    status, message, commit_sha = "ok", None, None
    scan = repository.add_scan(
        db, SourceScan(source_id=source.id, started_at=now, status="ok", counts={}, items=[])
    )
    try:
        conn = connector or connectors.build_connector(
            source.type, source.url, source.ref, source.credential_name
        )
        if hasattr(conn, "on_wait"):
            conn.on_wait = _wait_reporter(db, settings, source, scan)
        info = conn.repo_info()
        commit_sha = info.commit
        files = conn.list_files(info.commit)
        problem = _license_problem(source, info)
        prefix = source.path_glob
        dirs = _skill_dirs(files, prefix)
        notes: list[str] = []
        for directory, members in dirs.items():
            existing = import_api.find_by_source_path(db, source.id, directory)
            try:
                _import_dir(db, settings, storage, source, conn, info, directory, members, problem,
                            existing, run, now, notes)
            except ConnectorError as exc:
                run.connector_errors += 1
                run.add(directory or ".", "error", str(exc))
        run.counts["upstream_changed"] = _sync_upstream_status(
            db, source, info, problem, set(dirs), now, scan.id
        )
        if run.connector_errors:
            status, message = "error", f"{run.connector_errors} thư mục không tải được từ nguồn"
        elif problem:
            message = problem
    except ConnectorError as exc:
        status, message = "error", str(exc)[:500]
    except Exception:
        logger.exception("Quét nguồn %s thất bại", source.id)
        status, message = "error", "Lỗi không mong đợi khi quét nguồn"

    finished = utcnow()
    scan.finished_at = finished
    scan.status = status
    scan.message = message
    scan.commit = commit_sha
    scan.triggered_by = triggered_by.id if triggered_by else None
    scan.counts = run.counts
    scan.items = run.items
    source.last_scan_at = finished
    source.last_scan_status = status
    source.last_scan_message = message
    source.scan_started_at = None
    audit.record(db, triggered_by, "source.scan", "source", source.id,
                 {"status": status, "counts": run.counts, "commit": commit_sha})

    created = run.counts.get("new_skill", 0) + run.counts.get("new_version", 0)
    problems = run.counts.get("error", 0)
    if created:
        notifications.notify_managers(
            db, "source.new_versions", f"Nguồn {source.name} có {created} phiên bản mới chờ phân công duyệt",
            link="/admin/assignments", dedupe_key=f"scan-new:{scan.id}",
        )
    if problems:
        notifications.notify_managers(
            db, "source.import_error", f"Nguồn {source.name}: {problems} mục nhập lỗi, xem lịch sử quét",
            link=f"/admin/sources/{source.id}", dedupe_key=f"scan-error:{scan.id}",
        )
    db.flush()
    return scan


def run_scheduled(
    db: Session, settings: Settings, storage: BlobStorage, now: datetime | None = None
) -> dict[str, int]:
    """Quét các nguồn đang bật đã quá khoảng `source_scan_interval_hours` kể từ lần quét trước."""
    now = now or utcnow()
    interval = timedelta(hours=settings.source_scan_interval_hours)
    summary = {"sources_scanned": 0, "sources_failed": 0}
    for source in repository.list_enabled(db):
        if source.last_scan_at and now - _aware(source.last_scan_at) < interval:
            continue
        try:
            scan = scan_source(db, settings, storage, source, now=now)
        except ScanInProgress:
            continue
        db.commit()
        summary["sources_scanned"] += 1
        if scan.status == "error":
            summary["sources_failed"] += 1
    return summary
