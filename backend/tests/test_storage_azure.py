import os
import uuid
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.core.storage import AzureBlobStorage

# Khoá công khai của trình giả lập Azurite (không phải bí mật).
AZURITE_KEY = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=="
AZURITE_CONN = (
    "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;"
    f"AccountKey={AZURITE_KEY};BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
)


def _storage(container: str = "skills") -> AzureBlobStorage:
    from azure.storage.blob import BlobServiceClient

    service = BlobServiceClient.from_connection_string(AZURITE_CONN)
    return AzureBlobStorage(service, container, account_key=AZURITE_KEY)


def test_presign_is_read_only_short_lived_and_offline():
    """Ký SAS không gọi mạng: chỉ cần khoá tài khoản."""
    signed = _storage().presign("packages/1/2.zip", filename="skill-1-1.0.0.zip", ttl=timedelta(minutes=10))
    assert signed is not None
    parts = urlsplit(signed.url)
    assert parts.path == "/devstoreaccount1/skills/packages/1/2.zip"
    q = {k: v[0] for k, v in parse_qs(parts.query).items()}
    assert q["sp"] == "r"  # chỉ đọc
    assert "sig" in q and q["sr"] == "b"
    assert "skill-1-1.0.0.zip" in q["rscd"]
    assert 0 < (signed.expires_at - __import__("datetime").datetime.now(__import__("datetime").timezone.utc)).total_seconds() <= 600


def test_settings_validation(monkeypatch):
    from app.core.config import Settings

    base = {"session_secret": "x" * 40}
    with pytest.raises(ValueError, match="STORAGE_BACKEND=azure"):
        Settings(storage_backend="azure", **base)
    with pytest.raises(ValueError, match="Production phải dùng"):
        Settings(
            environment="production", cookie_secure=True, dev_login_enabled=False, storage_backend="local", **base
        )
    Settings(storage_backend="azure", azure_storage_account_url="https://acct.blob.core.windows.net", **base)


azurite = pytest.mark.skipif(
    not os.environ.get("AZURITE"), reason="Đặt AZURITE=1 và chạy Azurite ở cổng 10000 để chạy test tích hợp"
)


@azurite
def test_roundtrip_against_azurite():
    storage = _storage(f"t{uuid.uuid4().hex[:12]}")
    storage.ensure_container()
    storage.put("a/b.bin", b"hello")
    assert storage.exists("a/b.bin") and not storage.exists("a/none")
    assert storage.get("a/b.bin") == b"hello"
    signed = storage.presign("a/b.bin", filename="b.zip", ttl=timedelta(minutes=5))
    r = httpx.get(signed.url)
    assert r.status_code == 200 and r.content == b"hello"
    assert "b.zip" in r.headers["content-disposition"]
    bad = signed.url.replace("sig=", "sig=AAAA")
    assert httpx.get(bad).status_code == 403
    assert httpx.get(signed.url.split("?")[0]).status_code in (401, 403, 404)  # không có SAS thì không đọc được
    storage.delete("a/b.bin")
    storage.delete("a/b.bin")  # xoá hai lần không lỗi
    assert not storage.exists("a/b.bin")


@azurite
def test_full_flow_uses_sas_urls(make_app):
    from fastapi.testclient import TestClient

    from tests.test_catalog import publish
    from tests.test_reviews import World

    app = make_app(
        STORAGE_BACKEND="azure",
        AZURE_STORAGE_CONNECTION_STRING=AZURITE_CONN,
        AZURE_STORAGE_CONTAINER=f"t{uuid.uuid4().hex[:12]}",
    )
    with TestClient(app):
        w = World(app)
        sid, _ = publish(w)
        info = w.user.get(f"/api/skills/{sid}/download", params={"intent": "zip"}).json()
        assert info["url"].startswith("http://127.0.0.1:10000/devstoreaccount1/")
        assert "sig=" in info["url"] and info["checksum"].startswith("sha256:")
        r = httpx.get(info["url"])
        assert r.status_code == 200 and r.content[:2] == b"PK"
        # đường phát qua backend vẫn dùng được (CLI cũ, kiểm thử)
        direct = w.user.get(f"/api/skills/{sid}/versions/1.0.0/package")
        assert direct.status_code == 200 and direct.content == r.content
