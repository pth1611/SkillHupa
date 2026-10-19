def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_ready_checks_database(client):
    resp = client.get("/api/health/ready")
    assert resp.status_code == 200
    assert resp.json()["database"] == "up"


def test_unknown_route_uses_error_format(client):
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"
