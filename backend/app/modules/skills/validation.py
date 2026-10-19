"""Bộ kiểm tra tự động (D4, D14, D32). Thuần hàm: nhận thông tin gói, trả danh sách kết quả."""
import io
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path, PurePosixPath
from typing import Any

import yaml
from PIL import Image, UnidentifiedImageError

from app.modules.skills.packaging import PackageInfo

RULES_PATH = Path(__file__).with_name("validation_rules.yaml")
SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")

PASS, WARN, FAIL = "pass", "warn", "fail"

ICON_FORMATS = {"PNG", "JPEG", "WEBP"}
ICON_MIN_SIDE = 128
ICON_OUT_SIDE = 256
Image.MAX_IMAGE_PIXELS = 25_000_000


@dataclass
class Finding:
    check: str
    result: str
    detail: str
    file_path: str | None = None
    line: int | None = None


@lru_cache
def load_rules() -> dict[str, Any]:
    with RULES_PATH.open(encoding="utf-8") as fh:
        rules = yaml.safe_load(fh)
    for key in ("fail_patterns", "warn_patterns"):
        for rule in rules.get(key, []):
            rule["_re"] = re.compile(rule["regex"])
    return rules


def parse_semver(value: str) -> tuple[int, int, int] | None:
    m = SEMVER_RE.match(value or "")
    return (int(m[1]), int(m[2]), int(m[3])) if m else None


def _scan(info: PackageInfo, rules: dict[str, Any]) -> list[Finding]:
    limits = rules["limits"]
    script_ext = set(rules.get("script_extensions", []))
    per_rule: dict[str, int] = {}
    out: list[Finding] = []

    def add(rule: dict[str, Any], level: str, path: str, line_no: int) -> None:
        key = f'{rule["id"]}:{level}'
        per_rule[key] = per_rule.get(key, 0) + 1
        if per_rule[key] <= limits["max_findings_per_rule"]:
            out.append(Finding(rule["id"], level, rule["description"], path, line_no))

    for f in info.files:
        if f.content is None:
            continue
        ext = PurePosixPath(f.path).suffix.lower()
        is_script = ext in script_ext
        text = f.content.decode("utf-8", errors="replace")
        for line_no, line in enumerate(text.splitlines(), start=1):
            for rule in rules.get("fail_patterns", []):
                if rule["_re"].search(line):
                    add(rule, FAIL, f.path, line_no)
            for rule in rules.get("warn_patterns", []):
                if rule.get("scripts_only") and not is_script:
                    continue
                if rule["_re"].search(line):
                    add(rule, WARN, f.path, line_no)
    return out


