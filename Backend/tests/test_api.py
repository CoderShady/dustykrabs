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

HOSPITAL_ID = "WB-DEMO-001"
DEPARTMENT_ID = f"{HOSPITAL_ID}-D01"
SECOND_DEPARTMENT_ID = f"{HOSPITAL_ID}-D02"


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
    assert len(hospitals) == 20
    for h in hospitals:
        assert "id" in h
        assert "name" in h
        assert "demo" not in h["name"].lower()
        assert "total_waiting" in h
        assert "avg_wait_minutes" in h
    hospital = next(h for h in hospitals if h["id"] == "WB-DEMO-001")
    assert hospital["city"] == "Kolkata"
    assert hospital["district"] == "Kolkata"
    assert hospital["region"] == "South Bengal"
    assert hospital["hospital_tier"] == "tertiary"
    assert hospital["emergency_24x7"] is True
    assert hospital["total_doctors"] == 360
    assert hospital["total_inpatient_beds"] == 800
    assert hospital["total_opd_consultation_rooms"] == 58
    assert hospital["daily_opd_token_capacity"] == 2600
    assert hospital["department_count"] == 28


def test_get_hospital_detail(client: TestClient):
    res = client.get(f"/api/hospitals/{HOSPITAL_ID}")
    assert res.status_code == 200
    detail = res.json()
    assert detail["id"] == HOSPITAL_ID
    assert detail["name"] == "Kolkata Central Multispecialty Hospital"
    assert len(detail["departments"]) == 28
    dept = detail["departments"][0]
    assert "now_serving" in dept
    assert "queue_size" in dept
    assert "estimated_wait_minutes" in dept
    assert "num_counters" in dept


def test_expanded_hospital_has_operational_dashboard_data(client: TestClient):
    hospital_id = "WB-DEMO-001"
    detail_res = client.get(f"/api/hospitals/{hospital_id}")
    assert detail_res.status_code == 200
    detail = detail_res.json()

    assert detail["name"] == "Kolkata Central Multispecialty Hospital"
    assert len(detail["departments"]) == detail["department_count"] == 28
    assert len({department["id"] for department in detail["departments"]}) == 28

    department = detail["departments"][0]
    metrics_res = client.get(
        f"/api/hospitals/{hospital_id}/departments/{department['id']}/metrics"
    )
    assert metrics_res.status_code == 200
    assert metrics_res.json()["department_id"] == department["id"]

    beds_res = client.get(f"/api/hospitals/{hospital_id}/beds")
    assert beds_res.status_code == 200
    assert len(beds_res.json()) == 16


def test_expanded_hospital_token_and_bed_workflows(client: TestClient):
    hospital_id = "WB-DEMO-020"
    department_id = f"{hospital_id}-D01"

    token_res = client.post(
        "/api/tokens",
        json={
            "hospital_id": hospital_id,
            "department_id": department_id,
            "patient_name": "New Hospital Patient",
            "age": 38,
            "gender": "Female",
            "phone": "9000000020",
        },
    )
    assert token_res.status_code == 200
    token = token_res.json()
    assert token["number"].startswith("GM-")
    assert token["status"] == "waiting"

    queue_res = client.get(f"/api/departments/{department_id}/queue")
    assert queue_res.status_code == 200
    assert any(item["id"] == token["id"] for item in queue_res.json()["waiting"])

    beds = client.get(f"/api/hospitals/{hospital_id}/beds").json()
    bed_id = beds[0]["id"]
    occupy_res = client.patch(
        f"/api/beds/{bed_id}",
        json={"status": "occupied", "patient_name": "New Hospital Inpatient"},
    )
    assert occupy_res.status_code == 200
    assert occupy_res.json()["patient_name"] == "New Hospital Inpatient"

    release_res = client.post(f"/api/beds/{bed_id}/release")
    assert release_res.status_code == 200
    assert release_res.json()["status"] == "available"


def test_department_metrics(client: TestClient):
    res = client.get(
        f"/api/hospitals/{HOSPITAL_ID}/departments/{DEPARTMENT_ID}/metrics"
    )
    assert res.status_code == 200
    m = res.json()
    assert m["department_id"] == DEPARTMENT_ID
    assert m["lambda_per_hour"] > 0
    assert m["mu_per_hour"] > 0
    assert m["c"] == 2
    assert "rho" in m
    assert "p_wait" in m
    assert "recommended_c" in m


