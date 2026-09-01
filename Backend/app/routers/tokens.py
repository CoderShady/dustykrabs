"""Patient token generation, approval, and tracking endpoints."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.database import get_db
from app.websocket import manager

router = APIRouter(prefix="/tokens", tags=["Tokens"])


@router.post("/request", response_model=schemas.TokenOut)
async def request_token(payload: schemas.TokenCreate, db: Session = Depends(get_db)):
    """
    Patient submits token request.
    Created with status 'pending_approval'.
    Broadcasts real-time notification to staff receptionists.
    """
    dept = crud.get_department(db, payload.hospital_id, payload.department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found for this hospital")

    token = crud.create_token_request(
        db=db,
        hospital_id=payload.hospital_id,
        department_id=payload.department_id,
        patient_name=payload.patient_name,
        age=payload.age,
        gender=payload.gender,
        phone=payload.phone,
    )
    out = crud.token_to_out(db, token)

    # Broadcast pending request to staff receptionists
    await manager.broadcast(
        "token_requested",
        {
            "token_id": token.id,
            "hospital_id": payload.hospital_id,
            "department_id": payload.department_id,
            "department_name": dept.name,
            "patient_name": token.patient_name,
            "age": token.age,
            "gender": token.gender,
            "phone": token.phone,
            "created_at": token.created_at.isoformat(),
        },
    )

    return out


@router.get("/pending", response_model=list[schemas.TokenOut])
def get_pending_tokens(
    hospital_id: str | None = Query(None, description="Filter by hospital ID"),
    department_id: str | None = Query(None, description="Filter by department ID"),
    db: Session = Depends(get_db),
):
    """List all tokens awaiting receptionist approval."""
    tokens = crud.list_pending_tokens(db, hospital_id, department_id)
    return [crud.token_to_out(db, t) for t in tokens]


@router.get("/lookup", response_model=schemas.TokenOut)
def lookup_token(
    hospital_id: str = Query(..., min_length=1),
    department_id: str = Query(..., min_length=1),
    token_number: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    """Find a digital token using its hospital, department, and displayed number."""
    normalized_number = token_number.strip().upper()
    token = db.scalars(
        select(models.Token)
        .where(
            models.Token.hospital_id == hospital_id,
            models.Token.department_id == department_id,
            models.Token.number == normalized_number,
        )
        .order_by(models.Token.created_at.desc())
        .limit(1)
    ).first()

    if not token:
        raise HTTPException(status_code=404, detail="No token matches those details")

    return crud.token_to_out(db, token)


@router.post("/{token_id}/approve", response_model=schemas.TokenOut)
async def approve_token_request(token_id: str, db: Session = Depends(get_db)):
    """
    Receptionist approves a pending token request.
    Assigns sequential token number (e.g. A-001) and FIFO queue position.
    Broadcasts approval update so patient's screen unlocks live queue tracker.
    """
    token = crud.get_token(db, token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    if token.status not in {"pending_approval", "on_hold"}:
        raise HTTPException(
            status_code=400,
            detail=f"Token is in status '{token.status}' and cannot be approved",
        )

    approved = crud.approve_token(db, token)
    dept = crud.get_department_by_id(db, approved.department_id)
    out = crud.token_to_out(db, approved)

    # Broadcast token approval to patient and staff
    await manager.broadcast(
        "token_approved",
        {
            "token_id": approved.id,
            "number": approved.number,
            "hospital_id": approved.hospital_id,
            "department_id": approved.department_id,
            "patient_name": approved.patient_name,
            "queue_position": approved.queue_position,
            "ahead": out.ahead,
            "wait_minutes": out.wait_minutes,
        },
    )

    # Broadcast queue update to all dashboards
    if dept:
        await manager.broadcast(
            "queue_update",
            {
                "hospital_id": approved.hospital_id,
                "department_id": approved.department_id,
                "token_number": approved.number,
                "queue_size": crud.department_queue_size(db, dept),
            },
        )

    return out


@router.post("/{token_id}/hold", response_model=schemas.TokenOut)
async def hold_token_request(token_id: str, db: Session = Depends(get_db)):
    """Keep a new request out of the live queue until staff approves it."""
    token = crud.get_token(db, token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    if token.status != "pending_approval":
        raise HTTPException(
            status_code=400,
            detail=f"Token is in status '{token.status}' and cannot be held",
        )

    held = crud.hold_token(db, token)
    out = crud.token_to_out(db, held)
    await manager.broadcast(
        "token_held",
        {
            "token_id": held.id,
            "hospital_id": held.hospital_id,
            "department_id": held.department_id,
            "patient_name": held.patient_name,
        },
    )
    return out


@router.post("/{token_id}/reject", response_model=schemas.TokenOut)
async def reject_token_request(token_id: str, payload: schemas.TokenReject, db: Session = Depends(get_db)):
    """Receptionist rejects a pending token request with a reason."""
    token = crud.get_token(db, token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    if token.status != "pending_approval":
        raise HTTPException(
            status_code=400,
            detail=f"Token is in status '{token.status}' and cannot be rejected",
        )

    rejected = crud.reject_token(db, token, payload.reason)
    out = crud.token_to_out(db, rejected)

    # Broadcast rejection event to patient
    await manager.broadcast(
        "token_rejected",
        {
            "token_id": rejected.id,
            "hospital_id": rejected.hospital_id,
            "department_id": rejected.department_id,
            "reason": rejected.rejection_reason,
        },
    )

    return out


@router.post("", response_model=schemas.TokenOut)
async def direct_create_token(payload: schemas.TokenCreate, db: Session = Depends(get_db)):
    """
    Staff direct patient registration at reception (auto-approved).
    Assigns sequential token number and puts patient directly into the queue.
    """
    dept = crud.get_department(db, payload.hospital_id, payload.department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found for this hospital")

    token = crud.create_token(
        db=db,
        hospital_id=payload.hospital_id,
        department_id=payload.department_id,
        patient_name=payload.patient_name,
        age=payload.age,
        gender=payload.gender,
        phone=payload.phone,
    )
    out = crud.token_to_out(db, token)

    await manager.broadcast(
        "queue_update",
        {
            "hospital_id": payload.hospital_id,
            "department_id": payload.department_id,
            "token_number": token.number,
            "queue_size": crud.department_queue_size(db, dept),
        },
    )

    return out


@router.get("/{token_id}", response_model=schemas.TokenOut)
def get_token(token_id: str, db: Session = Depends(get_db)):
    """
    Get token details and live queue position.
    Calculates dynamic patients ahead and estimated wait minutes.
    """
    token = crud.get_token(db, token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    return crud.token_to_out(db, token)


@router.get("", response_model=list[schemas.TokenOut])
def list_tokens(
    hospital_id: str | None = Query(None, description="Filter by hospital ID"),
    department_id: str | None = Query(None, description="Filter by department ID"),
    status: str | None = Query(None, description="Filter by status (waiting, called, completed, etc.)"),
    today_only: bool = Query(False, description="Return only tokens created today in server-local time"),
    limit: int = Query(25, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """List recent tokens for reception and tracking."""
    stmt = select(models.Token).order_by(models.Token.created_at.desc())
    if hospital_id and hospital_id != "all":
        stmt = stmt.where(models.Token.hospital_id == hospital_id)
    if department_id:
        stmt = stmt.where(models.Token.department_id == department_id)
    if status:
        stmt = stmt.where(models.Token.status == status)
    if today_only:
        local_now = dt.datetime.now().astimezone()
        local_midnight = dt.datetime.combine(
            local_now.date(),
            dt.time.min,
            tzinfo=local_now.tzinfo,
        )
        next_midnight = local_midnight + dt.timedelta(days=1)
        start_utc = local_midnight.astimezone(dt.timezone.utc).replace(tzinfo=None)
        end_utc = next_midnight.astimezone(dt.timezone.utc).replace(tzinfo=None)
        stmt = stmt.where(
            models.Token.created_at >= start_utc,
            models.Token.created_at < end_utc,
        )

    tokens = list(db.scalars(stmt.limit(limit)))
    return [crud.token_to_out(db, t) for t in tokens]
