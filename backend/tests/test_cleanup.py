from datetime import timedelta

import pytest

from app.core.config import get_settings
from app.core.database import get_session_factory
from app.core.storage import get_storage
from app.jobs.cleanup import run_cleanup
from app.modules.audit.models import AuditLog
from app.modules.skills.models import Skill, SkillVersion
from app.shared.utils import utcnow
from tests.conftest import csrf_headers
from tests.test_admin import notes
from tests.test_catalog import make_tag, publish
from tests.test_reviews import World, package


@pytest.fixture
def w(client):
    return World(client.app)


def draft(w, suffix=""):
    """Tạo bản nháp (chưa gửi duyệt) của Creator và trả (skill_id, version)."""
    import json

    c = w.creator
    r = c.post(
        "/api/skills",
        data={"metadata": json.dumps({"name": f"Nháp{suffix}", "summary": "x", "category_id": w.category()})},
        files={"package": ("s.zip", package(), "application/zip")},
        headers=csrf_headers(c),
    )
    assert r.status_code == 201, r.text
    return r.json()["skill"]["id"], r.json()["version"]["version"]


def age(skill_id: int, days: int):
    """Lùi mốc hoạt động của một skill nháp về `days` ngày trước."""
    with get_session_factory()() as db:
        then = utcnow() - timedelta(days=days)
        skill = db.get(Skill, skill_id)
        skill.updated_at = then
        for v in skill.versions:
            v.created_at = then
        db.commit()


def run(now=None):
    with get_session_factory()() as db:
        out = run_cleanup(db, get_storage(), get_settings(), now)
        db.commit()
        return out


def test_delete_rejected_version_with_review_history_and_tags(w):
    """Phải chạy được cả trên PostgreSQL (ràng buộc khoá ngoại), không chỉ SQLite."""
    tag = make_tag("excel")
    sid, vid, ver = w.submit(tag_ids=[tag])
    w.assign(vid)
    assert w.decide(w.reviewer, vid, "rejected", "Thiếu mô tả").status_code == 204
    r = w.creator.delete(f"/api/skills/{sid}/versions/{ver}", headers=csrf_headers(w.creator))
    assert r.status_code == 204, r.text
    assert w.creator.get("/api/skills/mine").json() == []


def test_fresh_draft_is_left_alone(w):
    draft(w)
    assert run() == {"drafts_warned": 0, "drafts_deleted": 0, "audit_purged": 0}


def test_warns_once_before_deleting(w):
    sid, _ = draft(w)
    age(sid, 25)  # còn 5 ngày: trong cửa sổ cảnh báo 7 ngày
    assert run()["drafts_warned"] == 1
    assert run()["drafts_warned"] == 0  # không nhắc lặp
    n = notes(w.creator, "draft.expiring")
    assert len(n) == 1 and "sau 5 ngày" in n[0]["message"] and f"/studio/{sid}" in n[0]["link"]
    assert w.creator.get("/api/skills/mine").json()[0]["id"] == sid  # chưa xoá


def test_deletes_stale_draft_skill_package_and_notifies(w):
    sid, _ = draft(w)
    with get_session_factory()() as db:
        key = db.query(SkillVersion).filter_by(skill_id=sid).one().package_key
    assert get_storage().exists(key)
    age(sid, 31)
    out = run()
    assert out["drafts_deleted"] == 1
    assert w.creator.get("/api/skills/mine").json() == []
    assert not get_storage().exists(key)
    assert len(notes(w.creator, "draft.purged")) == 1
    with get_session_factory()() as db:
        log = db.query(AuditLog).filter_by(action="draft.purge").one()
        assert log.actor_id is None and log.detail["skill_id"] == sid


def test_new_draft_of_published_skill_deletes_only_the_version(w):
    sid, _ = publish(w)
    w.submit(skill_id=sid, version="1.1.0", data=None)  # bản chờ duyệt: không đụng tới
    # tạo thêm bản nháp 1.2.0 chưa gửi
    c = w.creator
    r = c.post(f"/api/skills/{sid}/versions", data={"version": "1.2.0"},
               files={"package": ("s.zip", package("1.2.0"), "application/zip")}, headers=csrf_headers(c))
    assert r.status_code == 201
    with get_session_factory()() as db:
        db.get(SkillVersion, r.json()["version"]["id"]).created_at = utcnow() - timedelta(days=40)
        skill = db.get(Skill, sid)
        skill.updated_at = utcnow() - timedelta(days=40)
        db.commit()
    assert run()["drafts_deleted"] == 1
    versions = {v["version"]: v["status"] for v in c.get(f"/api/skills/{sid}/versions").json()}
    assert versions == {"1.0.0": "published", "1.1.0": "pending"}
    assert w.user.get(f"/api/skills/{sid}").status_code == 200  # skill vẫn đang phục vụ


def test_editing_the_skill_resets_the_clock(w):
    sid, _ = draft(w)
    age(sid, 40)
    c = w.creator
    assert c.patch(f"/api/skills/{sid}", json={"summary": "Mô tả mới"}, headers=csrf_headers(c)).status_code == 200
    # hoạt động mới: bản nháp không bị dọn nữa
    with get_session_factory()() as db:
        for v in db.get(Skill, sid).versions:
            v.created_at = utcnow() - timedelta(days=40)
        db.commit()
    assert run()["drafts_deleted"] == 0


def test_imported_drafts_are_not_touched(w):
    sid, _ = draft(w)
    with get_session_factory()() as db:
        s = db.get(Skill, sid)
        s.origin, s.owner_id = "imported", None
        db.commit()
    age(sid, 90)
    assert run()["drafts_deleted"] == 0


def test_audit_retention_purges_only_expired_rows_and_logs_it(w):
    publish(w)  # tạo vài dòng nhật ký mới
    now = utcnow()
    with get_session_factory()() as db:
        db.add_all([
            AuditLog(actor_name="x", action="old.a", target_type="t", created_at=now - timedelta(days=365 * 3 + 5)),
            AuditLog(actor_name="x", action="old.b", target_type="t", created_at=now - timedelta(days=365 * 4)),
            AuditLog(actor_name="x", action="edge", target_type="t", created_at=now - timedelta(days=365 * 3 - 5)),
        ])
        db.commit()
        before = db.query(AuditLog).count()
    out = run()
    assert out["audit_purged"] == 2
    with get_session_factory()() as db:
        actions = [a.action for a in db.query(AuditLog)]
        assert "old.a" not in actions and "old.b" not in actions and "edge" in actions
        assert db.query(AuditLog).count() == before - 2 + 1  # trừ 2 dòng quá hạn, cộng dòng audit.purge
        assert db.query(AuditLog).filter_by(action="audit.purge").one().detail["rows"] == 2


def test_scheduled_entrypoint_runs_cleanup(w, monkeypatch):
    sid, _ = draft(w)
    age(sid, 40)
    from app.jobs import scheduled

    assert scheduled.main() == 0
    assert w.creator.get("/api/skills/mine").json() == []
