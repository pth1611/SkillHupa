import base64
import io
import re
import tarfile
import time
from collections.abc import Callable

import httpx

from app.modules.skills.validation import parse_semver
from app.modules.sources.connectors.base import ConnectorError, RemoteFile, RepoInfo

API = "https://api.github.com"
URL_RE = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$")
NO_LICENSE = {None, "", "NOASSERTION", "NONE"}
CODELOAD_HOST = "codeload.github.com"
MAX_TARBALL_BYTES = 100 * 1024 * 1024
MAX_MEMBER_BYTES = 10 * 1024 * 1024
MAX_RATE_WAIT = 3700  # giây; hạn mức GitHub đặt lại trong vòng một giờ, chờ lâu hơn thì báo lỗi
WAIT_CHUNK = 300  # giây; chia nhỏ lúc ngủ để báo tiến độ và giữ khoá quét


class TarballTooBig(ConnectorError):
    """Gói repo vượt giới hạn; connector chuyển sang tải từng file."""


def parse_repo_url(url: str) -> tuple[str, str] | None:
    m = URL_RE.match(url.strip())
    return (m[1], m[2]) if m else None


def is_semver_tag(name: str) -> bool:
    return parse_semver(name.removeprefix("v")) is not None


class GitHubConnector:
    """Chỉ gọi api.github.com với owner/repo lấy từ địa chỉ đã khai báo (chống SSRF)."""

    def __init__(self, url: str, ref: str | None, token: str | None, client: httpx.Client | None = None,
                 on_wait: Callable[[int, int], None] | None = None):
        parsed = parse_repo_url(url)
        if parsed is None:
            raise ConnectorError("Địa chỉ GitHub không hợp lệ")
        self.owner, self.repo = parsed
        self.ref = ref
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._client = client or httpx.Client(base_url=API, headers=headers, timeout=20.0)
        # Gọi với (số giây còn phải chờ, mốc epoch được dùng lại) mỗi khi đang chờ hạn mức.
        self.on_wait = on_wait
        self._paths: dict[str, str] = {}  # đường dẫn -> sha của blob
        self._tree_bytes = 0
        self._tarball_too_big = False
        self._tree_commit: str | None = None
        self._blobs: dict[str, bytes] = {}
        self._blobs_commit: str | None = None

    @staticmethod
    def _error(resp: httpx.Response) -> ConnectorError:
        code = resp.status_code
        remaining = resp.headers.get("x-ratelimit-remaining")
        if code == 429 or (code == 403 and (remaining == "0" or "retry-after" in resp.headers)):
            reset = resp.headers.get("x-ratelimit-reset")
            when = f", đặt lại lúc epoch {reset}" if reset and remaining == "0" else ""
            return ConnectorError(f"GitHub trả {code}: hết hạn mức gọi API{when}")
        if code == 401:
            return ConnectorError("GitHub trả 401: token sai hoặc đã hết hạn")
        if code == 403:
            return ConnectorError("GitHub trả 403: token không đủ quyền truy cập repo này")
        if code == 404:
            return ConnectorError("GitHub trả 404: không thấy repo/ref, hoặc token không có quyền với repo")
        return ConnectorError(f"GitHub trả lỗi {code}")

    @staticmethod
    def _rate_wait(resp: httpx.Response) -> tuple[int, int] | None:
        """(số giây cần chờ, epoch được dùng lại) nếu response là giới hạn tạm thời; None nếu không."""
        if resp.status_code not in (403, 429):
            return None
        now = time.time()
        retry_after = resp.headers.get("retry-after")
        if retry_after and retry_after.isdigit():
            return int(retry_after) + 1, int(now) + int(retry_after) + 1
        reset = resp.headers.get("x-ratelimit-reset")
        if resp.headers.get("x-ratelimit-remaining") == "0" and reset and reset.isdigit():
            return max(int(reset) - int(now), 0) + 2, int(reset) + 2  # +2 giây bù lệch đồng hồ
        return None

    def _sleep_until(self, seconds: int, until: int) -> None:
        end = time.time() + seconds
        while (left := int(end - time.time())) > 0:
            if self.on_wait:
                self.on_wait(left, until)
            time.sleep(min(left, WAIT_CHUNK))

    def _request(self, url: str, **kwargs) -> httpx.Response:
        """Gọi GitHub; khi chạm giới hạn thì ngủ đến lúc được đặt lại rồi gọi tiếp (tối đa hai lần chờ)."""
        for attempt in range(3):
            try:
                resp = self._client.get(url, **kwargs)
            except httpx.HTTPError as exc:
                raise ConnectorError(f"Lỗi mạng khi gọi GitHub: {exc.__class__.__name__}") from exc
            wait = self._rate_wait(resp)
            if wait is None or attempt == 2 or wait[0] > MAX_RATE_WAIT:
                return resp
            self._sleep_until(*wait)
        raise AssertionError("unreachable")

    def _get(self, path: str, **params) -> dict | list:
        resp = self._request(f"/repos/{self.owner}/{self.repo}{path}", params=params or None)
        if resp.status_code >= 400:
            raise self._error(resp)
        return resp.json()

    def repo_info(self) -> RepoInfo:
        repo = self._get("")
        ref = self.ref or repo["default_branch"]
        commit = self._get(f"/commits/{ref}")["sha"]
        spdx = (repo.get("license") or {}).get("spdx_id")
        tag = None
        if self.ref and is_semver_tag(self.ref):
            tag = self.ref
        else:
            for t in self._get("/tags", per_page=100):
                if t["commit"]["sha"] == commit and is_semver_tag(t["name"]):
                    tag = t["name"]
                    break
        return RepoInfo(
            commit=commit,
            archived=bool(repo.get("archived")),
            license=None if spdx in NO_LICENSE else spdx,
            semver_tag=tag,
        )

    def _tree(self, commit: str) -> list[dict]:
        tree = self._get(f"/git/trees/{commit}", recursive="1")
        if tree.get("truncated"):
            raise ConnectorError("Cây thư mục của repo quá lớn để quét")
        return tree["tree"]

    def list_files(self, commit: str) -> list[RemoteFile]:
        entries = self._tree(commit)
        self._paths = {e["path"]: e["sha"] for e in entries if e["type"] == "blob"}
        self._tree_bytes = sum(e.get("size", 0) for e in entries if e["type"] == "blob")
        self._tree_commit = commit
        # mode 120000 là symlink nên bị loại; submodule có type = commit nên cũng không vào đây.
        return [
            RemoteFile(path=e["path"], size=e.get("size", 0))
            for e in entries
            if e["type"] == "blob" and e.get("mode") != "120000"
        ]

    def _load_tarball(self, commit: str) -> None:
        """Tải cả repo bằng một request thay vì một request cho mỗi file."""
        resp = self._request(f"/repos/{self.owner}/{self.repo}/tarball/{commit}", follow_redirects=False)
        if resp.is_redirect:
            target = httpx.URL(resp.headers.get("location", ""))
            if target.scheme != "https" or target.host != CODELOAD_HOST:
                raise ConnectorError("GitHub chuyển hướng tới địa chỉ không được phép")
            # Dùng client trần: không gửi token tới host khác và không phụ thuộc base_url.
            try:
                with httpx.stream("GET", target, timeout=60.0) as dl:
                    if dl.status_code >= 400:
                        raise ConnectorError(f"Tải gói repo thất bại ({dl.status_code})")
                    data = self._read_limited(dl)
            except httpx.HTTPError as exc:
                raise ConnectorError(f"Lỗi mạng khi tải gói repo: {exc.__class__.__name__}") from exc
        elif resp.status_code >= 400:
            raise self._error(resp)
        else:
            data = resp.content
        if len(data) > MAX_TARBALL_BYTES:
            raise TarballTooBig("Gói repo quá lớn để quét")
        self._blobs = self._extract(data)
        self._blobs_commit = commit

    @staticmethod
    def _read_limited(resp: httpx.Response) -> bytes:
        buf = bytearray()
        for chunk in resp.iter_bytes():
            buf += chunk
            if len(buf) > MAX_TARBALL_BYTES:
                raise TarballTooBig("Gói repo quá lớn để quét")
        return bytes(buf)

    @staticmethod
    def _extract(data: bytes) -> dict[str, bytes]:
        blobs: dict[str, bytes] = {}
        try:
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
                for m in tar:
                    if not m.isreg() or m.size > MAX_MEMBER_BYTES:
                        continue  # chỉ lấy file thường; symlink/thiết bị bị bỏ
                    _, _, rel = m.name.partition("/")  # bỏ thư mục gốc "owner-repo-sha"
                    if rel and (f := tar.extractfile(m)) is not None:
                        blobs[rel] = f.read()
        except (tarfile.TarError, EOFError, OSError) as exc:
            raise ConnectorError("Gói repo tải về không hợp lệ") from exc
        return blobs

    def _fetch_blob(self, path: str) -> bytes:
        """Repo quá lớn để tải cả gói: chỉ tải đúng các file cần dùng, mỗi file một request."""
        data = self._get(f"/git/blobs/{self._paths[path]}")
        if data.get("encoding") != "base64":
            raise ConnectorError(f"GitHub trả file {path} ở dạng không hỗ trợ")
        blob = base64.b64decode(data["content"])
        if len(blob) > MAX_MEMBER_BYTES:
            raise ConnectorError(f"File {path} quá lớn để quét")
        return blob

    def fetch(self, commit: str, path: str) -> bytes:
        if self._tree_commit != commit:
            self.list_files(commit)
        if path not in self._paths:
            raise ConnectorError(f"Không thấy file {path} trong commit")
        if self._blobs_commit != commit and not self._tarball_too_big:
            if self._tree_bytes > MAX_TARBALL_BYTES:
                self._tarball_too_big = True
            else:
                try:
                    self._load_tarball(commit)
                except TarballTooBig:
                    self._tarball_too_big = True  # chỉ thử một lần, không tải lại cho từng thư mục
        if self._tarball_too_big:
            return self._fetch_blob(path)
        try:
            return self._blobs[path]
        except KeyError:
            raise ConnectorError(f"Không thấy file {path} trong gói repo") from None