def test_department_queue_trail(client: TestClient):
    create_res = client.post(
        "/api/tokens",
        json={
            "hospital_id": HOSPITAL_ID,
            "department_id": DEPARTMENT_ID,
            "patient_name": "Queue Trail Patient",
            "age": 29,
            "gender": "Male",
            "phone": "9123456799",
        },
    )
    assert create_res.status_code == 200

    res = client.get(
        f"/api/hospitals/{HOSPITAL_ID}/departments/{DEPARTMENT_ID}/trail"
    )
    assert res.status_code == 200
    trail = res.json()
    assert isinstance(trail, list)
    assert len(trail) > 0
    assert any(item["id"] == create_res.json()["id"] for item in trail)


def test_token_approval_workflow(client: TestClient):
    # 1. Patient requests a token
    req_payload = {
        "hospital_id": HOSPITAL_ID,
        "department_id": DEPARTMENT_ID,
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

    # 2. The request appears in today's reception list but not the live queue.
    pending_res = client.get(f"/api/tokens/pending?hospital_id={HOSPITAL_ID}")
    assert pending_res.status_code == 200
    pending_list = pending_res.json()
    assert any(t["id"] == token_id for t in pending_list)

    todays_res = client.get(
        f"/api/tokens?hospital_id={HOSPITAL_ID}&today_only=true&limit=500"
    )
    assert todays_res.status_code == 200
    assert any(t["id"] == token_id for t in todays_res.json())

    queue_before_hold = client.get(f"/api/departments/{DEPARTMENT_ID}/queue").json()
    assert not any(t["id"] == token_id for t in queue_before_hold["waiting"])

    # 3. Receptionist keeps it on hold; it remains out of Queue Management.
    hold_res = client.post(f"/api/tokens/{token_id}/hold")
    assert hold_res.status_code == 200
    assert hold_res.json()["status"] == "on_hold"

    queue_on_hold = client.get(f"/api/departments/{DEPARTMENT_ID}/queue").json()
    assert not any(t["id"] == token_id for t in queue_on_hold["waiting"])

    held_today = client.get(
        f"/api/tokens?hospital_id={HOSPITAL_ID}&today_only=true&limit=500"
    ).json()
    assert next(t for t in held_today if t["id"] == token_id)["status"] == "on_hold"

    # 4. Approval assigns a number and moves the held request into the queue.
    approve_res = client.post(f"/api/tokens/{token_id}/approve")
    assert approve_res.status_code == 200
    approved_data = approve_res.json()
    assert approved_data["status"] == "waiting"
    assert approved_data["number"].startswith("GM-")
    assert approved_data["approved_at"] is not None
    assert approved_data["ahead"] is not None

    queued = client.get(f"/api/departments/{DEPARTMENT_ID}/queue").json()
    assert any(t["id"] == token_id for t in queued["waiting"])

    # 5. Token is no longer pending
    pending_res2 = client.get(f"/api/tokens/pending?hospital_id={HOSPITAL_ID}")
    assert not any(t["id"] == token_id for t in pending_res2.json())


def test_token_rejection_workflow(client: TestClient):
    # 1. Patient requests token
    req_payload = {
        "hospital_id": HOSPITAL_ID,
        "department_id": SECOND_DEPARTMENT_ID,
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
        "hospital_id": HOSPITAL_ID,
        "department_id": DEPARTMENT_ID,
        "patient_name": "Test Patient",
        "age": 30,
        "gender": "Female",
        "phone": "9876543210",
    }
    create_res = client.post("/api/tokens", json=payload)
    assert create_res.status_code == 200
    token = create_res.json()
    assert token["number"].startswith("GM-")
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
    list_res = client.get(
        f"/api/tokens?hospital_id={HOSPITAL_ID}&department_id={DEPARTMENT_ID}"
    )
    assert list_res.status_code == 200
    tokens = list_res.json()
    assert any(t["id"] == token_id for t in tokens)


def test_department_queue_management(client: TestClient):
    # 1. Add a patient and inspect the queue view
    create_res = client.post(
        "/api/tokens",
        json={
            "hospital_id": HOSPITAL_ID,
            "department_id": DEPARTMENT_ID,
            "patient_name": "Queue Management Patient",
            "age": 41,
            "gender": "Female",
            "phone": "9123456798",
        },
    )
    assert create_res.status_code == 200

    view_res = client.get(f"/api/departments/{DEPARTMENT_ID}/queue")
    assert view_res.status_code == 200
    view = view_res.json()
    assert "department_id" in view
    assert "waiting" in view
    assert "recent" in view

    # 2. If already serving, resolve it first
    if view["now_serving"]:
        resolve_res = client.post(
            f"/api/departments/{DEPARTMENT_ID}/resolve",
            json={"status": "completed"},
        )
        assert resolve_res.status_code == 200
        assert resolve_res.json()["status"] == "completed"

    # 3. Call next patient
    call_res = client.post(f"/api/departments/{DEPARTMENT_ID}/call-next")
    assert call_res.status_code == 200
    called = call_res.json()
    assert called["status"] == "called"
    assert called["called_at"] is not None

    # 4. Try calling again while counter busy -> should reject with 400
    double_call = client.post(f"/api/departments/{DEPARTMENT_ID}/call-next")
    assert double_call.status_code == 400

    # 5. Resolve as completed
    resolve_res2 = client.post(
        f"/api/departments/{DEPARTMENT_ID}/resolve",
        json={"status": "completed"},
    )
    assert resolve_res2.status_code == 200
    assert resolve_res2.json()["status"] == "completed"


def test_counter_update(client: TestClient):
    res = client.patch(
        f"/api/departments/{DEPARTMENT_ID}/counters", json={"num_counters": 3}
    )
    assert res.status_code == 200
    assert res.json()["num_counters"] == 3

    # Check metrics reflected new counter count
    m_res = client.get(
        f"/api/hospitals/{HOSPITAL_ID}/departments/{DEPARTMENT_ID}/metrics"
    )
    assert m_res.json()["c"] == 3


def test_bed_management(client: TestClient):
    # 1. List beds
    list_res = client.get(f"/api/hospitals/{HOSPITAL_ID}/beds")
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
    assert stats["total_beds"] == 8460
    assert "occupied_pct" in stats
    assert "avg_utilization" in stats

    alerts_res = client.get("/api/admin/alerts")
    assert alerts_res.status_code == 200
    alerts = alerts_res.json()
    assert len(alerts) == 560  # 20 hospitals * 28 departments
    for a in alerts:
        assert a["severity"] in ["ok", "warning", "critical"]
        assert "message" in a


def test_hospital_auth(client: TestClient):
    # 1. Unauthenticated /me
    unauth_me = client.get("/api/auth/me")
    assert unauth_me.status_code == 200
    assert unauth_me.json()["authenticated"] is False

    # 2. Invalid credentials
    bad_res = client.post(
        "/api/auth/hospital-login",
        json={"username": "staff", "password": "wrongpassword"},
    )
    assert bad_res.status_code == 200
    assert bad_res.json()["success"] is False

    # 3. Valid credentials -> sets cookie
    good_res = client.post(
        "/api/auth/hospital-login",
        json={"username": "staff", "password": "staff123"},
    )
    assert good_res.status_code == 200
    assert good_res.json()["success"] is True
    assert "opd_hospital_session" in good_res.cookies

    # 4. Authenticated /me using session cookie
    auth_me = client.get("/api/auth/me")
    assert auth_me.status_code == 200
    assert auth_me.json()["authenticated"] is True
    assert auth_me.json()["role"] == "hospital"

    # 5. Access /hospital page when authenticated -> returns 200
    hospital_page = client.get("/hospital")
    assert hospital_page.status_code == 200

    # 6. Logout -> clears cookie
    logout_res = client.post("/api/auth/hospital-logout")
    assert logout_res.status_code == 200

    # 7. Access /hospital when unauthenticated -> redirects to /hospital/login (307)
    unauth_hospital = client.get("/hospital", follow_redirects=False)
    assert unauth_hospital.status_code == 307
    assert unauth_hospital.headers["location"] == "/hospital/login"


def test_simulation_endpoints(client: TestClient):
    tick_res = client.post("/api/simulation/tick")
    assert tick_res.status_code == 200
    assert tick_res.json()["success"] is True

    status_res = client.get("/api/simulation/status")
    assert status_res.status_code == 200
    data = status_res.json()
    assert data["hospitals"] == 20
    assert data["departments"] == 560
    assert data["beds"] == 320

    reset_res = client.post("/api/simulation/reset")
    assert reset_res.status_code == 200
    assert reset_res.json()["success"] is True
