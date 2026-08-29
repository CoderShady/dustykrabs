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

from app.database import Base, SessionLocal, engine
from app.routers import admin, auth, beds, departments, hospitals, simulation, tokens
from app.routers.auth import STAFF_COOKIE_NAME, STAFF_SECRET_TOKEN
from app.seed import seed_database
from app.websocket import manager

FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "Frontend",
)
INDEX_HTML = os.path.join(FRONTEND_DIR, "index.html")
PATIENT_HTML = os.path.join(FRONTEND_DIR, "patient.html")
STAFF_HTML = os.path.join(FRONTEND_DIR, "staff.html")
STAFF_LOGIN_HTML = os.path.join(FRONTEND_DIR, "staff_login.html")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB tables and seed data if database is empty
    Base.metadata.create_all(bind=engine)
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
    allow_origins=["*"],
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


@app.get("/staff", tags=["Pages"])
def staff_dashboard_page(request: Request):
    """
    Dedicated Staff Dashboard Webpage.
    Guarded by persistent session cookie.
    If authenticated -> serves staff.html.
    If unauthenticated -> redirects to /staff/login.
    """
    cookie = request.cookies.get(STAFF_COOKIE_NAME)
    if cookie == STAFF_SECRET_TOKEN:
        return FileResponse(STAFF_HTML)
    return RedirectResponse(url="/staff/login")


@app.get("/staff/login", tags=["Pages"])
def staff_login_page(request: Request):
    """
    Dedicated Staff Login Webpage.
    If already authenticated -> redirects to /staff dashboard.
    If unauthenticated -> serves staff_login.html.
    """
    cookie = request.cookies.get(STAFF_COOKIE_NAME)
    if cookie == STAFF_SECRET_TOKEN:
        return RedirectResponse(url="/staff")
    return FileResponse(STAFF_LOGIN_HTML)


# Mount frontend directory for static assets (style.css, staff.js, patient.js)
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=False), name="frontend")
