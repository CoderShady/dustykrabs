"""
Database seeder for the OPD Queuing & Bed Availability System.
Loads deterministic initial reference dataset from data/initial_data.json
so the database has consistent, non-random baseline records on startup.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "initial_data.json"


def seed_database(db: Session, force: bool = False) -> None:
    existing_hospitals = db.scalar(select(func.count(models.Hospital.id))) or 0
    if existing_hospitals > 0 and not force:
        return

    if force:
        db.query(models.Token).delete()
        db.query(models.Bed).delete()
        db.query(models.Department).delete()
        db.query(models.Hospital).delete()
        db.commit()

    if not DATA_FILE.exists():
        return

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    now = models.utcnow()

    # 1. Seed Hospitals, Departments, and Beds
    for h_data in data.get("hospitals", []):
        hospital = models.Hospital(
            id=h_data["id"],
            name=h_data["name"],
            location=h_data["location"],
        )
        db.add(hospital)

        for b_data in h_data.get("beds", []):
            bed = models.Bed(
                id=b_data["id"],
                hospital_id=h_data["id"],
                number=b_data["number"],
                status=b_data.get("status", "available"),
                patient_name=b_data.get("patient_name", ""),
            )
            db.add(bed)

        for d_data in h_data.get("departments", []):
            dept = models.Department(
                id=d_data["id"],
                hospital_id=h_data["id"],
                name=d_data["name"],
                prefix=d_data["prefix"],
                token_counter=d_data.get("token_counter", 0),
                num_counters=d_data.get("num_counters", 1),
                default_service_minutes=d_data.get("avg_service_time", 6.0),
                default_arrival_per_hour=d_data.get("arrival_rate", 6.0),
                capacity_threshold=d_data.get("capacity_threshold", 12),
                current_token_id=None,
                completed_count=0,
            )
            db.add(dept)

    db.flush()

    # 2. Seed Baseline Tokens
    for t_data in data.get("initial_tokens", []):
        created_time = now - dt.timedelta(minutes=t_data.get("minutes_ago_created", 10))
        called_time = (
            now - dt.timedelta(minutes=t_data.get("minutes_ago_called", 2))
            if "minutes_ago_called" in t_data
            else None
        )
        resolved_time = (
            now - dt.timedelta(minutes=t_data.get("minutes_ago_resolved", 1))
            if "minutes_ago_resolved" in t_data
            else None
        )

        tok = models.Token(
            id=t_data["id"],
            number=t_data["number"],
            hospital_id=t_data["hospital_id"],
            department_id=t_data["department_id"],
            patient_name=t_data["patient_name"],
            age=t_data["age"],
            gender=t_data["gender"],
            phone=t_data["phone"],
            status=t_data["status"],
            queue_position=t_data.get("queue_position", 1),
            created_at=created_time,
            approved_at=created_time,
            called_at=called_time,
            resolved_at=resolved_time,
        )
        db.add(tok)

        # If called, assign to department current_token_id
        if t_data["status"] == "called":
            dept = db.get(models.Department, t_data["department_id"])
            if dept:
                dept.current_token_id = tok.id

    db.commit()
