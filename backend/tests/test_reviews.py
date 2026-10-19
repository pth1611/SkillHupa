import io
import json
import zipfile
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.conftest import csrf_headers, login

MD = """---
name: Báo cáo tuần
description: Tạo báo cáo tuần
version: {version}
---
# Hướng dẫn
{body}
"""


def zip_of(files: dict[str, str | bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


def package(version="1.0.0", body="Nội dung", **extra) -> bytes:
    return zip_of({"SKILL.md": MD.format(version=version, body=body), **extra})


class World:
    """Creator, Reviewer, Manager, User đều đăng nhập trên các client riêng."""

    def __init__(self, app):
        self.app = app
        self.creator = self._client("creator@example.com", "creator", "Kế toán")
        self.reviewer = self._client("reviewer@example.com", "reviewer")
        self.reviewer2 = self._client("reviewer2@example.com", "reviewer")
        self.manager = self._client("manager@example.com", "manager")
        self.user = self._client("user@example.com", "user", "Kế toán")
        self.ids = {}
        for key, c in [("reviewer", self.reviewer), ("reviewer2", self.reviewer2),
                       ("creator", self.creator), ("manager", self.manager)]:
            self.ids[key] = c.get("/api/auth/me").json()["id"]

    def _client(self, email, role, department=None):
        c = TestClient(self.app)
        login(c, email, role=role, department=department)
        return c

    def category(self):
        from app.core.database import get_session_factory
        from app.modules.skills.models import Category

        with get_session_factory()() as db:
            cat = db.query(Category).first()
            if cat is None:
                cat = Category(name="Báo cáo", slug="bao-cao")
                db.add(cat)
                db.commit()
            return cat.id

    def submit(self, name_suffix="", version="1.0.0", data=None, skill_id=None, **extra):
        c = self.creator
        if skill_id is None:
            body = c.post(
                "/api/skills",
                data={"metadata": json.dumps({
                    "name": f"Báo cáo tuần{name_suffix}",
                    "summary": "Tạo báo cáo tuần nhanh",
                    "category_id": self.category(),
                    "changelog": "Bản đầu",
                    **extra,
                })},
                files={"package": ("s.zip", data or package(version), "application/zip")},
                headers=csrf_headers(c),
            ).json()
            skill_id, version = body["skill"]["id"], body["version"]["version"]
        else:
            r = c.post(
                f"/api/skills/{skill_id}/versions",
                data={"version": version, "changelog": "Cập nhật"},
                files={"package": ("s.zip", data or package(version), "application/zip")},
                headers=csrf_headers(c),
            )
            assert r.status_code == 201, r.text
        r = c.post(f"/api/skills/{skill_id}/versions/{version}/submit", headers=csrf_headers(c))
        assert r.status_code == 200, r.text
        return skill_id, r.json()["version"]["id"], version

    def assign(self, version_id, who="reviewer"):
        r = self.manager.put(
            f"/api/reviews/versions/{version_id}/assignment",
            json={"reviewer_id": self.ids[who]},
            headers=csrf_headers(self.manager),
        )
        assert r.status_code == 204, r.text

    def decide(self, client, version_id, decision, comment=None):
        return client.post(
            f"/api/reviews/versions/{version_id}/decision",
            json={"decision": decision, "comment": comment},
            headers=csrf_headers(client),
        )


@pytest.fixture
def w(client):
    return World(client.app)


# ---- hàng đợi và phân công ----------------------------------------------------


def test_reviewer_sees_only_assigned_manager_sees_all(w):
    _, vid, _ = w.submit()
    assert w.reviewer.get("/api/reviews/queue").json()["total"] == 0
    q = w.manager.get("/api/reviews/queue").json()
    assert q["total"] == 1
    assert q["items"][0]["kind"] == "version"
    assert q["items"][0]["assigned_to"] is None

    w.assign(vid)
    mine = w.reviewer.get("/api/reviews/queue").json()
    assert mine["total"] == 1 and mine["items"][0]["assigned_to_name"]
    assert w.reviewer2.get("/api/reviews/queue").json()["total"] == 0


def test_unassigned_reviewer_gets_404_on_detail(w):
    _, vid, _ = w.submit()
    assert w.reviewer.get(f"/api/reviews/versions/{vid}").status_code == 404
    assert w.manager.get(f"/api/reviews/versions/{vid}").status_code == 200


def test_only_manager_can_assign_and_assignee_must_be_reviewer(w):
    _, vid, _ = w.submit()
    r = w.reviewer.put(f"/api/reviews/versions/{vid}/assignment", json={"reviewer_id": w.ids["reviewer"]},
                       headers=csrf_headers(w.reviewer))
    assert r.status_code == 403
    r = w.manager.put(f"/api/reviews/versions/{vid}/assignment", json={"reviewer_id": w.ids["creator"]},
                      headers=csrf_headers(w.manager))
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "INVALID_ASSIGNEE"


def test_assignment_notifies_reviewer_and_is_audited(w):
    _, vid, _ = w.submit()
    w.assign(vid)
    notes = w.reviewer.get("/api/notifications").json()["items"]
    assert any(n["type"] == "review.assigned" for n in notes)
    assert w.reviewer.get("/api/auth/me").json()["unread_notifications"] >= 1

    from app.core.database import get_session_factory
    from app.modules.audit.models import AuditLog

    with get_session_factory()() as db:
        actions = [a.action for a in db.query(AuditLog).all()]
    assert "review.assign" in actions


def test_reassign_notifies_previous_reviewer(w):
    _, vid, _ = w.submit()
    w.assign(vid, "reviewer")
    w.assign(vid, "reviewer2")
    prev = w.reviewer.get("/api/notifications").json()["items"]
    assert any(n["type"] == "review.unassigned" for n in prev)
    assert w.reviewer.get(f"/api/reviews/versions/{vid}").status_code == 404
    assert w.reviewer2.get(f"/api/reviews/versions/{vid}").status_code == 200


def test_unassign(w):
    _, vid, _ = w.submit()
    w.assign(vid)
    r = w.manager.delete(f"/api/reviews/versions/{vid}/assignment", headers=csrf_headers(w.manager))
    assert r.status_code == 204
    assert w.reviewer.get("/api/reviews/queue").json()["total"] == 0


# ---- quyết định ----------------------------------------------------------------


def test_approve_publishes_skill_and_makes_it_visible(w):
    sid, vid, ver = w.submit()
    assert w.user.get(f"/api/skills/{sid}").status_code == 404
    w.assign(vid)
    r = w.decide(w.reviewer, vid, "approved")
    assert r.status_code == 204, r.text

    detail = w.user.get(f"/api/skills/{sid}").json()
    assert detail["status"] == "published"
    assert detail["latest_version"]["version"] == ver
    assert detail["skill_md"].startswith("# Hướng dẫn")
    assert w.reviewer.get("/api/reviews/queue").json()["total"] == 0

    notes = w.creator.get("/api/notifications").json()["items"]
    assert any(n["type"] == "review.approved" for n in notes)
    hist = w.reviewer.get("/api/reviews/history").json()
    assert hist["total"] == 1 and hist["items"][0]["decision"] == "approved"


def test_reject_requires_comment_then_creator_can_rework(w):
    sid, vid, ver = w.submit()
    w.assign(vid)
    assert w.decide(w.reviewer, vid, "rejected").status_code == 422
    assert w.decide(w.reviewer, vid, "rejected", "  ").status_code == 422
    assert w.decide(w.reviewer, vid, "rejected", "Thiếu hướng dẫn cài").status_code == 204

    notes = w.creator.get("/api/notifications").json()["items"]
    assert any(n["type"] == "review.rejected" and "Thiếu hướng dẫn cài" in n["message"] for n in notes)

    versions = w.creator.get(f"/api/skills/{sid}/versions").json()
    assert versions[0]["status"] == "rejected"
    r = w.creator.put(
        f"/api/skills/{sid}/versions/{ver}/package",
        files={"package": ("s.zip", package(body="Đã bổ sung"), "application/zip")},
        headers=csrf_headers(w.creator),
    )
    assert r.status_code == 200
    assert r.json()["version"]["status"] == "draft"
    assert w.user.get(f"/api/skills/{sid}").status_code == 404  # vẫn chưa đăng


def test_cannot_decide_twice_or_unassigned(w):
    _, vid, _ = w.submit()
    assert w.decide(w.reviewer, vid, "approved").status_code == 404  # chưa được giao
    w.assign(vid)
    assert w.decide(w.reviewer2, vid, "approved").status_code == 404
    assert w.decide(w.reviewer, vid, "approved").status_code == 204
    assert w.decide(w.reviewer, vid, "approved").status_code == 409


def test_manager_can_decide(w):
    _, vid, _ = w.submit()
    assert w.decide(w.manager, vid, "approved").status_code == 204


def test_checksum_mismatch_blocks_approval(w):
    _, vid, _ = w.submit()
    w.assign(vid)
    from app.core.database import get_session_factory
    from app.modules.skills.models import SkillVersion

    with get_session_factory()() as db:
        v = db.get(SkillVersion, vid)
        v.checksum = "0" * 64
        db.commit()
    r = w.decide(w.reviewer, vid, "approved")
    assert r.status_code == 409


def test_new_version_keeps_old_served_until_approved(w):
    sid, vid1, _ = w.submit()
    w.assign(vid1)
    w.decide(w.reviewer, vid1, "approved")
    _, vid2, _ = w.submit(version="1.1.0", skill_id=sid)
    detail = w.user.get(f"/api/skills/{sid}").json()
    assert detail["latest_version"]["version"] == "1.0.0"  # bản cũ vẫn phục vụ
    w.assign(vid2)
    w.decide(w.reviewer, vid2, "approved")
    detail = w.user.get(f"/api/skills/{sid}").json()
    assert detail["latest_version"]["version"] == "1.1.0"


# ---- xem gói và diff -----------------------------------------------------------


def test_file_tree_and_diff_against_base(w):
    sid, vid1, _ = w.submit(data=package(body="Dòng một", **{"a.txt": "giữ nguyên", "old.txt": "xoá"}))
    w.assign(vid1)
    w.decide(w.reviewer, vid1, "approved")
    _, vid2, _ = w.submit(
        version="1.1.0", skill_id=sid,
        data=package(version="1.1.0", body="Dòng hai", **{"a.txt": "giữ nguyên", "new.txt": "mới"}),
    )
    w.assign(vid2)

    detail = w.reviewer.get(f"/api/reviews/versions/{vid2}").json()
    assert detail["base_version"] == "1.0.0"

    tree = {e["path"]: e["status"] for e in w.reviewer.get(f"/api/reviews/versions/{vid2}/files").json()}
    assert tree == {"SKILL.md": "modified", "a.txt": "unchanged", "new.txt": "added", "old.txt": "removed"}

    content = w.reviewer.get(f"/api/reviews/versions/{vid2}/files/content", params={"path": "SKILL.md"}).json()
    assert "Dòng hai" in content["new"] and "Dòng một" in content["old"]
    assert "-Dòng một" in content["diff"] and "+Dòng hai" in content["diff"]

    missing = w.reviewer.get(f"/api/reviews/versions/{vid2}/files/content", params={"path": "nope"})
    assert missing.status_code == 404


def test_file_warnings_are_attached_and_binary_has_no_content(w):
    _, vid, _ = w.submit(data=package(**{"run.sh": "sudo reboot\n", "tool.bin": b"\x00\x01\x02\x03"}))
    w.assign(vid)
    tree = {e["path"]: e for e in w.reviewer.get(f"/api/reviews/versions/{vid}/files").json()}
    assert tree["run.sh"]["warnings"] == 1
    content = w.reviewer.get(f"/api/reviews/versions/{vid}/files/content", params={"path": "run.sh"}).json()
    assert content["warnings"][0]["check"] == "commands.shell"
    binary = w.reviewer.get(f"/api/reviews/versions/{vid}/files/content", params={"path": "tool.bin"}).json()
    assert binary["is_text"] is False and binary["new"] is None and binary["diff"] is None


def test_package_download_for_assigned_reviewer(w):
    _, vid, _ = w.submit()
    assert w.reviewer.get(f"/api/reviews/versions/{vid}/package").status_code == 404
    w.assign(vid)
    r = w.reviewer.get(f"/api/reviews/versions/{vid}/package")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert zipfile.ZipFile(io.BytesIO(r.content)).namelist() == ["SKILL.md"]


# ---- đổi phạm vi xem ------------------------------------------------------------


def _published_dept_skill(w, visibility):
    sid, vid, _ = w.submit(visibility=visibility, department="Kế toán")
    w.assign(vid)
    w.decide(w.reviewer, vid, "approved")
    return sid


def test_narrowing_applies_immediately(w):
    sid = _published_dept_skill(w, "company")
    r = w.creator.patch(f"/api/skills/{sid}", json={"visibility": "department"}, headers=csrf_headers(w.creator))
    assert r.status_code == 200
    assert r.json()["visibility"] == "department"


def test_widening_creates_request_and_needs_review(w):
    sid = _published_dept_skill(w, "department")
    r = w.creator.patch(f"/api/skills/{sid}", json={"visibility": "company"}, headers=csrf_headers(w.creator))
    assert r.status_code == 202
    req_id = r.json()["visibility_request"]["id"]
    assert w.creator.get(f"/api/skills/{sid}").json()["visibility"] == "department"

    again = w.creator.patch(f"/api/skills/{sid}", json={"visibility": "company"}, headers=csrf_headers(w.creator))
    assert again.status_code == 409

    q = w.manager.get("/api/reviews/queue?type=visibility").json()
    assert q["total"] == 1 and q["items"][0]["id"] == req_id
    mgr_notes = w.manager.get("/api/notifications").json()["items"]
    assert any(n["type"] == "visibility.requested" for n in mgr_notes)

    r = w.manager.put(f"/api/reviews/visibility-requests/{req_id}/assignment",
                      json={"reviewer_id": w.ids["reviewer"]}, headers=csrf_headers(w.manager))
    assert r.status_code == 204
    detail = w.reviewer.get(f"/api/reviews/visibility-requests/{req_id}").json()
    assert detail["to_visibility"] == "company"
    r = w.reviewer.post(f"/api/reviews/visibility-requests/{req_id}/decision",
                        json={"decision": "approved"}, headers=csrf_headers(w.reviewer))
    assert r.status_code == 204
    assert w.creator.get(f"/api/skills/{sid}").json()["visibility"] == "company"


def test_rejected_request_keeps_old_scope(w):
    sid = _published_dept_skill(w, "department")
    req = w.creator.patch(f"/api/skills/{sid}", json={"visibility": "company"},
                          headers=csrf_headers(w.creator)).json()["visibility_request"]["id"]
    w.manager.put(f"/api/reviews/visibility-requests/{req}/assignment",
                  json={"reviewer_id": w.ids["reviewer"]}, headers=csrf_headers(w.manager))
    r = w.reviewer.post(f"/api/reviews/visibility-requests/{req}/decision",
                        json={"decision": "rejected", "comment": "Nội dung nội bộ"}, headers=csrf_headers(w.reviewer))
    assert r.status_code == 204
    assert w.creator.get(f"/api/skills/{sid}").json()["visibility"] == "department"


# ---- tác vụ định kỳ ------------------------------------------------------------------


def _backdate(version_id, days):
    from app.core.database import get_session_factory
    from app.modules.skills.models import SkillVersion

    with get_session_factory()() as db:
        v = db.get(SkillVersion, version_id)
        v.submitted_at = datetime.now(UTC) - timedelta(days=days)
        db.commit()


def _run(now=None):
    from app.core.config import get_settings
    from app.core.database import get_session_factory
    from app.modules.reviews import service

    with get_session_factory()() as db:
        out = service.run_scheduled(db, get_settings(), now)
        db.commit()
        return out


def _count_notes(client, type_):
    items = client.get("/api/notifications").json()["items"]
    return len([n for n in items if n["type"] == type_])


def test_scheduled_reminds_managers_once(w):
    _, vid, _ = w.submit()
    _backdate(vid, 2)
    assert _run()["reminded"] >= 1
    assert _count_notes(w.manager, "review.unassigned_overdue") == 1
    _run()
    assert _count_notes(w.manager, "review.unassigned_overdue") == 1  # không lặp
    q = w.manager.get("/api/reviews/queue").json()["items"][0]
    assert q["unassigned_overdue"] is True


def test_scheduled_auto_assigns_after_three_working_days(w):
    _, vid, _ = w.submit()
    _backdate(vid, 10)  # chắc chắn quá 3 ngày làm việc
    out = _run()
    assert out["auto_assigned"] == 1
    item = w.manager.get("/api/reviews/queue").json()["items"][0]
    assert item["assigned_to"] in (w.ids["reviewer"], w.ids["reviewer2"])
    assert _count_notes(w.manager, "review.auto_assigned") == 1

    from app.core.database import get_session_factory
    from app.modules.audit.models import AuditLog

    with get_session_factory()() as db:
        entry = db.query(AuditLog).filter_by(action="review.auto_assign").one()
        assert entry.actor_id is None and entry.actor_name == "system"
    assert _run()["auto_assigned"] == 0  # đã giao thì không giao lại


def test_auto_assign_balances_load(w):
    ids = []
    for i in range(2):
        _, vid, _ = w.submit(name_suffix=f" {i}")
        _backdate(vid, 10)
        ids.append(vid)
    _run()
    items = w.manager.get("/api/reviews/queue").json()["items"]
    assert {i["assigned_to"] for i in items} == {w.ids["reviewer"], w.ids["reviewer2"]}


def test_overdue_review_notifies_reviewer_and_managers(w):
    _, vid, _ = w.submit()
    w.assign(vid)
    _backdate(vid, 10)
    assert _run()["overdue_notified"] >= 1
    assert _count_notes(w.reviewer, "review.overdue") == 1
    assert _count_notes(w.manager, "review.overdue") == 1


def test_no_reviewer_available_warns_managers(client):
    w2 = World(client.app)
    from app.core.database import get_session_factory
    from app.modules.users.models import User

    with get_session_factory()() as db:
        for u in db.query(User).filter(User.role == "reviewer"):
            u.is_active = False
        db.commit()
    _, vid, _ = w2.submit()
    _backdate(vid, 10)
    assert _run()["auto_assigned"] == 0
    assert _count_notes(w2.manager, "review.no_reviewer") == 1


def test_imported_skill_notifications_go_to_managers(w):
    sid, vid, _ = w.submit()
    from app.core.database import get_session_factory
    from app.modules.skills.models import Skill

    with get_session_factory()() as db:
        s = db.get(Skill, sid)
        s.owner_id = None
        s.origin = "imported"
        db.commit()
    w.assign(vid)
    assert w.decide(w.reviewer, vid, "approved").status_code == 204
    assert _count_notes(w.manager, "review.approved") == 1
    assert _count_notes(w.creator, "review.approved") == 0


# ---- thông báo -------------------------------------------------------------------------


def test_notifications_read_flow(w):
    _, vid, _ = w.submit()
    w.assign(vid)
    items = w.reviewer.get("/api/notifications?unread=true").json()["items"]
    assert items
    nid = items[0]["id"]
    assert w.reviewer.post(f"/api/notifications/{nid}/read", headers=csrf_headers(w.reviewer)).status_code == 204
    assert w.creator.post(f"/api/notifications/{nid}/read", headers=csrf_headers(w.creator)).status_code == 404
    assert w.reviewer.post("/api/notifications/read-all", headers=csrf_headers(w.reviewer)).status_code == 204
    assert w.reviewer.get("/api/notifications?unread=true").json()["total"] == 0


def test_review_detail_has_owner_assigner_and_icon_endpoint(w):
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (256, 256), "blue").save(buf, "PNG")
    c = w.creator
    r = c.post(
        "/api/skills",
        data={"metadata": json.dumps({"name": "Có ảnh", "summary": "x", "category_id": w.category()})},
        files={"package": ("s.zip", package(), "application/zip"), "icon": ("i.png", buf.getvalue(), "image/png")},
        headers=csrf_headers(c),
    )
    sid, ver = r.json()["skill"]["id"], r.json()["version"]["version"]
    c.post(f"/api/skills/{sid}/versions/{ver}/submit", headers=csrf_headers(c))
    vid = c.get(f"/api/skills/{sid}/versions").json()[0]["id"]
    assert w.reviewer.get(f"/api/reviews/versions/{vid}/icon").status_code == 404  # chưa được giao
    w.assign(vid)
    d = w.reviewer.get(f"/api/reviews/versions/{vid}").json()
    assert d["has_icon"] is True and d["owner_name"] and d["assigned_by_name"]
    img = w.reviewer.get(f"/api/reviews/versions/{vid}/icon")
    assert img.status_code == 200 and img.headers["content-type"] == "image/webp"


def test_bulk_assign_gives_many_and_skips_failures(w):
    _, v1, _ = w.submit()
    _, v2, _ = w.submit(name_suffix=" 2")
    r = w.manager.put(
        "/api/reviews/assignments",
        json={"reviewer_id": w.ids["reviewer"],
              "items": [{"kind": "version", "id": v1}, {"kind": "version", "id": v2}, {"kind": "version", "id": 99999}]},
        headers=csrf_headers(w.manager),
    )
    assert r.status_code == 200, r.text
    errors = {i["id"]: i["error"] for i in r.json()}
    assert errors == {v1: None, v2: None, 99999: "REVIEW_ITEM_NOT_FOUND"}
    assert w.decide(w.reviewer, v1, "approved").status_code == 204
    assert w.decide(w.reviewer, v2, "approved").status_code == 204


def test_bulk_assign_rejects_non_reviewer_and_non_manager(w):
    _, v1, _ = w.submit()
    body = {"reviewer_id": w.ids["creator"], "items": [{"kind": "version", "id": v1}]}
    assert w.manager.put("/api/reviews/assignments", json=body, headers=csrf_headers(w.manager)).status_code == 422
    body["reviewer_id"] = w.ids["reviewer"]
    assert w.reviewer.put("/api/reviews/assignments", json=body, headers=csrf_headers(w.reviewer)).status_code == 403
