import pytest
from fastapi.testclient import TestClient

from tests.conftest import csrf_headers, login
from tests.test_catalog import publish
from tests.test_installs import mine, publish_v2, report
from tests.test_reviews import World


@pytest.fixture
def w(client):
    return World(client.app)


def post(c, url, **body):
    return c.post(url, json=body or None, headers=csrf_headers(c))


def notes(c, type_):
    r = c.get("/api/notifications")
    assert r.status_code == 200, r.text
    return [n for n in r.json()["items"] if n["type"] == type_]


def audit_actions():
    from app.core.database import get_session_factory
    from app.modules.audit.models import AuditLog

    with get_session_factory()() as db:
        return [(a.action, a.detail) for a in db.query(AuditLog).order_by(AuditLog.id)]


def test_admin_endpoints_are_manager_only(w):
    sid, _ = publish(w)
    for c in (w.user, w.creator, w.reviewer):
        assert c.get("/api/admin/skills").status_code == 403
        assert post(c, f"/api/admin/skills/{sid}/remove", reason="x").status_code == 403
        assert c.get(f"/api/admin/skills/{sid}/impact").status_code == 403


def test_list_all_skills_with_filters(w):
    publish(w, " A")
    w.submit(name_suffix=" B")  # draft
    r = w.manager.get("/api/admin/skills").json()
    assert r["total"] == 2
    assert [i["name"] for i in w.manager.get("/api/admin/skills", params={"status": "published"}).json()["items"]] == ["Báo cáo tuần A"]
    assert w.manager.get("/api/admin/skills", params={"q": "tuần b"}).json()["total"] == 1
    assert w.manager.get("/api/admin/skills", params={"owner_id": w.ids["creator"]}).json()["total"] == 2
    assert w.manager.get("/api/admin/skills", params={"status": "bogus"}).status_code == 400


def test_remove_requires_reason_hides_skill_notifies_and_audits(w):
    sid, _ = publish(w)
    report(w.user, sid)
    w.user.get(f"/api/skills/{sid}/download", params={"intent": "zip"})  # cùng người, thêm bản zip
    assert post(w.manager, f"/api/admin/skills/{sid}/remove").status_code == 400
    assert post(w.manager, f"/api/admin/skills/{sid}/remove", reason="  ").status_code == 400
    imp = w.manager.get(f"/api/admin/skills/{sid}/impact").json()
    assert imp["installed_users"] == 1 and imp["zip_users"] == 1

    r = post(w.manager, f"/api/admin/skills/{sid}/remove", reason="Vi phạm bản quyền")
    assert r.status_code == 200 and r.json()["status"] == "removed"
    assert w.user.get("/api/skills").json()["items"] == []
    assert w.user.get(f"/api/skills/{sid}").status_code == 404
    assert w.user.get(f"/api/skills/{sid}/download").status_code == 404
    assert report(w.user, sid).status_code == 404
    assert w.creator.get(f"/api/skills/{sid}").status_code == 200  # chủ skill vẫn xem được
    assert {i["state"] for i in mine(w.user)} == {"removed"}
    assert len(notes(w.user, "skill.removed")) == 1
    assert "Vi phạm bản quyền" in notes(w.creator, "skill.removed")[0]["message"]
    assert audit_actions()[-1][0] == "skill.remove"
    assert audit_actions()[-1][1]["reason"] == "Vi phạm bản quyền"
    assert post(w.manager, f"/api/admin/skills/{sid}/remove", reason="x").status_code == 409


def test_cannot_remove_draft(w):
    sid, _, _ = w.submit()  # đang chờ duyệt, skill còn draft
    r = post(w.manager, f"/api/admin/skills/{sid}/remove", reason="x")
    assert r.status_code == 409 and r.json()["error"]["code"] == "SKILL_NOT_REMOVABLE"


def test_restore_returns_to_published_and_notifies(w):
    sid, _ = publish(w)
    report(w.user, sid)
    post(w.manager, f"/api/admin/skills/{sid}/remove", reason="tạm")
    r = post(w.manager, f"/api/admin/skills/{sid}/restore")
    assert r.status_code == 200 and r.json()["status"] == "published" and r.json()["latest_version"] == "1.0.0"
    assert [i["name"] for i in w.user.get("/api/skills").json()["items"]] == ["Báo cáo tuần"]
    assert mine(w.user)[0]["state"] == "up_to_date"
    assert len(notes(w.user, "skill.restored")) == 1
    assert post(w.manager, f"/api/admin/skills/{sid}/restore").status_code == 409


