/**
 * Patient Portal Script (SIH1620)
 * Handles Hospital Selection, Digital Check-in Requests, Real-Time Token Tracking,
 * and Live WebSocket Alerts.
 */

'use strict';

const API_BASE = '/api';

const state = {
  hospitals: [],
  selectedHospital: null,
  selectedDepartmentId: null,
  myTokenId: localStorage.getItem('opd_patient_token') || null,
  myToken: null,
};

let socket = null;

/* ================= UTILS & TOASTS ================= */

function showToast(message, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type || 'info'}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.remove(); }, 3500);
}

function showLoadingOverlay(msg) {
  const overlay = document.getElementById('loading-overlay');
  const txt = document.getElementById('loading-text');
  if (txt) txt.textContent = msg || 'Loading…';
  if (overlay) overlay.classList.remove('hidden');
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ================= VIEW SWITCHER ================= */

window.showPatientView = function(viewName) {
  const views = {
    'hospitals': document.getElementById('p-view-hospitals'),
    'hospital-detail': document.getElementById('p-view-hospital-detail'),
    'token-form': document.getElementById('p-view-token-form'),
    'tracker': document.getElementById('p-view-tracker'),
  };

  Object.values(views).forEach(v => {
    if (v) {
      v.classList.remove('active');
      v.classList.add('hidden');
    }
  });

  const target = views[viewName];
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (viewName === 'hospitals') renderHospitals();
  if (viewName === 'tracker' && state.myTokenId) fetchAndRenderToken(state.myTokenId);
};

/* ================= WEBSOCKET ================= */

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      console.log('Patient WebSocket connected.');
    };
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsEvent(msg);
      } catch (e) {}
    };
    socket.onclose = () => {
      setTimeout(initWebSocket, 3000);
    };
  } catch (e) {
    console.warn('Patient WebSocket init failed:', e);
  }
}

function handleWsEvent(msg) {
  const event = msg.event;
  const data = msg.data || {};

  if (event === 'token_approved' && state.myTokenId && data.token_id === state.myTokenId) {
    showToast(`Your token request has been approved! Assigned Number: ${data.number}`, 'success');
    fetchAndRenderToken(state.myTokenId);
  } else if (event === 'token_called' && state.myTokenId && data.token_id === state.myTokenId) {
    showToast(`🔔 It is your turn! Token ${data.token_number} is called at counter.`, 'success');
    fetchAndRenderToken(state.myTokenId);
  } else if (event === 'patient_alert' && state.myTokenId && data.token_id === state.myTokenId) {
    showToast(`⚠️ Get ready! You are next in line.`, 'warning');
    fetchAndRenderToken(state.myTokenId);
  } else if (event === 'queue_update') {
    if (state.myTokenId) fetchAndRenderToken(state.myTokenId);
    if (state.selectedHospital) renderHospitalDetail(state.selectedHospital.id);
  }
}

/* ================= HOSPITALS & DEPARTMENTS ================= */

async function fetchHospitals() {
  try {
    const res = await fetch(`${API_BASE}/hospitals`);
    if (res.ok) {
      state.hospitals = await res.json();
      renderHospitals();
    }
  } catch (err) {
    console.error('Fetch hospitals error:', err);
  }
}

function renderHospitals() {
  const list = document.getElementById('p-hospital-list');
  if (!list) return;

  list.innerHTML = state.hospitals.map(h => {
    const totalQueue = h.departments ? h.departments.reduce((sum, d) => sum + (d.queue_size || 0), 0) : 0;
    return `
      <div class="card hospital-card" onclick="selectHospital('${h.id}')" style="cursor:pointer;">
        <h3>${escapeHtml(h.name)}</h3>
        <p class="hospital-location">📍 ${escapeHtml(h.location)}</p>
        <div class="hospital-metrics">
          <span>${h.departments ? h.departments.length : 0} Departments</span>
          <span class="badge badge-${totalQueue > 15 ? 'warning' : 'ok'}">${totalQueue} Patients Waiting</span>
        </div>
        <button class="btn btn-primary btn-block" style="margin-top:16px;">View Departments &amp; Queues →</button>
      </div>
    `;
  }).join('');
}

window.selectHospital = function(hospitalId) {
  const hospital = state.hospitals.find(h => h.id === hospitalId);
  if (!hospital) return;
  state.selectedHospital = hospital;
  renderHospitalDetail(hospitalId);
  showPatientView('hospital-detail');
};

