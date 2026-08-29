/* =========================================================
   OPD Queue & Bed System — Application Logic
   Sections: Data Models -> Helpers -> State -> Render ->
   Navigation -> UI helpers -> Staff actions -> Simulation -> Init
   ========================================================= */

/* ================= DATA MODELS ================= */

const HOSPITALS = [
  {
    id: 'h1',
    name: 'City General Hospital',
    location: 'Sector 5, Salt Lake, Kolkata',
    departments: [
      { id: 'd1', name: 'General Medicine', prefix: 'A', avgServiceTime: 6, counter: 0, queue: [], currentTokenId: null, completedCount: 0 },
      { id: 'd2', name: 'Pediatrics', prefix: 'B', avgServiceTime: 8, counter: 0, queue: [], currentTokenId: null, completedCount: 0 },
      { id: 'd3', name: 'Orthopedics', prefix: 'C', avgServiceTime: 10, counter: 0, queue: [], currentTokenId: null, completedCount: 0 },
    ],
    beds: [],
  },
  {
    id: 'h2',
    name: 'Sunrise Community Hospital',
    location: 'Sector 2, Salt Lake, Kolkata',
    departments: [
      { id: 'd4', name: 'General Medicine', prefix: 'A', avgServiceTime: 5, counter: 0, queue: [], currentTokenId: null, completedCount: 0 },
      { id: 'd5', name: 'ENT', prefix: 'B', avgServiceTime: 9, counter: 0, queue: [], currentTokenId: null, completedCount: 0 },
      { id: 'd6', name: 'Gynecology', prefix: 'C', avgServiceTime: 11, counter: 0, queue: [], currentTokenId: null, completedCount: 0 },
    ],
    beds: [],
  },
  {
    id: 'h3',
    name: 'Riverside Health Center',
    location: 'Shibpur, Howrah',
    departments: [
      { id: 'd7', name: 'General Medicine', prefix: 'A', avgServiceTime: 6, counter: 0, queue: [], currentTokenId: null, completedCount: 0 },
      { id: 'd8', name: 'Dermatology', prefix: 'B', avgServiceTime: 7, counter: 0, queue: [], currentTokenId: null, completedCount: 0 },
      { id: 'd9', name: 'Cardiology', prefix: 'C', avgServiceTime: 12, counter: 0, queue: [], currentTokenId: null, completedCount: 0 },
    ],
    beds: [],
  },
];

const TOKENS = {}; // id -> token object

const NAME_POOL = [
  'Aditi Sharma', 'Rahul Verma', 'Priya Nair', 'Karan Mehta', 'Sneha Roy',
  'Arjun Das', 'Neha Gupta', 'Vikram Singh', 'Ananya Iyer', 'Rohan Bose',
  'Ishita Chatterjee', 'Manish Kumar', 'Pooja Reddy', 'Sameer Khan', 'Divya Menon',
  'Amit Chakraborty', 'Ritu Agarwal', 'Suresh Pillai', 'Kavita Joshi', 'Farhan Ahmed',
];

/* ================= BACKEND API & WEBSOCKET ================= */

const API_BASE = window.location.origin.includes(':8000') || window.location.pathname.startsWith('/api')
  ? '/api'
  : 'http://localhost:8000/api';
