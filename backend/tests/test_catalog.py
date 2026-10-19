import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from tests.conftest import csrf_headers, login
from tests.test_reviews import World, package


@pytest.fixture
def w(client):
    return World(client.app)


def publish(w, suffix="", visibility="company", department="Kế toán", version="1.0.0", **extra):
    sid, vid, _ = w.submit(name_suffix=suffix, version=version, visibility=visibility, department=department, **extra)
    w.assign(vid)
    assert w.decide(w.reviewer, vid, "approved").status_code == 204
    return sid, vid


def names(resp):
    assert resp.status_code == 200, resp.text
    return [i["name"] for i in resp.json()["items"]]


def make_tag(name, status="approved", proposed_by=None):
    from app.core.database import get_session_factory
    from app.modules.skills.models import Tag

    with get_session_factory()() as db:
        t = Tag(name=name, status=status, proposed_by=proposed_by)
        db.add(t)
        db.commit()
        return t.id


# ---- tìm kiếm --------------------------------------------------------------


def test_search_returns_only_published(w):
    publish(w, " A")
    w.submit(name_suffix=" B")  # đang chờ duyệt
    assert names(w.user.get("/api/skills")) == ["Báo cáo tuần A"]


def test_search_text_matches_name_summary_and_tag(w):
    tag = make_tag("excel")
    publish(w, " A", tag_ids=[tag])
    publish(w, " B")
    assert names(w.user.get("/api/skills", params={"q": "tuần b"})) == ["Báo cáo tuần B"]
    assert names(w.user.get("/api/skills", params={"q": "nhanh"})) == ["Báo cáo tuần B", "Báo cáo tuần A"]
    assert names(w.user.get("/api/skills", params={"q": "excel"})) == ["Báo cáo tuần A"]
    assert names(w.user.get("/api/skills", params={"q": "100%"})) == []  # ký tự đặc biệt không thành wildcard


def test_search_filters_category_department_tag(w):
    t1, t2 = make_tag("excel"), make_tag("pdf")
    publish(w, " A", tag_ids=[t1, t2], department="Kế toán")
    publish(w, " B", tag_ids=[t1], department="Nhân sự")
    assert names(w.user.get("/api/skills", params={"department": "Nhân sự"})) == ["Báo cáo tuần B"]
    assert names(w.user.get("/api/skills", params={"tag": ["excel", "pdf"]})) == ["Báo cáo tuần A"]
    assert len(names(w.user.get("/api/skills", params={"tag": "excel"}))) == 2
    assert names(w.user.get("/api/skills", params={"category": w.category() + 99})) == []


def test_search_sort_and_paging(w):
    publish(w, " B")
    publish(w, " A")
    assert names(w.user.get("/api/skills", params={"sort": "name"})) == ["Báo cáo tuần A", "Báo cáo tuần B"]
    r = w.user.get("/api/skills", params={"sort": "name", "page_size": 1, "page": 2}).json()
    assert r["total"] == 2 and [i["name"] for i in r["items"]] == ["Báo cáo tuần B"]
    assert w.user.get("/api/skills", params={"sort": "bogus"}).status_code == 400


def test_department_skill_hidden_from_other_departments(w):
    publish(w, " Nội bộ", visibility="department", department="Kế toán")
    assert names(w.user.get("/api/skills")) == ["Báo cáo tuần Nội bộ"]  # cùng phòng ban
    other = TestClient(w.app)
    login(other, "other@example.com", role="user", department="Nhân sự")
    assert names(other.get("/api/skills")) == []
    nodept = TestClient(w.app)
    login(nodept, "nodept@example.com", role="user")
    assert names(nodept.get("/api/skills")) == []
    assert names(w.manager.get("/api/skills")) == ["Báo cáo tuần Nội bộ"]


