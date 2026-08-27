"""
Queuing engine: M/M/c math.

This is the part you defend to judges. No ML, no black box — closed-form
queuing theory computed live off real arrival/service data captured by
the backend.

Notation (standard Kendall notation for M/M/c):
    lambda_  : arrival rate (patients per hour)
    mu       : service rate PER SERVER (patients per hour) = 60 / avg_service_minutes
    c        : number of servers (doctors/counters) at the department
    rho      : traffic intensity / utilization = lambda / (c * mu)   (stable iff rho < 1)
    a        : offered load in Erlangs = lambda / mu
    P_wait   : Erlang-C probability an arriving patient must wait (all c servers busy)
    Wq       : expected wait time IN QUEUE (before being seen)   [Erlang-C formula]
    Lq       : expected number of patients waiting in queue       (Little's Law: Lq = lambda * Wq)
    W        : expected total time in system (wait + service)
    L        : expected number of patients in the system          (Little's Law: L = lambda * W)

All the "live" numbers (lambda, mu) are estimated from real check-in
timestamps and real service durations recorded in the SQLite DB -- see
crud.py for how they're computed and passed in here. This module is
pure math with no DB/IO dependencies, so it's easy to unit-test and to
show judges in isolation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


def erlang_b(c: int, a: float) -> float:
    """
    Erlang B formula (probability all c servers busy in a loss system),
    computed via the numerically-stable recursive form:
        B(0, a) = 1
        B(n, a) = (a * B(n-1, a)) / (n + a * B(n-1, a))
    Used as a building block for Erlang C.
    """
    b = 1.0
    for n in range(1, c + 1):
        b = (a * b) / (n + a * b)
    return b


def erlang_c(c: int, a: float) -> float:
    """
    Erlang C formula: probability an arriving customer has to wait
    (i.e. all c servers are busy on arrival), for an M/M/c queue.

        C(c, a) = B(c, a) / (1 - rho * (1 - B(c, a)))     where rho = a / c

    Returns a value in [0, 1]. If the system is unstable (rho >= 1) we
    return 1.0 (certain wait / queue grows without bound).
    """
    if c <= 0:
        return 1.0
    rho = a / c
    if rho >= 1:
        return 1.0
    b = erlang_b(c, a)
    denom = 1 - rho * (1 - b)
    if denom <= 0:
        return 1.0
    return b / denom


@dataclass
class QueueMetrics:
    lambda_per_hour: float
    mu_per_hour: float
    c: int
    a_erlangs: float            # offered load
    rho: float                  # utilization (0-1, or >=1 if overloaded)
    p_wait: float                # Erlang C: probability of waiting at all
    wq_minutes: float            # expected wait time in queue
    lq: float                    # expected number waiting in queue
    w_minutes: float             # expected total time in system
    l: float                     # expected number in system
    is_stable: bool              # rho < 1
    recommended_c: int           # smallest c hitting the target wait time


def compute_metrics(
    lambda_per_hour: float,
    avg_service_minutes: float,
    c: int,
    target_wait_minutes: float = 15.0,
    max_c_search: int = 12,
) -> QueueMetrics:
    """
    Compute the full M/M/c metric set for one department right now.
    """
    mu_per_hour = 60.0 / avg_service_minutes if avg_service_minutes > 0 else 60.0
    c = max(1, c)
    a = lambda_per_hour / mu_per_hour if mu_per_hour > 0 else 0.0
    rho = a / c if c > 0 else float("inf")
    is_stable = rho < 1

    if is_stable:
        p_wait = erlang_c(c, a)
        # Wq = C(c,a) / (c*mu - lambda)   [minutes -> convert from hours]
        denom_per_hour = c * mu_per_hour - lambda_per_hour
        wq_hours = (p_wait / denom_per_hour) if denom_per_hour > 0 else float("inf")
        wq_minutes = wq_hours * 60.0
    else:
        p_wait = 1.0
        wq_minutes = float("inf")

    lq = lambda_per_hour * (wq_minutes / 60.0) if math.isfinite(wq_minutes) else float("inf")
    w_minutes = wq_minutes + (60.0 / mu_per_hour if mu_per_hour > 0 else 0.0)
    l = lambda_per_hour * (w_minutes / 60.0) if math.isfinite(w_minutes) else float("inf")

    recommended_c = _recommend_counters(lambda_per_hour, mu_per_hour, target_wait_minutes, max_c_search)

    return QueueMetrics(
        lambda_per_hour=round(lambda_per_hour, 3),
        mu_per_hour=round(mu_per_hour, 3),
        c=c,
        a_erlangs=round(a, 3),
        rho=round(rho, 3) if math.isfinite(rho) else rho,
        p_wait=round(p_wait, 4),
        wq_minutes=round(wq_minutes, 2) if math.isfinite(wq_minutes) else wq_minutes,
        lq=round(lq, 2) if math.isfinite(lq) else lq,
        w_minutes=round(w_minutes, 2) if math.isfinite(w_minutes) else w_minutes,
        l=round(l, 2) if math.isfinite(l) else l,
        is_stable=is_stable,
        recommended_c=recommended_c,
    )


def _recommend_counters(
    lambda_per_hour: float,
    mu_per_hour: float,
    target_wait_minutes: float,
    max_c_search: int,
) -> int:
    """
    Smallest number of servers c such that:
      - the system is stable (rho < 1), AND
      - expected wait Wq <= target_wait_minutes.
    This is the "optimal staffing" number we pitch to judges.
    """
    if mu_per_hour <= 0:
        return 1
    a = lambda_per_hour / mu_per_hour
    for c in range(1, max_c_search + 1):
        if c <= a:
            continue  # unstable, would never converge
        p_wait = erlang_c(c, a)
        denom_per_hour = c * mu_per_hour - lambda_per_hour
        if denom_per_hour <= 0:
            continue
        wq_minutes = (p_wait / denom_per_hour) * 60.0
        if wq_minutes <= target_wait_minutes:
            return c
    return max_c_search


@dataclass
class CapacityAlert:
    department_id: str
    department_name: str
    hospital_id: str
    hospital_name: str
    current_queue_len: int
    capacity_threshold: int
    net_growth_per_hour: float   # lambda - c*mu (positive => queue is growing)
    eta_hours: float | None
    predicted_at_iso: str | None
    message: str
    severity: str  # "critical" | "warning" | "ok"


def project_capacity_alert(
    *,
    department_id: str,
    department_name: str,
    hospital_id: str,
    hospital_name: str,
    current_queue_len: int,
    lambda_per_hour: float,
    mu_per_hour: float,
    c: int,
    capacity_threshold: int,
    now,
    horizon_hours: float = 6.0,
) -> CapacityAlert:
    """
    Predictive alert: "Cardiology OPD hits capacity by 11 AM at current
    arrival rate."

    We model the queue as growing (or shrinking) linearly at the net
    rate (arrivals in - service capacity out) and project forward to
    when it crosses the capacity threshold. This is intentionally a
    simple, explainable linear projection on top of the M/M/c rates
    (not a second, separate model) -- easy to defend: "if arrivals keep
    coming in at today's measured rate and service keeps to today's
    measured rate, here's when we run out of room."
    """
    net_rate = lambda_per_hour - (c * mu_per_hour)  # patients/hour net queue growth

    if current_queue_len >= capacity_threshold:
        return CapacityAlert(
            department_id=department_id,
            department_name=department_name,
            hospital_id=hospital_id,
            hospital_name=hospital_name,
            current_queue_len=current_queue_len,
            capacity_threshold=capacity_threshold,
            net_growth_per_hour=round(net_rate, 2),
            eta_hours=0.0,
            predicted_at_iso=now.isoformat(),
            message=f"{department_name} OPD is AT capacity right now ({current_queue_len} waiting).",
            severity="critical",
        )

    if net_rate <= 0:
        return CapacityAlert(
            department_id=department_id,
            department_name=department_name,
            hospital_id=hospital_id,
            hospital_name=hospital_name,
            current_queue_len=current_queue_len,
            capacity_threshold=capacity_threshold,
            net_growth_per_hour=round(net_rate, 2),
            eta_hours=None,
            predicted_at_iso=None,
            message=f"{department_name} OPD queue is stable or shrinking at the current rate.",
            severity="ok",
        )

    eta_hours = (capacity_threshold - current_queue_len) / net_rate

    if eta_hours > horizon_hours:
        return CapacityAlert(
            department_id=department_id,
            department_name=department_name,
            hospital_id=hospital_id,
            hospital_name=hospital_name,
            current_queue_len=current_queue_len,
            capacity_threshold=capacity_threshold,
            net_growth_per_hour=round(net_rate, 2),
            eta_hours=round(eta_hours, 2),
            predicted_at_iso=None,
            message=f"{department_name} OPD is trending upward but won't hit capacity within the next {int(horizon_hours)}h.",
            severity="ok",
        )

    predicted_time = now + __import__("datetime").timedelta(hours=eta_hours)
    severity = "critical" if eta_hours <= 1 else "warning"
    time_str = predicted_time.strftime("%I:%M %p").lstrip("0")

    return CapacityAlert(
        department_id=department_id,
        department_name=department_name,
        hospital_id=hospital_id,
        hospital_name=hospital_name,
        current_queue_len=current_queue_len,
        capacity_threshold=capacity_threshold,
        net_growth_per_hour=round(net_rate, 2),
        eta_hours=round(eta_hours, 2),
        predicted_at_iso=predicted_time.isoformat(),
        message=f"{department_name} OPD hits capacity by {time_str} at current arrival rate.",
        severity=severity,
    )