const WS_HOST = window.location.host.includes(':8000') ? window.location.host : 'localhost:8000';
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${WS_HOST}/ws`;

let BACKEND_ACTIVE = false;
let ws = null;

async function checkBackend() {
  try {
    const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
    if (res.ok) {
      BACKEND_ACTIVE = true;
      const logoText = document.querySelector('.logo-text');
      if (logoText && !document.getElementById('backend-status-badge')) {
        const badge = document.createElement('span');
        badge.id = 'backend-status-badge';
        badge.style.cssText = 'font-size:0.75rem; color:var(--primary-darker); background:var(--primary-light); padding:2px 8px; border-radius:999px; font-weight:600; margin-left:8px;';
        badge.textContent = '● M/M/c Engine Online';
        logoText.parentNode.appendChild(badge);
      }
      await syncFromBackend();
      initWebSocket();
      renderCurrentView();
      return true;
    }
  } catch (e) {
    console.log('Backend not reachable, running in standalone client mode.');
  }
  BACKEND_ACTIVE = false;
  return false;
}

async function syncFromBackend() {
  if (!BACKEND_ACTIVE) return;
  try {
    const res = await fetch(`${API_BASE}/hospitals`);
    if (!res.ok) return;
    const hospSummaries = await res.json();

    for (const hs of hospSummaries) {
      let h = getHospital(hs.id);
      if (!h) {
        h = { id: hs.id, name: hs.name, location: hs.location, departments: [], beds: [] };
        HOSPITALS.push(h);
      }
      const dRes = await fetch(`${API_BASE}/hospitals/${h.id}`);
      if (dRes.ok) {
        const detail = await dRes.json();
        for (const ds of detail.departments) {
          let dept = h.departments.find(d => d.id === ds.id);
          if (!dept) {
            dept = { id: ds.id, name: ds.name, prefix: ds.prefix, avgServiceTime: 6, counter: 0, queue: [], currentTokenId: null, completedCount: 0 };
            h.departments.push(dept);
          }
          dept.numCounters = ds.num_counters;
          const tRes = await fetch(`${API_BASE}/hospitals/${h.id}/departments/${dept.id}/trail`);
          if (tRes.ok) {
            const trail = await tRes.json();
            dept.queue = [];
            dept.currentTokenId = null;
            trail.forEach(item => {
              TOKENS[item.id] = {
                id: item.id,
                number: item.number,
                hospitalId: h.id,
                departmentId: dept.id,
                patientName: item.patient_name,
                status: item.is_current ? 'called' : 'waiting',
              };
              if (item.is_current) {
                dept.currentTokenId = item.id;
              } else {
                dept.queue.push(item.id);
              }
            });
          }
        }
      }

      const bRes = await fetch(`${API_BASE}/hospitals/${h.id}/beds`);
      if (bRes.ok) {
        const beds = await bRes.json();
        h.beds = beds.map(b => ({
          id: b.id,
          number: b.number,
          status: b.status,
          patientName: b.patient_name,
        }));
      }
    }

    const tokRes = await fetch(`${API_BASE}/tokens?limit=50`);
    if (tokRes.ok) {
      const recentToks = await tokRes.json();
      recentToks.forEach(t => {
        TOKENS[t.id] = {
          id: t.id,
          number: t.number,
          hospitalId: t.hospital_id,
          departmentId: t.department_id,
          patientName: t.patient_name,
          age: t.age,
          gender: t.gender,
          phone: t.phone,
          status: t.status,
          createdAt: new Date(t.created_at).getTime(),
          calledAt: t.called_at ? new Date(t.called_at).getTime() : null,
          resolvedAt: t.resolved_at ? new Date(t.resolved_at).getTime() : null,
          ahead: t.ahead,
          wait: t.wait_minutes,
        };
      });
    }

    if (state.myToken) {
      const myRes = await fetch(`${API_BASE}/tokens/${state.myToken.id}`);
      if (myRes.ok) {
        const mt = await myRes.json();
        TOKENS[mt.id] = {
          ...TOKENS[mt.id],
          status: mt.status,
          ahead: mt.ahead,
          wait: mt.wait_minutes,
        };
      }
    }
  } catch (err) {
    console.warn('Backend sync failed:', err);
  }
}

function initWebSocket() {
  if (!BACKEND_ACTIVE) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(WS_URL);
    ws.onmessage = async (msg) => {
      try {
        const event = JSON.parse(msg.data);
        if (event.event === 'token_requested') {
          showToast(`📋 New OPD token request from ${event.data.patient_name}`, 'info');
        } else if (event.event === 'token_approved') {
          if (state.myToken && event.data.token_id === state.myToken.id) {
            showToast(`🎉 Your token request has been approved! Token: ${event.data.number}`, 'success');
            state.myToken = { ...state.myToken, id: event.data.token_id };
          }
        } else if (event.event === 'token_rejected') {
          if (state.myToken && event.data.token_id === state.myToken.id) {
            showToast(`❌ Token request rejected: ${event.data.reason}`, 'danger');
          }
        } else if (event.event === 'patient_alert') {
          if (state.myToken && event.data.token_id === state.myToken.id) {
            showToast('🔔 ' + event.data.message, 'warning');
          }
        } else if (event.event === 'token_called') {
          if (state.myToken && event.data.token_id === state.myToken.id) {
            showToast(`📢 Token ${event.data.token_number} called to counter!`, 'warning');
          }
        }
        await syncFromBackend();
        renderCurrentView();
        if (state.staff.loggedIn && state.staff.activeTab === 'reception') {
          renderPendingTokens();
        }
      } catch (e) {
        console.error('Error in WS onmessage:', e);
      }
    };
    ws.onclose = () => {
      if (BACKEND_ACTIVE) setTimeout(initWebSocket, 3000);
    };
  } catch (e) {
    console.warn('WebSocket error:', e);
  }
}

/* ================= HELPERS ================= */

let _uidCounter = 1;
function uid(prefix) { return prefix + '_' + (_uidCounter++); }

function getHospital(id) { return HOSPITALS.find(h => h.id === id); }
function getDept(hospitalId, deptId) {
  const h = getHospital(hospitalId);
  return h ? h.departments.find(d => d.id === deptId) : null;
}
function getToken(id) { return TOKENS[id]; }

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function randomName() { return NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)]; }
function randomAge() { return 8 + Math.floor(Math.random() * 70); }
function randomGender() { return ['Male', 'Female', 'Other'][Math.floor(Math.random() * 3)]; }
function randomPhone() { return '9' + Math.floor(100000000 + Math.random() * 899999999); }

function estimateWaitMinutes(dept, aheadCount) {
  if (aheadCount <= 0) return 2;
  return aheadCount * dept.avgServiceTime;
}
function formatWait(mins) {
  if (mins === null || mins === undefined) return '—';
  if (mins < 1) return '<1 min';
  return `~${mins} min`;
}

function tokenPositionInfo(token) {
  const dept = getDept(token.hospitalId, token.departmentId);
  if (token.status === 'called') return { ahead: 0, wait: 0 };
  if (token.status !== 'waiting') return { ahead: null, wait: null };
  const idx = dept.queue.indexOf(token.id);
  const ahead = idx + (dept.currentTokenId ? 1 : 0);
  return { ahead, wait: estimateWaitMinutes(dept, ahead) };
}

function hospitalStats(hospital) {
  let totalWaiting = 0, waitSum = 0;
  hospital.departments.forEach(d => {
    const size = d.queue.length + (d.currentTokenId ? 1 : 0);
    totalWaiting += size;
    waitSum += estimateWaitMinutes(d, size);
  });
  const avgWait = hospital.departments.length ? Math.round(waitSum / hospital.departments.length) : 0;
  return { totalWaiting, avgWait };
}

function createToken(hospitalId, departmentId, patientName, age, gender, phone) {
  const dept = getDept(hospitalId, departmentId);
  dept.counter += 1;
  const number = dept.prefix + '-' + String(dept.counter).padStart(3, '0');
  const token = {
    id: uid('tok'),
    number, hospitalId, departmentId,
    patientName, age, gender, phone,
    status: 'waiting',
    createdAt: Date.now(),
    resolvedAt: null,
  };
  TOKENS[token.id] = token;
  dept.queue.push(token.id);
  return token;
}

function makeBeds(count, idPrefix) {
  const beds = [];
  const defaultStatuses = ['available', 'occupied', 'available', 'cleaning', 'available', 'occupied', 'available', 'maintenance'];
  const defaultNames = ['Rohan Bose', 'Pooja Reddy', 'Divya Menon', 'Arjun Das', 'Neha Gupta', 'Kavita Joshi'];
  let nameIdx = 0;
  for (let i = 1; i <= count; i++) {
    const status = defaultStatuses[(i - 1) % defaultStatuses.length];
    const patientName = status === 'occupied' ? defaultNames[(nameIdx++) % defaultNames.length] : '';
    beds.push({ id: `bed_${idPrefix}_${i}`, number: i, status, patientName });
  }
  return beds;
}

function seedData() {
  HOSPITALS[0].beds = makeBeds(16, 'h1');
  HOSPITALS[1].beds = makeBeds(14, 'h2');
  HOSPITALS[2].beds = makeBeds(12, 'h3');

  const samples = [
    { hId: 'h1', dId: 'd1', name: 'Aditi Sharma', age: 34, gender: 'Female', phone: '9876543210', status: 'called' },
    { hId: 'h1', dId: 'd1', name: 'Rahul Verma', age: 42, gender: 'Male', phone: '9876543211', status: 'waiting' },
    { hId: 'h1', dId: 'd1', name: 'Karan Mehta', age: 28, gender: 'Male', phone: '9876543212', status: 'waiting' },
    { hId: 'h1', dId: 'd2', name: 'Ananya Iyer', age: 8, gender: 'Female', phone: '9876543213', status: 'called' },
    { hId: 'h1', dId: 'd2', name: 'Ishita Chatterjee', age: 11, gender: 'Female', phone: '9876543214', status: 'waiting' },
    { hId: 'h1', dId: 'd3', name: 'Vikram Singh', age: 55, gender: 'Male', phone: '9876543215', status: 'called' },
    { hId: 'h1', dId: 'd3', name: 'Sneha Roy', age: 26, gender: 'Female', phone: '9876543216', status: 'waiting' },
  ];

  samples.forEach(s => {
    const dept = getDept(s.hId, s.dId);
    if (dept) {
      dept.counter += 1;
      const num = dept.prefix + '-' + String(dept.counter).padStart(3, '0');
      const tok = {
        id: `tok_${s.dId}_${dept.counter}`,
        number: num,
        hospitalId: s.hId,
        departmentId: s.dId,
        patientName: s.name,
        age: s.age,
        gender: s.gender,
        phone: s.phone,
        status: s.status,
        createdAt: Date.now() - (dept.counter * 180000),
        resolvedAt: null,
      };
      TOKENS[tok.id] = tok;
      if (s.status === 'called') {
        dept.currentTokenId = tok.id;
      } else {
        dept.queue.push(tok.id);
      }
    }
  });
}

/* ================= STATE ================= */

const state = {
  activeView: 'home',
  viewHistory: [],
  currentHospitalId: null,
  tokenFormContext: null,
  myToken: null, // { id, hospitalId, departmentId }
  staff: {
    loggedIn: localStorage.getItem('opd_staff_logged_in') === 'true',
    activeTab: 'reception',
    queueMgmt: { hospitalId: null, departmentId: null },
    bedMgmt: { hospitalId: null },
    admin: { hospitalId: 'all' },
  },
  modalBed: null,
  pendingConfirm: null,
};

/* ================= RENDER: shared bits ================= */

function statusBadge(status) {
  const map = {
    pending_approval: 'Awaiting Approval',
    waiting: 'Waiting', called: 'Called', completed: 'Completed',
    skipped: 'Skipped', noshow: 'No-show', rejected: 'Rejected',
    available: 'Available', occupied: 'Occupied', cleaning: 'Cleaning', maintenance: 'Maintenance',
  };
  const label = map[status] || status;
  return `<span class="badge badge-${status}">${label}</span>`;
}

function renderQueueTrail(dept, opts) {
  opts = opts || {};
  const items = [];
  if (dept.currentTokenId) {
    const t = getToken(dept.currentTokenId);
    if (t) items.push({ token: t, current: true });
  }
  dept.queue.forEach(id => {
    const t = getToken(id);
    if (t) items.push({ token: t, current: false });
  });
  if (!items.length) return '<div class="trail-empty">No patients currently in this queue.</div>';

  const MAX = 10;
  const shown = items.slice(0, MAX);
  const extra = items.length - shown.length;
  const pills = shown.map(it => {
    const cls = ['trail-pill'];
    if (it.current) cls.push('is-current');
    if (opts.highlightTokenId && it.token.id === opts.highlightTokenId) cls.push('is-me');
    return `<span class="${cls.join(' ')}" title="${escapeHtml(it.token.patientName)}">${escapeHtml(it.token.number)}</span>`;
  }).join('<span class="trail-arrow">→</span>');
  const extraHtml = extra > 0 ? `<span class="trail-arrow">→</span><span class="trail-pill">+${extra}</span>` : '';
  return `<div class="queue-trail">${pills}${extraHtml}</div>`;
}

/* ================= RENDER: patient portal ================= */

function renderHospitalList() {
  const el = document.getElementById('hospital-list');
  el.innerHTML = HOSPITALS.map(h => {
    const stats = hospitalStats(h);
    return `
      <div class="hospital-card">
        <h3>${escapeHtml(h.name)}</h3>
        <p class="location">${escapeHtml(h.location)}</p>
        <div class="stat-row">
          <span>Waiting: <strong>${stats.totalWaiting}</strong></span>
          <span>Avg wait: <strong>${formatWait(stats.avgWait)}</strong></span>
          <span>Depts: <strong>${h.departments.length}</strong></span>
        </div>
        <button class="btn btn-primary" data-action="view-hospital" data-hospital-id="${h.id}">View Hospital</button>
      </div>`;
  }).join('');
}

function renderHospitalDetail() {
  const hospital = getHospital(state.currentHospitalId);
  if (!hospital) return;
  const stats = hospitalStats(hospital);

  document.getElementById('hospital-detail-header').innerHTML = `
    <h2>${escapeHtml(hospital.name)}</h2>
    <p class="location">${escapeHtml(hospital.location)}</p>
    <div class="hospital-summary-row">
      <div class="summary-stat"><span class="num">${stats.totalWaiting}</span><span class="lbl">Patients waiting</span></div>
      <div class="summary-stat"><span class="num">${formatWait(stats.avgWait)}</span><span class="lbl">Avg. wait</span></div>
      <div class="summary-stat"><span class="num">${hospital.departments.length}</span><span class="lbl">Departments</span></div>
    </div>`;

  document.getElementById('department-list').innerHTML = hospital.departments.map(d => {
    const size = d.queue.length + (d.currentTokenId ? 1 : 0);
    const wait = estimateWaitMinutes(d, size);
    const nowServing = d.currentTokenId ? getToken(d.currentTokenId).number : '—';
    return `
      <div class="department-card">
        <h3>${escapeHtml(d.name)}</h3>
        <div class="stat-row"><span>Now serving: <strong>${escapeHtml(nowServing)}</strong></span></div>
        <div class="stat-row">
          <span>Waiting: <strong>${size}</strong></span>
          <span>Est. wait: <strong>${formatWait(wait)}</strong></span>
          <span>Counters: <strong>${d.numCounters || 1}</strong></span>
        </div>
        ${renderQueueTrail(d)}
        <button class="btn btn-primary" data-action="get-token" data-hospital-id="${hospital.id}" data-department-id="${d.id}">Get Token</button>
      </div>`;
  }).join('');
}

function renderTokenForm() {
  const ctx = state.tokenFormContext;
  const hospital = getHospital(ctx.hospitalId);
  const deptSelect = document.getElementById('tf-department');
  deptSelect.innerHTML = hospital.departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  document.getElementById('token-form').reset();
  deptSelect.value = ctx.departmentId;
  document.getElementById('tf-context').textContent = `${hospital.name} — fill in the patient's details below.`;
  document.getElementById('tf-error').classList.add('hidden');
}

