"""
Database seeder for the OPD Queuing & Bed Availability System.
Seeds realistic initial hospitals, departments, beds, and recent patient tokens
so the queuing engine has valid operational history on startup.
"""

from __future__ import annotations

import datetime as dt
import random
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models

NAME_POOL = [
    "Aditi Sharma", "Rahul Verma", "Priya Nair", "Karan Mehta", "Sneha Roy",
    "Arjun Das", "Neha Gupta", "Vikram Singh", "Ananya Iyer", "Rohan Bose",
    "Ishita Chatterjee", "Manish Kumar", "Pooja Reddy", "Sameer Khan", "Divya Menon",
    "Amit Chakraborty", "Ritu Agarwal", "Suresh Pillai", "Kavita Joshi", "Farhan Ahmed",
]

HOSPITAL_DATA = [
    {
        "id": "h1",
        "name": "City General Hospital",
        "location": "Sector 5, Salt Lake, Kolkata",
        "departments": [
            {"id": "d1", "name": "General Medicine", "prefix": "A", "service_min": 6.0, "arrival_hr": 8.0, "counters": 2, "threshold": 15},
            {"id": "d2", "name": "Pediatrics", "prefix": "B", "service_min": 8.0, "arrival_hr": 6.0, "counters": 1, "threshold": 12},
            {"id": "d3", "name": "Orthopedics", "prefix": "C", "service_min": 10.0, "arrival_hr": 5.0, "counters": 1, "threshold": 10},
        ],
        "bed_count": 16,
    },
    {
        "id": "h2",
        "name": "Sunrise Community Hospital",
        "location": "Sector 2, Salt Lake, Kolkata",
        "departments": [
            {"id": "d4", "name": "General Medicine", "prefix": "A", "service_min": 5.0, "arrival_hr": 10.0, "counters": 2, "threshold": 15},
            {"id": "d5", "name": "ENT", "prefix": "B", "service_min": 9.0, "arrival_hr": 5.0, "counters": 1, "threshold": 12},
            {"id": "d6", "name": "Gynecology", "prefix": "C", "service_min": 11.0, "arrival_hr": 4.0, "counters": 1, "threshold": 10},
        ],
        "bed_count": 14,
    },
    {
        "id": "h3",
        "name": "Riverside Health Center",
        "location": "Shibpur, Howrah",
        "departments": [
            {"id": "d7", "name": "General Medicine", "prefix": "A", "service_min": 6.0, "arrival_hr": 7.0, "counters": 2, "threshold": 15},
            {"id": "d8", "name": "Dermatology", "prefix": "B", "service_min": 7.0, "arrival_hr": 6.0, "counters": 1, "threshold": 12},
            {"id": "d9", "name": "Cardiology", "prefix": "C", "service_min": 12.0, "arrival_hr": 6.0, "counters": 1, "threshold": 10},
        ],
        "bed_count": 12,
    },
]


def random_phone() -> str:
    return "9" + "".join([str(random.randint(0, 9)) for _ in range(9)])


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

    now = models.utcnow()

    for h_data in HOSPITAL_DATA:
        hospital = models.Hospital(
            id=h_data["id"],
            name=h_data["name"],
            location=h_data["location"],
        )
        db.add(hospital)

        # Seed beds
        for b_num in range(1, h_data["bed_count"] + 1):
            roll = random.random()
            if roll < 0.42:
                status = "occupied"
                patient_name = random.choice(NAME_POOL)
            elif roll < 0.58:
                status = "cleaning"
                patient_name = ""
            elif roll < 0.66:
                status = "maintenance"
                patient_name = ""
            else:
                status = "available"
                patient_name = ""

            bed = models.Bed(
                id=f"bed_{h_data['id']}_{b_num}",
                hospital_id=h_data["id"],
                number=b_num,
                status=status,
                patient_name=patient_name,
            )
            db.add(bed)

        # Seed departments
        for d_data in h_data["departments"]:
            dept = models.Department(
                id=d_data["id"],
                hospital_id=h_data["id"],
                name=d_data["name"],
                prefix=d_data["prefix"],
                token_counter=0,
                num_counters=d_data["counters"],
                default_service_minutes=d_data["service_min"],
                default_arrival_per_hour=d_data["arrival_hr"],
                capacity_threshold=d_data["threshold"],
                current_token_id=None,
                completed_count=0,
            )
            db.add(dept)
            db.flush()

            # Seed completed tokens (so live service time estimation has real samples)
            num_completed = random.randint(4, 7)
            for c_idx in range(1, num_completed + 1):
                dept.token_counter += 1
                token_num = f"{dept.prefix}-{dept.token_counter:03d}"
                service_dur = max(2.0, random.gauss(d_data["service_min"], 1.5))
                end_ago = (num_completed - c_idx) * 10 + random.randint(1, 8)
                resolved_time = now - dt.timedelta(minutes=end_ago)
                called_time = resolved_time - dt.timedelta(minutes=service_dur)
                created_time = called_time - dt.timedelta(minutes=random.randint(5, 20))

                tok = models.Token(
                    id=f"tok_{dept.id}_{c_idx}_hist",
                    number=token_num,
                    hospital_id=h_data["id"],
                    department_id=dept.id,
                    patient_name=random.choice(NAME_POOL),
                    age=random.randint(18, 75),
                    gender=random.choice(["Male", "Female", "Other"]),
                    phone=random_phone(),
                    status="completed",
                    queue_position=c_idx,
                    created_at=created_time,
                    called_at=called_time,
                    resolved_at=resolved_time,
                )
                db.add(tok)
            dept.completed_count = num_completed

            # Seed current called token
            dept.token_counter += 1
            current_num = f"{dept.prefix}-{dept.token_counter:03d}"
            cur_called_time = now - dt.timedelta(minutes=random.randint(1, 4))
            cur_tok = models.Token(
                id=f"tok_{dept.id}_curr",
                number=current_num,
                hospital_id=h_data["id"],
                department_id=dept.id,
                patient_name=random.choice(NAME_POOL),
                age=random.randint(20, 68),
                gender=random.choice(["Male", "Female", "Other"]),
                phone=random_phone(),
                status="called",
                queue_position=dept.token_counter,
                created_at=cur_called_time - dt.timedelta(minutes=10),
                called_at=cur_called_time,
                resolved_at=None,
            )
            db.add(cur_tok)
            dept.current_token_id = cur_tok.id

            # Seed waiting queue tokens
            waiting_count = random.randint(2, 4)
            for w_idx in range(1, waiting_count + 1):
                dept.token_counter += 1
                w_num = f"{dept.prefix}-{dept.token_counter:03d}"
                w_tok = models.Token(
                    id=f"tok_{dept.id}_wait_{w_idx}",
                    number=w_num,
                    hospital_id=h_data["id"],
                    department_id=dept.id,
                    patient_name=random.choice(NAME_POOL),
                    age=random.randint(12, 80),
                    gender=random.choice(["Male", "Female", "Other"]),
                    phone=random_phone(),
                    status="waiting",
                    queue_position=dept.token_counter,
                    created_at=now - dt.timedelta(minutes=(waiting_count - w_idx + 1) * 3),
                    called_at=None,
                    resolved_at=None,
                )
                db.add(w_tok)

    db.commit()
