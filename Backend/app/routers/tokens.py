"""Patient token generation and tracking endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.database import get_db
from app.websocket import manager

router = APIRouter(prefix="/tokens", tags=["Tokens"])


@router.post("", response_model=schemas.TokenOut)
async def create_token(payload: schemas.TokenCreate, db: Session = Depends(get_db)):
    """
    Patient check-in / token generation.
    Assigns sequential token number (e.g. A-001) and FIFO queue position.
    Broadcasts real-time queue update over WebSockets.
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

    # Broadcast queue update
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
    limit: int = Query(25, ge=1, le=100),
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

    tokens = list(db.scalars(stmt.limit(limit)))
    return [crud.token_to_out(db, t) for t in tokens]