def test_revoke_moves_latest_back_and_warns_installers(w):
    sid, _ = publish(w)
    publish_v2(w, sid)
    report(w.user, sid, version="1.1.0")
    report(w.reviewer, sid, version="1.0.0")
    imp = w.manager.get(f"/api/admin/skills/{sid}/impact", params={"version": "1.1.0"}).json()
    assert imp == {"installed_users": 1, "zip_users": 0, "latest_after_revoke": "1.0.0"}

    assert post(w.manager, f"/api/admin/skills/{sid}/versions/1.1.0/revoke").status_code == 400
    r = post(w.manager, f"/api/admin/skills/{sid}/versions/1.1.0/revoke", reason="Có lỗi nghiêm trọng")
    assert r.status_code == 200 and r.json()["latest_version"] == "1.0.0"
    assert mine(w.user)[0]["state"] == "revoked"
    assert mine(w.reviewer)[0]["state"] == "up_to_date"  # không bị ảnh hưởng
    assert len(notes(w.user, "version.revoked")) == 1
    assert notes(w.reviewer, "version.revoked") == []
    assert w.user.get(f"/api/skills/{sid}/download", params={"version": "1.1.0"}).status_code == 409
    assert report(w.user, sid, version="1.1.0").status_code == 409
    assert w.user.get("/api/skills").json()["items"][0]["latest_version"] == "1.0.0"
    assert audit_actions()[-1][0] == "version.revoke"


def test_revoke_rejects_last_published_and_non_published(w):
    sid, _ = publish(w)
    r = post(w.manager, f"/api/admin/skills/{sid}/versions/1.0.0/revoke", reason="x")
    assert r.status_code == 409 and r.json()["error"]["code"] == "LAST_PUBLISHED_VERSION"
    w.submit(skill_id=sid, version="1.1.0", data=None)  # đang chờ duyệt
    r = post(w.manager, f"/api/admin/skills/{sid}/versions/1.1.0/revoke", reason="x")
    assert r.status_code == 409 and r.json()["error"]["code"] == "VERSION_NOT_REVOCABLE"
    assert post(w.manager, f"/api/admin/skills/{sid}/versions/9.9.9/revoke", reason="x").status_code == 404


def test_restore_after_revoke_while_removed_skips_revoked(w):
    sid, _ = publish(w)
    publish_v2(w, sid)
    post(w.manager, f"/api/admin/skills/{sid}/remove", reason="tạm")
    post(w.manager, f"/api/admin/skills/{sid}/versions/1.1.0/revoke", reason="lỗi")
    r = post(w.manager, f"/api/admin/skills/{sid}/restore")
    assert r.json()["latest_version"] == "1.0.0"


def test_transfer_ownership(w):
    sid, _ = publish(w)
    other = TestClient(w.app)
    login(other, "creator2@example.com", role="creator", department="Kế toán")
    new_id = other.get("/api/auth/me").json()["id"]
    for bad in (w.ids["reviewer"], w.ids["manager"], 99999):
        r = post(w.manager, f"/api/admin/skills/{sid}/transfer", new_owner_id=bad)
        assert r.status_code == 400 and r.json()["error"]["code"] == "INVALID_OWNER"
    r = post(w.manager, f"/api/admin/skills/{sid}/transfer", new_owner_id=new_id)
    assert r.status_code == 200 and r.json()["owner_id"] == new_id
    assert other.get("/api/skills/mine").json()[0]["id"] == sid
    assert w.creator.get("/api/skills/mine").json() == []
    assert len(notes(other, "skill.transferred_in")) == 1
    assert len(notes(w.creator, "skill.transferred_out")) == 1
    assert audit_actions()[-1][0] == "skill.transfer"


def test_transfer_rejected_for_imported_skill(w):
    sid, _ = publish(w)
    from app.core.database import get_session_factory
    from app.modules.skills.models import Skill

    with get_session_factory()() as db:
        s = db.get(Skill, sid)
        s.origin, s.owner_id = "imported", None
        db.commit()
    r = post(w.manager, f"/api/admin/skills/{sid}/transfer", new_owner_id=w.ids["creator"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "IMPORTED_SKILL_NO_OWNER"
