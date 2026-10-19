import logging
import sys


def configure_logging(level: int = logging.INFO) -> None:
    """Log ra stdout để Container Apps/Log Analytics thu thập.

    Không ghi token, SAS URL, nội dung gói hay bí mật (xem architecture.md, mục 11).
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
