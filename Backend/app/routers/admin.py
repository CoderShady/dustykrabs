"""Admin statistics and predictive capacity alerts."""

from __future__ import annotations

import datetime as dt
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app import crud, models, queuing, schemas
from app.config import ALERT_HORIZON_HOURS
from app.database import get_db

router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/stats", response_model=schemas.AdminStats)
def get_admin_stats(
    scope: str = Query("all", description="'all' or a specific hospital ID"),
    db: Session = Depends(get_db),
):
    """
    Hospital network overview metrics: total patients waiting, average wait time,
    bed occupancy rates, busiest department, and average server utilization (rho).
    """
    if scope == "all":
        hospitals = crud.list_hospitals(db)
    else:
        h = crud.get_hospital(db, scope)
        hospitals = [h] if h else []

    total_waiting = 0
    total_wait_minutes = 0.0
    wait_count = 0

    total_beds = 0
    occupied_beds = 0

    busiest_dept_name: str | None = None
    max_dept_queue = -1

    busiest_hosp_name: str | None = None
    max_hosp_waiting = -1

    utilizations: list[float] = []

    for hospital in hospitals:
        hosp_waiting = 0
        for dept in hospital.departments:
            q_size = crud.department_queue_size(db, dept)
            hosp_waiting += q_size
            total_waiting += q_size

            svc_min = crud.estimate_service_minutes(db, dept)
            for idx in range(q_size):
                total_wait_minutes += crud.estimate_wait_minutes_for_position(dept, idx, svc_min)
                wait_count += 1

            if q_size > max_dept_queue:
                max_dept_queue = q_size
                busiest_dept_name = f"{dept.name} ({hospital.name})"

            # Calculate utilization rho
            m = crud.department_metrics(db, dept)
            if m.rho is not None and m.rho != float("inf"):
                utilizations.append(min(1.5, m.rho))

        if hosp_waiting > max_hosp_waiting:
            max_hosp_waiting = hosp_waiting
            busiest_hosp_name = hospital.name

        recorded_beds = len(hospital.beds)
        configured_beds = hospital.total_inpatient_beds or 0
        total_beds += max(recorded_beds, configured_beds)
        for bed in hospital.beds:
            if bed.status == "occupied":
                occupied_beds += 1

    avg_wait = round(total_wait_minutes / wait_count, 1) if wait_count > 0 else 0.0
    available_beds = total_beds - occupied_beds
    occupied_pct = round((occupied_beds / total_beds) * 100.0, 1) if total_beds > 0 else 0.0
    avg_rho = round(sum(utilizations) / len(utilizations), 2) if utilizations else 0.0

    return schemas.AdminStats(
        scope=scope,
        total_waiting=total_waiting,
        avg_wait_minutes=avg_wait,
        total_beds=total_beds,
        occupied_beds=occupied_beds,
        available_beds=available_beds,
        occupied_pct=occupied_pct,
        busiest_department=busiest_dept_name,
        busiest_hospital=busiest_hosp_name,
        avg_utilization=avg_rho,
    )


@router.get("/alerts", response_model=list[schemas.AlertOut])
def get_capacity_alerts(
    hospital_id: str | None = Query(None, description="Optional hospital filter"),
    db: Session = Depends(get_db),
):
    """
    Predictive capacity alerts: models arrival rates vs service throughput
    to project exact overload thresholds ("Cardiology OPD hits capacity by 11:30 AM").
    """
    hospitals = crud.list_hospitals(db)
    if hospital_id and hospital_id != "all":
        hospitals = [h for h in hospitals if h.id == hospital_id]

    alerts: list[schemas.AlertOut] = []
    now = models.utcnow()

    for hospital in hospitals:
        for dept in hospital.departments:
            current_q = crud.department_queue_size(db, dept)
            lam = crud.estimate_lambda_per_hour(db, dept)
            svc_min = crud.estimate_service_minutes(db, dept)
            mu = 60.0 / svc_min if svc_min > 0 else 60.0

            alert = queuing.project_capacity_alert(
                department_id=dept.id,
                department_name=dept.name,
                hospital_id=hospital.id,
                hospital_name=hospital.name,
                current_queue_len=current_q,
                lambda_per_hour=lam,
                mu_per_hour=mu,
                c=dept.num_counters,
                capacity_threshold=dept.capacity_threshold,
                now=now,
                horizon_hours=ALERT_HORIZON_HOURS,
            )

            alerts.append(
                schemas.AlertOut(
                    department_id=alert.department_id,
                    department_name=alert.department_name,
                    hospital_id=alert.hospital_id,
                    hospital_name=alert.hospital_name,
                    current_queue_len=alert.current_queue_len,
                    capacity_threshold=alert.capacity_threshold,
                    net_growth_per_hour=alert.net_growth_per_hour,
                    eta_hours=alert.eta_hours,
                    predicted_at_iso=alert.predicted_at_iso,
                    message=alert.message,
                    severity=alert.severity,
                )
            )

    return alerts
