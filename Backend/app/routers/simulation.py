"""Simulation control endpoints for live demos and stress testing."""

from __future__ import annotations

import random
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import crud, models, seed
from app.database import get_db
from app.websocket import manager

router = APIRouter(prefix="/simulation", tags=["Simulation"])


NAME_POOL = [
    "Aditi Sharma", "Rahul Verma", "Priya Nair", "Karan Mehta", "Sneha Roy",
    "Arjun Das", "Neha Gupta", "Vikram Singh", "Ananya Iyer", "Rohan Bose",
    "Ishita Chatterjee", "Manish Kumar", "Pooja Reddy", "Sameer Khan", "Divya Menon",
]

def random_phone() -> str:
    return "9" + "".join([str(random.randint(0, 9)) for _ in range(9)])


@router.post("/tick")
async def run_simulation_tick(db: Session = Depends(get_db)):
    """
    Executes a single step of the hospital patient flow simulation on the backend:
    - Randomly creates a patient check-in
    - Progresses doctor queues (calling or completing visits)
    - Updates bed turnover
    - Broadcasts live WebSocket events
    """
    hospitals = crud.list_hospitals(db)
    if not hospitals:
        return {"message": "No hospitals found. Run /simulation/reset first."}

    events_emitted = []

    # 1. Occasionally add a new patient check-in
    queue_hospitals = [hospital for hospital in hospitals if hospital.departments]
    if queue_hospitals and random.random() < 0.6:
        h = random.choice(queue_hospitals)
        dept = random.choice(h.departments)
        q_len = crud.department_queue_size(db, dept)
        if q_len < dept.capacity_threshold + 5:
            tok = crud.create_token(
                db=db,
                hospital_id=h.id,
                department_id=dept.id,
                patient_name=random.choice(NAME_POOL),
                age=random.randint(10, 75),
                gender=random.choice(["Male", "Female", "Other"]),
                phone=random_phone(),
            )
            events_emitted.append(f"Check-in: {tok.number} -> {dept.name} ({h.name})")
            await manager.broadcast(
                "queue_update",
                {
                    "hospital_id": h.id,
                    "department_id": dept.id,
                    "token_number": tok.number,
                    "queue_size": crud.department_queue_size(db, dept),
                },
            )

    # 2. Progress department queues: call next or complete current
    for h in hospitals:
        for dept in h.departments:
            roll = random.random()
            if not dept.current_token_id and roll < 0.5:
                next_tok = crud.call_next(db, dept)
                if next_tok:
                    events_emitted.append(f"Called: {next_tok.number} at {dept.name}")
                    await manager.broadcast(
                        "token_called",
                        {
                            "hospital_id": h.id,
                            "department_id": dept.id,
                            "token_id": next_tok.id,
                            "token_number": next_tok.number,
                            "patient_name": next_tok.patient_name,
                        },
                    )
            elif dept.current_token_id and roll < 0.4:
                resolved = crud.resolve_current_token(db, dept, "completed")
                if resolved:
                    events_emitted.append(f"Completed: {resolved.number} at {dept.name}")
                    await manager.broadcast(
                        "queue_update",
                        {
                            "hospital_id": h.id,
                            "department_id": dept.id,
                            "resolved_token_id": resolved.id,
                            "status": "completed",
                            "queue_size": crud.department_queue_size(db, dept),
                        },
                    )

    # 3. Randomly shift a bed status
    cycle = {
        "available": "occupied",
        "occupied": "cleaning",
        "cleaning": "available",
        "maintenance": "available",
    }
    for h in hospitals:
        for bed in h.beds:
            if random.random() < 0.05:
                next_status = cycle.get(bed.status, "available")
                patient_name = random.choice(NAME_POOL) if next_status == "occupied" else ""
                crud.update_bed(db, bed, next_status, patient_name)
                events_emitted.append(f"Bed {bed.number} ({h.name}) -> {next_status}")
                await manager.broadcast(
                    "bed_updated",
                    {
                        "id": bed.id,
                        "hospital_id": h.id,
                        "number": bed.number,
                        "status": bed.status,
                        "patient_name": bed.patient_name,
                    },
                )

    return {
        "success": True,
        "events_count": len(events_emitted),
        "events": events_emitted,
    }


@router.post("/reset")
async def reset_simulation_data(db: Session = Depends(get_db)):
    """Reset the database and re-seed with fresh hospital dataset."""
    seed.seed_database(db, force=True)
    await manager.broadcast("system_reset", {"message": "Database reset to initial state"})
    return {"success": True, "message": "Database reset and re-seeded successfully."}


@router.get("/status")
def get_simulation_status(db: Session = Depends(get_db)):
    """Summary of database records."""
    h_count = db.scalar(select(func.count(models.Hospital.id))) or 0
    d_count = db.scalar(select(func.count(models.Department.id))) or 0
    t_count = db.scalar(select(func.count(models.Token.id))) or 0
    b_count = db.scalar(select(func.count(models.Bed.id))) or 0

    return {
        "hospitals": h_count,
        "departments": d_count,
        "tokens": t_count,
        "beds": b_count,
    }