function renderTokenResult(token) {
  const dept = getDept(token.hospitalId, token.departmentId);
  const hospital = getHospital(token.hospitalId);
  const pos = tokenPositionInfo(token);

  const titleEl = document.getElementById('token-result-title');
  const subEl = document.getElementById('token-result-sub');

  if (token.status === 'pending_approval') {
    if (titleEl) titleEl.textContent = 'Request Under Review';
    if (subEl) subEl.textContent = 'Your OPD ticket request is awaiting approval from the reception desk.';
    document.getElementById('token-result-card').innerHTML = `
      <div class="tb-label">Approval Status</div>
      <div class="tb-number" style="font-size:1.8rem; margin:15px 0; color:var(--warning);">⏳ AWAITING APPROVAL</div>
      <div class="tb-dept">${escapeHtml(dept ? dept.name : 'Department')} · ${escapeHtml(hospital ? hospital.name : 'Hospital')}</div>
      <div style="margin-top:16px; padding:12px 14px; background:var(--surface); border:1px dashed var(--border); border-radius:var(--radius-sm); font-size:0.9rem; color:var(--text); text-align:center;">
        Your details have been submitted to reception. Once staff approves your request, your official token number will appear here automatically via real-time update!
      </div>
      <div class="tb-qr">PATIENT<br>${escapeHtml(token.patientName)}</div>`;
    return;
  }

  if (token.status === 'rejected') {
    if (titleEl) titleEl.textContent = 'Request Rejected';
    if (subEl) subEl.textContent = 'The hospital reception could not approve this request.';
    document.getElementById('token-result-card').innerHTML = `
      <div class="tb-label">Status</div>
      <div class="tb-number" style="font-size:1.8rem; margin:15px 0; color:var(--danger);">✕ REJECTED</div>
      <div class="tb-dept">${escapeHtml(dept ? dept.name : 'Department')} · ${escapeHtml(hospital ? hospital.name : 'Hospital')}</div>
      <div style="margin-top:16px; padding:12px 14px; background:var(--danger-bg); color:var(--danger); border-radius:var(--radius-sm); font-size:0.9rem; text-align:center;">
        <strong>Reason:</strong> ${escapeHtml(token.rejectionReason || 'Department capacity exceeded / please visit reception')}
      </div>`;
    return;
  }

  if (titleEl) titleEl.textContent = "You're in the queue";
  if (subEl) subEl.textContent = 'Your token is active. Track your position in real time.';
  document.getElementById('token-result-card').innerHTML = `
    <div class="tb-label">Your Token</div>
    <div class="tb-number">${escapeHtml(token.number)}</div>
    <div class="tb-dept">${escapeHtml(dept ? dept.name : 'Department')} · ${escapeHtml(hospital ? hospital.name : 'Hospital')}</div>
    <div class="tb-meta">
      <div><span class="m-num">${pos.ahead ?? 0}</span><span class="m-lbl">Patients ahead</span></div>
      <div><span class="m-num">${formatWait(pos.wait ?? 0)}</span><span class="m-lbl">Est. wait</span></div>
    </div>
    <div class="tb-qr">TOKEN<br>${escapeHtml(token.number)}</div>`;
}

