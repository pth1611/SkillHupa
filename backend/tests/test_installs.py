from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from tests.conftest import csrf_headers, login
from tests.test_catalog import publish
from tests.test_reviews import World, package


@pytest.fixture
def w(client):
    return World(client.app)


def report(c, skill_id, version="1.0.0", target="claude-code"):
    return c.post("/api/installs", json={"skill_id": skill_id, "version": version, "target": target},
                  headers=csrf_headers(c))


def mine(c, **params):
    r = c.get("/api/installs/me", params=params)
    assert r.status_code == 200, r.text
    return r.json()["items"]


def publish_v2(w, sid, version="1.1.0"):
    _, vid, _ = w.submit(skill_id=sid, version=version, data=package(version))
    w.assign(vid)
    assert w.decide(w.reviewer, vid, "approved").status_code == 204
    return vid


def set_status(sid_or_vid, model, status):
    from app.core.database import get_session_factory
    from app.modules.skills import models

    with get_session_factory()() as db:
        db.get(getattr(models, model), sid_or_vid).status = status
        db.commit()


def test_report_install_is_idempotent_and_counts_distinct_cli_users(w):
    sid, _ = publish(w)
    assert report(w.user, sid).status_code == 200
    assert report(w.user, sid).status_code == 200
    assert report(w.user, sid, target="cursor").status_code == 200  # cùng người, không tăng số
    assert len(mine(w.user)) == 2
    assert w.manager.get(f"/api/skills/{sid}").json()["install_count"] == 1
    report(w.reviewer, sid)
    assert w.user.get("/api/skills").json()["items"][0]["install_count"] == 2


def test_zip_download_creates_record_but_is_not_counted(w):
    sid, _ = publish(w)
    w.user.get(f"/api/skills/{sid}/download", params={"intent": "zip"})
    item = mine(w.user)[0]
    assert item["source"] == "zip" and item["target"] == "zip" and item["state"] == "up_to_date"
    assert w.user.get(f"/api/skills/{sid}").json()["install_count"] == 0
    w.user.get(f"/api/skills/{sid}/download")  # intent=install không ghi gì
    assert len(mine(w.user)) == 1


def test_report_validates_target_version_and_visibility(w):
    sid, _ = publish(w, visibility="department", department="Kế toán")
    assert report(w.user, sid, target="zip").status_code == 400
    assert report(w.user, sid, target="vim").status_code == 400
    assert report(w.user, sid, version="9.9.9").status_code == 404
    other = TestClient(w.app)
    login(other, "o@example.com", role="user", department="Nhân sự")
    assert report(other, sid).status_code == 404


def test_cannot_report_revoked_version(w):
    sid, vid = publish(w)
    set_status(vid, "SkillVersion", "revoked")
    r = report(w.user, sid)
    assert r.status_code == 409 and r.json()["error"]["code"] == "VERSION_NOT_INSTALLABLE"


def test_states_update_available_revoked_removed(w):
    sid, vid1 = publish(w)
    report(w.user, sid)
    assert mine(w.user)[0]["state"] == "up_to_date"
    vid2 = publish_v2(w, sid)
    item = mine(w.user)[0]
    assert item["state"] == "update_available" and item["latest_version"] == "1.1.0"
    assert mine(w.user, state="up_to_date") == []
    set_status(vid1, "SkillVersion", "revoked")
    assert mine(w.user)[0]["state"] == "revoked"
    set_status(vid2, "SkillVersion", "revoked")  # không còn bản tốt cũng không được báo "up_to_date"
    assert mine(w.user)[0]["state"] == "revoked"
    set_status(sid, "Skill", "removed")
    item = mine(w.user)[0]
    assert item["state"] == "removed" and item["latest_version"] is None


def test_no_access_after_visibility_change(w):
    sid, _ = publish(w, visibility="department", department="Kế toán")
    report(w.user, sid)
    from app.core.database import get_session_factory
    from app.modules.skills.models import Skill

    with get_session_factory()() as db:
        db.get(Skill, sid).department = "Nhân sự"
        db.commit()
    assert mine(w.user)[0]["state"] == "no_access"


def test_uninstall_marks_not_deletes_and_allows_reinstall(w):
    sid, _ = publish(w)
    report(w.user, sid)
    report(w.user, sid, target="cursor")
    h = csrf_headers(w.user)
    assert w.user.delete(f"/api/installs/{sid}", params={"target": "cursor"}, headers=h).status_code == 204
    assert [i["target"] for i in mine(w.user)] == ["claude-code"]
    assert w.user.delete(f"/api/installs/{sid}", params={"target": "cursor"}, headers=h).status_code == 404
    assert w.user.delete(f"/api/installs/{sid}", headers=h).status_code == 204
    assert mine(w.user) == []
    assert w.manager.get(f"/api/skills/{sid}").json()["install_count"] == 0
    report(w.user, sid)
    assert len(mine(w.user)) == 1


def test_hide_zip_entry_via_delete(w):
    sid, _ = publish(w)
    w.user.get(f"/api/skills/{sid}/download", params={"intent": "zip"})
    assert w.user.delete(f"/api/installs/{sid}", params={"target": "zip"}, headers=csrf_headers(w.user)).status_code == 204
    assert mine(w.user) == []


def test_check_batch(w):
    sid, _ = publish(w)
    publish_v2(w, sid)
    r = w.user.post("/api/installs/check", headers=csrf_headers(w.user), json={"items": [
        {"skill_id": sid, "version": "1.0.0"},
        {"skill_id": sid, "version": "1.1.0"},
        {"skill_id": 9999, "version": "1.0.0"},
    ]})
    assert [(x["state"], x["latest_version"]) for x in r.json()] == [
        ("update_available", "1.1.0"), ("up_to_date", "1.1.0"), ("removed", None)]


def test_installs_are_per_user_and_paged(w):
    a, _ = publish(w, " A")
    b, _ = publish(w, " B")
    report(w.user, a)
    report(w.user, b)
    assert mine(w.reviewer) == []
    r = w.user.get("/api/installs/me", params={"page_size": 1, "page": 2}).json()
    assert r["total"] == 2 and len(r["items"]) == 1


def test_featured_prefers_recent_installs_over_new_boost(w, monkeypatch):
    monkeypatch.setattr("app.modules.skills.service.NEW_SKILL_BOOST", 2)
    a, _ = publish(w, " Cũ")
    publish(w, " Mới")
    from app.core.database import get_session_factory
    from app.modules.skills.models import Skill
    from app.shared.utils import utcnow

    with get_session_factory()() as db:  # A đăng đã lâu (mất điểm 'mới'), B vừa đăng
        db.get(Skill, a).published_at = utcnow() - timedelta(days=90)
        db.commit()
    names = [c["name"] for c in w.user.get("/api/skills/featured").json()]
    assert names == ["Báo cáo tuần Mới", "Báo cáo tuần Cũ"]
    for who in (w.reviewer, w.manager, w.creator, w.user):  # 4 lượt cài A (4 > 2) vượt điểm mới của B
        report(who, a)
    names = [c["name"] for c in w.user.get("/api/skills/featured").json()]
    assert names[0] == "Báo cáo tuần Cũ"
