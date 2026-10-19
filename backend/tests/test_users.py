from tests.conftest import login


def test_list_users_requires_manager(client):
    login(client, "u@example.com", role="user")
    assert client.get("/api/users").status_code == 403


def test_list_users_unauthenticated(client):
    assert client.get("/api/users").status_code == 401


def test_manager_can_search_and_filter(client):
    from fastapi.testclient import TestClient

    # Tạo vài người bằng các phiên riêng
    for email, role, dept in [
        ("c1@example.com", "creator", "Kế toán"),
        ("c2@example.com", "creator", "Nhân sự"),
        ("r1@example.com", "reviewer", "Kế toán"),
    ]:
        with TestClient(client.app) as other:
            login(other, email, role=role, department=dept)
    login(client, "m@example.com", role="manager")

    everyone = client.get("/api/users").json()
    assert everyone["total"] == 4

    creators = client.get("/api/users?role=creator").json()
    assert {u["email"] for u in creators["items"]} == {"c1@example.com", "c2@example.com"}

    by_dept = client.get("/api/users", params={"department": "Kế toán"}).json()
    assert by_dept["total"] == 2

    by_q = client.get("/api/users?q=R1").json()
    assert [u["email"] for u in by_q["items"]] == ["r1@example.com"]


def test_pagination(client):
    from fastapi.testclient import TestClient

    for i in range(5):
        with TestClient(client.app) as other:
            login(other, f"p{i}@example.com")
    login(client, "m@example.com", role="manager")
    page = client.get("/api/users?page=2&page_size=2").json()
    assert page["page"] == 2 and page["page_size"] == 2
    assert len(page["items"]) == 2
    assert page["total"] == 6


def test_invalid_page_size_is_validation_error(client):
    login(client, "m@example.com", role="manager")
    resp = client.get("/api/users?page_size=1000")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
