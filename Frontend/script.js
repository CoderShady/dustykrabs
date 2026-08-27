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

function makeBeds(count) {
  const beds = [];
  for (let i = 1; i <= count; i++) {
    const roll = Math.random();
    let status = 'available';
    if (roll < 0.42) status = 'occupied';
    else if (roll < 0.58) status = 'cleaning';
    else if (roll < 0.66) status = 'maintenance';
    beds.push({ id: uid('bed'), number: i, status, patientName: status === 'occupied' ? randomName() : '' });
  }
  return beds;
}

function seedData() {
  HOSPITALS[0].beds = makeBeds(16);
  HOSPITALS[1].beds = makeBeds(14);
  HOSPITALS[2].beds = makeBeds(12);

  HOSPITALS.forEach(hospital => {
    hospital.departments.forEach(dept => {
      const waitingCount = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < waitingCount; i++) {
        createToken(hospital.id, dept.id, randomName(), randomAge(), randomGender(), randomPhone());
      }
      if (dept.queue.length) {
        const id = dept.queue.shift();
        dept.currentTokenId = id;
        getToken(id).status = 'called';
      }
    });
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
    loggedIn: false,
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
    waiting: 'Waiting', called: 'Called', completed: 'Completed',
    skipped: 'Skipped', noshow: 'No-show',
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
  document.getElementById('token-result-card').innerHTML = `
    <div class="tb-label">Your Token</div>
    <div class="tb-number">${escapeHtml(token.number)}</div>
    <div class="tb-dept">${escapeHtml(dept.name)} · ${escapeHtml(hospital.name)}</div>
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
  const nowServing = dept.currentTokenId ? getToken(dept.currentTokenId).number : '—';

  let statusText = '—', statusColor = 'var(--text)';
  if (token.status === 'waiting') {
    statusText = pos.ahead <= 1 ? 'Approaching — get ready' : 'In queue';
  } else if (token.status === 'called') {
    statusText = 'Called — please proceed to the counter'; statusColor = 'var(--warning)';
  } else if (token.status === 'completed') {
    statusText = 'Visit completed'; statusColor = 'var(--success)';
  } else if (token.status === 'skipped') {
    statusText = 'Skipped — please check in at reception'; statusColor = 'var(--muted)';
  } else if (token.status === 'noshow') {
    statusText = 'Marked as no-show — please check in at reception'; statusColor = 'var(--danger)';
  }

  const isFinal = ['completed', 'skipped', 'noshow'].includes(token.status);

  container.innerHTML = `
    <div class="tracker-status">
      <div class="status-big" style="color:${statusColor}">${statusText}</div>
      <div class="section-sub" style="margin-bottom:0;">${escapeHtml(token.number)} · ${escapeHtml(dept.name)} · ${escapeHtml(hospital.name)}</div>
    </div>
    <div class="tracker-grid">
      <div class="tracker-metric"><span class="num">${escapeHtml(nowServing)}</span><span class="lbl">Now serving</span></div>
      <div class="tracker-metric"><span class="num">${escapeHtml(token.number)}</span><span class="lbl">Your token</span></div>
      <div class="tracker-metric"><span class="num">${pos.ahead !== null ? pos.ahead : '—'}</span><span class="lbl">Patients ahead</span></div>
      <div class="tracker-metric"><span class="num">${pos.wait !== null ? formatWait(pos.wait) : '—'}</span><span class="lbl">Est. wait</span></div>
    </div>
    <h3 class="section-heading">Queue Order</h3>
    ${renderQueueTrail(dept, { highlightTokenId: token.id })}
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

function renderTodaysTokens() {
  const el = document.getElementById('todays-tokens-list');
  const all = Object.values(TOKENS).sort((a, b) => b.createdAt - a.createdAt).slice(0, 25);
  if (!all.length) { el.innerHTML = '<div class="empty-row">No tokens generated yet.</div>'; return; }
  el.innerHTML = all.map(t => {
    const hospital = getHospital(t.hospitalId);
    const dept = getDept(t.hospitalId, t.departmentId);
    return `
      <div class="token-row">
        <div class="tr-left">
          <span class="tr-num">${escapeHtml(t.number)}</span>
          <span class="tr-name">${escapeHtml(t.patientName)}</span>
          <span class="tr-meta">${escapeHtml(dept.name)} · ${escapeHtml(hospital.name)}</span>
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

function renderAdminStats() {
  const scope = document.getElementById('admin-hospital').value;
  state.staff.admin.hospitalId = scope;
  const hospitals = scope === 'all' ? HOSPITALS : [getHospital(scope)];

  let totalWaiting = 0, waitSum = 0, waitCount = 0, totalBeds = 0, occupiedBeds = 0, busiest = null;

  hospitals.forEach(h => {
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

/* ================= NAVIGATION ================= */

function navigateTo(viewId, opts) {
  opts = opts || {};
  const target = document.getElementById(viewId);
  if (!target) return;
  if (!opts.isBack && state.activeView !== viewId) state.viewHistory.push(state.activeView);
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  target.classList.add('active');
  state.activeView = viewId;
  if (viewId === 'home') state.viewHistory = [];
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderCurrentView();
}
function goBack() { navigateTo(state.viewHistory.pop() || 'home', { isBack: true }); }

function renderCurrentView() {
  switch (state.activeView) {
    case 'patient-portal': renderHospitalList(); break;
    case 'hospital-detail': renderHospitalDetail(); break;
    case 'live-tracker': renderLiveTracker(); break;
    case 'staff-dashboard':
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

function callNextToken(hospitalId, departmentId) {
  const dept = getDept(hospitalId, departmentId);
  if (!dept || dept.currentTokenId || !dept.queue.length) return;
  showLoadingOverlay('Updating queue…');
  setTimeout(() => {
    const nextId = dept.queue.shift();
    dept.currentTokenId = nextId;
    getToken(nextId).status = 'called';
    hideLoadingOverlay();
    renderQueueMgmt();
    showToast(`Now calling ${getToken(nextId).number}`, 'info');
  }, 350);
}

function resolveCurrentToken(hospitalId, departmentId, newStatus, toastMsg) {
  const dept = getDept(hospitalId, departmentId);
  if (!dept || !dept.currentTokenId) return;
  showLoadingOverlay('Updating queue…');
  setTimeout(() => {
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

function saveBedChanges() {
  if (!state.modalBed) return;
  const { hospitalId, bedId } = state.modalBed;
  const bed = getHospital(hospitalId).beds.find(b => b.id === bedId);
  const newStatus = document.getElementById('bed-status-select').value;
  const patientName = document.getElementById('bed-patient-name').value.trim();
  showLoadingOverlay('Updating bed status…');
  setTimeout(() => {
    bed.status = newStatus;
    bed.patientName = newStatus === 'occupied' ? (patientName || 'Unnamed patient') : '';
    hideLoadingOverlay();
    closeBedModal();
    renderBedGrid();
    showToast(`Bed ${bed.number} updated to ${capitalize(newStatus)}.`, 'success');
  }, 350);
}
function releaseBed() {
  if (!state.modalBed) return;
  const { hospitalId, bedId } = state.modalBed;
  const bed = getHospital(hospitalId).beds.find(b => b.id === bedId);
  showLoadingOverlay('Updating bed status…');
  setTimeout(() => {
    bed.status = 'available';
    bed.patientName = '';
    hideLoadingOverlay();
    closeBedModal();
    renderBedGrid();
    showToast(`Bed ${bed.number} released and marked available.`, 'success');
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
    showConfirm('Log out of the staff portal?', () => {
      state.staff.loggedIn = false;
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
  }
}

/* ================= SIMULATION ================= */

function nextBedStatus(current) {
  if (current === 'available' && Math.random() < 0.12) return 'maintenance';
  const cycle = { available: 'occupied', occupied: 'cleaning', cleaning: 'available', maintenance: 'available' };
  return cycle[current] || 'available';
}

function simulationTick() {
  // 1. Occasionally add a new patient to a random department queue
  if (Math.random() < 0.5) {
    const hospital = HOSPITALS[Math.floor(Math.random() * HOSPITALS.length)];
    const dept = hospital.departments[Math.floor(Math.random() * hospital.departments.length)];
    if (dept.queue.length < 12) {
      createToken(hospital.id, dept.id, randomName(), randomAge(), randomGender(), randomPhone());
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
      if (tab === 'reception') renderTodaysTokens();
      if (tab === 'queue-mgmt') renderQueueMgmt();
      if (tab === 'bed-mgmt') renderBedGrid();
      if (tab === 'admin') renderAdminStats();
    });
  });

  // Patient: token form submit
  document.getElementById('token-form').addEventListener('submit', function (e) {
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
    showLoadingOverlay('Generating your token…');
    setTimeout(() => {
      const hospitalId = state.tokenFormContext.hospitalId;
      const token = createToken(hospitalId, departmentId, name, age, gender, phone);
      state.myToken = { id: token.id, hospitalId, departmentId };
      hideLoadingOverlay();
      setBtnBusy(submitBtn, false);
      renderTokenResult(token);
      navigateTo('token-result');
      showToast(`Token generated: ${token.number}`, 'success');
    }, 600);
  });

  // Staff: register patient
  document.getElementById('register-form').addEventListener('submit', function (e) {
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
    showLoadingOverlay('Generating token…');
    setTimeout(() => {
      const token = createToken(hospitalId, departmentId, name, age, gender, phone);
      hideLoadingOverlay();
      setBtnBusy(btn, false);
      document.getElementById('register-form').reset();
      document.getElementById('reg-hospital').value = hospitalId;
      populateDepartmentSelect(document.getElementById('reg-department'), hospitalId);
      renderTodaysTokens();
      showToast(`Token generated: ${token.number}`, 'success');
    }, 600);
  });

  // Staff: login
  document.getElementById('staff-login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const u = document.getElementById('staff-username').value.trim();
    const p = document.getElementById('staff-password').value;
    const errorEl = document.getElementById('staff-login-error');
    if (u === 'staff' && p === 'staff123') {
      errorEl.classList.add('hidden');
      state.staff.loggedIn = true;
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

  renderCurrentView();
  setInterval(simulationTick, 5000);
});