function renderLiveTracker() {
  const container = document.getElementById('live-tracker-content');
  if (!state.myToken) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎫</div>
        <p>You don't have an active token yet.</p>
        <button class="btn btn-primary" data-nav="patient-portal" style="margin-top:14px;">Get a Token</button>
      </div>`;
    return;
  }
  const token = getToken(state.myToken.id);
  if (!token) { container.innerHTML = '<div class="empty-state">Token not found.</div>'; return; }
  const dept = getDept(token.hospitalId, token.departmentId);
  const hospital = getHospital(token.hospitalId);
  const pos = tokenPositionInfo(token);
  const nowServing = dept && dept.currentTokenId ? getToken(dept.currentTokenId).number : '—';

  let statusText = '—', statusColor = 'var(--text)';
  if (token.status === 'pending_approval') {
    statusText = 'Awaiting Reception Approval'; statusColor = 'var(--warning)';
  } else if (token.status === 'waiting') {
    statusText = pos.ahead <= 1 ? 'Approaching — get ready' : 'In queue';
  } else if (token.status === 'called') {
    statusText = 'Called — please proceed to the counter'; statusColor = 'var(--warning)';
  } else if (token.status === 'completed') {
    statusText = 'Visit completed'; statusColor = 'var(--success)';
  } else if (token.status === 'skipped') {
    statusText = 'Skipped — please check in at reception'; statusColor = 'var(--muted)';
  } else if (token.status === 'noshow') {
    statusText = 'Marked as no-show — please check in at reception'; statusColor = 'var(--danger)';
  } else if (token.status === 'rejected') {
    statusText = 'Request Rejected'; statusColor = 'var(--danger)';
  }

  const isFinal = ['completed', 'skipped', 'noshow', 'rejected'].includes(token.status);

  container.innerHTML = `
    <div class="tracker-status">
      <div class="status-big" style="color:${statusColor}">${statusText}</div>
      <div class="section-sub" style="margin-bottom:0;">${escapeHtml(token.number || 'Pending')} · ${escapeHtml(dept ? dept.name : 'Department')} · ${escapeHtml(hospital ? hospital.name : 'Hospital')}</div>
    </div>
    <div class="tracker-grid">
      <div class="tracker-metric"><span class="num">${escapeHtml(nowServing)}</span><span class="lbl">Now serving</span></div>
      <div class="tracker-metric"><span class="num">${escapeHtml(token.number || 'Pending')}</span><span class="lbl">Your token</span></div>
      <div class="tracker-metric"><span class="num">${pos.ahead !== null ? pos.ahead : '—'}</span><span class="lbl">Patients ahead</span></div>
      <div class="tracker-metric"><span class="num">${pos.wait !== null ? formatWait(pos.wait) : '—'}</span><span class="lbl">Est. wait</span></div>
    </div>
    <h3 class="section-heading">Queue Order</h3>
    ${dept ? renderQueueTrail(dept, { highlightTokenId: token.id }) : ''}
    ${isFinal ? '<button class="btn btn-outline btn-block" data-nav="patient-portal" style="margin-top:18px;">Get a New Token</button>' : ''}`;
}

/* ================= RENDER: staff ================= */

function populateHospitalSelect(selectEl, includeAllOption) {
  let html = includeAllOption ? '<option value="all">All Hospitals</option>' : '';
  html += HOSPITALS.map(h => `<option value="${h.id}">${escapeHtml(h.name)}</option>`).join('');
  selectEl.innerHTML = html;
}
function populateDepartmentSelect(selectEl, hospitalId) {
  const hospital = getHospital(hospitalId);
  selectEl.innerHTML = hospital.departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
}

async function renderPendingTokens() {
  const el = document.getElementById('pending-tokens-list');
  const badgeEl = document.getElementById('pa-count-badge');
  if (!el) return;

  let pending = [];
  if (BACKEND_ACTIVE) {
    try {
      const res = await fetch(`${API_BASE}/tokens/pending`);
      if (res.ok) {
        pending = await res.json();
      }
    } catch (e) {
      console.warn('Failed to fetch pending tokens:', e);
    }
  } else {
    pending = Object.values(TOKENS).filter(t => t.status === 'pending_approval');
  }

  if (badgeEl) badgeEl.textContent = pending.length;

  if (!pending.length) {
    el.innerHTML = '<div class="empty-row">No pending token requests at this time.</div>';
    return;
  }

  el.innerHTML = pending.map(t => {
    const hospId = t.hospitalId || t.hospital_id;
    const deptId = t.departmentId || t.department_id;
    const hospital = getHospital(hospId);
    const dept = getDept(hospId, deptId);
    const deptName = dept ? dept.name : 'Department';
    const hospName = hospital ? hospital.name : 'Hospital';
    return `
      <div class="token-row">
        <div class="tr-left">
          <span class="tr-name"><strong>${escapeHtml(t.patientName || t.patient_name)}</strong></span>
          <span class="tr-meta">${escapeHtml(deptName)} · ${escapeHtml(hospName)} · Age: ${t.age}, ${escapeHtml(t.gender)} · 📞 ${escapeHtml(t.phone)}</span>
        </div>
        <div class="token-actions" style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-primary btn-sm" data-action="approve-token" data-token-id="${t.id}" style="font-size:0.82rem; padding:6px 14px;">✓ Approve</button>
          <button class="btn btn-outline btn-sm" data-action="reject-token" data-token-id="${t.id}" style="font-size:0.82rem; padding:6px 12px; color:var(--danger); border-color:var(--danger);">✕ Reject</button>
        </div>
      </div>`;
  }).join('');
}

async function approveToken(tokenId) {
  showLoadingOverlay('Approving token…');
  if (BACKEND_ACTIVE) {
    try {
      const res = await fetch(`${API_BASE}/tokens/${tokenId}/approve`, { method: 'POST' });
      if (res.ok) {
        const approved = await res.json();
        await syncFromBackend();
        hideLoadingOverlay();
        renderPendingTokens();
        renderTodaysTokens();
        renderQueueMgmt();
        showToast(`Approved! Token ${approved.number} issued to ${approved.patient_name}.`, 'success');
        return;
      } else {
        const err = await res.json();
        hideLoadingOverlay();
        showToast(err.detail || 'Could not approve token.', 'warning');
        return;
      }
    } catch (e) {
      console.error('Approve token error:', e);
    }
  }

  setTimeout(() => {
    const t = getToken(tokenId);
    if (t) {
      const dept = getDept(t.hospitalId, t.departmentId);
      dept.counter += 1;
      t.number = dept.prefix + '-' + String(dept.counter).padStart(3, '0');
      t.status = 'waiting';
      dept.queue.push(t.id);
    }
    hideLoadingOverlay();
    renderPendingTokens();
    renderTodaysTokens();
    renderQueueMgmt();
    showToast('Token approved.', 'success');
  }, 300);
}

async function rejectToken(tokenId, reason) {
  showLoadingOverlay('Rejecting request…');
  if (BACKEND_ACTIVE) {
    try {
      const res = await fetch(`${API_BASE}/tokens/${tokenId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'Department at capacity' }),
      });
      if (res.ok) {
        await syncFromBackend();
        hideLoadingOverlay();
        renderPendingTokens();
        renderTodaysTokens();
        showToast('Token request rejected.', 'info');
        return;
      } else {
        const err = await res.json();
        hideLoadingOverlay();
        showToast(err.detail || 'Could not reject token.', 'warning');
        return;
      }
    } catch (e) {
      console.error('Reject token error:', e);
    }
  }

  setTimeout(() => {
    const t = getToken(tokenId);
    if (t) {
      t.status = 'rejected';
      t.rejectionReason = reason;
    }
    hideLoadingOverlay();
    renderPendingTokens();
    renderTodaysTokens();
    showToast('Token request rejected.', 'info');
  }, 300);
}

function renderTodaysTokens() {
  const el = document.getElementById('todays-tokens-list');
  const all = Object.values(TOKENS)
    .filter(t => t.status !== 'pending_approval')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 25);

  if (!all.length) { el.innerHTML = '<div class="empty-row">No active tokens generated yet.</div>'; return; }
  el.innerHTML = all.map(t => {
    const hospital = getHospital(t.hospitalId);
    const dept = getDept(t.hospitalId, t.departmentId);
    return `
      <div class="token-row">
        <div class="tr-left">
          <span class="tr-num">${escapeHtml(t.number || '—')}</span>
          <span class="tr-name">${escapeHtml(t.patientName)}</span>
          <span class="tr-meta">${escapeHtml(dept ? dept.name : 'Department')} · ${escapeHtml(hospital ? hospital.name : 'Hospital')}</span>
        </div>
        ${statusBadge(t.status)}
      </div>`;
  }).join('');
}

