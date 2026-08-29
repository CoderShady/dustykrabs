"""Integration tests for all REST API endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.seed import seed_database

# Create isolated in-memory SQLite test database
TEST_ENGINE = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=TEST_ENGINE)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_test_db():
    Base.metadata.create_all(bind=TEST_ENGINE)
    db = TestingSessionLocal()
    seed_database(db, force=True)
    db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=TEST_ENGINE)


@pytest.fixture
def client():
    return TestClient(app)


def test_health_check(client: TestClient):
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert "M/M/c" in data["model"]


def test_list_hospitals(client: TestClient):
    res = client.get("/api/hospitals")
    assert res.status_code == 200
    hospitals = res.json()
    assert len(hospitals) == 3
    for h in hospitals:
        assert "id" in h
        assert "name" in h
        assert "total_waiting" in h
        assert "avg_wait_minutes" in h
        assert h["department_count"] == 3


def test_get_hospital_detail(client: TestClient):
    res = client.get("/api/hospitals/h1")
    assert res.status_code == 200
    detail = res.json()
    assert detail["id"] == "h1"
    assert detail["name"] == "City General Hospital"
    assert len(detail["departments"]) == 3
    dept = detail["departments"][0]
    assert "now_serving" in dept
    assert "queue_size" in dept
    assert "estimated_wait_minutes" in dept
    assert "num_counters" in dept


def test_department_metrics(client: TestClient):
    res = client.get("/api/hospitals/h1/departments/d1/metrics")
    assert res.status_code == 200
    m = res.json()
    assert m["department_id"] == "d1"
    assert m["lambda_per_hour"] > 0
    assert m["mu_per_hour"] > 0
    assert m["c"] == 2
    assert "rho" in m
    assert "p_wait" in m
    assert "recommended_c" in m


def test_department_queue_trail(client: TestClient):
    res = client.get("/api/hospitals/h1/departments/d1/trail")
    assert res.status_code == 200
    trail = res.json()
    assert isinstance(trail, list)
    assert len(trail) > 0
    # First element is usually the current token
    assert any(item["is_current"] is True for item in trail)


def test_token_approval_workflow(client: TestClient):
    # 1. Patient requests a token
    req_payload = {
        "hospital_id": "h1",
        "department_id": "d1",
        "patient_name": "Applicant Alice",
        "age": 25,
        "gender": "Female",
        "phone": "9123456780",
    }
    req_res = client.post("/api/tokens/request", json=req_payload)
    assert req_res.status_code == 200
    req_data = req_res.json()
    assert req_data["status"] == "pending_approval"
    assert req_data["patient_name"] == "Applicant Alice"
    token_id = req_data["id"]

    # 2. Check pending list
    pending_res = client.get("/api/tokens/pending?hospital_id=h1")
    assert pending_res.status_code == 200
    pending_list = pending_res.json()
    assert any(t["id"] == token_id for t in pending_list)

    # 3. Receptionist approves token
    approve_res = client.post(f"/api/tokens/{token_id}/approve")
    assert approve_res.status_code == 200
    approved_data = approve_res.json()
    assert approved_data["status"] == "waiting"
    assert approved_data["number"].startswith("A-")
    assert approved_data["approved_at"] is not None
    assert approved_data["ahead"] is not None

    # 4. Token is no longer pending
    pending_res2 = client.get("/api/tokens/pending?hospital_id=h1")
    assert not any(t["id"] == token_id for t in pending_res2.json())


def test_token_rejection_workflow(client: TestClient):
    # 1. Patient requests token
    req_payload = {
        "hospital_id": "h1",
        "department_id": "d2",
        "patient_name": "Applicant Bob",
        "age": 45,
        "gender": "Male",
        "phone": "9123456781",
    }
    req_res = client.post("/api/tokens/request", json=req_payload)
    token_id = req_res.json()["id"]

    # 2. Receptionist rejects token
    reject_res = client.post(
        f"/api/tokens/{token_id}/reject",
        json={"reason": "Incorrect department selected for adult patient."},
    )
    assert reject_res.status_code == 200
    reject_data = reject_res.json()
    assert reject_data["status"] == "rejected"
    assert "Incorrect department" in reject_data["rejection_reason"]


def test_token_lifecycle(client: TestClient):
    # 1. Create a new token (patient check-in)
    payload = {
        "hospital_id": "h1",
        "department_id": "d1",
        "patient_name": "Test Patient",
        "age": 30,
        "gender": "Female",
        "phone": "9876543210",
    }
    create_res = client.post("/api/tokens", json=payload)
    assert create_res.status_code == 200
    token = create_res.json()
    assert token["number"].startswith("A-")
    assert token["patient_name"] == "Test Patient"
    assert token["status"] == "waiting"
    assert token["ahead"] is not None
    assert token["wait_minutes"] is not None

    token_id = token["id"]

    # 2. Query token by ID (patient tracking view)
    get_res = client.get(f"/api/tokens/{token_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == token_id

    # 3. List tokens for reception
    list_res = client.get("/api/tokens?hospital_id=h1&department_id=d1")
    assert list_res.status_code == 200
    tokens = list_res.json()
    assert any(t["id"] == token_id for t in tokens)


def test_department_queue_management(client: TestClient):
    # 1. Inspect queue view
    view_res = client.get("/api/departments/d1/queue")
    assert view_res.status_code == 200
    view = view_res.json()
    assert "department_id" in view
    assert "waiting" in view
    assert "recent" in view

    # 2. If already serving, resolve it first
    if view["now_serving"]:
        resolve_res = client.post(
            "/api/departments/d1/resolve",
            json={"status": "completed"},
        )
        assert resolve_res.status_code == 200
        assert resolve_res.json()["status"] == "completed"

    # 3. Call next patient
    call_res = client.post("/api/departments/d1/call-next")
    assert call_res.status_code == 200
    called = call_res.json()
    assert called["status"] == "called"
    assert called["called_at"] is not None

    # 4. Try calling again while counter busy -> should reject with 400
    double_call = client.post("/api/departments/d1/call-next")
    assert double_call.status_code == 400

    # 5. Resolve as completed
    resolve_res2 = client.post(
        "/api/departments/d1/resolve",
        json={"status": "completed"},
    )
    assert resolve_res2.status_code == 200
    assert resolve_res2.json()["status"] == "completed"


def test_counter_update(client: TestClient):
    res = client.patch("/api/departments/d1/counters", json={"num_counters": 3})
    assert res.status_code == 200
    assert res.json()["num_counters"] == 3

    # Check metrics reflected new counter count
    m_res = client.get("/api/hospitals/h1/departments/d1/metrics")
    assert m_res.json()["c"] == 3


def test_bed_management(client: TestClient):
    # 1. List beds
    list_res = client.get("/api/hospitals/h1/beds")
    assert list_res.status_code == 200
    beds = list_res.json()
    assert len(beds) == 16
    bed = beds[0]
    bed_id = bed["id"]

    # 2. Update bed to occupied
    update_res = client.patch(
        f"/api/beds/{bed_id}",
        json={"status": "occupied", "patient_name": "Inpatient Charlie"},
    )
    assert update_res.status_code == 200
    assert update_res.json()["status"] == "occupied"
    assert update_res.json()["patient_name"] == "Inpatient Charlie"

    # 3. Release bed
    release_res = client.post(f"/api/beds/{bed_id}/release")
    assert release_res.status_code == 200
    assert release_res.json()["status"] == "available"
    assert release_res.json()["patient_name"] == ""


def test_admin_stats_and_alerts(client: TestClient):
    stats_res = client.get("/api/admin/stats?scope=all")
    assert stats_res.status_code == 200
    stats = stats_res.json()
    assert stats["total_waiting"] >= 0
    assert stats["total_beds"] == 42  # 16 + 14 + 12
    assert "occupied_pct" in stats
    assert "avg_utilization" in stats

    alerts_res = client.get("/api/admin/alerts")
    assert alerts_res.status_code == 200
    alerts = alerts_res.json()
    assert len(alerts) == 9  # 3 hospitals * 3 depts
    for a in alerts:
        assert a["severity"] in ["ok", "warning", "critical"]
        assert "message" in a


def test_staff_auth(client: TestClient):
    # 1. Unauthenticated /me
    unauth_me = client.get("/api/auth/me")
    assert unauth_me.status_code == 200
    assert unauth_me.json()["authenticated"] is False

    # 2. Invalid credentials
    bad_res = client.post(
        "/api/auth/staff-login",
        json={"username": "staff", "password": "wrongpassword"},
    )
    assert bad_res.status_code == 200
    assert bad_res.json()["success"] is False

    # 3. Valid credentials -> sets cookie
    good_res = client.post(
        "/api/auth/staff-login",
        json={"username": "staff", "password": "staff123"},
    )
    assert good_res.status_code == 200
    assert good_res.json()["success"] is True
    assert "opd_staff_session" in good_res.cookies

    # 4. Authenticated /me using session cookie
    auth_me = client.get("/api/auth/me")
    assert auth_me.status_code == 200
    assert auth_me.json()["authenticated"] is True
    assert auth_me.json()["role"] == "staff"

    # 5. Access /staff page when authenticated -> returns 200
    staff_page = client.get("/staff")
    assert staff_page.status_code == 200

    # 6. Logout -> clears cookie
    logout_res = client.post("/api/auth/staff-logout")
    assert logout_res.status_code == 200

    # 7. Access /staff page when unauthenticated -> redirects to /staff/login (307)
    unauth_staff = client.get("/staff", follow_redirects=False)
    assert unauth_staff.status_code == 307
    assert unauth_staff.headers["location"] == "/staff/login"


def test_simulation_endpoints(client: TestClient):
    tick_res = client.post("/api/simulation/tick")
    assert tick_res.status_code == 200
    assert tick_res.json()["success"] is True

    status_res = client.get("/api/simulation/status")
    assert status_res.status_code == 200
    data = status_res.json()
    assert data["hospitals"] == 3
    assert data["departments"] == 9
    assert data["beds"] == 42

    reset_res = client.post("/api/simulation/reset")
    assert reset_res.status_code == 200
    assert reset_res.json()["success"] is True
