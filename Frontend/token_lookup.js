/** Digital token lookup and printable token copy. */

'use strict';

(function createTokenLookup() {
  const {
    api,
    byId,
    clearFormError,
    escapeHtml,
    hideLoading,
    showFormError,
    showLoading,
  } = window.OPD;

  const state = {
    hospitals: [],
    hospitalDetails: new Map(),
    selectedHospitalId: null,
  };

  function searchableText(hospital) {
    return [
      hospital.name,
      hospital.location,
      hospital.city,
      hospital.district,
      hospital.region,
      hospital.hospital_tier,
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function hospitalMeta(hospital) {
    return [hospital.city || hospital.location, hospital.district, hospital.region]
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join(' · ');
  }

  function filteredHospitals() {
    const query = byId('token-hospital-search')?.value.trim().toLowerCase() || '';
    return state.hospitals.filter((hospital) => searchableText(hospital).includes(query));
  }

  function renderHospitalResults() {
    const results = byId('token-hospital-results');
    const status = byId('token-hospital-status');
    if (!results || !status) return;

    const query = byId('token-hospital-search')?.value.trim() || '';
    const matches = filteredHospitals();
    const visible = query ? matches : matches.slice(0, 8);

    if (!matches.length) {
      status.textContent = 'No hospitals match that search. Try a city, district, or hospital name.';
      results.innerHTML = '';
      return;
    }

    status.textContent = query
      ? `${matches.length} hospital${matches.length === 1 ? '' : 's'} found`
      : `Showing ${visible.length} of ${matches.length} hospitals. Search to find another hospital.`;

    results.innerHTML = visible.map((hospital) => `
      <button
        class="insight-hospital-option ${hospital.id === state.selectedHospitalId ? 'is-selected' : ''}"
        type="button"
        data-token-hospital-id="${escapeHtml(hospital.id)}"
      >
        <span class="insight-option-main">
          <strong>${escapeHtml(hospital.name)}</strong>
          <small>📍 ${escapeHtml(hospitalMeta(hospital))}</small>
        </span>
        <span class="insight-option-meta">
          ${hospital.department_count || 0} departments<br>
          <b>Select hospital →</b>
        </span>
      </button>
    `).join('');
  }

  function metricCard(value, label) {
    return `
      <div class="insight-stat-card">
        <span class="insight-stat-value">${escapeHtml(value)}</span>
        <span class="insight-stat-label">${escapeHtml(label)}</span>
      </div>
    `;
  }

  function formatStatus(status) {
    const labels = {
      pending_approval: 'Waiting for reception approval',
      on_hold: 'Kept on hold by reception',
      waiting: 'Waiting in queue',
      called: 'Now being served',
      completed: 'Visit completed',
      skipped: 'Skipped',
      noshow: 'No-show',
      rejected: 'Not approved',
    };
    return labels[status] || String(status).replaceAll('_', ' ');
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  async function loadHospital(hospitalId) {
    if (state.hospitalDetails.has(hospitalId)) return state.hospitalDetails.get(hospitalId);
    const hospital = await api.get(`/hospitals/${encodeURIComponent(hospitalId)}`);
    state.hospitalDetails.set(hospitalId, hospital);
    return hospital;
  }

  async function populateDepartments(hospitalId) {
    const departmentSelect = byId('token-department');
    if (!departmentSelect) return;

    departmentSelect.disabled = true;
    departmentSelect.innerHTML = '<option value="">Loading departments…</option>';

    try {
      const hospital = await loadHospital(hospitalId);
      if (!hospital.departments.length) {
        departmentSelect.innerHTML = '<option value="">Departments not configured yet</option>';
        departmentSelect.disabled = true;
        return;
      }
      departmentSelect.innerHTML = hospital.departments.map((department) => (
        `<option value="${escapeHtml(department.id)}">${escapeHtml(department.name)}</option>`
      )).join('');
    } finally {
      const hospital = state.hospitalDetails.get(hospitalId);
      departmentSelect.disabled = !hospital?.departments.length;
    }
  }

  async function selectHospital(hospitalId, options = {}) {
    const summary = state.hospitals.find((hospital) => hospital.id === hospitalId);
    if (!summary) return;

    state.selectedHospitalId = hospitalId;
    renderHospitalResults();
    clearFormError(byId('token-lookup-error'));
    showLoading('Preparing digital token lookup…');

    try {
      const hospital = await loadHospital(hospitalId);
      byId('token-hospital-heading').innerHTML = `
        <p class="eyebrow">Selected hospital</p>
        <h2>${escapeHtml(hospital.name)}</h2>
        <p class="insight-location">📍 ${escapeHtml(hospitalMeta(hospital))}</p>
      `;
      byId('token-hospital-summary').innerHTML = [
        metricCard(hospital.department_count || hospital.departments.length, 'Declared departments'),
        metricCard(hospital.total_waiting || 0, 'Patients in live queues'),
        metricCard(`${hospital.avg_wait_minutes || 0} min`, 'Average predicted wait'),
      ].join('');

      await populateDepartments(hospitalId);
      const hasDepartments = hospital.departments.length > 0;
      byId('find-token-btn').disabled = !hasDepartments;
      byId('token-number').value = '';
      byId('token-copy-container').innerHTML = hasDepartments
        ? `
          <div class="card empty-state">
            <div class="empty-icon">🎫</div>
            <h3>Your approved token will appear here</h3>
            <p>Enter the department and token number to see live status, patients ahead, and predicted wait.</p>
          </div>
        `
        : `
          <div class="card insight-empty-data">
            <div class="empty-icon">🎫</div>
            <h3>Digital token lookup is not configured yet</h3>
            <p>This hospital has ${hospital.department_count || 0} declared departments, but its department and token records still need to be connected.</p>
          </div>
        `;
      byId('token-workspace').classList.remove('hidden');

      const url = new URL(window.location.href);
      url.searchParams.set('hospital', hospitalId);
      window.history.replaceState({}, '', url);
      if (!options.keepPosition) {
        byId('token-workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (error) {
      showFormError(byId('token-lookup-error'), error.message || 'This hospital could not be loaded.');
    } finally {
      hideLoading();
    }
  }

  async function initializeHospitals() {
    state.hospitals = await api.get('/hospitals');
    renderHospitalResults();

    const requestedHospital = new URLSearchParams(window.location.search).get('hospital');
    if (requestedHospital && state.hospitals.some((hospital) => hospital.id === requestedHospital)) {
      await selectHospital(requestedHospital);
    }
  }

  function renderToken(token, hospital, department) {
    const container = byId('token-copy-container');
    const waitTime = token.wait_minutes == null ? '—' : `About ${token.wait_minutes} min`;
    const patientsAhead = token.ahead == null ? '—' : token.ahead;

    container.innerHTML = `
      <article class="token-copy" aria-label="Digital token ${escapeHtml(token.number)}">
        <div class="token-copy-head">
          <span class="badge badge-${escapeHtml(token.status)}">${escapeHtml(formatStatus(token.status))}</span>
          <div class="token-copy-number">${escapeHtml(token.number)}</div>
          <h2>Digital OPD Token</h2>
        </div>
        <div class="token-copy-body">
          <div class="token-copy-row">
            <span class="token-copy-label">Patient</span>
            <span class="token-copy-value">${escapeHtml(token.patient_name)}</span>
          </div>
          <div class="token-copy-row">
            <span class="token-copy-label">Hospital</span>
            <span class="token-copy-value">${escapeHtml(hospital.name)}</span>
          </div>
          <div class="token-copy-row">
            <span class="token-copy-label">Department</span>
            <span class="token-copy-value">${escapeHtml(department.name)}</span>
          </div>
          <div class="token-copy-row">
            <span class="token-copy-label">Patients ahead</span>
            <span class="token-copy-value">${patientsAhead}</span>
          </div>
          <div class="token-copy-row">
            <span class="token-copy-label">Expected wait</span>
            <span class="token-copy-value">${escapeHtml(waitTime)}</span>
          </div>
          <div class="token-copy-row">
            <span class="token-copy-label">Created</span>
            <span class="token-copy-value">${escapeHtml(formatDate(token.created_at))}</span>
          </div>
          <p style="margin-top:18px; color:var(--text-muted); font-size:0.88rem; text-align:center;">Show this token to hospital reception when you arrive.</p>
          <div class="token-copy-actions">
            <button id="print-token-btn" class="btn btn-primary" type="button">Print / Save Token</button>
            <a href="./hospital_login.html" class="btn btn-outline" style="text-decoration:none;">Hospital Login</a>
          </div>
        </div>
      </article>
    `;

    byId('print-token-btn')?.addEventListener('click', () => window.print());
  }

  async function findToken(event) {
    event.preventDefault();
    const errorElement = byId('token-lookup-error');
    const hospitalId = state.selectedHospitalId;
    const departmentId = byId('token-department').value;
    const tokenNumber = byId('token-number').value.trim().toUpperCase();

    if (!hospitalId || !departmentId || !tokenNumber) {
      showFormError(errorElement, 'Select a hospital and department, then enter the approved token number.');
      return;
    }

    clearFormError(errorElement);
    showLoading('Finding your token…');

    try {
      const [token, hospital] = await Promise.all([
        api.get(`/tokens/lookup?hospital_id=${encodeURIComponent(hospitalId)}&department_id=${encodeURIComponent(departmentId)}&token_number=${encodeURIComponent(tokenNumber)}`),
        loadHospital(hospitalId),
      ]);
      const department = hospital.departments.find((item) => item.id === departmentId);
      renderToken(token, hospital, department || { name: 'OPD Department' });
    } catch (error) {
      showFormError(errorElement, error.status === 404
        ? 'No token was found. Check the hospital, department, and token number.'
        : error.message || 'The token could not be loaded.');
    } finally {
      hideLoading();
    }
  }

  async function initializeTokenLookup() {
    byId('token-lookup-form')?.addEventListener('submit', findToken);
    byId('token-hospital-search')?.addEventListener('input', renderHospitalResults);
    byId('token-hospital-search')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && filteredHospitals().length === 1) {
        event.preventDefault();
        selectHospital(filteredHospitals()[0].id);
      }
    });
    byId('clear-token-hospital-search')?.addEventListener('click', () => {
      byId('token-hospital-search').value = '';
      renderHospitalResults();
      byId('token-hospital-search').focus();
    });
    byId('token-hospital-results')?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-token-hospital-id]');
      if (option) selectHospital(option.dataset.tokenHospitalId);
    });

    try {
      await initializeHospitals();
    } catch (error) {
      byId('token-hospital-status').textContent = error.message || 'Hospitals could not be loaded.';
    }
  }

  document.addEventListener('DOMContentLoaded', initializeTokenLookup);
}());
