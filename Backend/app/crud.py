"""
CRUD + derived-metric helpers.

This is the seam between raw DB rows and the queuing engine: functions
here turn "recent tokens in this department" into live estimates of
lambda (arrival rate) and mu (service rate), then hand them to
queuing.compute_metrics().
"""

from __future__ import annotations

import datetime as dt
import itertools

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models, queuing, schemas
from app.config import (
    DEFAULT_ARRIVAL_WINDOW_MINUTES,
    MIN_SAMPLES_FOR_LIVE_SERVICE_RATE,
    SERVICE_TIME_SAMPLE_SIZE,
    TARGET_WAIT_MINUTES,
)

_uid_counter = itertools.count(1)


def new_id(prefix: str) -> str:
    return f"{prefix}_{next(_uid_counter)}_{int(models.utcnow().timestamp() * 1000)}"


# ------------------------------------------------------------------ #
# Hospitals / Departments / Beds - simple reads
# ------------------------------------------------------------------ #

def get_hospital(db: Session, hospital_id: str) -> models.Hospital | None:
    return db.get(models.Hospital, hospital_id)


def list_hospitals(db: Session) -> list[models.Hospital]:
    return list(db.scalars(select(models.Hospital)))


def get_department(db: Session, hospital_id: str, department_id: str) -> models.Department | None:
    dept = db.get(models.Department, department_id)
    if dept and dept.hospital_id == hospital_id:
        return dept
    return None


def get_department_by_id(db: Session, department_id: str) -> models.Department | None:
    return db.get(models.Department, department_id)


def get_token(db: Session, token_id: str) -> models.Token | None:
    return db.get(models.Token, token_id)


def get_bed(db: Session, bed_id: str) -> models.Bed | None:
    return db.get(models.Bed, bed_id)


# ------------------------------------------------------------------ #
# Live rate estimation
# ------------------------------------------------------------------ #

def estimate_lambda_per_hour(db: Session, dept: models.Department, window_minutes: int = DEFAULT_ARRIVAL_WINDOW_MINUTES) -> float:
    """
    Live arrival rate estimate: count tokens created in the last
    `window_minutes` for this department, extrapolated to a per-hour
    rate. Blends toward the department's configured default when the
    sample is thin (cold start / quiet period) so numbers don't swing
    wildly on 1-2 data points.
    """
    since = models.utcnow() - dt.timedelta(minutes=window_minutes)
    count = db.scalar(
        select(func.count(models.Token.id)).where(
            models.Token.department_id == dept.id,
            models.Token.created_at >= since,
        )
    ) or 0

    observed_per_hour = count * (60.0 / window_minutes)

    if count < 3:
        # Not enough recent signal yet -> blend with the seeded default
        weight = count / 3.0  # 0 .. ~1
        return round(observed_per_hour * weight + dept.default_arrival_per_hour * (1 - weight), 3)

    return round(observed_per_hour, 3)


def estimate_service_minutes(db: Session, dept: models.Department, sample_size: int = SERVICE_TIME_SAMPLE_SIZE) -> float:
    """
    Live average service time: average (resolved_at - called_at) over
    the most recent completed tokens for this department. Falls back
    to the department's seeded default until enough real completions
    have accumulated.
    """
    rows = db.scalars(
        select(models.Token)
        .where(
            models.Token.department_id == dept.id,
            models.Token.status == "completed",
            models.Token.called_at.is_not(None),
            models.Token.resolved_at.is_not(None),
        )
        .order_by(models.Token.resolved_at.desc())
        .limit(sample_size)
    ).all()

    if len(rows) < MIN_SAMPLES_FOR_LIVE_SERVICE_RATE:
        return dept.default_service_minutes

    durations = [
        (t.resolved_at - t.called_at).total_seconds() / 60.0
        for t in rows
        if t.resolved_at and t.called_at
    ]
    durations = [d for d in durations if d > 0]
    if not durations:
        return dept.default_service_minutes

    avg = sum(durations) / len(durations)
    # Sanity clamp so one weird outlier can't wreck the estimate for the demo
    return max(1.0, min(avg, 120.0))


def department_queue_size(db: Session, dept: models.Department) -> int:
    waiting = db.scalar(
        select(func.count(models.Token.id)).where(
            models.Token.department_id == dept.id,
            models.Token.status == "waiting",
        )
    ) or 0
    return waiting + (1 if dept.current_token_id else 0)


