"""Staff authentication endpoints with persistent session cookies."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response
from app import schemas
from app.config import STAFF_USERNAME, STAFF_PASSWORD

router = APIRouter(prefix="/auth", tags=["Auth"])

STAFF_COOKIE_NAME = "opd_staff_session"
STAFF_SECRET_TOKEN = "opd-staff-authenticated-session-key-v1"


@router.post("/staff-login", response_model=schemas.StaffLoginResult)
def staff_login(payload: schemas.StaffLogin, response: Response):
    """Authenticate staff credentials and issue a persistent session cookie."""
    if payload.username == STAFF_USERNAME and payload.password == STAFF_PASSWORD:
        response.set_cookie(
            key=STAFF_COOKIE_NAME,
            value=STAFF_SECRET_TOKEN,
            max_age=30 * 24 * 3600,  # 30 days
            httponly=False,
            samesite="lax",
            path="/",
        )
        return schemas.StaffLoginResult(
            success=True,
            token=STAFF_SECRET_TOKEN,
            message="Authenticated successfully",
        )
    return schemas.StaffLoginResult(
        success=False,
        token=None,
        message="Invalid credentials. Use staff / staff123 for demo access.",
    )


@router.post("/staff-logout")
def staff_logout(response: Response):
    """Log out staff and clear session cookie."""
    response.delete_cookie(key=STAFF_COOKIE_NAME, path="/")
    return {"success": True, "message": "Logged out successfully"}


@router.get("/me")
def get_current_user(request: Request):
    """Verify session cookie."""
    cookie = request.cookies.get(STAFF_COOKIE_NAME)
    if cookie == STAFF_SECRET_TOKEN:
        return {"authenticated": True, "role": "staff", "username": STAFF_USERNAME}
    return {"authenticated": False, "role": None, "username": None}
