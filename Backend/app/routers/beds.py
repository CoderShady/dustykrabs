"""Bed management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import crud, schemas
from app.database import get_db
from app.websocket import manager

router = APIRouter(tags=["Beds"])


@router.get("/hospitals/{hospital_id}/beds", response_model=list[schemas.BedOut])
def list_hospital_beds(hospital_id: str, db: Session = Depends(get_db)):
    """List all beds in a hospital ward, ordered by bed number."""
    hospital = crud.get_hospital(db, hospital_id)
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")
    beds = crud.list_beds(db, hospital_id)
    return [schemas.BedOut.model_validate(b) for b in beds]


@router.patch("/beds/{bed_id}", response_model=schemas.BedOut)
async def update_bed_status(bed_id: str, payload: schemas.BedUpdate, db: Session = Depends(get_db)):
    """Update bed occupancy, maintenance, or cleaning status."""
    valid_statuses = ["available", "occupied", "cleaning", "maintenance"]
    if payload.status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{payload.status}'. Must be one of: {', '.join(valid_statuses)}",
        )

    bed = crud.get_bed(db, bed_id)
    if not bed:
        raise HTTPException(status_code=404, detail="Bed not found")

    updated = crud.update_bed(db, bed, payload.status, payload.patient_name)
    out = schemas.BedOut.model_validate(updated)

    # Broadcast bed state change
    await manager.broadcast("bed_updated", out.model_dump())

    return out


@router.post("/beds/{bed_id}/release", response_model=schemas.BedOut)
async def release_bed_occupancy(bed_id: str, db: Session = Depends(get_db)):
    """Discharge patient and mark bed as available."""
    bed = crud.get_bed(db, bed_id)
    if not bed:
        raise HTTPException(status_code=404, detail="Bed not found")

    released = crud.release_bed(db, bed)
    out = schemas.BedOut.model_validate(released)

    # Broadcast bed state change
    await manager.broadcast("bed_updated", out.model_dump())

    return out
