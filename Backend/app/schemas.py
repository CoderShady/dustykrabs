"""Pydantic request/response schemas."""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, ConfigDict, Field


# ---------------- Hospitals / Departments ---------------- #

class HospitalSummary(BaseModel):
    id: str
    name: str
    location: str
    department_count: int
    total_waiting: int
    avg_wait_minutes: float


class DepartmentSummary(BaseModel):
    id: str
    name: str
    prefix: str
    now_serving: str | None
    queue_size: int
    estimated_wait_minutes: float
    num_counters: int


class HospitalDetail(BaseModel):
    id: str
    name: str
    location: str
    total_waiting: int
    avg_wait_minutes: float
    departments: list[DepartmentSummary]


class QueueTrailItem(BaseModel):
    id: str
    number: str
    patient_name: str
    is_current: bool


class DepartmentMetrics(BaseModel):
    """Full M/M/c metrics -- the numbers you show judges."""
    department_id: str
    lambda_per_hour: float
    mu_per_hour: float
    c: int
    a_erlangs: float
    rho: float
    p_wait: float
    wq_minutes: float | str
    lq: float | str
    w_minutes: float | str
    l: float | str
    is_stable: bool
    recommended_c: int


# ---------------- Tokens ---------------- #

class TokenCreate(BaseModel):
    hospital_id: str
    department_id: str
    patient_name: str = Field(min_length=1)
    age: int = Field(ge=0, le=120)
    gender: str
    phone: str = Field(min_length=1)


class TokenOut(BaseModel):
    id: str
    number: str
    hospital_id: str
    department_id: str
    patient_name: str
    age: int
    gender: str
    phone: str
    status: str
    created_at: dt.datetime
    called_at: dt.datetime | None
    resolved_at: dt.datetime | None
    ahead: int | None = None
    wait_minutes: float | None = None

    model_config = ConfigDict(from_attributes=True)


class QueueMgmtView(BaseModel):
    department_id: str
    now_serving: TokenOut | None
    waiting: list[TokenOut]
    recent: list[TokenOut]


class ResolveToken(BaseModel):
    status: str = Field(description="completed, skipped, or noshow")


class CounterUpdate(BaseModel):
    num_counters: int = Field(ge=1, le=20, description="Number of counters/doctors")


# ---------------- Beds ---------------- #

class BedOut(BaseModel):
    id: str
    hospital_id: str
    number: int
    status: str
    patient_name: str

    model_config = ConfigDict(from_attributes=True)


class BedUpdate(BaseModel):
    status: str
    patient_name: str | None = None


# ---------------- Admin / Alerts ---------------- #

class AdminStats(BaseModel):
    scope: str
    total_waiting: int
    avg_wait_minutes: float
    total_beds: int
    occupied_beds: int
    available_beds: int
    occupied_pct: float
    busiest_department: str | None
    busiest_hospital: str | None
    avg_utilization: float


class AlertOut(BaseModel):
    department_id: str
    department_name: str
    hospital_id: str
    hospital_name: str
    current_queue_len: int
    capacity_threshold: int
    net_growth_per_hour: float
    eta_hours: float | None
    predicted_at_iso: str | None
    message: str
    severity: str


# ---------------- Staff auth ---------------- #

class StaffLogin(BaseModel):
    username: str
    password: str


class StaffLoginResult(BaseModel):
    success: bool
    token: str | None = None
    message: str | None = None
