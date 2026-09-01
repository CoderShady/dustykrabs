"""Hospital portal authentication endpoints with persistent session cookies."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response
from app import schemas
from app.config import HOSPITAL_PASSWORD, HOSPITAL_USERNAME

router = APIRouter(prefix="/auth", tags=["Auth"])

HOSPITAL_COOKIE_NAME = "opd_hospital_session"
HOSPITAL_SECRET_TOKEN = "opd-hospital-authenticated-session-key-v1"


@router.post("/hospital-login", response_model=schemas.HospitalLoginResult)
def hospital_login(payload: schemas.HospitalLogin, response: Response):
    """Authenticate hospital credentials and issue a persistent session cookie."""
    if payload.username == HOSPITAL_USERNAME and payload.password == HOSPITAL_PASSWORD:
        response.set_cookie(
            key=HOSPITAL_COOKIE_NAME,
            value=HOSPITAL_SECRET_TOKEN,
            max_age=30 * 24 * 3600,  # 30 days
            httponly=False,
            samesite="lax",
            path="/",
        )
        return schemas.HospitalLoginResult(
            success=True,
            token=HOSPITAL_SECRET_TOKEN,
            message="Authenticated successfully",
        )
    return schemas.HospitalLoginResult(
        success=False,
        token=None,
        message="Invalid credentials. Use staff / staff123 for demo access.",
    )


@router.post("/hospital-logout")
def hospital_logout(response: Response):
    """Log out of the hospital portal and clear the session cookie."""
    response.delete_cookie(key=HOSPITAL_COOKIE_NAME, path="/")
    return {"success": True, "message": "Logged out successfully"}


@router.get("/me")
def get_current_user(request: Request):
    """Verify session cookie."""
    cookie = request.cookies.get(HOSPITAL_COOKIE_NAME)
    if cookie == HOSPITAL_SECRET_TOKEN:
        return {"authenticated": True, "role": "hospital", "username": HOSPITAL_USERNAME}
    return {"authenticated": False, "role": None, "username": None}
