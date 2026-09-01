"""Hospital and Department reading endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.database import get_db

router = APIRouter(prefix="/hospitals", tags=["Hospitals"])


@router.get("", response_model=list[schemas.HospitalSummary])
def list_hospitals(db: Session = Depends(get_db)):
    """List all hospitals with aggregated waiting queue and wait time stats."""
    hospitals = crud.list_hospitals(db)
    results: list[schemas.HospitalSummary] = []
    for h in hospitals:
        total_waiting = 0
        wait_sum = 0.0
        for d in h.departments:
            size = crud.department_queue_size(db, d)
            total_waiting += size
            svc_min = crud.estimate_service_minutes(db, d)
            wait_sum += crud.estimate_wait_minutes_for_position(d, size, svc_min)

        configured_dept_count = h.department_count if h.department_count is not None else len(h.departments)
        live_dept_count = len(h.departments)
        avg_wait = round(wait_sum / live_dept_count, 1) if live_dept_count > 0 else 0.0
        results.append(
            schemas.HospitalSummary(
                id=h.id,
                name=h.name,
                location=h.location,
                city=h.city,
                district=h.district,
                region=h.region,
                hospital_tier=h.hospital_tier,
                emergency_24x7=h.emergency_24x7,
                total_doctors=h.total_doctors,
                total_inpatient_beds=h.total_inpatient_beds,
                total_opd_consultation_rooms=h.total_opd_consultation_rooms,
                daily_opd_token_capacity=h.daily_opd_token_capacity,
                department_count=configured_dept_count,
                total_waiting=total_waiting,
                avg_wait_minutes=avg_wait,
            )
        )
    return results


@router.get("/{hospital_id}", response_model=schemas.HospitalDetail)
def get_hospital_detail(hospital_id: str, db: Session = Depends(get_db)):
    """Get hospital details including each department's live queue status."""
    hospital = crud.get_hospital(db, hospital_id)
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")

    dept_summaries: list[schemas.DepartmentSummary] = []
    total_waiting = 0
    wait_sum = 0.0

    for d in hospital.departments:
        size = crud.department_queue_size(db, d)
        total_waiting += size
        svc_min = crud.estimate_service_minutes(db, d)
        est_wait = crud.estimate_wait_minutes_for_position(d, size, svc_min)
        wait_sum += est_wait

        now_serving_tok = crud.get_token(db, d.current_token_id) if d.current_token_id else None
        now_serving_number = now_serving_tok.number if now_serving_tok else None

        dept_summaries.append(
            schemas.DepartmentSummary(
                id=d.id,
                name=d.name,
                prefix=d.prefix,
                now_serving=now_serving_number,
                queue_size=size,
                estimated_wait_minutes=est_wait,
                num_counters=d.num_counters,
            )
        )

    dept_count = len(hospital.departments)
    avg_wait = round(wait_sum / dept_count, 1) if dept_count > 0 else 0.0

    return schemas.HospitalDetail(
        id=hospital.id,
        name=hospital.name,
        location=hospital.location,
        city=hospital.city,
        district=hospital.district,
        region=hospital.region,
        hospital_tier=hospital.hospital_tier,
        emergency_24x7=hospital.emergency_24x7,
        total_doctors=hospital.total_doctors,
        total_inpatient_beds=hospital.total_inpatient_beds,
        total_opd_consultation_rooms=hospital.total_opd_consultation_rooms,
        daily_opd_token_capacity=hospital.daily_opd_token_capacity,
        department_count=hospital.department_count if hospital.department_count is not None else dept_count,
        total_waiting=total_waiting,
        avg_wait_minutes=avg_wait,
        departments=dept_summaries,
    )


@router.get("/{hospital_id}/departments/{department_id}/metrics", response_model=schemas.DepartmentMetrics)
def get_department_metrics(hospital_id: str, department_id: str, db: Session = Depends(get_db)):
    """
    Get live M/M/c queuing theory metrics for a department.
    Computes arrival rate (lambda), service rate (mu), Erlang-C wait probability,
    and recommended counter count for optimal staffing.
    """
    dept = crud.get_department(db, hospital_id, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    m = crud.department_metrics(db, dept)
    return schemas.DepartmentMetrics(
        department_id=dept.id,
        lambda_per_hour=m.lambda_per_hour,
        mu_per_hour=m.mu_per_hour,
        c=m.c,
        a_erlangs=m.a_erlangs,
        rho=m.rho,
        p_wait=m.p_wait,
        wq_minutes=m.wq_minutes if m.is_stable else "inf",
        lq=m.lq if m.is_stable else "inf",
        w_minutes=m.w_minutes if m.is_stable else "inf",
        l=m.l if m.is_stable else "inf",
        is_stable=m.is_stable,
        recommended_c=m.recommended_c,
    )


@router.get("/{hospital_id}/departments/{department_id}/trail", response_model=list[schemas.QueueTrailItem])
def get_department_queue_trail(hospital_id: str, department_id: str, db: Session = Depends(get_db)):
    """Get the visual queue sequence (now-serving + waiting tokens in FIFO order)."""
    dept = crud.get_department(db, hospital_id, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    trail: list[schemas.QueueTrailItem] = []
    if dept.current_token_id:
        cur = crud.get_token(db, dept.current_token_id)
        if cur:
            trail.append(
                schemas.QueueTrailItem(
                    id=cur.id,
                    number=cur.number,
                    patient_name=cur.patient_name,
                    is_current=True,
                )
            )

    waiting = crud.waiting_queue(db, dept)
    for tok in waiting:
        trail.append(
            schemas.QueueTrailItem(
                id=tok.id,
                number=tok.number,
                patient_name=tok.patient_name,
                is_current=False,
            )
        )

    return trail
