"""
FastAPI application entrypoint for OPD Queuing & Bed Availability System (SIH1620).
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.database import Base, SessionLocal, engine, ensure_schema
from app.routers import admin, auth, beds, departments, hospitals, simulation, tokens
from app.routers.auth import HOSPITAL_COOKIE_NAME, HOSPITAL_SECRET_TOKEN
from app.seed import seed_database
from app.websocket import manager

FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "Frontend",
)
INDEX_HTML = os.path.join(FRONTEND_DIR, "index.html")
PATIENT_HTML = os.path.join(FRONTEND_DIR, "patient.html")
HOSPITAL_HTML = os.path.join(FRONTEND_DIR, "hospital.html")
HOSPITAL_LOGIN_HTML = os.path.join(FRONTEND_DIR, "hospital_login.html")
TOKEN_LOOKUP_HTML = os.path.join(FRONTEND_DIR, "token_lookup.html")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB tables and seed data if database is empty
    Base.metadata.create_all(bind=engine)
    ensure_schema()
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title="OPD Queuing & Bed Availability System (SIH1620)",
    description="Mathematical M/M/c queuing engine, real-time wait estimation, bed availability, and predictive capacity alerts.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware for local dev and frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# WebSocket endpoint for real-time OPD events
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# Include API Routers under /api
app.include_router(hospitals.router, prefix="/api")
app.include_router(tokens.router, prefix="/api")
app.include_router(departments.router, prefix="/api")
app.include_router(beds.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(simulation.router, prefix="/api")


@app.get("/api/health", tags=["Health"])
def health_check():
    return {
        "status": "healthy",
        "system": "OPD Queuing & Bed Availability System",
        "model": "M/M/c Queuing Engine",
    }


# ================= Standalone Webpage Endpoints ================= #

@app.get("/", tags=["Pages"])
def home_page():
    """OPD System Landing Page."""
    return FileResponse(INDEX_HTML)


@app.get("/patient", tags=["Pages"])
def patient_page():
    """Dedicated Patient Portal Webpage."""
    return FileResponse(PATIENT_HTML)


@app.get("/token", tags=["Pages"])
def token_lookup_page():
    """Patient-facing digital token lookup page."""
    return FileResponse(TOKEN_LOOKUP_HTML)


@app.get("/hospital", tags=["Pages"])
def hospital_dashboard_page(request: Request):
    """
    Dedicated Hospital Dashboard Webpage.
    Guarded by persistent session cookie.
    If authenticated -> serves hospital.html.
    If unauthenticated -> redirects to /hospital/login.
    """
    cookie = request.cookies.get(HOSPITAL_COOKIE_NAME)
    if cookie == HOSPITAL_SECRET_TOKEN:
        return FileResponse(HOSPITAL_HTML)
    return RedirectResponse(url="/hospital/login")


@app.get("/hospital/login", tags=["Pages"])
def hospital_login_page(request: Request):
    """
    Dedicated Hospital Login Webpage.
    If already authenticated -> redirects to /hospital dashboard.
    If unauthenticated -> serves hospital_login.html.
    """
    cookie = request.cookies.get(HOSPITAL_COOKIE_NAME)
    if cookie == HOSPITAL_SECRET_TOKEN:
        return RedirectResponse(url="/hospital")
    return RedirectResponse(url="/hospital_login.html")


# Mount frontend directory for static assets (style.css, hospital.js, patient.js)
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=False), name="frontend")
