"""Điểm vào cho Azure Container Apps Job: `python -m app.jobs.scheduled`.

Chạy định kỳ (mặc định mỗi giờ trong giờ làm việc): nhắc việc chưa giao, tự chia việc,
nhắc việc quá hạn duyệt (D18, D28) quét các nguồn thu thập đến hạn (D46) và dọn dẹp (bản nháp bỏ quên, nhật ký quá hạn lưu).
"""
import logging

from app.core.config import get_settings
from app.core.database import get_session_factory
from app.core.logging import configure_logging
from app.core.storage import get_storage
from app.jobs.cleanup import run_cleanup
from app.modules.reviews import service as reviews
from app.modules.sources import service as sources

logger = logging.getLogger("jobs.scheduled")


def main() -> int:
    configure_logging()
    settings = get_settings()
    with get_session_factory()() as db:
        try:
            summary = reviews.run_scheduled(db, settings)
            db.commit()
            summary |= sources.run_scheduled(db, settings, get_storage())
            db.commit()
            summary |= run_cleanup(db, get_storage(), settings)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Tác vụ định kỳ thất bại")
            return 1
    logger.info("Tác vụ định kỳ xong: %s", summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
