/**
 * Staff Portal Operations Script (SIH1620)
 * Handles Real-time Queue Management, Token Approvals, Bed Availability,
 * and Predictive Capacity Alerts.
 */

'use strict';

const API_BASE = '/api';

const state = {
  activeTab: 'reception',
  hospitals: [],
  selectedHospitalId: 'h1',
  selectedDepartmentId: 'd1',
  adminHospitalId: 'all',
  modalBed: null,
  pendingConfirm: null,
};

let socket = null;

/* ================= TOASTS & UTILS ================= */

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

function showConfirm(title, message, onConfirm) {
  document.getElementById('confirm-title').textContent = title || 'Confirm Action';
  document.getElementById('confirm-message').textContent = message || 'Are you sure you want to proceed?';
  state.pendingConfirm = onConfirm;
  document.getElementById('confirm-modal').classList.remove('hidden');
}

function hideConfirm() {
  state.pendingConfirm = null;
  document.getElementById('confirm-modal').classList.add('hidden');
}

/* ================= WEBSOCKET ================= */

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      console.log('Staff WebSocket connected.');
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
    console.warn('WebSocket init failed:', e);
  }
}

function handleWsEvent(msg) {
  const event = msg.event;
  const data = msg.data || {};

  if (event === 'token_requested') {
    showToast(`New patient check-in request: ${data.patient_name || 'Patient'}`, 'info');
    renderPendingTokens();
  } else if (event === 'token_approved' || event === 'token_rejected') {
    renderPendingTokens();
    renderTodaysTokens();
    if (state.activeTab === 'queue-mgmt') renderQueueMgmt();
  } else if (event === 'queue_update' || event === 'token_called') {
    renderTodaysTokens();
    if (state.activeTab === 'queue-mgmt') renderQueueMgmt();
    if (state.activeTab === 'admin') renderAdminStats();
  } else if (event === 'bed_updated') {
    if (state.activeTab === 'bed-mgmt') renderBedGrid();
    if (state.activeTab === 'admin') renderAdminStats();
  }
}

/* ================= INITIALIZATION & DATA FETCHING ================= */

async function fetchHospitals() {
  try {
    const res = await fetch(`${API_BASE}/hospitals`);
    if (res.ok) {
      state.hospitals = await res.json();
      populateDropdowns();
    }
  } catch (err) {
    console.error('Fetch hospitals error:', err);
  }
}

function populateDropdowns() {
  const regH = document.getElementById('reg-hospital');
  const regD = document.getElementById('reg-department');
  const qmH = document.getElementById('qm-hospital');
  const qmD = document.getElementById('qm-department');
  const bedH = document.getElementById('bed-hospital');
  const adminH = document.getElementById('admin-hospital');

  if (!state.hospitals.length) return;

  const hOptions = state.hospitals.map(h => `<option value="${h.id}">${escapeHtml(h.name)}</option>`).join('');

  if (regH) regH.innerHTML = hOptions;
  if (qmH) qmH.innerHTML = hOptions;
  if (bedH) bedH.innerHTML = hOptions;
  if (adminH) adminH.innerHTML = `<option value="all">All Hospitals</option>` + hOptions;

  updateDeptSelect(regD, regH ? regH.value : state.hospitals[0].id);
  updateDeptSelect(qmD, qmH ? qmH.value : state.hospitals[0].id);
}

function updateDeptSelect(selectEl, hospitalId) {
  if (!selectEl) return;
  const hospital = state.hospitals.find(h => h.id === hospitalId);
  if (hospital && hospital.departments) {
    selectEl.innerHTML = hospital.departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  }
}

/* ================= RECEPTION TAB ================= */

async function renderPendingTokens() {
  const container = document.getElementById('pending-tokens-list');
  const badge = document.getElementById('pending-count-badge');
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/tokens/pending`);
    if (res.ok) {
      const list = await res.json();
      if (badge) badge.textContent = `${list.length} pending`;

      if (!list.length) {
        container.innerHTML = '<div class="empty-row">No pending token requests at this time.</div>';
        return;
      }

      container.innerHTML = list.map(t => {
        const hospital = state.hospitals.find(h => h.id === t.hospital_id);
        return `
          <div class="token-row" style="background: rgba(234, 179, 8, 0.05); border-left: 3px solid var(--color-warning);">
            <div class="tr-left">
              <span class="tr-num" style="color: var(--color-warning);">PENDING</span>
              <span class="tr-name">${escapeHtml(t.patient_name)}</span>
              <span class="tr-meta">${escapeHtml(t.gender || '')} · ${t.age} yrs · 📞 ${escapeHtml(t.phone)} · ${escapeHtml(hospital ? hospital.name : '')}</span>
            </div>
            <div class="tr-right" style="display:flex; gap:8px;">
              <button class="btn btn-primary btn-sm" onclick="approveToken('${t.id}')">✓ Approve</button>
              <button class="btn btn-danger btn-sm" onclick="promptRejectToken('${t.id}')">✕ Reject</button>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Pending tokens fetch error:', err);
  }
}

