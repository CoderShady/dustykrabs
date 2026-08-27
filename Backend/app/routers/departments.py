"""Department queue management and counter actions."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.database import get_db
from app.websocket import manager

router = APIRouter(prefix="/departments", tags=["Departments"])


@router.get("/{department_id}/queue", response_model=schemas.QueueMgmtView)
def get_queue_view(department_id: str, db: Session = Depends(get_db)):
    """
    Get staff queue management view.
    Returns the currently served patient, waiting queue, and recent completed/skipped visits.
    """
    dept = crud.get_department_by_id(db, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    now_serving = None
    if dept.current_token_id:
        tok = crud.get_token(db, dept.current_token_id)
        if tok:
            now_serving = crud.token_to_out(db, tok)

    waiting_tokens = crud.waiting_queue(db, dept)
    waiting_outs = [crud.token_to_out(db, t) for t in waiting_tokens]

    recent_tokens = crud.recent_resolved(db, dept, limit=5)
    recent_outs = [crud.token_to_out(db, t) for t in recent_tokens]

    return schemas.QueueMgmtView(
        department_id=dept.id,
        now_serving=now_serving,
        waiting=waiting_outs,
        recent=recent_outs,
    )


@router.post("/{department_id}/call-next", response_model=schemas.TokenOut)
async def call_next_patient(department_id: str, db: Session = Depends(get_db)):
    """
    Call the next patient in line.
    Transitions token from 'waiting' -> 'called', records timestamp for service duration tracking,
    and alerts the subsequent patient if their turn is close (stretch SMS/alert feature).
    """
    dept = crud.get_department_by_id(db, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    if dept.current_token_id:
        raise HTTPException(status_code=400, detail="A patient is already currently being served at this counter")

    next_tok = crud.call_next(db, dept)
    if not next_tok:
        raise HTTPException(status_code=400, detail="No patients waiting in queue")

    out = crud.token_to_out(db, next_tok)

    # Check next waiting patient for SMS/alert notification (approaching turn)
    remaining_waiting = crud.waiting_queue(db, dept)
    approaching_notification = None
    if remaining_waiting:
        up_next = remaining_waiting[0]
        approaching_notification = {
            "token_id": up_next.id,
            "token_number": up_next.number,
            "phone": up_next.phone,
            "patient_name": up_next.patient_name,
            "message": f"Your token {up_next.number} is next in line for {dept.name}. Please proceed to the waiting area.",
        }
        await manager.broadcast("patient_alert", approaching_notification)

    # Broadcast token call event
    await manager.broadcast(
        "token_called",
        {
            "hospital_id": dept.hospital_id,
            "department_id": dept.id,
            "token_id": next_tok.id,
            "token_number": next_tok.number,
            "patient_name": next_tok.patient_name,
            "called_at": next_tok.called_at.isoformat() if next_tok.called_at else None,
            "approaching_alert": approaching_notification,
        },
    )

    return out


@router.post("/{department_id}/resolve", response_model=schemas.TokenOut)
async def resolve_patient(department_id: str, payload: schemas.ResolveToken, db: Session = Depends(get_db)):
    """
    Resolve currently served patient (completed, skipped, or noshow).
    Records resolved_at timestamp to dynamically update the live service rate (mu).
    """
    valid_statuses = ["completed", "skipped", "noshow"]
    if payload.status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{payload.status}'. Must be one of: {', '.join(valid_statuses)}",
        )

    dept = crud.get_department_by_id(db, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    if not dept.current_token_id:
        raise HTTPException(status_code=400, detail="No active patient currently being served")

    resolved_tok = crud.resolve_current_token(db, dept, payload.status)
    if not resolved_tok:
        raise HTTPException(status_code=404, detail="Current token could not be resolved")

    out = crud.token_to_out(db, resolved_tok)

    # Broadcast queue update
    await manager.broadcast(
        "queue_update",
        {
            "hospital_id": dept.hospital_id,
            "department_id": dept.id,
            "resolved_token_id": resolved_tok.id,
            "status": resolved_tok.status,
            "queue_size": crud.department_queue_size(db, dept),
        },
    )

    return out


@router.patch("/{department_id}/counters")
async def update_counters(department_id: str, payload: schemas.CounterUpdate, db: Session = Depends(get_db)):
    """
    Adjust active doctor/counter count (c) for M/M/c simulation and optimal staffing demonstrations.
    """
    dept = crud.get_department_by_id(db, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    dept.num_counters = payload.num_counters
    db.commit()
    db.refresh(dept)

    # Broadcast staffing change
    await manager.broadcast(
        "staffing_updated",
        {
            "hospital_id": dept.hospital_id,
            "department_id": dept.id,
            "num_counters": dept.num_counters,
        },
    )

    return {
        "department_id": dept.id,
        "num_counters": dept.num_counters,
        "message": f"Updated active counters to {dept.num_counters}",
    }