def test_card_has_latest_version_icon_flag_and_only_approved_tags(w):
    ok = make_tag("excel")
    pending = make_tag("riêng", status="pending", proposed_by=w.ids["creator"])
    publish(w, tag_ids=[ok, pending])
    card = w.user.get("/api/skills").json()["items"][0]
    assert card["latest_version"] == "1.0.0"
    assert card["tags"] == ["excel"]
    assert card["has_icon"] is False and card["install_count"] == 0


def test_featured_route_not_shadowed_by_skill_id(w):
    publish(w, " A")
    publish(w, " B")
    r = w.user.get("/api/skills/featured")
    assert r.status_code == 200
    assert [c["name"] for c in r.json()] == ["Báo cáo tuần B", "Báo cáo tuần A"]  # hoà điểm: mới đăng trước


# ---- tải gói ---------------------------------------------------------------


def test_download_zip_counts_and_streams_package(w):
    sid, _ = publish(w)
    r = w.user.get(f"/api/skills/{sid}/download", params={"intent": "zip"})
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "1.0.0" and body["checksum"].startswith("sha256:")
    got = w.user.get(body["url"])
    assert got.status_code == 200
    assert zipfile.ZipFile(io.BytesIO(got.content)).namelist() == ["SKILL.md"]
    assert w.user.get(f"/api/skills/{sid}").json()["download_count"] == 1
    w.user.get(f"/api/skills/{sid}/download")  # intent=install không đếm
    assert w.user.get(f"/api/skills/{sid}").json()["download_count"] == 1


def test_download_unknown_version_and_hidden_skill(w):
    sid, _ = publish(w, visibility="department", department="Kế toán")
    assert w.user.get(f"/api/skills/{sid}/download", params={"version": "9.9.9"}).status_code == 404
    other = TestClient(w.app)
    login(other, "o@example.com", role="user", department="Nhân sự")
    assert other.get(f"/api/skills/{sid}/download").status_code == 404
    assert other.get(f"/api/skills/{sid}/versions/1.0.0/package").status_code == 404


def test_download_pending_version_only_via_review_not_here(w):
    sid, _, _ = w.submit()
    assert w.user.get(f"/api/skills/{sid}/download").status_code == 404
    assert w.manager.get(f"/api/skills/{sid}/download", params={"version": "1.0.0"}).status_code == 404


