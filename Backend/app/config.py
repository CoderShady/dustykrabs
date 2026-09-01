"""
Central configuration for the OPD Queuing & Bed Availability backend.
Keep this file dependency-free so it can be imported from anywhere
(models, queuing engine, routers) without circular imports.
"""

import os

# --- Database ---------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # Backend/
DB_PATH = os.path.join(BASE_DIR, "opd_system.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

# --- Hospital portal auth (demo only, matches the frontend hint text) -
HOSPITAL_USERNAME = "staff"
HOSPITAL_PASSWORD = "staff123"

# --- Queuing engine defaults --------------------------------------------
# If a department has too few real observations yet, these seed the
# M/M/c estimate so numbers aren't zero/garbage on a cold start.
DEFAULT_ARRIVAL_WINDOW_MINUTES = 60      # window used to measure live lambda
MIN_SAMPLES_FOR_LIVE_SERVICE_RATE = 3    # completed tokens needed before we trust live mu
SERVICE_TIME_SAMPLE_SIZE = 20            # how many recent completions to average for mu

# Queue length beyond which a department is considered "at capacity".
# Used for overflow probability / predictive "hits capacity by HH:MM" alerts.
DEFAULT_CAPACITY_THRESHOLD = 15

# Target average wait (minutes) used when recommending an optimal counter count.
TARGET_WAIT_MINUTES = 15

# How far into the future (hours) a capacity alert is allowed to project.
ALERT_HORIZON_HOURS = 6

# Background alert-refresh cadence (seconds)
ALERT_REFRESH_INTERVAL_SECONDS = 20
