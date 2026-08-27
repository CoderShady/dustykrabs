"""
SQLAlchemy ORM models.

Field names mirror the frontend's in-memory JS objects (HOSPITALS,
TOKENS, beds, departments in script.js) as closely as possible, so the
JSON shapes coming out of the API map cleanly onto what the UI already
expects to render.
"""

import datetime as dt

from sqlalchemy import String, Integer, Float, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


class Hospital(Base):
    __tablename__ = "hospitals"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    location: Mapped[str] = mapped_column(String, nullable=False)

    departments: Mapped[list["Department"]] = relationship(
        back_populates="hospital", cascade="all, delete-orphan"
    )
    beds: Mapped[list["Bed"]] = relationship(
        back_populates="hospital", cascade="all, delete-orphan"
    )


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    hospital_id: Mapped[str] = mapped_column(ForeignKey("hospitals.id"))
    name: Mapped[str] = mapped_column(String, nullable=False)
    prefix: Mapped[str] = mapped_column(String, nullable=False)

    # Token numbering counter, e.g. prefix + counter -> "A-001"
    token_counter: Mapped[int] = mapped_column(Integer, default=0)

    # Queuing model parameters
    num_counters: Mapped[int] = mapped_column(Integer, default=1)  # c (servers)
    default_service_minutes: Mapped[float] = mapped_column(Float, default=8.0)  # 1/mu seed
    default_arrival_per_hour: Mapped[float] = mapped_column(Float, default=6.0)  # lambda seed
    capacity_threshold: Mapped[int] = mapped_column(Integer, default=15)

    # Currently-being-served token (nullable FK-ish, stored as string id)
    current_token_id: Mapped[str | None] = mapped_column(String, nullable=True)
    completed_count: Mapped[int] = mapped_column(Integer, default=0)

    hospital: Mapped["Hospital"] = relationship(back_populates="departments")
    tokens: Mapped[list["Token"]] = relationship(
        back_populates="department", cascade="all, delete-orphan"
    )


class Token(Base):
    __tablename__ = "tokens"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    number: Mapped[str] = mapped_column(String, nullable=False)  # e.g. "A-001"
    hospital_id: Mapped[str] = mapped_column(ForeignKey("hospitals.id"))
    department_id: Mapped[str] = mapped_column(ForeignKey("departments.id"))

    patient_name: Mapped[str] = mapped_column(String, nullable=False)
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    gender: Mapped[str] = mapped_column(String, nullable=False)
    phone: Mapped[str] = mapped_column(String, nullable=False)

    # waiting -> called -> completed | skipped | noshow
    status: Mapped[str] = mapped_column(String, default="waiting")
    queue_position: Mapped[int] = mapped_column(Integer, default=0)  # explicit FIFO order

    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    called_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)

    department: Mapped["Department"] = relationship(back_populates="tokens")


class Bed(Base):
    __tablename__ = "beds"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    hospital_id: Mapped[str] = mapped_column(ForeignKey("hospitals.id"))
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, default="available")  # available|occupied|cleaning|maintenance
    patient_name: Mapped[str] = mapped_column(String, default="")

    hospital: Mapped["Hospital"] = relationship(back_populates="beds")