function renderQueueMgmt() {
  const hospitalId = document.getElementById('qm-hospital').value;
  const departmentId = document.getElementById('qm-department').value;
  const dept = getDept(hospitalId, departmentId);
  if (!dept) return;
  state.staff.queueMgmt = { hospitalId, departmentId };

  const nowServingEl = document.getElementById('qm-now-serving');
  if (dept.currentTokenId) {
    const t = getToken(dept.currentTokenId);
    nowServingEl.innerHTML = `
      <div class="ns-head">
        <div>
          <div class="section-sub" style="margin-bottom:4px;">Now serving</div>
          <span class="ns-token">${escapeHtml(t.number)}</span>
        </div>
        <div class="ns-info">
          <div><strong>${escapeHtml(t.patientName)}</strong> · ${escapeHtml(t.age)}y, ${escapeHtml(t.gender)}</div>
          <div>${escapeHtml(t.phone)}</div>
        </div>
      </div>
      <div class="ns-actions">
        <button class="btn btn-primary" data-action="complete-token">✓ Complete</button>
        <button class="btn btn-outline" data-action="skip-token">Skip</button>
        <button class="btn btn-outline" data-action="noshow-token">Mark No-Show</button>
      </div>`;
  } else {
    nowServingEl.innerHTML = `
      <p class="ns-empty">No patient currently being served.</p>
      <div class="ns-actions">
        <button class="btn btn-primary" data-action="call-next" data-hospital-id="${hospitalId}" data-department-id="${departmentId}" ${dept.queue.length === 0 ? 'disabled' : ''}>Call Next</button>
      </div>`;
  }

  const listEl = document.getElementById('qm-queue-list');
  listEl.innerHTML = dept.queue.length
    ? dept.queue.map((tid, idx) => {
        const t = getToken(tid);
        const ahead = idx + (dept.currentTokenId ? 1 : 0);
        return `
          <div class="token-row">
            <div class="tr-left">
              <span class="tr-num">${escapeHtml(t.number)}</span>
              <span class="tr-name">${escapeHtml(t.patientName)}</span>
              <span class="tr-meta">Position ${idx + 1} · ${formatWait(estimateWaitMinutes(dept, ahead))}</span>
            </div>
            ${statusBadge('waiting')}
          </div>`;
      }).join('')
    : '<div class="empty-row">The waiting queue is empty.</div>';

  const recentEl = document.getElementById('qm-recent');
  const recent = Object.values(TOKENS)
    .filter(t => t.hospitalId === hospitalId && t.departmentId === departmentId && ['completed', 'skipped', 'noshow'].includes(t.status))
    .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0))
    .slice(0, 5);
  recentEl.innerHTML = recent.length
    ? recent.map(t => `
        <div class="token-row">
          <div class="tr-left"><span class="tr-num">${escapeHtml(t.number)}</span><span class="tr-name">${escapeHtml(t.patientName)}</span></div>
          ${statusBadge(t.status)}
        </div>`).join('')
    : '<div class="empty-row">No recent activity yet.</div>';
}

function renderBedGrid() {
  const hospitalId = document.getElementById('bed-hospital').value;
  state.staff.bedMgmt.hospitalId = hospitalId;
  const hospital = getHospital(hospitalId);
  document.getElementById('bed-grid').innerHTML = hospital.beds.map(b => `
    <button class="bed-card bed-${b.status}" data-action="open-bed-modal" data-hospital-id="${hospitalId}" data-bed-id="${b.id}">
      <span class="bed-num">Bed ${b.number}</span>
      ${statusBadge(b.status)}
      ${b.status === 'occupied' && b.patientName ? `<span class="bed-patient">${escapeHtml(b.patientName)}</span>` : ''}
    </button>`).join('');
}

async function renderAdminStats() {
  const scope = document.getElementById('admin-hospital').value;
  state.staff.admin.hospitalId = scope;

  if (BACKEND_ACTIVE) {
    try {
      const [statsRes, alertsRes] = await Promise.all([
        fetch(`${API_BASE}/admin/stats?scope=${encodeURIComponent(scope)}`),
        fetch(`${API_BASE}/admin/alerts${scope !== 'all' ? `?hospital_id=${encodeURIComponent(scope)}` : ''}`),
      ]);
      if (statsRes.ok && alertsRes.ok) {
        const stats = await statsRes.json();
        const alerts = await alertsRes.json();

        let alertsHtml = '';
        if (alerts && alerts.length) {
          const cards = alerts.map(a => `
            <div class="alert-card alert-${a.severity}">
              <div class="alert-left">
                <div class="alert-title">${escapeHtml(a.department_name)} · ${escapeHtml(a.hospital_name)}</div>
                <div class="alert-msg">${escapeHtml(a.message)}</div>
                <div class="alert-meta">Queue: ${a.current_queue_len} / ${a.capacity_threshold} | Net growth: ${a.net_growth_per_hour > 0 ? '+' : ''}${a.net_growth_per_hour}/hr${a.eta_hours !== null ? ` | ETA to overflow: ~${a.eta_hours}h` : ''}</div>
              </div>
              <span class="badge badge-${a.severity}">${a.severity.toUpperCase()}</span>
            </div>
          `).join('');
          alertsHtml = `
            <div class="alerts-section" style="margin-top:28px;">
              <h3 style="margin-bottom:4px;">Predictive Capacity Alerts</h3>
              <p class="section-sub" style="margin-bottom:12px;">Analytical M/M/c arrival rate vs service rate projection (early warning)</p>
              <div class="alert-list">${cards}</div>
            </div>`;
        }

        document.getElementById('admin-stats').innerHTML = `
          <div class="stat-cards">
            <div class="stat-card"><span class="sc-num">${stats.total_waiting}</span><span class="sc-lbl">Patients waiting</span></div>
            <div class="stat-card"><span class="sc-num">${formatWait(stats.avg_wait_minutes)}</span><span class="sc-lbl">Average wait time</span></div>
            <div class="stat-card"><span class="sc-num">${stats.available_beds} / ${stats.total_beds}</span><span class="sc-lbl">Beds available</span></div>
            <div class="stat-card"><span class="sc-num">${stats.busiest_department ? escapeHtml(stats.busiest_department) : '—'}</span><span class="sc-lbl">Busiest department</span></div>
            <div class="stat-card"><span class="sc-num">${stats.avg_utilization}</span><span class="sc-lbl">Traffic intensity (ρ)</span></div>
          </div>
          <div class="bed-bar-wrap">
            <h3 style="margin-bottom:2px;">Bed Occupancy</h3>
            <div class="bed-bar-track"><div class="bed-bar-fill" style="width:${stats.occupied_pct}%"></div></div>
            <div class="bed-bar-legend"><span>${stats.occupied_beds} occupied</span><span>${stats.occupied_pct}%</span><span>${stats.available_beds} available</span></div>
          </div>
          ${alertsHtml}`;
        return;
      }
    } catch (e) {
      console.error('Failed to load admin stats from API:', e);
    }
  }

  const hospitals = scope === 'all' ? HOSPITALS : [getHospital(scope)];

  let totalWaiting = 0, waitSum = 0, waitCount = 0, totalBeds = 0, occupiedBeds = 0, busiest = null;

  hospitals.forEach(h => {
    if (!h) return;
    h.departments.forEach(d => {
      const size = d.queue.length + (d.currentTokenId ? 1 : 0);
      totalWaiting += size;
      d.queue.forEach((tid, idx) => {
        waitSum += estimateWaitMinutes(d, idx + (d.currentTokenId ? 1 : 0));
        waitCount++;
      });
      if (!busiest || size > busiest.size) busiest = { name: d.name, hospital: h.name, size };
    });
    h.beds.forEach(b => { totalBeds++; if (b.status === 'occupied') occupiedBeds++; });
  });

  const avgWait = waitCount ? Math.round(waitSum / waitCount) : 0;
  const availableBeds = totalBeds - occupiedBeds;
  const occupiedPct = totalBeds ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  document.getElementById('admin-stats').innerHTML = `
    <div class="stat-cards">
      <div class="stat-card"><span class="sc-num">${totalWaiting}</span><span class="sc-lbl">Patients waiting</span></div>
      <div class="stat-card"><span class="sc-num">${formatWait(avgWait)}</span><span class="sc-lbl">Average wait time</span></div>
      <div class="stat-card"><span class="sc-num">${availableBeds} / ${totalBeds}</span><span class="sc-lbl">Beds available</span></div>
      <div class="stat-card"><span class="sc-num">${busiest ? escapeHtml(busiest.name) : '—'}</span><span class="sc-lbl">Busiest department${busiest ? ' · ' + escapeHtml(busiest.hospital) : ''}</span></div>
    </div>
    <div class="bed-bar-wrap">
      <h3 style="margin-bottom:2px;">Bed Occupancy</h3>
      <div class="bed-bar-track"><div class="bed-bar-fill" style="width:${occupiedPct}%"></div></div>
      <div class="bed-bar-legend"><span>${occupiedBeds} occupied</span><span>${occupiedPct}%</span><span>${availableBeds} available</span></div>
    </div>`;
}

/* ================= NAVIGATION & AUTH ================= */

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

