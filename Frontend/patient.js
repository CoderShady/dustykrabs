/**
 * Patient portal controller.
 * Handles hospital browsing, token requests, live tracking, and queue events.
 */

'use strict';

(function createPatientPortal() {
  const {
    ApiError,
    api,
    byId,
    clearFormError,
    connectWebSocket,
    escapeHtml,
    hideLoading,
    showFormError,
    showLoading,
    showToast,
  } = window.OPD;

  const TOKEN_STORAGE_KEY = 'opd_patient_token';

  const state = {
    hospitals: [],
    hospitalDetails: new Map(),
    selectedHospital: null,
    selectedDepartmentId: null,
    myTokenId: localStorage.getItem(TOKEN_STORAGE_KEY),
    myToken: null,
  };

  function showPatientView(viewName) {
    const views = {
      hospitals: byId('p-view-hospitals'),
      'hospital-detail': byId('p-view-hospital-detail'),
      'token-form': byId('p-view-token-form'),
      tracker: byId('p-view-tracker'),
    };

    Object.values(views).forEach((view) => {
      view?.classList.remove('active');
      view?.classList.add('hidden');
    });

    views[viewName]?.classList.remove('hidden');
    views[viewName]?.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (viewName === 'hospitals') renderHospitals();
  }

  async function fetchHospitals() {
    state.hospitals = await api.get('/hospitals');
    renderHospitals();
  }

  function renderHospitals() {
    const list = byId('p-hospital-list');
    const summary = byId('p-hospital-search-summary');
    const searchText = byId('p-hospital-search')?.value.trim().toLowerCase() || '';
    if (!list) return;

    const hospitals = state.hospitals.filter((hospital) => (
      `${hospital.name} ${hospital.location}`.toLowerCase().includes(searchText)
    ));

    if (summary) {
      summary.textContent = searchText
        ? `${hospitals.length} hospital${hospitals.length === 1 ? '' : 's'} found`
        : `${hospitals.length} participating hospitals`;
    }

    if (!hospitals.length) {
      list.innerHTML = `<div class="empty-row">${searchText ? 'No hospitals match that search.' : 'No hospitals are currently available.'}</div>`;
      return;
    }

    list.innerHTML = hospitals.map((hospital) => `
      <div
        class="card hospital-card"
        data-hospital-id="${escapeHtml(hospital.id)}"
        role="button"
        tabindex="0"
        style="cursor:pointer;"
      >
        <h3>${escapeHtml(hospital.name)}</h3>
        <p class="hospital-location location">📍 ${escapeHtml(hospital.location)}</p>
        <div class="hospital-metrics stat-row">
          <span>${hospital.department_count || 0} Departments</span>
          <span>About ${hospital.avg_wait_minutes || 0} min average wait</span>
          <span class="badge badge-${hospital.total_waiting > 15 ? 'warning' : 'ok'}">
            ${hospital.total_waiting || 0} Patients Waiting
          </span>
        </div>
        <button class="btn btn-primary btn-block" style="margin-top:16px;">
          View Departments &amp; Queues →
        </button>
      </div>
    `).join('');
  }

  async function loadHospitalDetails(hospitalId, forceRefresh = false) {
    if (!forceRefresh && state.hospitalDetails.has(hospitalId)) {
      return state.hospitalDetails.get(hospitalId);
    }

    const hospital = await api.get(`/hospitals/${encodeURIComponent(hospitalId)}`);
    const departments = await Promise.all(hospital.departments.map(async (department) => {
      try {
        const metrics = await api.get(
          `/hospitals/${encodeURIComponent(hospitalId)}/departments/${encodeURIComponent(department.id)}/metrics`,
        );
        const averageServiceMinutes = metrics.mu_per_hour > 0 ? 60 / metrics.mu_per_hour : 0;
        return { ...department, averageServiceMinutes };
      } catch (error) {
        console.warn(`Unable to load metrics for department ${department.id}.`, error);
        return { ...department, averageServiceMinutes: 0 };
      }
    }));

    const detailedHospital = { ...hospital, departments };
    state.hospitalDetails.set(hospitalId, detailedHospital);
    return detailedHospital;
  }

  function renderHospitalDetails(hospital) {
    const header = byId('p-hospital-detail-header');
    const departmentList = byId('p-department-list');

    if (header) {
      header.innerHTML = `
        <h2>${escapeHtml(hospital.name)}</h2>
        <p class="hospital-location location" style="margin-top:4px;">
          📍 ${escapeHtml(hospital.location)}
        </p>
      `;
    }

    if (!departmentList) return;

    departmentList.innerHTML = hospital.departments.map((department) => `
      <div class="card department-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <h4 style="margin:0; font-size:18px;">${escapeHtml(department.name)}</h4>
            <p style="font-size:13px; color:var(--text-muted); margin-top:2px;">
              Open counters: ${department.num_counters} · About ${department.averageServiceMinutes.toFixed(1)} minutes per visit
            </p>
          </div>
          <span class="badge badge-${department.queue_size > 15 ? 'warning' : 'ok'}">
            ${department.queue_size} in queue
          </span>
        </div>

        <div class="dept-stats" style="margin:16px 0; display:flex; gap:16px; font-size:14px;">
          <div><strong>Expected wait:</strong> about ${department.estimated_wait_minutes || 0} min</div>
          <div><strong>Serving:</strong> ${escapeHtml(department.now_serving || '—')}</div>
        </div>

        <button
          class="btn btn-primary btn-block"
          data-token-hospital="${escapeHtml(hospital.id)}"
          data-token-department="${escapeHtml(department.id)}"
        >
          Get Digital Token →
        </button>
      </div>
    `).join('');
  }

  async function selectHospital(hospitalId) {
    showLoading('Loading hospital queues…');

    try {
      const hospital = await loadHospitalDetails(hospitalId, true);
      state.selectedHospital = hospital;
      renderHospitalDetails(hospital);
      showPatientView('hospital-detail');
    } catch (error) {
      console.error('Unable to load hospital details.', error);
      showToast(error.message || 'Could not load this hospital.', 'warning');
    } finally {
      hideLoading();
    }
  }

  async function openTokenForm(hospitalId, departmentId) {
    let hospital = state.hospitalDetails.get(hospitalId);

    try {
      if (!hospital) hospital = await loadHospitalDetails(hospitalId);
    } catch (error) {
      console.error('Unable to prepare the token form.', error);
      showToast(error.message || 'Could not load department details.', 'warning');
      return;
    }

    state.selectedHospital = hospital;
    state.selectedDepartmentId = departmentId;

    const departmentSelect = byId('p-tf-department');
    const context = byId('p-tf-context');
    const selectedDepartment = hospital.departments.find((department) => department.id === departmentId);

    if (context) {
      context.textContent = selectedDepartment
        ? `${hospital.name} · ${selectedDepartment.name}`
        : hospital.name;
    }
    if (departmentSelect) {
      departmentSelect.innerHTML = hospital.departments.map((department) => `
        <option value="${escapeHtml(department.id)}" ${department.id === departmentId ? 'selected' : ''}>
          ${escapeHtml(department.name)}
        </option>
      `).join('');
    }

    const tokenTime = byId('p-tf-token-time');
    if (tokenTime) {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      tokenTime.value = now.toISOString().slice(0, 16);
    }

    showPatientView('token-form');
  }

  function formatTokenTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return 'Just now';

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function updateTokenNavigation(token) {
    const navigationButton = byId('my-token-nav-btn');
    if (!navigationButton) return;

    navigationButton.classList.remove('hidden');
    navigationButton.textContent = `My Token: ${token.number || 'Pending'} 🎫`;
  }

  function clearSavedToken() {
    state.myTokenId = null;
    state.myToken = null;
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    byId('my-token-nav-btn')?.classList.add('hidden');
  }

  async function fetchAndRenderToken(tokenId) {
    if (!tokenId) return false;

    try {
      const token = await api.get(`/tokens/${encodeURIComponent(tokenId)}`);
      if (!state.hospitalDetails.has(token.hospital_id)) {
        try {
          await loadHospitalDetails(token.hospital_id);
        } catch (hospitalError) {
          console.warn('Unable to load the token hospital details.', hospitalError);
        }
      }
      state.myToken = token;
      renderTracker(token);
      updateTokenNavigation(token);
      return true;
    } catch (error) {
      console.error('Unable to load the saved token.', error);

      if (error instanceof ApiError && error.status === 404) {
        clearSavedToken();
        showToast('Your saved token is no longer available.', 'warning');
        showPatientView('hospitals');
      }
      return false;
    }
  }

  function renderPendingTracker(token) {
    const isOnHold = token.status === 'on_hold';
    return `
      <div class="card token-result-card" style="text-align:center; padding:36px 20px; border-top:5px solid var(--warning);">
        <div class="badge badge-${isOnHold ? 'on_hold' : 'pending_approval'}" style="font-size:14px; padding:6px 14px;">
          ${isOnHold ? '⏸ ON HOLD' : '⏳ AWAITING APPROVAL'}
        </div>
        <h2 style="margin:16px 0 8px;">${isOnHold ? 'Check-in Request Kept on Hold' : 'Check-in Request Under Review'}</h2>
        <p style="color:var(--text-muted); max-width:400px; margin:0 auto 20px;">
          We received the request for <strong>${escapeHtml(token.patient_name)}</strong>.
          ${isOnHold ? 'Reception will review it again before adding it to the queue.' : 'Staff will send the token number soon.'}
        </p>
        <div style="background:var(--surface-sunken); border-radius:8px; padding:16px; max-width:360px; margin:0 auto; text-align:left; font-size:14px;">
          <div><strong>Patient:</strong> ${escapeHtml(token.patient_name)} (${token.age} yrs, ${escapeHtml(token.gender)})</div>
          <div style="margin-top:6px;"><strong>Phone:</strong> ${escapeHtml(token.phone)}</div>
          <div style="margin-top:6px;"><strong>Time:</strong> Just now</div>
        </div>
        <p style="margin-top:20px; font-size:13px; color:var(--text-faint);">
          ⚡ This page updates automatically the moment reception staff clicks approve.
        </p>
      </div>
    `;
  }

  function renderRejectedTracker(token) {
    return `
      <div class="card token-result-card" style="text-align:center; padding:36px 20px; border-top:5px solid var(--danger);">
        <div class="badge badge-rejected" style="font-size:14px; padding:6px 14px;">✕ REQUEST REJECTED</div>
        <h2 style="margin:16px 0 8px;">Request Could Not Be Approved</h2>
        <p style="color:var(--text-muted); max-width:400px; margin:0 auto 20px;">
          ${escapeHtml(token.rejection_reason || 'The department is full or some details need correction.')}
        </p>
        <button class="btn btn-primary" data-patient-view="hospitals">
          Choose Another Department / Hospital
        </button>
      </div>
    `;
  }

  function renderActiveTracker(token) {
    const isCalled = token.status === 'called';
    const isCompleted = token.status === 'completed';
    const statusLabel = String(token.status).replaceAll('_', ' ').toUpperCase();
    const hospital = state.hospitalDetails.get(token.hospital_id) || state.selectedHospital;
    const department = hospital?.departments?.find((item) => item.id === token.department_id);
    const careLocation = [hospital?.name, department?.name].filter(Boolean).join(' · ');

    let statusContent = `
      <div class="tracker-metrics-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:24px 0;">
        <div class="card" style="background:var(--surface-sunken); padding:16px;">
          <div style="font-size:32px; font-weight:700; color:var(--primary);">${token.ahead ?? 0}</div>
          <div style="font-size:13px; color:var(--text-muted);">Patients Ahead of You</div>
        </div>
        <div class="card" style="background:var(--surface-sunken); padding:16px;">
          <div style="font-size:32px; font-weight:700; color:var(--success);">~${token.wait_minutes ?? 0}</div>
          <div style="font-size:13px; color:var(--text-muted);">Estimated Wait (min)</div>
        </div>
      </div>
    `;

    if (isCalled) {
      statusContent = `
        <div class="alert-item alert-critical" style="margin:24px 0; background:rgba(34, 197, 94, 0.15); border-color:var(--success); text-align:center;">
          <h3 style="color:var(--success); margin:0;">🔔 It's Your Turn!</h3>
          <p style="margin-top:4px;">Please proceed directly to the doctor's consultation counter.</p>
        </div>
      `;
    } else if (isCompleted) {
      statusContent = `
        <div class="alert-item" style="margin:24px 0; background:var(--surface-sunken); text-align:center;">
          <h3 style="margin:0;">✓ Consultation Finished</h3>
          <p style="margin-top:4px;">Thank you for visiting. Have a healthy day!</p>
        </div>
      `;
    }

    return `
      <div class="card token-result-card" style="text-align:center; padding:32px 20px; border-top:5px solid ${isCalled ? 'var(--success)' : 'var(--primary)'};">
        <span class="badge badge-${escapeHtml(token.status)}" style="font-size:14px; padding:6px 14px;">${escapeHtml(statusLabel)}</span>
        <div class="token-number-hero" style="font-size:56px; font-weight:800; color:var(--primary); margin:12px 0;">
          ${escapeHtml(token.number || 'Pending')}
        </div>
        <h3 style="margin:0;">${escapeHtml(token.patient_name)}</h3>
        ${careLocation ? `<p style="font-weight:700; margin-top:6px;">${escapeHtml(careLocation)}</p>` : ''}
        <p style="color:var(--text-muted); margin-top:4px;">📞 ${escapeHtml(token.phone)} · Created ${escapeHtml(formatTokenTime(token.created_at))}</p>

        ${statusContent}

        <div style="margin-top:20px;">
          <button class="btn btn-outline btn-sm" data-patient-view="hospitals">← View Hospital List</button>
        </div>
      </div>
    `;
  }

  function renderTracker(token) {
    const container = byId('p-tracker-content');
    if (!container) return;

    if (token.status === 'pending_approval' || token.status === 'on_hold') {
      container.innerHTML = renderPendingTracker(token);
    } else if (token.status === 'rejected') {
      container.innerHTML = renderRejectedTracker(token);
    } else {
      container.innerHTML = renderActiveTracker(token);
    }
  }

  async function handleTokenRequest(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const errorElement = byId('p-tf-error');
    const name = byId('p-tf-name').value.trim();
    const phone = byId('p-tf-phone').value.trim();
    const departmentId = byId('p-tf-department').value;

    if (!name || !/^\d{10}$/.test(phone) || !departmentId) {
      showFormError(errorElement, 'Enter your name and a valid 10-digit contact number.');
      return;
    }

    if (!state.selectedHospital) {
      showFormError(errorElement, 'Please select a hospital before requesting a token.');
      return;
    }

    clearFormError(errorElement);
    showLoading('Generating your token…');

    try {
      const token = await api.post('/tokens', {
        hospital_id: state.selectedHospital.id,
        department_id: departmentId,
        patient_name: name,
        age: 0,
        gender: 'Not specified',
        phone,
      });

      state.myTokenId = token.id;
      state.myToken = token;
      localStorage.setItem(TOKEN_STORAGE_KEY, token.id);
      showToast(`Token ${token.number} created successfully.`, 'success');
      form.reset();
      renderTracker(token);
      updateTokenNavigation(token);
      showPatientView('tracker');
    } catch (error) {
      console.error('Token request failed.', error);
      showToast(error.message || 'Could not submit the check-in request.', 'warning');
    } finally {
      hideLoading();
    }
  }

  function handleWebSocketEvent(message) {
    const event = message.event;
    const data = message.data || {};
    const isMyToken = state.myTokenId && data.token_id === state.myTokenId;

    if (event === 'token_approved' && isMyToken) {
      showToast(`Your token request has been approved! Assigned Number: ${data.number}`, 'success');
      fetchAndRenderToken(state.myTokenId);
      return;
    }

    if (event === 'token_rejected' && isMyToken) {
      showToast('Your token request was not approved.', 'warning');
      fetchAndRenderToken(state.myTokenId);
      return;
    }

    if (event === 'token_held' && isMyToken) {
      showToast('Your token request has been kept on hold by reception.', 'info');
      fetchAndRenderToken(state.myTokenId);
      return;
    }

    if (event === 'token_called' && isMyToken) {
      showToast(`🔔 It is your turn! Token ${data.token_number} is called at counter.`, 'success');
      fetchAndRenderToken(state.myTokenId);
      return;
    }

    if (event === 'patient_alert' && isMyToken) {
      showToast('⚠️ Get ready! You are next in line.', 'warning');
      fetchAndRenderToken(state.myTokenId);
      return;
    }

    if (event === 'queue_update') {
      if (state.myTokenId) fetchAndRenderToken(state.myTokenId);
      if (state.selectedHospital?.id === data.hospital_id) {
        loadHospitalDetails(data.hospital_id, true)
          .then((hospital) => {
            state.selectedHospital = hospital;
            renderHospitalDetails(hospital);
          })
          .catch((error) => console.error('Live hospital refresh failed.', error));
      }
    }
  }

  function handlePortalClick(event) {
    const viewButton = event.target.closest('[data-patient-view]');
    if (viewButton) {
      const viewName = viewButton.dataset.patientView;
      showPatientView(viewName);
      if (viewName === 'tracker' && state.myTokenId) fetchAndRenderToken(state.myTokenId);
      return;
    }

    const tokenButton = event.target.closest('[data-token-department]');
    if (tokenButton) {
      openTokenForm(tokenButton.dataset.tokenHospital, tokenButton.dataset.tokenDepartment);
      return;
    }

    const hospitalCard = event.target.closest('[data-hospital-id]');
    if (hospitalCard) selectHospital(hospitalCard.dataset.hospitalId);
  }

  function handlePortalKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const hospitalCard = event.target.closest('[data-hospital-id]');
    if (!hospitalCard) return;

    event.preventDefault();
    selectHospital(hospitalCard.dataset.hospitalId);
  }

  async function initializePatientPortal() {
    byId('p-token-form')?.addEventListener('submit', handleTokenRequest);
    byId('p-hospital-search')?.addEventListener('input', renderHospitals);
    document.addEventListener('click', handlePortalClick);
    document.addEventListener('keydown', handlePortalKeydown);
    connectWebSocket(handleWebSocketEvent, 'Patient');

    try {
      await fetchHospitals();
    } catch (error) {
      console.error('Unable to load hospitals.', error);
      showToast(error.message || 'Could not load hospitals.', 'warning');
    }

    const requestedHospitalId = new URLSearchParams(window.location.search).get('hospital');

    if (requestedHospitalId && state.hospitals.some((hospital) => hospital.id === requestedHospitalId)) {
      await selectHospital(requestedHospitalId);
    } else if (state.myTokenId) {
      showPatientView('tracker');
      await fetchAndRenderToken(state.myTokenId);
    } else {
      showPatientView('hospitals');
    }
  }

  window.showPatientView = showPatientView;
  window.selectHospital = selectHospital;
  window.openTokenForm = openTokenForm;

  document.addEventListener('DOMContentLoaded', initializePatientPortal);
}());
