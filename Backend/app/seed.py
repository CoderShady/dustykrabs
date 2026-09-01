"""
Database seeder for the OPD Queuing & Bed Availability System.
Loads deterministic initial reference dataset from data/initial_data.json
so the database has consistent, non-random baseline records on startup.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from sqlalchemy.orm import Session

from app import models

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "initial_data.json"
DEMO_HOSPITALS_FILE = Path(__file__).resolve().parent.parent / "data" / "wb_demo_hospitals.json"

RETIRED_HOSPITAL_IDS = ("h1", "h2", "h3")

HOSPITAL_METADATA_FIELDS = (
    "city",
    "district",
    "region",
    "hospital_tier",
    "emergency_24x7",
    "total_doctors",
    "total_inpatient_beds",
    "total_opd_consultation_rooms",
    "daily_opd_token_capacity",
    "department_count",
)

# The expanded West Bengal hospital catalogue contains summary metadata only.
# Materialize the same operational records used by the original three hospitals
# so every listed hospital can participate in registration, queues, metrics, and
# bed management. IDs include the hospital ID because department and bed primary
# keys are shared across the entire database.
DEPARTMENT_TEMPLATES = (
    ("General Medicine", "GM", 6.0, 8.0, 2, 15),
    ("General Surgery", "GS", 10.0, 5.0, 2, 12),
    ("Pediatrics", "PD", 8.0, 6.0, 2, 12),
    ("Obstetrics & Gynaecology", "OG", 11.0, 5.0, 2, 12),
    ("Orthopaedics", "OR", 10.0, 5.0, 2, 10),
    ("Cardiology", "CD", 12.0, 5.0, 2, 10),
    ("Neurology", "NU", 12.0, 4.0, 1, 10),
    ("Neurosurgery", "NS", 15.0, 3.0, 1, 8),
    ("ENT", "EN", 9.0, 5.0, 1, 12),
    ("Ophthalmology", "OP", 9.0, 5.0, 1, 12),
    ("Dermatology", "DR", 7.0, 6.0, 1, 12),
    ("Psychiatry", "PS", 15.0, 3.0, 1, 8),
    ("Pulmonology", "PM", 10.0, 5.0, 1, 10),
    ("Gastroenterology", "GE", 11.0, 4.0, 1, 10),
    ("Nephrology", "NE", 12.0, 4.0, 1, 10),
    ("Urology", "UR", 11.0, 4.0, 1, 10),
    ("Endocrinology", "ED", 10.0, 4.0, 1, 10),
    ("Rheumatology", "RH", 11.0, 3.0, 1, 9),
    ("Oncology", "ON", 15.0, 3.0, 1, 8),
    ("Haematology", "HM", 12.0, 3.0, 1, 9),
    ("Emergency Medicine", "EM", 6.0, 8.0, 2, 15),
    ("Dentistry", "DN", 12.0, 4.0, 1, 10),
    ("Physiotherapy & Rehabilitation", "PT", 15.0, 4.0, 1, 10),
    ("Radiology", "RD", 8.0, 6.0, 2, 12),
    ("Anaesthesiology", "AN", 12.0, 3.0, 1, 8),
    ("Infectious Diseases", "ID", 10.0, 4.0, 1, 10),
    ("Geriatric Medicine", "GR", 12.0, 4.0, 1, 10),
    ("Pain Medicine", "PN", 12.0, 3.0, 1, 9),
)

OPERATIONAL_BED_COUNT = 16
OCCUPIED_BED_NUMBERS = frozenset({2, 3, 7, 10, 14})
CLEANING_BED_NUMBERS = frozenset({5, 12})
MAINTENANCE_BED_NUMBERS = frozenset({8})


def _build_departments(hospital_data: dict) -> list[dict]:
    """Create live OPD records for a metadata-only hospital."""
    declared_count = int(hospital_data.get("department_count") or 0)
    if declared_count > len(DEPARTMENT_TEMPLATES):
        raise ValueError(
            f"{hospital_data['id']} declares {declared_count} departments, "
            f"but only {len(DEPARTMENT_TEMPLATES)} templates are configured"
        )

    hospital_id = hospital_data["id"]
    departments = []
    for index, template in enumerate(DEPARTMENT_TEMPLATES[:declared_count], start=1):
        name, prefix, service_minutes, arrival_rate, counters, threshold = template
        departments.append(
            {
                "id": f"{hospital_id}-D{index:02d}",
                "name": name,
                "prefix": prefix,
                "avg_service_time": service_minutes,
                "arrival_rate": arrival_rate,
                "num_counters": counters,
                "capacity_threshold": threshold,
                "token_counter": 0,
            }
        )
    return departments


def _build_beds(hospital_data: dict) -> list[dict]:
    """Create a manageable operational ward matching the original dashboards."""
    declared_beds = int(hospital_data.get("total_inpatient_beds") or 0)
    hospital_id = hospital_data["id"]
    beds = []

    for number in range(1, min(declared_beds, OPERATIONAL_BED_COUNT) + 1):
        if number in OCCUPIED_BED_NUMBERS:
            status = "occupied"
            patient_name = f"Demo Patient {number:02d}"
        elif number in CLEANING_BED_NUMBERS:
            status = "cleaning"
            patient_name = ""
        elif number in MAINTENANCE_BED_NUMBERS:
            status = "maintenance"
            patient_name = ""
        else:
            status = "available"
            patient_name = ""

        beds.append(
            {
                "id": f"{hospital_id}-B{number:04d}",
                "number": number,
                "status": status,
                "patient_name": patient_name,
            }
        )
    return beds


def _with_operational_records(hospital_data: dict) -> dict:
    """Preserve explicit records and fill only metadata-only hospital entries."""
    operational_data = dict(hospital_data)
    if not operational_data.get("departments"):
        operational_data["departments"] = _build_departments(operational_data)
    if not operational_data.get("beds"):
        operational_data["beds"] = _build_beds(operational_data)
    return operational_data


def _remove_retired_hospitals(db: Session) -> None:
    """Remove the three superseded starter hospitals and all related records."""
    filters = (
        (models.Token, models.Token.hospital_id),
        (models.Bed, models.Bed.hospital_id),
        (models.Department, models.Department.hospital_id),
        (models.Hospital, models.Hospital.id),
    )
    for model, hospital_id_column in filters:
        db.query(model).filter(hospital_id_column.in_(RETIRED_HOSPITAL_IDS)).delete(
            synchronize_session=False
        )


def seed_database(db: Session, force: bool = False) -> None:
    if force:
        db.query(models.Token).delete()
        db.query(models.Bed).delete()
        db.query(models.Department).delete()
        db.query(models.Hospital).delete()
        db.commit()

    _remove_retired_hospitals(db)

    if not DATA_FILE.exists():
        return

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    if DEMO_HOSPITALS_FILE.exists():
        with open(DEMO_HOSPITALS_FILE, "r", encoding="utf-8") as f:
            data["hospitals"].extend(json.load(f))

    now = models.utcnow()

    # 1. Seed Hospitals, Departments, and Beds
    for raw_hospital_data in data.get("hospitals", []):
        h_data = _with_operational_records(raw_hospital_data)
        hospital = db.get(models.Hospital, h_data["id"])
        if hospital is None:
            hospital = models.Hospital(
                id=h_data["id"],
                name=h_data["name"],
                location=h_data["location"],
                **{
                    field: h_data.get(field)
                    for field in HOSPITAL_METADATA_FIELDS
                },
            )
            db.add(hospital)
        else:
            # Keep display names aligned with the current listing data.
            hospital.name = h_data["name"]
            # Backfill metadata introduced after the original database was made,
            # without overwriting later operational edits.
            for field in HOSPITAL_METADATA_FIELDS:
                if getattr(hospital, field) is None and field in h_data:
                    setattr(hospital, field, h_data[field])

        for b_data in h_data.get("beds", []):
            if db.get(models.Bed, b_data["id"]) is not None:
                continue
            bed = models.Bed(
                id=b_data["id"],
                hospital_id=h_data["id"],
                number=b_data["number"],
                status=b_data.get("status", "available"),
                patient_name=b_data.get("patient_name", ""),
            )
            db.add(bed)

        for d_data in h_data.get("departments", []):
            if db.get(models.Department, d_data["id"]) is not None:
                continue
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
        if db.get(models.Token, t_data["id"]) is not None:
            continue
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


if __name__ == "__main__":
    from app.database import Base, SessionLocal, engine, ensure_schema

    Base.metadata.create_all(bind=engine)
    ensure_schema()
    with SessionLocal() as session:
        seed_database(session)
