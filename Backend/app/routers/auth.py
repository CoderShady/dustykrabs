"""Staff authentication endpoints."""

from __future__ import annotations

from fastapi import APIRouter
from app import schemas
from app.config import STAFF_USERNAME, STAFF_PASSWORD

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/staff-login", response_model=schemas.StaffLoginResult)
def staff_login(payload: schemas.StaffLogin):
    """Authenticate staff credentials."""
    if payload.username == STAFF_USERNAME and payload.password == STAFF_PASSWORD:
        return schemas.StaffLoginResult(
            success=True,
            token="opd-demo-staff-bearer-token",
            message="Authenticated successfully",
        )
    return schemas.StaffLoginResult(
        success=False,
        token=None,
        message="Invalid credentials. Use staff / staff123 for demo access.",
    )
