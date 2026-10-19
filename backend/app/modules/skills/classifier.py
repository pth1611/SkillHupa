"""Gợi ý phân loại tự động bằng luật (đuôi file + từ khoá), không gọi dịch vụ ngoài.

Kết quả chỉ là gợi ý đổ sẵn vào wizard; Creator xác nhận hoặc sửa. Tất cả slug trả về
đều nằm trong taxonomy.yaml (từ vựng đóng).
"""
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import PurePosixPath

from app.modules.skills import packaging, taxonomy

THRESHOLD = 2  # điểm tối thiểu để gợi ý một slug
MAX_OUTPUT_TYPES = 3
MAX_ECOSYSTEMS = 3
_BODY_CAP = 2  # một từ khoá trong thân SKILL.md tính tối đa 2 điểm, tránh bị lặp từ đánh lừa
_EXT_CAP = 2  # nhiều file cùng đuôi cũng chỉ tính tối đa 2 điểm


@dataclass
class Suggestion:
    output_types: list[str] = field(default_factory=list)
    ecosystems: list[str] = field(default_factory=list)
    category_slug: str | None = None
    # Điểm tin cậy theo slug (số tín hiệu khớp), lưu cùng facet để phân biệt gợi ý mạnh/yếu.
    output_scores: dict[str, int] = field(default_factory=dict)
    ecosystem_scores: dict[str, int] = field(default_factory=dict)


def _pattern(keyword: str) -> re.Pattern[str]:
    # Ranh giới "từ" theo ký tự chữ-số để không khớp "gh" trong "right"; hỗ trợ chữ có dấu.
    return re.compile(rf"(?<![\w]){re.escape(keyword.lower())}(?![\w])")


@lru_cache
def _signals() -> dict:
    raw = taxonomy.load_signals()
    compiled: dict = {"output_types": {}, "ecosystems": {}, "categories": {}}
    for slug, cfg in raw["output_types"].items():
        compiled["output_types"][slug] = (set(cfg.get("extensions", [])), [_pattern(k) for k in cfg["keywords"]])
    for slug, cfg in raw["ecosystems"].items():
        compiled["ecosystems"][slug] = (set(), [_pattern(k) for k in cfg["keywords"]])
    for slug, kws in raw["categories"].items():
        compiled["categories"][slug] = (set(), [_pattern(k) for k in kws])
    return compiled


def _count(patterns: list[re.Pattern[str]], text: str) -> int:
    return sum(1 for p in patterns if p.search(text))


def _score(extensions: set[str], patterns: list[re.Pattern[str]], head: str, body: str, ext_counts: dict[str, int]) -> int:
    # Tên + mô tả: mỗi từ khoá khớp 2 điểm. Thân SKILL.md: 1 điểm cho mỗi từ khoá, tối đa _BODY_CAP.
    score = 2 * _count(patterns, head)
    score += min(_count(patterns, body), _BODY_CAP)
    score += min(sum(ext_counts.get(e, 0) for e in extensions), _EXT_CAP)
    return score


def _rank(group: dict, head: str, body: str, ext_counts: dict[str, int], limit: int) -> list[tuple[str, int]]:
    scored = [(_score(exts, pats, head, body, ext_counts), slug) for slug, (exts, pats) in group.items()]
    scored = [(s, slug) for s, slug in scored if s >= THRESHOLD]
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [(slug, s) for s, slug in scored[:limit]]


def suggest(info: packaging.PackageInfo) -> Suggestion:
    fm = info.frontmatter
    head = " ".join(str(fm.get(k) or "") for k in ("name", "description")).lower()
    body = packaging.strip_frontmatter(info.skill_md or "").lower()
    ext_counts: dict[str, int] = {}
    for f in info.files:
        ext = PurePosixPath(f.path).suffix.lstrip(".").lower()
        if ext:
            ext_counts[ext] = ext_counts.get(ext, 0) + 1

    sig = _signals()
    out = _rank(sig["output_types"], head, body, ext_counts, MAX_OUTPUT_TYPES)
    eco = _rank(sig["ecosystems"], head, body, ext_counts, MAX_ECOSYSTEMS)
    cat = _rank(sig["categories"], head, body, {}, 1)
    return Suggestion(
        output_types=[s for s, _ in out],
        ecosystems=[s for s, _ in eco],
        category_slug=cat[0][0] if cat else None,
        output_scores=dict(out),
        ecosystem_scores=dict(eco),
    )


_SLUG_NAME = re.compile(r"^[a-z0-9]+(?:[-_.][a-z0-9]+)+$")
_H1 = re.compile(r"^#\s+(.+?)\s*#*\s*$", re.MULTILINE)
_NAME_MAX = 100


def _pretty(slug: str) -> str:
    return " ".join(w[:1].upper() + w[1:] for w in re.split(r"[-_.]+", slug) if w)


def suggest_name(info: packaging.PackageInfo) -> str | None:
    """Gợi ý tên hiển thị dễ đọc khi tên trong frontmatter là slug (vd. `remotion-best-practices`).

    Ưu tiên tiêu đề H1 đầu tiên của SKILL.md; không có thì viết hoa từng từ của slug.
    Tên đã dễ đọc (có khoảng trắng, chữ hoa, chữ có dấu) thì không gợi ý gì.
    """
    raw = str(info.frontmatter.get("name") or "").strip()
    if raw and not _SLUG_NAME.match(raw) and "-" not in raw and "_" not in raw:
        return None
    pretty = _pretty(raw) if raw else None
    match = _H1.search(packaging.strip_frontmatter(info.skill_md or ""))
    title = match.group(1).strip() if match else None
    if title and 3 <= len(title) <= 60:
        candidate = title
    else:
        candidate = pretty
    if not candidate or candidate == raw:
        return None
    return candidate[:_NAME_MAX]