async function renderHospitalDetail(hospitalId) {
  try {
    const res = await fetch(`${API_BASE}/hospitals/${hospitalId}`);
    if (!res.ok) return;
    const h = await res.json();
    state.selectedHospital = h;

    const header = document.getElementById('p-hospital-detail-header');
    if (header) {
      header.innerHTML = `
        <h2>${escapeHtml(h.name)}</h2>
        <p class="hospital-location" style="margin-top:4px;">📍 ${escapeHtml(h.location)}</p>
      `;
    }

    const deptList = document.getElementById('p-department-list');
    if (deptList && h.departments) {
      deptList.innerHTML = h.departments.map(d => {
        return `
          <div class="card dept-card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <div>
                <h4 style="margin:0; font-size:18px;">${escapeHtml(d.name)}</h4>
                <p style="font-size:13px; color:var(--color-text-secondary); margin-top:2px;">
                  Active Counters: ${d.num_counters} · ~${d.avg_service_time} min/patient
                </p>
              </div>
              <span class="badge badge-${d.queue_size > d.capacity_threshold ? 'warning' : 'ok'}">
                ${d.queue_size} in queue
              </span>
            </div>

            <div class="dept-stats" style="margin:16px 0; display:flex; gap:16px; font-size:14px;">
              <div><strong>Est. Wait:</strong> ~${d.expected_wait_minutes || 0} min</div>
              <div><strong>Serving:</strong> ${d.current_token_number ? escapeHtml(d.current_token_number) : '—'}</div>
            </div>

            <button class="btn btn-primary btn-block" onclick="openTokenForm('${h.id}', '${d.id}')">
              Get Digital Token →
            </button>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Render hospital detail error:', err);
  }
}

/* ================= TOKEN FORM ================= */

window.openTokenForm = function(hospitalId, departmentId) {
  state.selectedDepartmentId = departmentId;
  const hospital = state.hospitals.find(h => h.id === hospitalId);
  const deptSelect = document.getElementById('p-tf-department');
  const contextEl = document.getElementById('p-tf-context');

  if (hospital && deptSelect) {
    if (contextEl) contextEl.textContent = `${hospital.name}`;
    deptSelect.innerHTML = hospital.departments.map(d => `
      <option value="${d.id}" ${d.id === departmentId ? 'selected' : ''}>${escapeHtml(d.name)}</option>
    `).join('');
  }

  showPatientView('token-form');
};

/* ================= LIVE TOKEN TRACKER ================= */

async function fetchAndRenderToken(tokenId) {
  if (!tokenId) return;

  try {
    const res = await fetch(`${API_BASE}/tokens/${tokenId}`);
    if (res.ok) {
      const tok = await res.json();
      state.myToken = tok;
      renderTrackerUI(tok);

      const navBtn = document.getElementById('my-token-nav-btn');
      if (navBtn) {
        navBtn.classList.remove('hidden');
        navBtn.textContent = `My Token: ${tok.number || 'Pending'} 🎫`;
      }
    }
  } catch (err) {
    console.error('Fetch token error:', err);
  }
}

function renderTrackerUI(token) {
  const container = document.getElementById('p-tracker-content');
  if (!container) return;

  if (token.status === 'pending_approval') {
    container.innerHTML = `
      <div class="card token-result-card" style="text-align:center; padding:36px 20px; border-top:5px solid var(--color-warning);">
        <div class="badge badge-pending_approval" style="font-size:14px; padding:6px 14px;">⏳ AWAITING APPROVAL</div>
        <h2 style="margin:16px 0 8px;">Check-in Request Under Review</h2>
        <p style="color:var(--color-text-secondary); max-width:400px; margin:0 auto 20px;">
          Your request for <strong>${escapeHtml(token.patient_name)}</strong> has been received by hospital reception. Please wait while staff verify and assign your token number.
        </p>
        <div style="background:var(--color-bg-secondary); border-radius:8px; padding:16px; max-width:360px; margin:0 auto; text-align:left; font-size:14px;">
          <div><strong>Patient:</strong> ${escapeHtml(token.patient_name)} (${token.age} yrs, ${token.gender})</div>
          <div style="margin-top:6px;"><strong>Phone:</strong> ${escapeHtml(token.phone)}</div>
          <div style="margin-top:6px;"><strong>Time:</strong> Just now</div>
        </div>
        <p style="margin-top:20px; font-size:13px; color:var(--color-text-tertiary);">
          ⚡ This page updates automatically the moment reception staff clicks approve.
        </p>
      </div>
    `;
    return;
  }

  if (token.status === 'rejected') {
    container.innerHTML = `
      <div class="card token-result-card" style="text-align:center; padding:36px 20px; border-top:5px solid var(--color-danger);">
        <div class="badge badge-danger" style="font-size:14px; padding:6px 14px;">✕ REQUEST REJECTED</div>
        <h2 style="margin:16px 0 8px;">Request Could Not Be Approved</h2>
        <p style="color:var(--color-text-secondary); max-width:400px; margin:0 auto 20px;">
          ${escapeHtml(token.rejection_reason || 'Department capacity exceeded or patient details invalid.')}
        </p>
        <button class="btn btn-primary" onclick="showPatientView('hospitals')">Choose Another Department / Hospital</button>
      </div>
    `;
    return;
  }

  // Approved active token board
  const isCalled = token.status === 'called';
  const isCompleted = token.status === 'completed';

  container.innerHTML = `
    <div class="card token-result-card" style="text-align:center; padding:32px 20px; border-top: 5px solid ${isCalled ? 'var(--color-success)' : 'var(--color-primary)'};">
      <span class="badge badge-${token.status}" style="font-size:14px; padding:6px 14px;">${token.status.toUpperCase()}</span>
      <div class="token-number-hero" style="font-size:56px; font-weight:800; color:var(--color-primary); margin:12px 0;">
        ${escapeHtml(token.number)}
      </div>
      <h3 style="margin:0;">${escapeHtml(token.patient_name)}</h3>
      <p style="color:var(--color-text-secondary); margin-top:4px;">${token.age} yrs · ${token.gender} · 📞 ${escapeHtml(token.phone)}</p>

      ${isCalled ? `
        <div class="alert-item alert-critical" style="margin:24px 0; background:rgba(34, 197, 94, 0.15); border-color:var(--color-success); text-align:center;">
          <h3 style="color:var(--color-success); margin:0;">🔔 It's Your Turn!</h3>
          <p style="margin-top:4px;">Please proceed directly to the doctor's consultation counter.</p>
        </div>
      ` : isCompleted ? `
        <div class="alert-item" style="margin:24px 0; background:var(--color-bg-secondary); text-align:center;">
          <h3 style="margin:0;">✓ Consultation Finished</h3>
          <p style="margin-top:4px;">Thank you for visiting. Have a healthy day!</p>
        </div>
      ` : `
        <div class="tracker-metrics-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:24px 0;">
          <div class="card" style="background:var(--color-bg-secondary); padding:16px;">
            <div style="font-size:32px; font-weight:700; color:var(--color-primary);">${token.ahead != null ? token.ahead : 0}</div>
            <div style="font-size:13px; color:var(--color-text-secondary);">Patients Ahead of You</div>
          </div>
          <div class="card" style="background:var(--color-bg-secondary); padding:16px;">
            <div style="font-size:32px; font-weight:700; color:var(--color-success);">~${token.wait_minutes != null ? token.wait_minutes : 0}</div>
            <div style="font-size:13px; color:var(--color-text-secondary);">Estimated Wait (min)</div>
          </div>
        </div>
      `}

      <div style="margin-top:20px;">
        <button class="btn btn-outline btn-sm" onclick="showPatientView('hospitals')">← View Hospital List</button>
      </div>
    </div>
  `;
}

/* ================= EVENT LISTENERS ================= */

document.addEventListener('DOMContentLoaded', async function() {
  await fetchHospitals();
  initWebSocket();

  // If patient has saved active token, open tracker directly!
  if (state.myTokenId) {
    showPatientView('tracker');
    fetchAndRenderToken(state.myTokenId);
  } else {
    showPatientView('hospitals');
  }

  // My Active Token navbar button
  document.getElementById('my-token-nav-btn')?.addEventListener('click', () => {
    showPatientView('tracker');
  });

  // Token Check-in Form submit
  const form = document.getElementById('p-token-form');
  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const name = document.getElementById('p-tf-name').value.trim();
      const age = document.getElementById('p-tf-age').value;
      const gender = document.getElementById('p-tf-gender').value;
      const phone = document.getElementById('p-tf-phone').value.trim();
      const departmentId = document.getElementById('p-tf-department').value;
      const errorEl = document.getElementById('p-tf-error');

      if (!name || !age || Number(age) <= 0 || !gender || !phone || !departmentId) {
        errorEl.textContent = 'Please fill in all fields with valid information.';
        errorEl.classList.remove('hidden');
        return;
      }
      errorEl.classList.add('hidden');
      showLoadingOverlay('Submitting check-in request…');

      const hospitalId = state.selectedHospital ? state.selectedHospital.id : 'h1';

      try {
        const res = await fetch(`${API_BASE}/tokens/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hospital_id: hospitalId,
            department_id: departmentId,
            patient_name: name,
            age: Number(age),
            gender: gender,
            phone: phone,
          }),
        });
        hideLoadingOverlay();
        if (res.ok) {
          const tok = await res.json();
          state.myTokenId = tok.id;
          state.myToken = tok;
          localStorage.setItem('opd_patient_token', tok.id);
          showToast('Check-in submitted! Awaiting staff approval.', 'info');
          form.reset();
          showPatientView('tracker');
          renderTrackerUI(tok);
        } else {
          showToast('Could not submit check-in request.', 'warning');
        }
      } catch (err) {
        hideLoadingOverlay();
        console.error('Request token error:', err);
      }
    });
  }
});
