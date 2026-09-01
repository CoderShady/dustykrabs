# OPD Queuing & Bed Availability System (SIH1620)

> Real-time hospital operational intelligence platform modeling patient flow using **$M/M/c$ Queuing Theory**, live wait-time forecasting, ward bed management, and predictive capacity overload alerts.

---

## 🏥 Problem Statement & Pitch

Government hospital OPDs run blind. Patients arrive with no visibility into wait times, staff receive no early warning when a department is about to get overloaded, and ward bed allocation remains reactive.

This platform replaces operational guesswork with **applied queuing theory**:
- **Mathematical rigor**: Closed-form $M/M/c$ queuing formulas (Erlang-C wait probability, Little's Law queue length, traffic intensity $\rho$, and optimal staffing recommendations).
- **Zero black-box ML needed**: Real-time arrival rates ($\lambda$) and service rates ($\mu$) are estimated directly from patient check-in events and doctor service durations.
- **Predictive early warnings**: Identifies when net queue growth ($\lambda - c\mu > 0$) will breach capacity thresholds (e.g. *"Cardiology OPD hits capacity by 11:30 AM"*).
- **Full-stack real-time pipeline**: FastAPI backend with SQLite persistence, live WebSocket feeds (`/ws`), and an interactive responsive dashboard.

---

## 📐 Mathematical Formulation ($M/M/c$ Engine)

The queuing engine implements Kendall's $M/M/c$ model:

- **Arrival Rate ($\lambda$)**: Live arrival rate (patients/hour) estimated from recent token generation events over an observation window.
- **Service Rate ($\mu$)**: Service rate per doctor/counter (patients/hour) derived from completed visit durations ($\mu = 60 / \text{avg\_service\_minutes}$).
- **Servers ($c$)**: Number of active doctors/counters in the department.
- **Offered Load ($a$)**: $a = \lambda / \mu$ (in Erlangs).
- **Traffic Intensity ($\rho$)**: $\rho = \frac{\lambda}{c \cdot \mu}$. The system is stable if and only if $\rho < 1$.
- **Erlang-C Wait Probability ($P(\text{wait})$)**:
  $$P(\text{wait}) = \frac{B(c, a)}{1 - \rho (1 - B(c, a))}$$
  where $B(c, a)$ is the Erlang-B loss formula computed via a numerically stable recursion:
  $$B(n, a) = \frac{a \cdot B(n-1, a)}{n + a \cdot B(n-1, a)}, \quad B(0, a) = 1$$
- **Expected Queue Wait ($W_q$)**:
  $$W_q = \frac{P(\text{wait})}{c\mu - \lambda} \times 60 \quad (\text{minutes})$$
- **Expected Queue Length ($L_q$)** *(Little's Law)*:
  $$L_q = \lambda \times \frac{W_q}{60}$$
- **Total Time in System ($W$)**: $W = W_q + \frac{60}{\mu}$
- **Total Patients in System ($L$)** *(Little's Law)*: $L = \lambda \times \frac{W}{60}$
- **Optimal Staffing Recommendation ($c^*$)**: Smallest counter count $c$ such that $\rho < 1$ and $W_q \le W_{\text{target}}$ (default 15 min).

### Predictive Capacity Alerts
When a department's arrival rate exceeds service throughput ($\lambda > c\mu$), the queue expands at net rate $r = \lambda - c\mu$.
The estimated time until the queue hits capacity threshold $K$ is:
$$\text{ETA} = \frac{K - L_{\text{current}}}{\lambda - c\mu} \quad (\text{hours})$$
Generating actionable staff alerts: *"Cardiology OPD hits capacity by 11:30 AM at current arrival rate"*.

---

## 🚀 Quick Start

### 1. Install Dependencies
Ensure Python 3.10+ is installed, then install backend packages:
```powershell
pip install -r Backend/requirements.txt
```

### 2. Run the Application
Start the FastAPI server from the `Backend/` directory:
```powershell
cd Backend
python -m uvicorn app.main:app --port 8000 --reload
```

### 3. Open in Browser
- **Hospital Dashboard & Patient Portal**: [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
- **Interactive Swagger API Docs**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Alternative ReDoc**: [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)

Hospital Login Credentials (Demo):
- **Username**: `staff`
- **Password**: `staff123`

---

## 🧪 Running Automated Tests

Run the complete test suite (unit tests for queuing math & integration tests for all REST endpoints):
```powershell
cd Backend
python -m pytest tests/ -v
```

---

## 📡 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status & engine indicator |
| `GET` | `/api/hospitals` | List hospitals with waiting counts & avg wait times |
| `GET` | `/api/hospitals/{hospital_id}` | Detailed hospital view with department queues |
| `GET` | `/api/hospitals/{h_id}/departments/{d_id}/metrics` | **Live $M/M/c$ Queuing Theory metrics** |
| `GET` | `/api/hospitals/{h_id}/departments/{d_id}/trail` | FIFO Queue sequence trail for visual board |
| `POST` | `/api/tokens` | Patient check-in (generates token & queue position) |
| `GET` | `/api/tokens/{token_id}` | Live token tracking (ahead count & estimated wait) |
| `GET` | `/api/tokens` | List recent tokens (filter by hospital, department, status) |
| `GET` | `/api/departments/{dept_id}/queue` | Staff queue management view (serving, waiting, recent) |
| `POST` | `/api/departments/{dept_id}/call-next` | Call next patient & trigger approaching turn notification |
| `POST` | `/api/departments/{dept_id}/resolve` | Mark patient visit as `completed`, `skipped`, or `noshow` |
| `PATCH` | `/api/departments/{dept_id}/counters` | Adjust server count $c$ to demonstrate staffing optimization |
| `GET` | `/api/hospitals/{hospital_id}/beds` | List ward beds with occupancy status & patient names |
| `PATCH` | `/api/beds/{bed_id}` | Update bed status (`available`, `occupied`, `cleaning`, `maintenance`) |
| `POST` | `/api/beds/{bed_id}/release` | Discharge patient and release bed to available |
| `GET` | `/api/admin/stats` | Network-wide operational statistics & bed occupancy |
| `GET` | `/api/admin/alerts` | **Predictive capacity alerts with ETA overflow projection** |
| `POST` | `/api/auth/hospital-login` | Hospital portal authentication |
| `POST` | `/api/simulation/tick` | Trigger a live patient flow step (check-in/service/bed) |
| `POST` | `/api/simulation/reset` | Re-seed database with clean hospital dataset |

---

## ⚡ WebSocket Protocol (`/ws`)

Connect to `ws://127.0.0.1:8000/ws` for real-time notifications:

- `queue_update`: Broadcast when a patient checks in or a visit resolves.
- `token_called`: Broadcast when a doctor calls the next token to a counter.
- `patient_alert`: SMS/push notification triggered when a patient's turn is approaching (`ahead <= 1`).
- `bed_updated`: Broadcast when a bed status changes in any ward.
- `staffing_updated`: Broadcast when active doctor counters are reconfigured.