def department_metrics(db: Session, dept: models.Department) -> queuing.QueueMetrics:
    lam = estimate_lambda_per_hour(db, dept)
    svc_minutes = estimate_service_minutes(db, dept)
    return queuing.compute_metrics(
        lambda_per_hour=lam,
        avg_service_minutes=svc_minutes,
        c=dept.num_counters,
        target_wait_minutes=TARGET_WAIT_MINUTES,
    )


def estimate_wait_minutes_for_position(dept: models.Department, ahead_count: int, avg_service_minutes: float) -> float:
    """
    Per-patient wait estimate shown on tokens/tracker: simple and
    intuitive (ahead-in-line * average service time / number of
    counters), matching what the frontend already shows, but now fed
    by the *live* measured service time instead of a hardcoded number.
    """
    if ahead_count <= 0:
        return 2.0
    c = max(1, dept.num_counters)
    return round((ahead_count / c) * avg_service_minutes, 1)


# ------------------------------------------------------------------ #
# Token lifecycle
# ------------------------------------------------------------------ #

def create_token_request(
    db: Session,
    hospital_id: str,
    department_id: str,
    patient_name: str,
    age: int,
    gender: str,
    phone: str,
) -> models.Token:
    dept = get_department(db, hospital_id, department_id)
    if dept is None:
        raise ValueError("Department not found for this hospital")

    token = models.Token(
        id=new_id("req"),
        number="PENDING",
        hospital_id=hospital_id,
        department_id=department_id,
        patient_name=patient_name,
        age=age,
        gender=gender,
        phone=phone,
        status="pending_approval",
        queue_position=0,
        created_at=models.utcnow(),
    )
    db.add(token)
    db.commit()
    db.refresh(token)
    return token


def approve_token(db: Session, token: models.Token) -> models.Token:
    dept = get_department_by_id(db, token.department_id)
    if dept is None:
        raise ValueError("Department not found")

    if token.status != "pending_approval":
        raise ValueError(f"Token cannot be approved from status '{token.status}'")

    dept.token_counter += 1
    token.number = f"{dept.prefix}-{dept.token_counter:03d}"

    max_pos = db.scalar(
        select(func.max(models.Token.queue_position)).where(
            models.Token.department_id == token.department_id,
            models.Token.status.in_(["waiting", "called"]),
        )
    ) or 0

    token.status = "waiting"
    token.queue_position = max_pos + 1
    token.approved_at = models.utcnow()
    db.commit()
    db.refresh(token)
    return token


def reject_token(db: Session, token: models.Token, reason: str) -> models.Token:
    if token.status != "pending_approval":
        raise ValueError(f"Token cannot be rejected from status '{token.status}'")

    token.status = "rejected"
    token.rejection_reason = reason
    token.resolved_at = models.utcnow()
    db.commit()
    db.refresh(token)
    return token


def list_pending_tokens(db: Session, hospital_id: str | None = None, department_id: str | None = None) -> list[models.Token]:
    stmt = select(models.Token).where(models.Token.status == "pending_approval").order_by(models.Token.created_at.asc())
    if hospital_id and hospital_id != "all":
        stmt = stmt.where(models.Token.hospital_id == hospital_id)
    if department_id:
        stmt = stmt.where(models.Token.department_id == department_id)
    return list(db.scalars(stmt))


def create_token(
    db: Session,
    hospital_id: str,
    department_id: str,
    patient_name: str,
    age: int,
    gender: str,
    phone: str,
) -> models.Token:
    dept = get_department(db, hospital_id, department_id)
    if dept is None:
        raise ValueError("Department not found for this hospital")

    dept.token_counter += 1
    number = f"{dept.prefix}-{dept.token_counter:03d}"

    max_pos = db.scalar(
        select(func.max(models.Token.queue_position)).where(
            models.Token.department_id == department_id,
            models.Token.status.in_(["waiting", "called"]),
        )
    ) or 0

    token = models.Token(
        id=new_id("tok"),
        number=number,
        hospital_id=hospital_id,
        department_id=department_id,
        patient_name=patient_name,
        age=age,
        gender=gender,
        phone=phone,
        status="waiting",
        queue_position=max_pos + 1,
        created_at=models.utcnow(),
        approved_at=models.utcnow(),
    )
    db.add(token)
    db.commit()
    db.refresh(token)
    return token