async function checkStaffAuth() {
  if (BACKEND_ACTIVE) {
    try {
      const res = await fetch(`${API_BASE}/auth/me`);
      if (res.ok) {
        const data = await res.json();
        state.staff.loggedIn = Boolean(data.authenticated);
        if (state.staff.loggedIn) {
          localStorage.setItem('opd_staff_logged_in', 'true');
        } else {
          localStorage.removeItem('opd_staff_logged_in');
        }
        updateStaffNavUI();
        return state.staff.loggedIn;
      }
    } catch (e) {
      console.warn('Auth check error:', e);
    }
  }
  const hasCookie = Boolean(getCookie('opd_staff_session'));
  const hasLocal = localStorage.getItem('opd_staff_logged_in') === 'true';
  state.staff.loggedIn = hasCookie || hasLocal;
  updateStaffNavUI();
  return state.staff.loggedIn;
}

function updateStaffNavUI() {
  const staffNavBtns = document.querySelectorAll('[data-nav="staff-entry"], [data-nav="staff-dashboard"]');
  staffNavBtns.forEach(btn => {
    if (state.staff.loggedIn) {
      btn.dataset.nav = 'staff-dashboard';
      if (btn.classList.contains('nav-link')) {
        btn.textContent = 'Staff Dashboard';
      } else if (btn.classList.contains('btn')) {
        btn.textContent = 'Staff Dashboard →';
      }
    } else {
      btn.dataset.nav = 'staff-entry';
      if (btn.classList.contains('nav-link')) {
        btn.textContent = 'Staff Portal';
      } else if (btn.classList.contains('btn')) {
        btn.textContent = 'Staff Login';
      }
    }
  });
}

function navigateTo(viewId, opts) {
  opts = opts || {};
  if (viewId === 'staff-entry' && state.staff.loggedIn) {
    viewId = 'staff-dashboard';
  }
  if (viewId === 'staff-dashboard' && !state.staff.loggedIn) {
    viewId = 'staff-entry';
  }
  const target = document.getElementById(viewId);
  if (!target) return;
  if (!opts.isBack && state.activeView !== viewId) state.viewHistory.push(state.activeView);
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  target.classList.add('active');
  state.activeView = viewId;
  localStorage.setItem('opd_active_view', viewId);

  try {
    if (viewId === 'staff-dashboard') {
      if (window.location.pathname !== '/staff') history.replaceState(null, '', '/staff');
    } else if (viewId === 'staff-entry') {
      if (window.location.pathname !== '/staff/login') history.replaceState(null, '', '/staff/login');
    } else if (viewId === 'patient-portal') {
      if (window.location.pathname !== '/patient') history.replaceState(null, '', '/patient');
    } else if (viewId === 'home') {
      if (window.location.pathname !== '/') history.replaceState(null, '', '/');
    } else {
      if (window.location.hash !== '#' + viewId) history.replaceState(null, '', '#' + viewId);
    }
  } catch (e) {}

  if (viewId === 'home') state.viewHistory = [];
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateStaffNavUI();
  renderCurrentView();
}
function goBack() { navigateTo(state.viewHistory.pop() || 'home', { isBack: true }); }

function renderCurrentView() {
  switch (state.activeView) {
    case 'patient-portal': renderHospitalList(); break;
    case 'hospital-detail': renderHospitalDetail(); break;
    case 'live-tracker': renderLiveTracker(); break;
    case 'staff-dashboard':
      renderPendingTokens();
      renderTodaysTokens();
      if (state.staff.activeTab === 'queue-mgmt') renderQueueMgmt();
      if (state.staff.activeTab === 'bed-mgmt') renderBedGrid();
      if (state.staff.activeTab === 'admin') renderAdminStats();
      break;
  }
}

/* ================= UI HELPERS ================= */

function showToast(message, type) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type || 'info'}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 200ms ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, 3400);
}

function showLoadingOverlay(text) {
  document.getElementById('loading-text').textContent = text || 'Loading…';
  document.getElementById('loading-overlay').classList.remove('hidden');
}
function hideLoadingOverlay() { document.getElementById('loading-overlay').classList.add('hidden'); }

function setBtnBusy(btn, busy) {
  const spinner = btn.querySelector('.btn-spinner');
  btn.disabled = busy;
  if (spinner) spinner.classList.toggle('hidden', !busy);
}

function showConfirm(message, onYes) {
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-modal').classList.remove('hidden');
  state.pendingConfirm = onYes;
  document.getElementById('confirm-no').focus();
}
function hideConfirm() {
  document.getElementById('confirm-modal').classList.add('hidden');
  state.pendingConfirm = null;
}

/* ================= STAFF ACTIONS ================= */

async function callNextToken(hospitalId, departmentId) {
  const dept = getDept(hospitalId, departmentId);
  if (!dept) return;

  showLoadingOverlay('Updating queue…');

  if (BACKEND_ACTIVE) {
    try {
      const res = await fetch(`${API_BASE}/departments/${departmentId}/call-next`, { method: 'POST' });
      if (res.ok) {
        const nextTok = await res.json();
        TOKENS[nextTok.id] = {
          ...TOKENS[nextTok.id],
          status: 'called',
          calledAt: Date.now(),
        };
        dept.currentTokenId = nextTok.id;
        await syncFromBackend();
        hideLoadingOverlay();
        renderQueueMgmt();
        showToast(`Now calling ${nextTok.number}`, 'info');
        return;
      } else {
        const err = await res.json();
        hideLoadingOverlay();
        showToast(err.detail || 'Could not call next patient.', 'warning');
        return;
      }
    } catch (e) {
      console.error('API call-next error:', e);
    }
  }

  setTimeout(() => {
    if (dept.currentTokenId || !dept.queue.length) {
      hideLoadingOverlay();
      return;
    }
    const nextId = dept.queue.shift();
    dept.currentTokenId = nextId;
    getToken(nextId).status = 'called';
    hideLoadingOverlay();
    renderQueueMgmt();
    showToast(`Now calling ${getToken(nextId).number}`, 'info');
  }, 350);
}

async function resolveCurrentToken(hospitalId, departmentId, newStatus, toastMsg) {
  const dept = getDept(hospitalId, departmentId);
  if (!dept) return;

  showLoadingOverlay('Updating queue…');

  if (BACKEND_ACTIVE) {
    try {
      const res = await fetch(`${API_BASE}/departments/${departmentId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        dept.currentTokenId = null;
        await syncFromBackend();
        hideLoadingOverlay();
        renderQueueMgmt();
        showToast(toastMsg, newStatus === 'completed' ? 'success' : 'info');
        return;
      } else {
        const err = await res.json();
        hideLoadingOverlay();
        showToast(err.detail || 'Could not resolve patient.', 'warning');
        return;
      }
    } catch (e) {
      console.error('API resolve error:', e);
    }
  }

  setTimeout(() => {
    if (!dept.currentTokenId) {
      hideLoadingOverlay();
      return;
    }
    const t = getToken(dept.currentTokenId);
    t.status = newStatus;
    t.resolvedAt = Date.now();
    if (newStatus === 'completed') dept.completedCount = (dept.completedCount || 0) + 1;
    dept.currentTokenId = null;
    hideLoadingOverlay();
    renderQueueMgmt();
    showToast(toastMsg, newStatus === 'completed' ? 'success' : 'info');
  }, 350);
}

function openBedModal(hospitalId, bedId) {
  const hospital = getHospital(hospitalId);
  const bed = hospital.beds.find(b => b.id === bedId);
  if (!bed) return;
  state.modalBed = { hospitalId, bedId };
  document.getElementById('bed-modal-title').textContent = `Bed ${bed.number}`;
  document.getElementById('bed-modal-current').textContent =
    `Current status: ${capitalize(bed.status)}${bed.patientName ? ' · ' + bed.patientName : ''}`;
  document.getElementById('bed-status-select').value = bed.status;
  document.getElementById('bed-patient-name').value = bed.patientName || '';
  toggleBedPatientField();
  document.getElementById('bed-modal').classList.remove('hidden');
  document.getElementById('bed-status-select').focus();
}
function closeBedModal() {
  document.getElementById('bed-modal').classList.add('hidden');
  state.modalBed = null;
}
function toggleBedPatientField() {
  const status = document.getElementById('bed-status-select').value;
  document.getElementById('bed-patient-field').style.display = status === 'occupied' ? 'flex' : 'none';
}

async function saveBedChanges() {
  if (!state.modalBed) return;
  const { hospitalId, bedId } = state.modalBed;
  const newStatus = document.getElementById('bed-status-select').value;
  const patientName = document.getElementById('bed-patient-name').value.trim();
  showLoadingOverlay('Updating bed status…');

  if (BACKEND_ACTIVE) {
    try {
      const res = await fetch(`${API_BASE}/beds/${bedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, patient_name: patientName }),
      });
      if (res.ok) {
        await syncFromBackend();
        hideLoadingOverlay();
        closeBedModal();
        renderBedGrid();
        showToast(`Bed updated to ${capitalize(newStatus)}.`, 'success');
        return;
      }
    } catch (e) {
      console.error('API save bed error:', e);
    }
  }

  setTimeout(() => {
    const bed = getHospital(hospitalId).beds.find(b => b.id === bedId);
    if (bed) {
      bed.status = newStatus;
      bed.patientName = newStatus === 'occupied' ? (patientName || 'Unnamed patient') : '';
    }
    hideLoadingOverlay();
    closeBedModal();
    renderBedGrid();
    showToast(`Bed updated to ${capitalize(newStatus)}.`, 'success');
  }, 350);
}

