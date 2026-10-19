"""Dọn dẹp định kỳ: bản nháp bị bỏ quên và nhật ký kiểm toán quá hạn lưu.

Chạy chung trong `python -m app.jobs.scheduled`. Idempotent: thông báo có `dedupe_key`.
"""
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.storage import BlobStorage
from app.modules.audit import service as audit
from app.modules.notifications import service as notifications
from app.modules.skills import cleanup_api
from app.shared.utils import utcnow


def run_cleanup(
    db: Session, storage: BlobStorage, settings: Settings, now: datetime | None = None
) -> dict[str, int]:
    now = now or utcnow()
    summary = {"drafts_warned": 0, "drafts_deleted": 0, "audit_purged": 0}

    warn_after = timedelta(days=max(settings.draft_retention_days - settings.draft_warn_days, 0))
    expire_after = timedelta(days=settings.draft_retention_days)
    for version, skill, last_activity in cleanup_api.stale_drafts(db, before=now - warn_after):
        label = f"{skill.name} {version.version}"
        if now - last_activity >= expire_after:
            skill_id, version_id, owner_id = skill.id, version.id, skill.owner_id
            cleanup_api.delete_draft(db, storage, version, skill)
            audit.record(db, None, "draft.purge", "skill_version", version_id,
                         {"skill_id": skill_id, "label": label, "inactive_days": (now - last_activity).days})
            if owner_id is not None:
                notifications.notify(
                    db, [owner_id], "draft.purged",
                    f"Bản nháp {label} đã bị dọn vì quá {settings.draft_retention_days} ngày không gửi duyệt",
                    link="/studio",
                )
            summary["drafts_deleted"] += 1
        else:
            remaining = expire_after - (now - last_activity)
            days_left = max(-int(-remaining.total_seconds() // 86400), 0)  # làm tròn lên
            created = notifications.notify(
                db, [skill.owner_id], "draft.expiring",
                f"Bản nháp {label} sẽ bị dọn sau {days_left} ngày nếu không gửi duyệt",
                link=f"/studio/{skill.id}?version={version.version}",
                dedupe_key=f"draft-expiring:{version.id}",
            )
            summary["drafts_warned"] += created

    cutoff = now - timedelta(days=365 * settings.audit_retention_years)
    purged = audit.purge_older_than(db, cutoff)
    if purged:
        audit.record(db, None, "audit.purge", "audit_log", None,
                     {"rows": purged, "older_than": cutoff.isoformat()})
    summary["audit_purged"] = purged
    return summary