def token_position_info(db: Session, token: models.Token) -> dict:
    """Ahead-count + estimated wait for a single token (patient portal / tracker view)."""
    dept = get_department_by_id(db, token.department_id)
    if dept is None:
        return {"ahead": None, "wait_minutes": None}

    if token.status == "called":
        return {"ahead": 0, "wait_minutes": 0}
    if token.status != "waiting":
        return {"ahead": None, "wait_minutes": None}

    ahead = db.scalar(
        select(func.count(models.Token.id)).where(
            models.Token.department_id == dept.id,
            models.Token.status == "waiting",
            models.Token.queue_position < token.queue_position,
        )
    ) or 0
    if dept.current_token_id:
        ahead += 1

    svc_minutes = estimate_service_minutes(db, dept)
    wait = estimate_wait_minutes_for_position(dept, ahead, svc_minutes)
    return {"ahead": ahead, "wait_minutes": wait}


def token_to_out(db: Session, token: models.Token) -> schemas.TokenOut:
    pos = token_position_info(db, token)
    return schemas.TokenOut(
        id=token.id,
        number=token.number,
        hospital_id=token.hospital_id,
        department_id=token.department_id,
        patient_name=token.patient_name,
        age=token.age,
        gender=token.gender,
        phone=token.phone,
        status=token.status,
        created_at=token.created_at,
        approved_at=token.approved_at,
        called_at=token.called_at,
        resolved_at=token.resolved_at,
        rejection_reason=token.rejection_reason,
        ahead=pos["ahead"],
        wait_minutes=pos["wait_minutes"],
    )


def call_next(db: Session, dept: models.Department) -> models.Token | None:
    if dept.current_token_id:
        return None  # someone's already being served
    next_token = db.scalars(
        select(models.Token)
        .where(models.Token.department_id == dept.id, models.Token.status == "waiting")
        .order_by(models.Token.queue_position.asc())
        .limit(1)
    ).first()
    if next_token is None:
        return None

    next_token.status = "called"
    next_token.called_at = models.utcnow()
    dept.current_token_id = next_token.id
    db.commit()
    db.refresh(next_token)
    return next_token


def resolve_current_token(db: Session, dept: models.Department, new_status: str) -> models.Token | None:
    if not dept.current_token_id:
        return None
    token = get_token(db, dept.current_token_id)
    if token is None:
        dept.current_token_id = None
        db.commit()
        return None

    token.status = new_status
    token.resolved_at = models.utcnow()
    if new_status == "completed":
        dept.completed_count = (dept.completed_count or 0) + 1
    dept.current_token_id = None
    db.commit()
    db.refresh(token)
    return token


def waiting_queue(db: Session, dept: models.Department) -> list[models.Token]:
    return list(
        db.scalars(
            select(models.Token)
            .where(models.Token.department_id == dept.id, models.Token.status == "waiting")
            .order_by(models.Token.queue_position.asc())
        )
    )


def recent_resolved(db: Session, dept: models.Department, limit: int = 5) -> list[models.Token]:
    return list(
        db.scalars(
            select(models.Token)
            .where(
                models.Token.department_id == dept.id,
                models.Token.status.in_(["completed", "skipped", "noshow"]),
            )
            .order_by(models.Token.resolved_at.desc())
            .limit(limit)
        )
    )


def todays_tokens(db: Session, hospital_id: str | None = None, limit: int = 25) -> list[models.Token]:
    stmt = select(models.Token).order_by(models.Token.created_at.desc()).limit(limit)
    if hospital_id and hospital_id != "all":
        stmt = stmt.where(models.Token.hospital_id == hospital_id)
    return list(db.scalars(stmt))


# ------------------------------------------------------------------ #
# Beds
# ------------------------------------------------------------------ #

def list_beds(db: Session, hospital_id: str) -> list[models.Bed]:
    return list(
        db.scalars(
            select(models.Bed).where(models.Bed.hospital_id == hospital_id).order_by(models.Bed.number.asc())
        )
    )


def update_bed(db: Session, bed: models.Bed, status: str, patient_name: str | None) -> models.Bed:
    bed.status = status
    bed.patient_name = (patient_name or "Unnamed patient") if status == "occupied" else ""
    db.commit()
    db.refresh(bed)
    return bed


def release_bed(db: Session, bed: models.Bed) -> models.Bed:
    bed.status = "available"
    bed.patient_name = ""
    db.commit()
    db.refresh(bed)
    return bed
