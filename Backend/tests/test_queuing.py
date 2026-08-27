"""Unit tests for M/M/c queuing formulas and predictive capacity alerts."""

from __future__ import annotations

import datetime as dt
import math
import pytest

from app.queuing import compute_metrics, erlang_b, erlang_c, project_capacity_alert


def test_erlang_b_known_values():
    # B(1, a) = a / (1 + a)
    assert pytest.approx(erlang_b(1, 2.0), 0.001) == 2.0 / 3.0
    # B(0, a) should be 1.0
    assert erlang_b(0, 5.0) == 1.0


def test_erlang_c_stable_and_unstable():
    # For c=1, a=0.5 -> rho = 0.5. C(1, 0.5) = rho = 0.5
    assert pytest.approx(erlang_c(1, 0.5), 0.001) == 0.5

    # Unstable queue (rho >= 1) must return 1.0
    assert erlang_c(1, 1.0) == 1.0
    assert erlang_c(2, 2.5) == 1.0


def test_compute_metrics_stable_queue():
    # lambda = 6 patients/hr, service = 10 min (mu = 6/hr), c = 2 counters
    # Offered load a = 1.0 Erlangs, rho = 0.5
    metrics = compute_metrics(
        lambda_per_hour=6.0,
        avg_service_minutes=10.0,
        c=2,
        target_wait_minutes=15.0,
    )
    assert metrics.is_stable is True
    assert metrics.rho == 0.5
    assert metrics.a_erlangs == 1.0
    assert metrics.mu_per_hour == 6.0
    assert metrics.p_wait < 1.0
    assert math.isfinite(metrics.wq_minutes)

    # Little's Law verification: Lq = lambda * Wq (in hours)
    expected_lq = 6.0 * (metrics.wq_minutes / 60.0)
    assert pytest.approx(metrics.lq, 0.01) == expected_lq

    # Total system time: W = Wq + 1/mu
    expected_w = metrics.wq_minutes + 10.0
    assert pytest.approx(metrics.w_minutes, 0.01) == expected_w


def test_compute_metrics_overloaded_queue():
    # lambda = 20 patients/hr, service = 10 min (mu = 6/hr), c = 2 counters
    # Capacity = c*mu = 12/hr < 20/hr -> rho = 1.67 (unstable)
    metrics = compute_metrics(
        lambda_per_hour=20.0,
        avg_service_minutes=10.0,
        c=2,
        target_wait_minutes=15.0,
    )
    assert metrics.is_stable is False
    assert metrics.rho > 1.0
    # Recommended counters should scale up to stabilize the queue
    assert metrics.recommended_c >= 4


def test_project_capacity_alert_already_at_capacity():
    now = dt.datetime(2026, 8, 27, 10, 0, 0)
    alert = project_capacity_alert(
        department_id="d1",
        department_name="Cardiology",
        hospital_id="h1",
        hospital_name="City General",
        current_queue_len=16,
        lambda_per_hour=15.0,
        mu_per_hour=6.0,
        c=2,
        capacity_threshold=15,
        now=now,
    )
    assert alert.severity == "critical"
    assert alert.eta_hours == 0.0
    assert "AT capacity" in alert.message


def test_project_capacity_alert_stable_queue():
    now = dt.datetime(2026, 8, 27, 10, 0, 0)
    # lambda = 8/hr, c*mu = 2*6 = 12/hr -> net growth = -4/hr (shrinking queue)
    alert = project_capacity_alert(
        department_id="d1",
        department_name="General Medicine",
        hospital_id="h1",
        hospital_name="City General",
        current_queue_len=5,
        lambda_per_hour=8.0,
        mu_per_hour=6.0,
        c=2,
        capacity_threshold=15,
        now=now,
    )
    assert alert.severity == "ok"
    assert alert.eta_hours is None
    assert alert.net_growth_per_hour < 0


def test_project_capacity_alert_overflow_projection():
    now = dt.datetime(2026, 8, 27, 10, 0, 0)
    # current_len = 10, threshold = 15 -> 5 slots remaining
    # lambda = 16/hr, c*mu = 1*6 = 6/hr -> net growth = +10 patients/hr
    # eta = 5 / 10 = 0.5 hours (30 minutes) -> hits capacity at 10:30 AM
    alert = project_capacity_alert(
        department_id="d1",
        department_name="Pediatrics",
        hospital_id="h1",
        hospital_name="City General",
        current_queue_len=10,
        lambda_per_hour=16.0,
        mu_per_hour=6.0,
        c=1,
        capacity_threshold=15,
        now=now,
        horizon_hours=6.0,
    )
    assert alert.severity == "critical"
    assert alert.eta_hours == 0.5
    assert "hits capacity by 10:30 AM" in alert.message
