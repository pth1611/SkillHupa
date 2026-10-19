"""Gợi ý phân loại cho skill đã có từ trước: `python -m app.jobs.backfill_classification`.

Mặc định chỉ xử lý skill chưa có facet nào. `--refresh` tính lại cả skill có facet tự động
(không bao giờ ghi đè giá trị do người chọn). `--dry-run` chỉ in kết quả, không ghi.
"""
import argparse
import logging

from app.core.config import get_settings
from app.core.database import get_session_factory
from app.core.logging import configure_logging
from app.core.storage import get_storage
from app.modules.skills import classifier, repository, service
from app.modules.skills.models import Skill

logger = logging.getLogger("jobs.backfill_classification")


def run(db, settings, storage, *, refresh: bool = False, dry_run: bool = False) -> dict[str, int]:
    summary = {"checked": 0, "updated": 0, "skipped_no_package": 0, "no_suggestion": 0}
    for skill_id in repository.skill_ids_without_manual_facets(db, only_empty=not refresh):
        skill = db.get(Skill, skill_id)
        ver = service.latest_packaged_version(db, skill)
        summary["checked"] += 1
        if ver is None:
            summary["skipped_no_package"] += 1
            continue
        guess = classifier.suggest(service._inspect(settings, storage.get(ver.package_key)))
        if not guess.output_types and not guess.ecosystems:
            summary["no_suggestion"] += 1
            continue
        logger.info("skill %s: output=%s ecosystem=%s", skill.id, guess.output_types, guess.ecosystems)
        if dry_run or service.apply_auto_classification(db, skill.id, guess):
            summary["updated"] += 1
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="tính lại cả skill đã có facet tự động")
    parser.add_argument("--dry-run", action="store_true", help="chỉ in, không ghi")
    args = parser.parse_args()
    configure_logging()
    settings = get_settings()
    with get_session_factory()() as db:
        try:
            summary = run(db, settings, get_storage(), refresh=args.refresh, dry_run=args.dry_run)
            if args.dry_run:
                db.rollback()
            else:
                db.commit()
        except Exception:
            db.rollback()
            logger.exception("Backfill phân loại thất bại")
            return 1
    logger.info("Backfill phân loại xong: %s", summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