def _magic_is_binary(content_head: bytes | None) -> bool:
    return bool(content_head) and (
        content_head[:4] in (b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe") or content_head[:2] == b"MZ"
    )


def validate_package(
    info: PackageInfo,
    *,
    max_total_bytes: int,
    summary: str | None,
    changelog: str | None,
    version: str,
    existing_versions: list[str],
) -> list[Finding]:
    rules = load_rules()
    limits = rules["limits"]
    findings: list[Finding] = []

    # Cấu trúc
    if info.skill_md is None and info.skill_md_error is None:
        findings.append(Finding("structure.skill_md", FAIL, "Thiếu file SKILL.md ở gốc gói"))
    elif info.skill_md_error:
        findings.append(Finding("structure.skill_md", FAIL, info.skill_md_error, "SKILL.md"))
    else:
        findings.append(Finding("structure.skill_md", PASS, "Có SKILL.md hợp lệ"))
        fm = info.frontmatter
        missing = [k for k in ("name", "description") if not str(fm.get(k) or "").strip()]
        if missing:
            findings.append(
                Finding("structure.metadata", FAIL, f"SKILL.md thiếu: {', '.join(missing)}", "SKILL.md")
            )
        else:
            findings.append(Finding("structure.metadata", PASS, "Metadata đầy đủ"))

    # Giới hạn
    if len(info.files) > limits["max_files"]:
        findings.append(
            Finding("limits.file_count", FAIL, f"Số file vượt giới hạn ({len(info.files)} > {limits['max_files']})")
        )
    else:
        findings.append(Finding("limits.file_count", PASS, f"{len(info.files)} file"))
    if info.total_size > max_total_bytes:
        findings.append(
            Finding("limits.total_size", FAIL, f"Dung lượng giải nén vượt giới hạn ({info.total_size} byte)")
        )
    else:
        findings.append(Finding("limits.total_size", PASS, f"{info.total_size} byte"))

    # Đường dẫn
    if info.unsafe_paths:
        for p in info.unsafe_paths[: limits["max_findings_per_rule"]]:
            findings.append(Finding("paths.unsafe", FAIL, "Đường dẫn nguy hiểm trong gói", p))
    else:
        findings.append(Finding("paths.unsafe", PASS, "Đường dẫn an toàn"))

    # Quét nội dung (bỏ qua nếu gói quá giới hạn hoặc có đường dẫn nguy hiểm)
    blocked = (
        len(info.files) > limits["max_files"]
        or info.total_size > max_total_bytes
        or bool(info.unsafe_paths)
    )
    if not blocked:
        content_findings = _scan(info, rules)
        findings.extend(content_findings)
        if not any(f.result == FAIL for f in content_findings):
            findings.append(Finding("content.dangerous", PASS, "Không có mẫu nguy hiểm"))
    else:
        findings.append(Finding("content.dangerous", WARN, "Chưa quét nội dung vì gói vi phạm giới hạn/đường dẫn"))

    # File nhị phân và file lớn
    bin_ext = set(rules.get("binary_extensions", []))
    for f in info.files:
        ext = PurePosixPath(f.path).suffix.lower()
        head = f.content[:4] if f.content else None
        if ext in bin_ext or (not f.is_text and f.size and _magic_is_binary(head)):
            findings.append(Finding("files.binary", WARN, "File thực thi/nhị phân", f.path))
        if f.size > limits["warn_file_bytes"]:
            findings.append(Finding("files.large", WARN, f"File lớn ({f.size} byte)", f.path))

    # Phiên bản
    parsed = parse_semver(version)
    if parsed is None:
        findings.append(Finding("version.format", FAIL, "Phiên bản phải có dạng MAJOR.MINOR.PATCH"))
    else:
        higher = [v for v in existing_versions if (p := parse_semver(v)) and p >= parsed]
        if higher:
            findings.append(
                Finding("version.greater", FAIL, f"Phiên bản phải lớn hơn mọi bản đã có (đang có {max(higher, key=parse_semver)})")
            )
        else:
            findings.append(Finding("version.greater", PASS, "Phiên bản hợp lệ"))

    # Chất lượng
    if not (summary or "").strip():
        findings.append(Finding("quality.summary", WARN, "Chưa có mô tả ngắn"))
    elif summary.strip() == str(info.frontmatter.get("description") or "").strip():
        findings.append(Finding("quality.summary", WARN, "Mô tả ngắn trùng với mô tả trong SKILL.md"))
    if not (changelog or "").strip():
        findings.append(Finding("quality.changelog", WARN, "Chưa có changelog"))
    return findings


def process_icon(data: bytes, *, max_bytes: int) -> tuple[bytes | None, list[Finding]]:
    """Kiểm tra và chuẩn hoá ảnh biểu tượng về WebP 256x256 (D39)."""
    if len(data) > max_bytes:
        return None, [Finding("icon.size", FAIL, f"Ảnh vượt giới hạn {max_bytes} byte")]
    try:
        img = Image.open(io.BytesIO(data))
        fmt = img.format
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        return None, [Finding("icon.decode", FAIL, "Không giải mã được ảnh")]
    if fmt not in ICON_FORMATS:
        return None, [Finding("icon.format", FAIL, "Ảnh phải là PNG, JPEG hoặc WebP")]
    w, h = img.size
    if min(w, h) < ICON_MIN_SIDE:
        return None, [Finding("icon.dimensions", FAIL, f"Ảnh tối thiểu {ICON_MIN_SIDE}x{ICON_MIN_SIDE}")]
    findings = [Finding("icon.valid", PASS, "Ảnh biểu tượng hợp lệ")]
    if w != h:
        findings.append(Finding("icon.square", WARN, "Ảnh không vuông, sẽ được cắt giữa"))
    side = min(w, h)
    left, top = (w - side) // 2, (h - side) // 2
    img = img.convert("RGBA").crop((left, top, left + side, top + side))
    img = img.resize((ICON_OUT_SIDE, ICON_OUT_SIDE), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=90)  # ghi lại ảnh mới, bỏ siêu dữ liệu gốc
    return out.getvalue(), findings
