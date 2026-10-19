"""Từ vựng phân loại cố định: loại đầu ra và hệ sinh thái ứng dụng (D52)."""
from functools import lru_cache
from pathlib import Path

import yaml

TAXONOMY_PATH = Path(__file__).with_name("taxonomy.yaml")

OUTPUT_TYPE = "output_type"
ECOSYSTEM = "ecosystem"
KINDS = (OUTPUT_TYPE, ECOSYSTEM)

_KEYS = {OUTPUT_TYPE: "output_types", ECOSYSTEM: "ecosystems"}


@lru_cache
def load_taxonomy() -> dict[str, list[str]]:
    with TAXONOMY_PATH.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    return {kind: list(data[key]) for kind, key in _KEYS.items()}


def allowed(kind: str) -> list[str]:
    return load_taxonomy()[kind]


def unknown(kind: str, slugs: list[str]) -> list[str]:
    valid = set(allowed(kind))
    return sorted({s for s in slugs if s not in valid})


@lru_cache
def load_signals() -> dict:
    """Tín hiệu gợi ý phân loại; chỉ giữ slug có trong từ vựng."""
    with TAXONOMY_PATH.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh)["signals"]
    valid = load_taxonomy()
    return {
        "output_types": {s: c for s, c in data["output_types"].items() if s in valid[OUTPUT_TYPE]},
        "ecosystems": {s: c for s, c in data["ecosystems"].items() if s in valid[ECOSYSTEM]},
        "categories": data["categories"],
    }