async function releaseBed() {
  if (!state.modalBed) return;
  const { hospitalId, bedId } = state.modalBed;
  showLoadingOverlay('Updating bed status…');

  if (BACKEND_ACTIVE) {
    try {
      const res = await fetch(`${API_BASE}/beds/${bedId}/release`, { method: 'POST' });
      if (res.ok) {
        await syncFromBackend();
        hideLoadingOverlay();
        closeBedModal();
        renderBedGrid();
        showToast('Bed released and marked available.', 'success');
        return;
      }
    } catch (e) {
      console.error('API release bed error:', e);
    }
  }

  setTimeout(() => {
    const bed = getHospital(hospitalId).beds.find(b => b.id === bedId);
    if (bed) {
      bed.status = 'available';
      bed.patientName = '';
    }
    hideLoadingOverlay();
    closeBedModal();
    renderBedGrid();
    showToast('Bed released and marked available.', 'success');
  }, 350);
}

/* ================= ACTION DISPATCH ================= */

function handleAction(el) {
  const a = el.dataset.action;
  if (a === 'view-hospital') {
    state.currentHospitalId = el.dataset.hospitalId;
    navigateTo('hospital-detail');
  } else if (a === 'get-token') {
    state.tokenFormContext = { hospitalId: el.dataset.hospitalId, departmentId: el.dataset.departmentId };
    navigateTo('token-form-view');
    renderTokenForm();
  } else if (a === 'track-token') {
    navigateTo('live-tracker');
  } else if (a === 'staff-logout') {
    showConfirm('Log out of the staff portal?', async () => {
      if (BACKEND_ACTIVE) {
        try {
          await fetch(`${API_BASE}/auth/staff-logout`, { method: 'POST' });
        } catch (e) {}
      }
      state.staff.loggedIn = false;
      document.cookie = 'opd_staff_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      localStorage.removeItem('opd_staff_logged_in');
      localStorage.removeItem('opd_active_view');
      updateStaffNavUI();
      navigateTo('home');
      showToast('Logged out.', 'info');
    });
  } else if (a === 'call-next') {
    callNextToken(el.dataset.hospitalId, el.dataset.departmentId);
  } else if (a === 'complete-token') {
    resolveCurrentToken(state.staff.queueMgmt.hospitalId, state.staff.queueMgmt.departmentId, 'completed', 'Marked as completed.');
  } else if (a === 'skip-token') {
    showConfirm('Skip this token? The patient will need to check in again.', () =>
      resolveCurrentToken(state.staff.queueMgmt.hospitalId, state.staff.queueMgmt.departmentId, 'skipped', 'Token skipped.'));
  } else if (a === 'noshow-token') {
    showConfirm('Mark this token as a no-show?', () =>
      resolveCurrentToken(state.staff.queueMgmt.hospitalId, state.staff.queueMgmt.departmentId, 'noshow', 'Marked as no-show.'));
  } else if (a === 'open-bed-modal') {
    openBedModal(el.dataset.hospitalId, el.dataset.bedId);
  } else if (a === 'close-modal') {
    closeBedModal();
  } else if (a === 'save-bed') {
    saveBedChanges();
  } else if (a === 'release-bed') {
    showConfirm('Release this bed and mark it available?', releaseBed);
  } else if (a === 'approve-token') {
    approveToken(el.dataset.tokenId);
  } else if (a === 'reject-token') {
    showConfirm('Reject this token request?', () => rejectToken(el.dataset.tokenId, 'Department capacity exceeded'));
  } else if (a === 'refresh-pending') {
    renderPendingTokens();
    showToast('Refreshed pending requests.', 'info');
  }
}

/* ================= SIMULATION ================= */

function nextBedStatus(current) {
  if (current === 'available' && Math.random() < 0.12) return 'maintenance';
  const cycle = { available: 'occupied', occupied: 'cleaning', cleaning: 'available', maintenance: 'available' };
  return cycle[current] || 'available';
}

async function simulationTick() {
  if (BACKEND_ACTIVE) {
    try {
      await fetch(`${API_BASE}/simulation/tick`, { method: 'POST' });
      await syncFromBackend();
      renderCurrentView();
      return;
    } catch (e) {
      console.warn('API simulation tick failed:', e);
    }
  }

  // 1. Occasionally add a new patient to a random department queue
  if (Math.random() < 0.5) {
    const hospital = HOSPITALS[Math.floor(Math.random() * HOSPITALS.length)];
    if (hospital && hospital.departments.length) {
      const dept = hospital.departments[Math.floor(Math.random() * hospital.departments.length)];
      if (dept.queue.length < 12) {
        createToken(hospital.id, dept.id, randomName(), randomAge(), randomGender(), randomPhone());
      }
    }
  }

  // 2. Progress queues: call next where idle, occasionally complete current
  HOSPITALS.forEach(hospital => {
    hospital.departments.forEach(dept => {
      if (!dept.currentTokenId && dept.queue.length > 0 && Math.random() < 0.6) {
        const nextId = dept.queue.shift();
        dept.currentTokenId = nextId;
        getToken(nextId).status = 'called';
      } else if (dept.currentTokenId && Math.random() < 0.35) {
        const t = getToken(dept.currentTokenId);
        t.status = 'completed';
        t.resolvedAt = Date.now();
        dept.completedCount = (dept.completedCount || 0) + 1;
        dept.currentTokenId = null;
      }
    });
  });

  // 3. Randomly change a few bed statuses
  HOSPITALS.forEach(hospital => {
    hospital.beds.forEach(bed => {
      if (Math.random() < 0.06) {
        bed.status = nextBedStatus(bed.status);
        bed.patientName = bed.status === 'occupied' ? randomName() : '';
      }
    });
  });

  renderCurrentView();
}

/* ================= INIT ================= */

