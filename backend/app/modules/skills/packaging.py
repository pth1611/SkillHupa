"""Đọc gói .zip an toàn: không giải nén ra đĩa, không thực thi, giới hạn kích thước.

Kết quả là mô tả gói (danh sách file, nội dung SKILL.md, frontmatter) cùng các
vi phạm cấu trúc để bộ kiểm tra tự động xử lý.
"""
import hashlib
import io
import stat
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath

import yaml

SKILL_MD = "SKILL.md"
_TEXT_SNIFF_BYTES = 8192


class NotAZipError(Exception):
    pass


@dataclass
class PackageFile:
    path: str
    size: int
    sha256: str
    is_text: bool
    content: bytes | None = None  # chỉ giữ nội dung file văn bản để quét


@dataclass
class PackageInfo:
    files: list[PackageFile] = field(default_factory=list)
    skill_md: str | None = None
    skill_md_error: str | None = None
    frontmatter: dict = field(default_factory=dict)
    total_size: int = 0
    unsafe_paths: list[str] = field(default_factory=list)
    stripped_prefix: str = ""


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def looks_like_text(sample: bytes) -> bool:
    if b"\x00" in sample:
        return False
    try:
        sample.decode("utf-8")
    except UnicodeDecodeError as exc:
        # Cắt giữa ký tự đa byte ở cuối mẫu thì vẫn coi là văn bản.
        return exc.start >= len(sample) - 3
    return True


def _is_unsafe(name: str) -> bool:
    if name.startswith(("/", "\\")) or "\\" in name:
        return True
    parts = PurePosixPath(name).parts
    if ".." in parts:
        return True
    return bool(parts and len(parts[0]) == 2 and parts[0][1] == ":")  # C:


def detect_prefix(names: list[str]) -> str:
    """Gói có một thư mục gốc duy nhất chứa SKILL.md thì bỏ tiền tố đó."""
    if SKILL_MD in names:
        return ""
    roots = {PurePosixPath(n).parts[0] for n in names if PurePosixPath(n).parts}
    if len(roots) == 1:
        root = next(iter(roots))
        if f"{root}/{SKILL_MD}" in names:
            return f"{root}/"
    return ""


def read_member(data: bytes, path: str, *, max_bytes: int) -> bytes | None:
    """Đọc đúng một file trong gói (không giải nén cả gói); None nếu không có."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = [m.filename for m in archive.infolist() if not m.is_dir()]
        prefix = detect_prefix(names)
        for name in names:
            if _is_unsafe(name):
                continue
            norm = name[len(prefix) :] if prefix and name.startswith(prefix) else name
            if norm == path:
                with archive.open(name) as fh:
                    return fh.read(max_bytes + 1)
    return None


def parse_frontmatter(text: str) -> dict:
    if not text.startswith("---"):
        return {}
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            try:
                data = yaml.safe_load("\n".join(lines[1:i]))
            except yaml.YAMLError:
                return {}
            return data if isinstance(data, dict) else {}
    return {}


def strip_frontmatter(text: str) -> str:
    lines = text.splitlines()
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                return "\n".join(lines[i + 1 :]).lstrip("\n")
    return text


def inspect(
    data: bytes,
    *,
    max_files: int,
    max_total_bytes: int,
    max_skill_md_bytes: int,
    max_scan_bytes: int,
) -> PackageInfo:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise NotAZipError("Tệp không phải gói .zip hợp lệ") from exc

    info = PackageInfo()
    members = [m for m in archive.infolist() if not m.is_dir()]
    info.total_size = sum(m.file_size for m in members)

    # Quá giới hạn thì không đọc nội dung (chặn zip bomb); chỉ liệt kê tên.
    over_limit = len(members) > max_files or info.total_size > max_total_bytes

    names = [m.filename for m in members]
    for name in names:
        if _is_unsafe(name):
            info.unsafe_paths.append(name)
    for m in members:
        mode = m.external_attr >> 16
        if stat.S_ISLNK(mode):
            info.unsafe_paths.append(f"{m.filename} (liên kết tượng trưng)")

    prefix = detect_prefix(names)
    info.stripped_prefix = prefix

    for m in members:
        path = m.filename[len(prefix) :] if prefix and m.filename.startswith(prefix) else m.filename
        if _is_unsafe(m.filename) or over_limit:
            info.files.append(PackageFile(path, m.file_size, "", False))
            continue
        with archive.open(m) as fh:
            head = fh.read(max_scan_bytes + 1)
        is_text = looks_like_text(head[:_TEXT_SNIFF_BYTES])
        if m.file_size <= max_scan_bytes:
            digest = sha256_hex(head)
        else:
            with archive.open(m) as fh:
                h = hashlib.sha256()
                for chunk in iter(lambda: fh.read(65536), b""):
                    h.update(chunk)
            digest = h.hexdigest()
        content = head[:max_scan_bytes] if is_text else None
        info.files.append(PackageFile(path, m.file_size, digest, is_text, content))

    skill = next((f for f in info.files if f.path == SKILL_MD), None)
    if skill is not None and not over_limit:
        if skill.size > max_skill_md_bytes:
            info.skill_md_error = "SKILL.md vượt giới hạn kích thước"
        elif skill.content is None:
            info.skill_md_error = "SKILL.md không phải văn bản UTF-8"
        else:
            try:
                info.skill_md = skill.content.decode("utf-8-sig")
            except UnicodeDecodeError:
                info.skill_md_error = "SKILL.md không giải mã được UTF-8"
            else:
                info.frontmatter = parse_frontmatter(info.skill_md)
    return info
