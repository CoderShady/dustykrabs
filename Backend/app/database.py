from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.config import DATABASE_URL


class Base(DeclarativeBase):
    pass


engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # needed for SQLite + FastAPI's threadpool
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


HOSPITAL_COLUMN_MIGRATIONS = {
    "city": "VARCHAR",
    "district": "VARCHAR",
    "region": "VARCHAR",
    "hospital_tier": "VARCHAR",
    "emergency_24x7": "BOOLEAN",
    "total_doctors": "INTEGER",
    "total_inpatient_beds": "INTEGER",
    "total_opd_consultation_rooms": "INTEGER",
    "daily_opd_token_capacity": "INTEGER",
    "department_count": "INTEGER",
}


def ensure_schema() -> None:
    """Add newly introduced hospital metadata columns to legacy SQLite files."""
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    if "hospitals" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("hospitals")}
    missing_columns = {
        name: sql_type
        for name, sql_type in HOSPITAL_COLUMN_MIGRATIONS.items()
        if name not in existing_columns
    }
    if not missing_columns:
        return

    with engine.begin() as connection:
        for name, sql_type in missing_columns.items():
            connection.execute(text(f"ALTER TABLE hospitals ADD COLUMN {name} {sql_type}"))


def get_db():
    """FastAPI dependency: yields a DB session, closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