document.addEventListener('DOMContentLoaded', function () {
  seedData();

  // Populate static selects
  populateHospitalSelect(document.getElementById('reg-hospital'), false);
  populateDepartmentSelect(document.getElementById('reg-department'), HOSPITALS[0].id);
  populateHospitalSelect(document.getElementById('qm-hospital'), false);
  populateDepartmentSelect(document.getElementById('qm-department'), HOSPITALS[0].id);
  populateHospitalSelect(document.getElementById('bed-hospital'), false);
  populateHospitalSelect(document.getElementById('admin-hospital'), true);

  state.staff.queueMgmt = { hospitalId: HOSPITALS[0].id, departmentId: HOSPITALS[0].departments[0].id };
  state.staff.bedMgmt.hospitalId = HOSPITALS[0].id;

  // Delegated navigation + actions
  document.body.addEventListener('click', function (e) {
    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) {
      let target = navBtn.dataset.nav;
      if (target === 'staff-entry' && state.staff.loggedIn) target = 'staff-dashboard';
      navigateTo(target);
      return;
    }
    const backBtn = e.target.closest('[data-back]');
    if (backBtn) { goBack(); return; }
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) { handleAction(actionEl); }
  });

  // Hospital -> department select syncing
  document.getElementById('reg-hospital').addEventListener('change', function () {
    populateDepartmentSelect(document.getElementById('reg-department'), this.value);
  });
  document.getElementById('qm-hospital').addEventListener('change', function () {
    populateDepartmentSelect(document.getElementById('qm-department'), this.value);
    renderQueueMgmt();
  });
  document.getElementById('qm-department').addEventListener('change', renderQueueMgmt);
  document.getElementById('bed-hospital').addEventListener('change', renderBedGrid);
  document.getElementById('admin-hospital').addEventListener('change', renderAdminStats);
  document.getElementById('bed-status-select').addEventListener('change', toggleBedPatientField);

  // Staff tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.staffTab;
      state.staff.activeTab = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.staff-tab').forEach(p => p.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      if (tab === 'reception') { renderPendingTokens(); renderTodaysTokens(); }
      if (tab === 'queue-mgmt') renderQueueMgmt();
      if (tab === 'bed-mgmt') renderBedGrid();
      if (tab === 'admin') renderAdminStats();
    });
  });

  // Patient: token form submit (Request Token for Approval)
  document.getElementById('token-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const name = document.getElementById('tf-name').value.trim();
    const age = document.getElementById('tf-age').value;
    const gender = document.getElementById('tf-gender').value;
    const phone = document.getElementById('tf-phone').value.trim();
    const departmentId = document.getElementById('tf-department').value;
    const errorEl = document.getElementById('tf-error');

    if (!name || !age || Number(age) <= 0 || Number(age) > 120 || !gender || !phone || !departmentId) {
      errorEl.textContent = 'Please fill in all fields with valid details to continue.';
      errorEl.classList.remove('hidden');
      return;
    }
    errorEl.classList.add('hidden');

    const submitBtn = document.getElementById('tf-submit');
    setBtnBusy(submitBtn, true);
    showLoadingOverlay('Submitting token request…');

    const hospitalId = state.tokenFormContext.hospitalId;

    if (BACKEND_ACTIVE) {
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
        if (res.ok) {
          const token = await res.json();
          TOKENS[token.id] = {
            id: token.id,
            number: token.number || 'PENDING',
            hospitalId: token.hospital_id,
            departmentId: token.department_id,
            patientName: token.patient_name,
            age: token.age,
            gender: token.gender,
            phone: token.phone,
            status: token.status,
            createdAt: new Date(token.created_at).getTime(),
            ahead: token.ahead,
            wait: token.wait_minutes,
          };
          state.myToken = { id: token.id, hospitalId, departmentId };
          await syncFromBackend();
          hideLoadingOverlay();
          setBtnBusy(submitBtn, false);
          renderTokenResult(token);
          navigateTo('token-result');
          showToast('Request submitted! Awaiting staff approval.', 'info');
          return;
        }
      } catch (err) {
        console.error('API request token error:', err);
      }
    }

    setTimeout(() => {
      const token = {
        id: uid('req'),
        number: 'PENDING',
        hospitalId, departmentId,
        patientName: name, age: Number(age), gender, phone,
        status: 'pending_approval',
        createdAt: Date.now(),
      };
      TOKENS[token.id] = token;
      state.myToken = { id: token.id, hospitalId, departmentId };
      hideLoadingOverlay();
      setBtnBusy(submitBtn, false);
      renderTokenResult(token);
      navigateTo('token-result');
      showToast('Request submitted! Awaiting staff approval.', 'info');
    }, 600);
  });

  // Staff: register patient
  document.getElementById('register-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const hospitalId = document.getElementById('reg-hospital').value;
    const departmentId = document.getElementById('reg-department').value;
    const name = document.getElementById('reg-name').value.trim();
    const age = document.getElementById('reg-age').value;
    const gender = document.getElementById('reg-gender').value;
    const phone = document.getElementById('reg-phone').value.trim();
    const errorEl = document.getElementById('reg-error');

    if (!hospitalId || !departmentId || !name || !age || Number(age) <= 0 || Number(age) > 120 || !gender || !phone) {
      errorEl.textContent = 'Please fill in all fields with valid details to register the patient.';
      errorEl.classList.remove('hidden');
      return;
    }
    errorEl.classList.add('hidden');

    const btn = document.getElementById('reg-submit');
    setBtnBusy(btn, true);
    showLoadingOverlay('Issuing token…');

    if (BACKEND_ACTIVE) {
      try {
        const res = await fetch(`${API_BASE}/tokens`, {
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
        if (res.ok) {
          const token = await res.json();
          TOKENS[token.id] = {
            id: token.id,
            number: token.number,
            hospitalId: token.hospital_id,
            departmentId: token.department_id,
            patientName: token.patient_name,
            age: token.age,
            gender: token.gender,
            phone: token.phone,
            status: token.status,
            createdAt: new Date(token.created_at).getTime(),
          };
          await syncFromBackend();
          hideLoadingOverlay();
          setBtnBusy(btn, false);
          document.getElementById('register-form').reset();
          document.getElementById('reg-hospital').value = hospitalId;
          populateDepartmentSelect(document.getElementById('reg-department'), hospitalId);
          renderPendingTokens();
          renderTodaysTokens();
          showToast(`Token generated: ${token.number}`, 'success');
          return;
        }
      } catch (err) {
        console.error('API register error:', err);
      }
    }

    setTimeout(() => {
      const token = createToken(hospitalId, departmentId, name, age, gender, phone);
      hideLoadingOverlay();
      setBtnBusy(btn, false);
      document.getElementById('register-form').reset();
      document.getElementById('reg-hospital').value = hospitalId;
      populateDepartmentSelect(document.getElementById('reg-department'), hospitalId);
      renderPendingTokens();
      renderTodaysTokens();
      showToast(`Token generated: ${token.number}`, 'success');
    }, 600);
  });

  // Staff: login
  document.getElementById('staff-login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const u = document.getElementById('staff-username').value.trim();
    const p = document.getElementById('staff-password').value;
    const errorEl = document.getElementById('staff-login-error');

    if (BACKEND_ACTIVE) {
      try {
        const res = await fetch(`${API_BASE}/auth/staff-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            errorEl.classList.add('hidden');
            state.staff.loggedIn = true;
            localStorage.setItem('opd_staff_logged_in', 'true');
            document.getElementById('staff-login-form').reset();
            navigateTo('staff-dashboard');
            showToast('Welcome back!', 'success');
            return;
          } else {
            errorEl.textContent = data.message || 'Incorrect username or password. Try staff / staff123.';
            errorEl.classList.remove('hidden');
            return;
          }
        }
      } catch (err) {
        console.error('API login error:', err);
      }
    }

    if (u === 'staff' && p === 'staff123') {
      errorEl.classList.add('hidden');
      state.staff.loggedIn = true;
      localStorage.setItem('opd_staff_logged_in', 'true');
      document.getElementById('staff-login-form').reset();
      navigateTo('staff-dashboard');
      showToast('Welcome back!', 'success');
    } else {
      errorEl.textContent = 'Incorrect username or password. Try staff / staff123.';
      errorEl.classList.remove('hidden');
    }
  });

  // Modals: backdrop click + confirm buttons + escape key
  document.getElementById('bed-modal').addEventListener('click', function (e) { if (e.target === this) closeBedModal(); });
  document.getElementById('confirm-modal').addEventListener('click', function (e) { if (e.target === this) hideConfirm(); });
  document.getElementById('confirm-yes').addEventListener('click', function () {
    const fn = state.pendingConfirm;
    hideConfirm();
    if (fn) fn();
  });
  document.getElementById('confirm-no').addEventListener('click', hideConfirm);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeBedModal(); hideConfirm(); }
  });

  await checkBackend();
  await checkStaffAuth();

  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const hashView = window.location.hash.replace(/^#/, '');
  const savedView = localStorage.getItem('opd_active_view');

  let initialView = 'home';
  if (path === '/staff') {
    initialView = state.staff.loggedIn ? 'staff-dashboard' : 'staff-entry';
  } else if (path === '/staff/login') {
    initialView = state.staff.loggedIn ? 'staff-dashboard' : 'staff-entry';
  } else if (path === '/patient') {
    initialView = 'patient-portal';
  } else if (hashView) {
    initialView = hashView;
  } else if (state.staff.loggedIn && savedView === 'staff-dashboard') {
    initialView = 'staff-dashboard';
  }

  navigateTo(initialView, { isBack: true });
});