def test_revoked_version_not_downloadable(w):
    sid, vid = publish(w)
    from app.core.database import get_session_factory
    from app.modules.skills.models import SkillVersion

    with get_session_factory()() as db:
        db.get(SkillVersion, vid).status = "revoked"
        db.commit()
    r = w.user.get(f"/api/skills/{sid}/download", params={"version": "1.0.0"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "VERSION_NOT_DOWNLOADABLE"


# ---- icon ------------------------------------------------------------------


def _png() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (256, 256), "red").save(buf, "PNG")
    return buf.getvalue()


def test_icon_served_for_published_and_404_without(w):
    sid, _ = publish(w, " noicon")
    assert w.user.get(f"/api/skills/{sid}/icon").status_code == 404
    c = w.creator
    r = c.post(
        "/api/skills",
        data={"metadata": json.dumps({"name": "Có icon", "summary": "x", "category_id": w.category()})},
        files={"package": ("s.zip", package(), "application/zip"), "icon": ("i.png", _png(), "image/png")},
        headers=csrf_headers(c),
    )
    sid2, ver = r.json()["skill"]["id"], r.json()["version"]["version"]
    assert w.user.get(f"/api/skills/{sid2}/icon").status_code == 404  # chưa đăng
    assert c.get(f"/api/skills/{sid2}/icon", params={"version": ver}).status_code == 200
    assert w.user.get(f"/api/skills/{sid2}/icon", params={"version": ver}).status_code == 404
    c.post(f"/api/skills/{sid2}/versions/{ver}/submit", headers=csrf_headers(c))
    vid = c.get(f"/api/skills/{sid2}/versions").json()[0]["id"]
    w.assign(vid)
    w.decide(w.reviewer, vid, "approved")
    img = w.user.get(f"/api/skills/{sid2}/icon")
    assert img.status_code == 200 and img.headers["content-type"] == "image/webp"
    assert "max-age" in img.headers["cache-control"]
    assert w.user.get("/api/skills").json()["items"][0]["has_icon"] is True


# ---- danh mục, phòng ban, tag ----------------------------------------------


def test_categories_and_departments(w, monkeypatch):
    w.category()
    assert [c["slug"] for c in w.user.get("/api/categories").json()] == ["bao-cao"]
    assert w.user.get("/api/departments").json() == []
    assert TestClient(w.app).get("/api/categories").status_code == 401


def test_departments_from_config(make_app):
    app = make_app(STANDARD_DEPARTMENTS="Kế toán, Nhân sự ,")
    c = TestClient(app)
    login(c, "u@example.com")
    assert c.get("/api/departments").json() == ["Kế toán", "Nhân sự"]


def test_tag_list_only_approved_ordered_by_usage(w):
    make_tag("excel")
    b = make_tag("pdf")
    make_tag("ẩn", status="pending")
    make_tag("bị loại", status="rejected")
    publish(w, tag_ids=[b])
    tags = w.user.get("/api/tags").json()
    assert [(t["name"], t["usage_count"]) for t in tags] == [("pdf", 1), ("excel", 0)]
    assert [t["name"] for t in w.user.get("/api/tags", params={"q": "EX"}).json()] == ["excel"]


def test_tag_proposal_flow(w):
    c = w.creator
    r = c.post("/api/tags/proposals", json={"name": "  Báo  Cáo "}, headers=csrf_headers(c))
    assert r.status_code == 201
    assert r.json()["name"] == "báo cáo" and r.json()["status"] == "pending"
    again = c.post("/api/tags/proposals", json={"name": "BÁO CÁO"}, headers=csrf_headers(c))
    assert again.status_code == 200 and again.json()["id"] == r.json()["id"]
    assert [t["name"] for t in c.get("/api/tags/proposals/mine").json()] == ["báo cáo"]
    assert w.user.get("/api/tags").json() == []  # tag chờ duyệt không lộ
    assert w.user.post("/api/tags/proposals", json={"name": "x"}, headers=csrf_headers(w.user)).status_code == 403
    assert c.post("/api/tags/proposals", json={"name": " "}, headers=csrf_headers(c)).status_code == 400


def test_categories_seeded_by_migration(tmp_path):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, text

    url = f"sqlite:///{tmp_path / 'm.db'}"
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", url)
    import os
    old = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = url
    try:
        command.upgrade(cfg, "head")
    finally:
        os.environ["DATABASE_URL"] = old
    with create_engine(url).connect() as conn:
        slugs = [r[0] for r in conn.execute(text("SELECT slug FROM categories ORDER BY id"))]
    assert "khac" in slugs and "nhan-su" in slugs and len(slugs) == 10


def test_department_must_be_in_standard_list(make_app):
    import json

    app = make_app(STANDARD_DEPARTMENTS="Kế toán,Nhân sự")
    c = TestClient(app)
    login(c, "c@example.com", role="creator", department="Kế toán")
    pkg = package()

    def create(dept):
        return c.post(
            "/api/skills",
            data={"metadata": json.dumps({"department": dept})},
            files={"package": ("s.zip", pkg, "application/zip")},
            headers=csrf_headers(c),
        )

    bad = create("Phòng lạ")
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "UNKNOWN_DEPARTMENT"
    ok = create("Nhân sự")
    assert ok.status_code == 201
    sid = ok.json()["skill"]["id"]
    r = c.patch(f"/api/skills/{sid}", json={"department": "Phòng lạ"}, headers=csrf_headers(c))
    assert r.status_code == 400
    r = c.patch(f"/api/skills/{sid}", json={"department": "Kế toán"}, headers=csrf_headers(c))
    assert r.status_code == 200


def test_detail_has_tags_owner_and_version_param(w):
    tag = make_tag("excel")
    sid, _ = publish(w, tag_ids=[tag])
    from tests.test_installs import publish_v2

    publish_v2(w, sid, "1.1.0")
    d = w.user.get(f"/api/skills/{sid}").json()
    assert d["tags"] == ["excel"] and d["owner_name"]
    assert d["viewing_version"]["version"] == "1.1.0" == d["latest_version"]["version"]
    old = w.user.get(f"/api/skills/{sid}", params={"version": "1.0.0"}).json()
    assert old["viewing_version"]["version"] == "1.0.0"
    assert old["latest_version"]["version"] == "1.1.0"
    assert w.user.get(f"/api/skills/{sid}", params={"version": "9.9.9"}).status_code == 404


def test_detail_hides_unpublished_versions_from_others(w):
    sid, _vid, _ = w.submit(version="1.0.0")
    assert w.manager.get(f"/api/skills/{sid}", params={"version": "1.0.0"}).status_code == 200
    assert w.user.get(f"/api/skills/{sid}").status_code == 404


# ---- phân loại theo loại đầu ra và ứng dụng (D52) ----------------------------


def test_taxonomy_lists_allowed_values(w):
    data = w.user.get("/api/taxonomy").json()
    assert "code" in data["output_types"] and "github" in data["ecosystems"]


def test_classification_filters_and_facets(w):
    publish(w, " A", output_types=["code", "document"], ecosystems=["github"])
    publish(w, " B", output_types=["document"])
    publish(w, " C")  # chưa phân loại

    got = names(w.user.get("/api/skills", params={"output_type": "code"}))
    assert got == ["Báo cáo tuần A"]
    # nhiều giá trị trong một chiều: khớp một trong số đó (OR)
    both = names(w.user.get("/api/skills", params=[("output_type", "code"), ("output_type", "document")]))
    assert sorted(both) == ["Báo cáo tuần A", "Báo cáo tuần B"]
    # hai chiều khác nhau: phải khớp cả hai (AND)
    assert names(w.user.get("/api/skills", params={"output_type": "document", "ecosystem": "github"})) == [
        "Báo cáo tuần A"
    ]

    card = w.user.get("/api/skills", params={"output_type": "code"}).json()["items"][0]
    assert card["output_types"] == ["code", "document"] and card["ecosystems"] == ["github"]

    facets = w.user.get("/api/skills/facets").json()
    assert facets["total"] == 3
    assert facets["output_types"] == {"code": 1, "document": 2}
    assert facets["ecosystems"] == {"github": 1}
    # chọn "code": số đếm của chiều đó không tự thu hẹp, chiều khác thì có
    narrowed = w.user.get("/api/skills/facets", params={"output_type": "code"}).json()
    assert narrowed["output_types"] == {"code": 1, "document": 2}
    assert narrowed["ecosystems"] == {"github": 1}
    assert narrowed["total"] == 1


def test_facets_respect_visibility(w):
    publish(w, " kín", visibility="department", department="Nhân sự", output_types=["code"])
    assert w.user.get("/api/skills/facets").json()["output_types"] == {}  # người ngoài phòng ban không đếm được


def test_unknown_classification_rejected(w):
    resp = w.creator.post(
        "/api/skills",
        data={"metadata": json.dumps({"output_types": ["hologram"]})},
        files={"package": ("s.zip", package(), "application/zip")},
        headers=csrf_headers(w.creator),
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "UNKNOWN_CLASSIFICATION"


def test_update_classification(w):
    sid, _ = publish(w, " A", output_types=["code"])
    ok = w.creator.patch(
        f"/api/skills/{sid}", json={"output_types": ["video"], "ecosystems": ["teams"]}, headers=csrf_headers(w.creator)
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["output_types"] == ["video"]
    detail = w.user.get(f"/api/skills/{sid}").json()
    assert detail["output_types"] == ["video"] and detail["ecosystems"] == ["teams"]