window.approveToken = async function(tokenId) {
  showLoadingOverlay('Approving token…');
  try {
    const res = await fetch(`${API_BASE}/tokens/${tokenId}/approve`, { method: 'POST' });
    hideLoadingOverlay();
    if (res.ok) {
      const data = await res.json();
      showToast(`Token approved! Assigned Number: ${data.number}`, 'success');
      renderPendingTokens();
      renderTodaysTokens();
    } else {
      const err = await res.json();
      showToast(err.detail || 'Could not approve token.', 'warning');
    }
  } catch (err) {
    hideLoadingOverlay();
    console.error('Approve token error:', err);
  }
};

window.promptRejectToken = function(tokenId) {
  showConfirm('Reject Token Request', 'Are you sure you want to reject this patient token request?', async () => {
    showLoadingOverlay('Rejecting request…');
    try {
      const res = await fetch(`${API_BASE}/tokens/${tokenId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Department at capacity' }),
      });
      hideLoadingOverlay();
      if (res.ok) {
        showToast('Token request rejected.', 'info');
        renderPendingTokens();
      } else {
        const err = await res.json();
        showToast(err.detail || 'Could not reject token.', 'warning');
      }
    } catch (err) {
      hideLoadingOverlay();
      console.error('Reject token error:', err);
    }
  });
};

async function renderTodaysTokens() {
  const container = document.getElementById('todays-tokens-list');
  if (!container) return;

  const hId = document.getElementById('reg-hospital') ? document.getElementById('reg-hospital').value : 'h1';

  try {
    const res = await fetch(`${API_BASE}/tokens?hospital_id=${hId}`);
    if (res.ok) {
      const all = await res.json();
      const approved = all.filter(t => t.status !== 'pending_approval');
      if (!approved.length) {
        container.innerHTML = '<div class="empty-row">No active tokens generated yet.</div>';
        return;
      }
      container.innerHTML = approved.slice(0, 20).map(t => {
        return `
          <div class="token-row">
            <div class="tr-left">
              <span class="tr-num">${escapeHtml(t.number || '—')}</span>
              <span class="tr-name">${escapeHtml(t.patient_name)}</span>
              <span class="tr-meta">${escapeHtml(t.gender || '')} · ${t.age} yrs · ${escapeHtml(t.phone)}</span>
            </div>
            <div class="tr-right">
              <span class="badge badge-${t.status}">${t.status}</span>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Todays tokens fetch error:', err);
  }
}

/* ================= QUEUE MANAGEMENT TAB ================= */

async function renderQueueMgmt() {
  const qmH = document.getElementById('qm-hospital');
  const qmD = document.getElementById('qm-department');
  if (!qmH || !qmD) return;

  const dId = qmD.value;
  if (!dId) return;

  try {
    const res = await fetch(`${API_BASE}/departments/${dId}/queue`);
    if (res.ok) {
      const data = await res.json();
      
      // 1. Render Now Serving
      const servingEl = document.getElementById('qm-serving-detail');
      if (data.now_serving) {
        const cur = data.now_serving;
        servingEl.innerHTML = `
          <div class="serving-active">
            <div class="serving-token-huge">${escapeHtml(cur.number)}</div>
            <div class="serving-patient-name">${escapeHtml(cur.patient_name)}</div>
            <div class="serving-patient-meta">${cur.age} yrs · ${cur.gender} · 📞 ${escapeHtml(cur.phone)}</div>
            <div class="serving-actions" style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
              <button class="btn btn-success btn-lg" onclick="completeVisit('${dId}')">✓ Complete Consultation</button>
              <button class="btn btn-outline" onclick="skipToken('${dId}')">Skip</button>
              <button class="btn btn-danger btn-outline" onclick="noShowToken('${dId}')">No-show</button>
            </div>
          </div>
        `;
      } else {
        servingEl.innerHTML = `
          <div class="serving-idle" style="text-align:center; padding:30px 20px;">
            <p style="color:var(--color-text-secondary); margin-bottom:16px;">Counter is currently idle.</p>
            <button class="btn btn-primary btn-lg" onclick="callNext('${dId}')" ${data.waiting.length === 0 ? 'disabled' : ''}>
              📢 Call Next Patient
            </button>
          </div>
        `;
      }

      // 2. Render Waiting Queue
      const summaryEl = document.getElementById('qm-queue-summary');
      if (summaryEl) summaryEl.textContent = `${data.queue_size} patients waiting · Active Service Rate: ${data.live_service_minutes.toFixed(1)} min/patient`;

      const waitEl = document.getElementById('qm-waiting-list');
      if (!data.waiting.length) {
        waitEl.innerHTML = '<div class="empty-row">Queue is empty.</div>';
      } else {
        waitEl.innerHTML = data.waiting.map(t => `
          <div class="token-row">
            <div class="tr-left">
              <span class="tr-num">${escapeHtml(t.number)}</span>
              <span class="tr-name">${escapeHtml(t.patient_name)}</span>
              <span class="tr-meta">Position #${t.queue_position} · Est. Wait: ~${t.wait_minutes} min</span>
            </div>
            <div class="tr-right">
              <span class="badge badge-waiting">Waiting</span>
            </div>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Queue mgmt fetch error:', err);
  }
}

window.callNext = async function(deptId) {
  showLoadingOverlay('Calling next patient…');
  try {
    const res = await fetch(`${API_BASE}/departments/${deptId}/call-next`, { method: 'POST' });
    hideLoadingOverlay();
    if (res.ok) {
      const data = await res.json();
      showToast(`Called token ${data.number}`, 'success');
      renderQueueMgmt();
    } else {
      const err = await res.json();
      showToast(err.detail || 'Could not call next patient.', 'warning');
    }
  } catch (err) {
    hideLoadingOverlay();
    console.error('Call next error:', err);
  }
};

window.completeVisit = async function(deptId) {
  showLoadingOverlay('Recording completed visit…');
  try {
    const res = await fetch(`${API_BASE}/departments/${deptId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    hideLoadingOverlay();
    if (res.ok) {
      showToast('Consultation marked as completed.', 'success');
      renderQueueMgmt();
    }
  } catch (err) {
    hideLoadingOverlay();
    console.error('Complete error:', err);
  }
};

window.skipToken = function(deptId) {
  showConfirm('Skip Patient', 'Skip this patient? They will need to re-register.', async () => {
    showLoadingOverlay('Skipping…');
    try {
      await fetch(`${API_BASE}/departments/${deptId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'skipped' }),
      });
      hideLoadingOverlay();
      showToast('Token skipped.', 'info');
      renderQueueMgmt();
    } catch (err) {
      hideLoadingOverlay();
    }
  });
};

window.noShowToken = function(deptId) {
  showConfirm('Mark No-Show', 'Mark this patient as a no-show?', async () => {
    showLoadingOverlay('Marking no-show…');
    try {
      await fetch(`${API_BASE}/departments/${deptId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'noshow' }),
      });
      hideLoadingOverlay();
      showToast('Marked as no-show.', 'info');
      renderQueueMgmt();
    } catch (err) {
      hideLoadingOverlay();
    }
  });
};

/* ================= BED MANAGEMENT TAB ================= */

async function renderBedGrid() {
  const bedH = document.getElementById('bed-hospital');
  const hId = bedH ? bedH.value : 'h1';

  try {
    const res = await fetch(`${API_BASE}/hospitals/${hId}/beds`);
    if (res.ok) {
      const beds = await res.json();
      
      const total = beds.length;
      const occupied = beds.filter(b => b.status === 'occupied').length;
      const available = beds.filter(b => b.status === 'available').length;
      const cleaning = beds.filter(b => b.status === 'cleaning').length;
      const maint = beds.filter(b => b.status === 'maintenance').length;
      const pct = total ? Math.round((occupied / total) * 100) : 0;

      const bar = document.getElementById('bed-summary-bar');
      if (bar) {
        bar.innerHTML = `
          <div class="card" style="padding:16px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
              <strong>Ward Bed Occupancy</strong>
              <span>${occupied} / ${total} Beds Occupied (${pct}%)</span>
            </div>
            <div class="bed-bar" style="display:flex; height:12px; border-radius:6px; overflow:hidden; background:var(--color-bg-secondary);">
              <div style="width:${(occupied/total)*100}%; background:var(--color-danger);"></div>
              <div style="width:${(cleaning/total)*100}%; background:var(--color-warning);"></div>
              <div style="width:${(maint/total)*100}%; background:var(--color-text-tertiary);"></div>
              <div style="width:${(available/total)*100}%; background:var(--color-success);"></div>
            </div>
            <div style="display:flex; gap:16px; margin-top:10px; font-size:13px; color:var(--color-text-secondary);">
              <span>● ${available} Available</span>
              <span>● ${occupied} Occupied</span>
              <span>● ${cleaning} Cleaning</span>
              <span>● ${maint} Maintenance</span>
            </div>
          </div>
        `;
      }

      const grid = document.getElementById('bed-grid');
      if (grid) {
        grid.innerHTML = beds.map(b => `
          <div class="bed-card bed-${b.status}" onclick="openBedModal('${b.id}', ${b.number}, '${b.status}', '${escapeHtml(b.patient_name)}')">
            <div class="bed-number">Bed #${b.number}</div>
            <div class="bed-status-tag">${b.status}</div>
            <div class="bed-patient">${b.patient_name ? escapeHtml(b.patient_name) : '—'}</div>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Bed grid fetch error:', err);
  }
}

window.openBedModal = function(id, number, status, patientName) {
  state.modalBed = { id, number, status, patientName };
  document.getElementById('modal-bed-title').textContent = `Edit Bed #${number}`;
  const select = document.getElementById('bed-status-select');
  const pField = document.getElementById('bed-patient-field');
  const pInput = document.getElementById('bed-patient-name');

  select.value = status;
  pInput.value = patientName || '';
  if (status === 'occupied') pField.classList.remove('hidden');
  else pField.classList.add('hidden');

  document.getElementById('bed-modal').classList.remove('hidden');
};

function closeBedModal() {
  state.modalBed = null;
  document.getElementById('bed-modal').classList.add('hidden');
}

/* ================= ADMIN & ALERTS TAB ================= */

async function renderAdminStats() {
  const adminH = document.getElementById('admin-hospital');
  const scope = adminH ? adminH.value : 'all';

  try {
    const statsRes = await fetch(`${API_BASE}/admin/stats?scope=${scope}`);
    if (statsRes.ok) {
      const s = await statsRes.json();
      const grid = document.getElementById('admin-stats-grid');
      if (grid) {
        grid.innerHTML = `
          <div class="card stat-card">
            <div class="stat-value" style="color:var(--color-primary);">${s.total_waiting}</div>
            <div class="stat-label">Total Patients in Queue</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value" style="color:var(--color-success);">${s.total_beds}</div>
            <div class="stat-label">Total Hospital Beds</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value" style="color:var(--color-danger);">${s.occupied_pct}%</div>
            <div class="stat-label">Bed Occupancy Rate</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value" style="color:var(--color-warning);">${(s.avg_utilization * 100).toFixed(1)}%</div>
            <div class="stat-label">OPD Counter Traffic ($\rho$)</div>
          </div>
        `;
      }
    }

    const alertsRes = await fetch(`${API_BASE}/admin/alerts`);
    if (alertsRes.ok) {
      const alerts = await alertsRes.json();
      const list = document.getElementById('admin-alerts-list');
      if (list) {
        list.innerHTML = alerts.map(a => `
          <div class="alert-item alert-${a.severity}">
            <div class="alert-header">
              <strong>${escapeHtml(a.department_name)} · ${escapeHtml(a.hospital_name)}</strong>
              <span class="badge badge-${a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warning' : 'ok'}">${a.severity.toUpperCase()}</span>
            </div>
            <p class="alert-msg">${escapeHtml(a.message)}</p>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Admin stats fetch error:', err);
  }
}

/* ================= EVENT LISTENERS ================= */

document.addEventListener('DOMContentLoaded', async function() {
  await fetchHospitals();
  initWebSocket();

  // Tab Switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.staffTab;
      state.activeTab = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.staff-tab').forEach(p => p.classList.remove('active'));
      const activePanel = document.getElementById('tab-' + tab);
      if (activePanel) activePanel.classList.add('active');

      if (tab === 'reception') { renderPendingTokens(); renderTodaysTokens(); }
      if (tab === 'queue-mgmt') renderQueueMgmt();
      if (tab === 'bed-mgmt') renderBedGrid();
      if (tab === 'admin') renderAdminStats();
    });
  });

  // Reception Direct Registration Form
  const regForm = document.getElementById('register-form');
  if (regForm) {
    regForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      const hId = document.getElementById('reg-hospital').value;
      const dId = document.getElementById('reg-department').value;
      const name = document.getElementById('reg-name').value.trim();
      const age = document.getElementById('reg-age').value;
      const gender = document.getElementById('reg-gender').value;
      const phone = document.getElementById('reg-phone').value.trim();
      const errorEl = document.getElementById('reg-error');

      if (!name || !age || !gender || !phone) {
        errorEl.textContent = 'Please fill in all fields with valid details.';
        errorEl.classList.remove('hidden');
        return;
      }
      errorEl.classList.add('hidden');
      showLoadingOverlay('Generating token…');

      try {
        const res = await fetch(`${API_BASE}/tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hospital_id: hId,
            department_id: dId,
            patient_name: name,
            age: Number(age),
            gender: gender,
            phone: phone,
          }),
        });
        hideLoadingOverlay();
        if (res.ok) {
          const tok = await res.json();
          showToast(`Token issued: ${tok.number}`, 'success');
          regForm.reset();
          renderTodaysTokens();
        } else {
          showToast('Could not register token.', 'warning');
        }
      } catch (err) {
        hideLoadingOverlay();
        console.error('Register error:', err);
      }
    });
  }

  // Dropdown Change Listeners
  document.getElementById('reg-hospital')?.addEventListener('change', function() {
    updateDeptSelect(document.getElementById('reg-department'), this.value);
    renderTodaysTokens();
  });
  document.getElementById('qm-hospital')?.addEventListener('change', function() {
    updateDeptSelect(document.getElementById('qm-department'), this.value);
    renderQueueMgmt();
  });
  document.getElementById('qm-department')?.addEventListener('change', renderQueueMgmt);
  document.getElementById('bed-hospital')?.addEventListener('change', renderBedGrid);
  document.getElementById('admin-hospital')?.addEventListener('change', renderAdminStats);

  // Manual Refresh Buttons
  document.getElementById('refresh-pending-btn')?.addEventListener('click', renderPendingTokens);
  document.getElementById('refresh-tokens-btn')?.addEventListener('click', renderTodaysTokens);
  document.getElementById('refresh-queue-btn')?.addEventListener('click', renderQueueMgmt);

  // Bed Modal Actions
  document.getElementById('bed-status-select')?.addEventListener('change', function() {
    const pf = document.getElementById('bed-patient-field');
    if (this.value === 'occupied') pf.classList.remove('hidden');
    else pf.classList.add('hidden');
  });

  document.getElementById('close-bed-modal-btn')?.addEventListener('click', closeBedModal);
  document.getElementById('cancel-bed-btn')?.addEventListener('click', closeBedModal);
  document.getElementById('bed-modal')?.addEventListener('click', function(e) { if (e.target === this) closeBedModal(); });

  document.getElementById('save-bed-btn')?.addEventListener('click', async function() {
    if (!state.modalBed) return;
    const status = document.getElementById('bed-status-select').value;
    const pName = document.getElementById('bed-patient-name').value.trim();
    showLoadingOverlay('Updating bed…');
    try {
      await fetch(`${API_BASE}/beds/${state.modalBed.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, patient_name: status === 'occupied' ? pName : '' }),
      });
      hideLoadingOverlay();
      closeBedModal();
      renderBedGrid();
      showToast('Bed status updated.', 'success');
    } catch (err) {
      hideLoadingOverlay();
      console.error('Save bed error:', err);
    }
  });

  document.getElementById('release-bed-btn')?.addEventListener('click', function() {
    if (!state.modalBed) return;
    showConfirm('Release Bed', 'Mark this bed as available and discharge the patient?', async () => {
      showLoadingOverlay('Releasing bed…');
      try {
        await fetch(`${API_BASE}/beds/${state.modalBed.id}/release`, { method: 'POST' });
        hideLoadingOverlay();
        closeBedModal();
        renderBedGrid();
        showToast('Bed released.', 'success');
      } catch (err) {
        hideLoadingOverlay();
      }
    });
  });

  // Logout Button
  document.getElementById('logout-btn')?.addEventListener('click', function() {
    showConfirm('Log Out', 'Are you sure you want to log out of the staff portal?', async () => {
      showLoadingOverlay('Logging out…');
      try {
        await fetch(`${API_BASE}/auth/staff-logout`, { method: 'POST' });
      } catch (e) {}
      window.location.href = '/staff/login';
    });
  });

  // Confirm Modal Buttons
  document.getElementById('confirm-yes')?.addEventListener('click', function() {
    const fn = state.pendingConfirm;
    hideConfirm();
    if (fn) fn();
  });
  document.getElementById('confirm-no')?.addEventListener('click', hideConfirm);
  document.getElementById('confirm-modal')?.addEventListener('click', function(e) { if (e.target === this) hideConfirm(); });

  // Initial tab render
  renderPendingTokens();
  renderTodaysTokens();
});
