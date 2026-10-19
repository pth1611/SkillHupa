import csv
import io
import json
from datetime import timedelta

import pytest

from tests.conftest import csrf_headers
from tests.test_admin import audit_actions, notes, post
from tests.test_catalog import make_tag, publish
from tests.test_reviews import World


@pytest.fixture
def w(client):
    return World(client.app)


def admin_tags(c, **params):
    r = c.get("/api/admin/tags", params=params)
    assert r.status_code == 200, r.text
    return r.json()["items"]


def propose(c, name):
    r = c.post("/api/tags/proposals", json={"name": name}, headers=csrf_headers(c))
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def tags_of(w, sid):
    return w.manager.get(f"/api/skills/{sid}").json()["tag_ids"]


# ---- tag --------------------------------------------------------------------


def test_tag_admin_is_manager_only(w):
    tid = propose(w.creator, "excel")
    for c in (w.user, w.creator, w.reviewer):
        assert c.get("/api/admin/tags").status_code == 403
        assert post(c, f"/api/admin/tags/{tid}/approve").status_code == 403
        assert post(c, "/api/admin/tags", name="x").status_code == 403


def test_list_filter_and_usage(w):
    approved = make_tag("excel")
    propose(w.creator, "pdf")
    publish(w, tag_ids=[approved])
    assert {t["name"] for t in admin_tags(w.manager)} == {"excel", "pdf"}
    assert [t["name"] for t in admin_tags(w.manager, status="pending")] == ["pdf"]
    assert [t["name"] for t in admin_tags(w.manager, q="EXC")] == ["excel"]
    by_name = {t["name"]: t for t in admin_tags(w.manager)}
    assert by_name["excel"]["usage_count"] == 1
    assert w.manager.get("/api/admin/tags", params={"status": "zzz"}).status_code == 400


def test_create_tag_is_approved_and_unique(w):
    r = post(w.manager, "/api/admin/tags", name="  Báo  Cáo ")
    assert r.status_code == 201 and r.json()["name"] == "báo cáo" and r.json()["status"] == "approved"
    assert [t["name"] for t in w.user.get("/api/tags").json()] == ["báo cáo"]
    again = post(w.manager, "/api/admin/tags", name="BÁO CÁO")
    assert again.status_code == 409 and again.json()["error"]["code"] == "TAG_EXISTS"
    assert audit_actions()[-1][0] == "tag.create"


def test_approve_makes_visible_and_notifies_proposer(w):
    tid = propose(w.creator, "excel")
    assert w.user.get("/api/tags").json() == []
    r = post(w.manager, f"/api/admin/tags/{tid}/approve")
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert [t["name"] for t in w.user.get("/api/tags").json()] == ["excel"]
    assert len(notes(w.creator, "tag.approved")) == 1
    assert post(w.manager, f"/api/admin/tags/{tid}/approve").status_code == 409
    assert post(w.manager, "/api/admin/tags/9999/approve").status_code == 404


def test_reject_detaches_from_skills_and_notifies(w):
    tid = propose(w.creator, "excel")
    sid, _ = publish(w, tag_ids=[tid])  # tag chờ duyệt không chặn đăng (D30)
    assert tags_of(w, sid) == [tid]
    assert post(w.manager, f"/api/admin/tags/{tid}/reject").status_code == 400  # thiếu lý do
    r = post(w.manager, f"/api/admin/tags/{tid}/reject", reason="Trùng nghĩa với 'bảng tính'")
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert tags_of(w, sid) == []
    assert "Trùng nghĩa" in notes(w.creator, "tag.rejected")[0]["message"]
    action, detail = audit_actions()[-1]
    assert action == "tag.reject" and detail["skills_detached"] == 1
    assert post(w.manager, f"/api/admin/tags/{tid}/reject", reason="x").status_code == 409


def test_merge_moves_skills_without_duplicates_and_deletes_sources(w):
    keep, dup1, dup2 = make_tag("excel"), make_tag("ex-cel"), make_tag("xlsx")
    a, _ = publish(w, " A", tag_ids=[keep, dup1])  # đã có tag đích -> không nhân đôi
    b, _ = publish(w, " B", tag_ids=[dup2])
    r = post(w.manager, "/api/admin/tags/merge", **{"from": [dup1, dup2], "into": keep})
    assert r.status_code == 200, r.text
    assert r.json()["skills_moved"] == 1 and r.json()["merged"] == 2
    assert r.json()["into"]["usage_count"] == 2
    assert tags_of(w, a) == [keep] and tags_of(w, b) == [keep]
    assert [t["name"] for t in admin_tags(w.manager)] == ["excel"]
    assert audit_actions()[-1][0] == "tag.merge"


def test_merge_validations(w):
    a, b = make_tag("a"), make_tag("b")
    pending = propose(w.creator, "c")
    for body in (
        {"from": [a], "into": a},
        {"from": [a], "into": pending},
        {"from": [a, 9999], "into": b},
    ):
        r = post(w.manager, "/api/admin/tags/merge", **body)
        assert r.status_code == 400 and r.json()["error"]["code"] == "INVALID_MERGE", body
    assert post(w.manager, "/api/admin/tags/merge", **{"from": [a], "into": 9999}).status_code == 404


def test_delete_only_unused_tags(w):
    used, free = make_tag("dùng"), make_tag("rảnh")
    publish(w, tag_ids=[used])
    h = csrf_headers(w.manager)
    r = w.manager.delete(f"/api/admin/tags/{used}", headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "TAG_IN_USE"
    assert w.manager.delete(f"/api/admin/tags/{free}", headers=h).status_code == 204
    assert [t["name"] for t in admin_tags(w.manager)] == ["dùng"]


# ---- bảng điều khiển ----------------------------------------------------------


def test_dashboard_counts(w):
    propose(w.creator, "chờ")
    sid, _ = publish(w, " A")
    w.submit(name_suffix=" B")  # chờ duyệt, chưa giao
    post(w.manager, f"/api/admin/skills/{sid}/remove", reason="thử")
    d = w.manager.get("/api/admin/dashboard").json()
    assert d["unassigned"] == 1 and d["tags_pending"] == 1
    assert d["unassigned_overdue"] == 0 and d["review_overdue"] == 0
    assert d["visibility_requests_pending"] == 0 and d["sources_with_problems"] == 0
    assert d["overview"]["skills_removed"] == 1 and d["overview"]["versions_pending"] == 1
    assert [e["action"] for e in d["recent_events"]] == ["skill.remove"]
    assert w.user.get("/api/admin/dashboard").status_code == 403


def test_dashboard_overdue_uses_work_calendar(w):
    _, vid, _ = w.submit()
    from app.core.database import get_session_factory
    from app.modules.skills.models import SkillVersion
    from app.shared.utils import utcnow

    with get_session_factory()() as db:
        db.get(SkillVersion, vid).submitted_at = utcnow() - timedelta(days=30)
        db.commit()
    d = w.manager.get("/api/admin/dashboard").json()
    assert d["unassigned_overdue"] == 1 and d["review_overdue"] == 0
    w.assign(vid)
    d = w.manager.get("/api/admin/dashboard").json()
    assert d["unassigned"] == 0 and d["review_overdue"] == 1


# ---- nhật ký ------------------------------------------------------------------


def test_audit_list_filters_and_paging(w):
    sid, _ = publish(w)
    post(w.manager, f"/api/admin/skills/{sid}/remove", reason="thử")
    post(w.manager, f"/api/admin/skills/{sid}/restore")
    c = w.manager
    allr = c.get("/api/admin/audit-logs").json()
    assert allr["total"] >= 4
    assert allr["items"][0]["action"] == "skill.restore"  # mới nhất trước
    only = c.get("/api/admin/audit-logs", params={"action": "skill.remove"}).json()
    assert only["total"] == 1 and only["items"][0]["detail"]["reason"] == "thử"
    assert c.get("/api/admin/audit-logs", params={"target_type": "skill", "target_id": sid}).json()["total"] == 2
    assert c.get("/api/admin/audit-logs", params={"actor_id": w.ids["manager"]}).json()["total"] >= 2
    assert c.get("/api/admin/audit-logs", params={"from": "2999-01-01T00:00:00Z"}).json()["total"] == 0
    assert c.get("/api/admin/audit-logs", params={"page_size": 1}).json()["items"].__len__() == 1
    assert w.reviewer.get("/api/admin/audit-logs").status_code == 403


def test_audit_export_csv_and_is_itself_logged(w):
    sid, _ = publish(w)
    post(w.manager, f"/api/admin/skills/{sid}/remove", reason="=HYPERLINK(\"x\")")
    r = w.manager.get("/api/admin/audit-logs/export", params={"action": "skill.remove"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert r.headers["cache-control"] == "no-store"
    assert "attachment" in r.headers["content-disposition"]
    text = r.content.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0][:6] == ["id", "created_at", "actor_id", "actor_email", "actor_name", "action"]
    assert len(rows) == 2 and rows[1][5] == "skill.remove"
    assert json.loads(rows[1][8].lstrip("'"))["reason"] == '=HYPERLINK("x")'
    action, detail = audit_actions()[-1]
    assert action == "audit.export" and detail["rows"] == 1 and detail["filter"] == {"action": "skill.remove"}
    assert w.user.get("/api/admin/audit-logs/export").status_code == 403


def test_csv_cells_are_neutralised_against_formula_injection():
    from app.modules.admin.router import _csv_cell

    assert _csv_cell("=1+1") == "'=1+1"
    assert _csv_cell("@sum") == "'@sum"
    assert _csv_cell("bình thường") == "bình thường"
    assert _csv_cell(None) == ""


def test_export_refuses_over_limit(w, monkeypatch):
    publish(w)
    monkeypatch.setattr("app.modules.admin.service.EXPORT_LIMIT", 1)
    r = w.manager.get("/api/admin/audit-logs/export")
    assert r.status_code == 413 and r.json()["error"]["code"] == "EXPORT_TOO_LARGE"
    assert all(a != "audit.export" for a, _ in audit_actions())
