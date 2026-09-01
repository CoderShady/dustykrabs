/**
 * Hospital dashboard controller.
 * Handles approvals, registration, queues, beds, and operational alerts.
 */

'use strict';

(function createHospitalDashboard() {
  const {
    api,
    appUrl,
    byId,
    clearFormError,
    connectWebSocket,
    escapeHtml,
    hideLoading,
    showFormError,
    showLoading,
    showToast,
  } = window.OPD;

  const state = {
    activeTab: 'reception',
    hospitals: [],
    bedsById: new Map(),
    modalBed: null,
    pendingConfirm: null,
  };

  function showConfirm(title, message, onConfirm) {
    byId('confirm-title').textContent = title || 'Confirm Action';
    byId('confirm-message').textContent = message || 'Are you sure you want to proceed?';
    state.pendingConfirm = onConfirm;
    byId('confirm-modal').classList.remove('hidden');
  }

  function hideConfirm() {
    state.pendingConfirm = null;
    byId('confirm-modal')?.classList.add('hidden');
  }

  function getHospital(hospitalId) {
    return state.hospitals.find((hospital) => hospital.id === hospitalId);
  }

  function getDepartment(hospitalId, departmentId) {
    return getHospital(hospitalId)?.departments.find((department) => department.id === departmentId);
  }

  async function fetchHospitals() {
    const summaries = await api.get('/hospitals');

    state.hospitals = await Promise.all(
      summaries.map((hospital) => api.get(`/hospitals/${encodeURIComponent(hospital.id)}`)),
    );

    populateDropdowns();
  }

  function hospitalOptions(includeAll = false) {
    const options = state.hospitals.map((hospital) => (
      `<option value="${escapeHtml(hospital.id)}">${escapeHtml(hospital.name)}</option>`
    )).join('');

    return includeAll ? `<option value="all">All Hospitals</option>${options}` : options;
  }

  function updateDepartmentSelect(select, hospitalId) {
    if (!select) return;

    const hospital = getHospital(hospitalId);
    select.innerHTML = (hospital?.departments || []).map((department) => (
      `<option value="${escapeHtml(department.id)}">${escapeHtml(department.name)}</option>`
    )).join('');
  }

  function populateDropdowns() {
    if (!state.hospitals.length) return;

    const options = hospitalOptions();
    const registrationHospital = byId('reg-hospital');
    const queueHospital = byId('qm-hospital');
    const bedHospital = byId('bed-hospital');
    const adminHospital = byId('admin-hospital');

    if (registrationHospital) registrationHospital.innerHTML = options;
    if (queueHospital) queueHospital.innerHTML = options;
    if (bedHospital) bedHospital.innerHTML = options;
    if (adminHospital) adminHospital.innerHTML = hospitalOptions(true);

    updateDepartmentSelect(byId('reg-department'), registrationHospital?.value);
    updateDepartmentSelect(byId('qm-department'), queueHospital?.value);
  }

  async function renderPendingTokens() {
    const container = byId('pending-tokens-list');
    const badge = byId('pending-count-badge');
    if (!container) return;

    try {
      const tokens = await api.get('/tokens/pending');
      if (badge) badge.textContent = `${tokens.length} pending`;

      if (!tokens.length) {
        container.innerHTML = '<div class="empty-row">No pending token requests at this time.</div>';
        return;
      }

      container.innerHTML = tokens.map((token) => {
        const hospital = getHospital(token.hospital_id);

        return `
          <div class="token-row" style="background:rgba(234, 179, 8, 0.05); border-left:3px solid var(--warning);">
            <div class="tr-left">
              <span class="tr-num" style="color:var(--warning);">PENDING</span>
              <span class="tr-name">${escapeHtml(token.patient_name)}</span>
              <span class="tr-meta">
                ${escapeHtml(token.gender)} · ${token.age} yrs · 📞 ${escapeHtml(token.phone)} · ${escapeHtml(hospital?.name || '')}
              </span>
            </div>
            <div class="tr-right" style="display:flex; gap:8px;">
              <button class="btn btn-primary btn-sm" data-action="approve-token" data-token-id="${escapeHtml(token.id)}">✓ Approve</button>
              <button class="btn btn-outline btn-sm" data-action="hold-token" data-token-id="${escapeHtml(token.id)}">Keep on Hold</button>
            </div>
          </div>
        `;
      }).join('');
    } catch (error) {
      console.error('Unable to load pending token requests.', error);
    }
  }

  async function approveToken(tokenId) {
    showLoading('Approving token…');

    try {
      const token = await api.post(`/tokens/${encodeURIComponent(tokenId)}/approve`);
      showToast(`Token approved! Assigned Number: ${token.number}`, 'success');
      await Promise.all([renderPendingTokens(), renderTodaysTokens()]);
    } catch (error) {
      console.error('Token approval failed.', error);
      showToast(error.message || 'Could not approve the token.', 'warning');
    } finally {
      hideLoading();
    }
  }

  async function holdToken(tokenId) {
    showLoading('Keeping request on hold…');

    try {
      await api.post(`/tokens/${encodeURIComponent(tokenId)}/hold`);
      showToast('Token request kept on hold.', 'info');
      await Promise.all([renderPendingTokens(), renderTodaysTokens()]);
    } catch (error) {
      console.error('Unable to hold the token request.', error);
      showToast(error.message || 'Could not keep the token on hold.', 'warning');
    } finally {
      hideLoading();
    }
  }

  function promptRejectToken(tokenId) {
    showConfirm(
      'Reject Token Request',
      'Are you sure you want to reject this patient token request?',
      async () => {
        showLoading('Rejecting request…');

        try {
          await api.post(`/tokens/${encodeURIComponent(tokenId)}/reject`, {
            reason: 'Department at capacity',
          });
          showToast('Token request rejected.', 'info');
          await renderPendingTokens();
        } catch (error) {
          console.error('Token rejection failed.', error);
          showToast(error.message || 'Could not reject the token.', 'warning');
        } finally {
          hideLoading();
        }
      },
    );
  }

  async function renderTodaysTokens() {
    const container = byId('todays-tokens-list');
    const hospitalId = byId('reg-hospital')?.value;
    if (!container || !hospitalId) return;

    try {
      const tokens = await api.get(
        `/tokens?hospital_id=${encodeURIComponent(hospitalId)}&today_only=true&limit=500`,
      );

      if (!tokens.length) {
        container.innerHTML = '<div class="empty-row">No token requests received today.</div>';
        return;
      }

      container.innerHTML = tokens.map((token) => {
        const department = getDepartment(token.hospital_id, token.department_id);
        const statusLabel = String(token.status).replaceAll('_', ' ');
        let actions = `
          <span class="badge badge-${escapeHtml(token.status)}">${escapeHtml(statusLabel)}</span>
        `;

        if (token.status === 'pending_approval') {
          actions = `
            <button class="btn btn-primary btn-sm" data-action="approve-token" data-token-id="${escapeHtml(token.id)}">✓ Approve</button>
            <button class="btn btn-outline btn-sm" data-action="hold-token" data-token-id="${escapeHtml(token.id)}">Keep on Hold</button>
          `;
        } else if (token.status === 'on_hold') {
          actions = `
            <button class="btn btn-primary btn-sm" data-action="approve-token" data-token-id="${escapeHtml(token.id)}">✓ Approve</button>
            <span class="badge badge-on_hold">On Hold</span>
          `;
        }

        return `
          <div class="token-row">
            <div class="tr-left">
              <span class="tr-num">${escapeHtml(token.number || 'PENDING')}</span>
              <span class="tr-name">${escapeHtml(token.patient_name)}</span>
              <span class="tr-meta">
                ${escapeHtml(department?.name || 'Department')} · ${escapeHtml(token.gender)} · ${token.age} yrs · ${escapeHtml(token.phone)}
              </span>
            </div>
            <div class="tr-right" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              ${actions}
            </div>
          </div>
        `;
      }).join('');
    } catch (error) {
      console.error('Unable to load today’s tokens.', error);
    }
  }

  function serviceMinutesFromMetrics(metrics) {
    if (!metrics?.mu_per_hour || metrics.mu_per_hour <= 0) return 0;
    return 60 / metrics.mu_per_hour;
  }

  async function renderQueueManagement() {
    const hospitalId = byId('qm-hospital')?.value;
    const departmentId = byId('qm-department')?.value;
    if (!hospitalId || !departmentId) return;

    try {
      const [queue, metrics] = await Promise.all([
        api.get(`/departments/${encodeURIComponent(departmentId)}/queue`),
        api.get(
          `/hospitals/${encodeURIComponent(hospitalId)}/departments/${encodeURIComponent(departmentId)}/metrics`,
        ).catch(() => null),
      ]);

      renderNowServing(queue.now_serving, departmentId, queue.waiting.length);
      renderWaitingQueue(queue.waiting, serviceMinutesFromMetrics(metrics));
    } catch (error) {
      console.error('Unable to load queue management data.', error);
      showToast(error.message || 'Could not load this queue.', 'warning');
    }
  }

  function renderNowServing(currentToken, departmentId, waitingCount) {
    const container = byId('qm-serving-detail');
    if (!container) return;

    if (currentToken) {
      container.innerHTML = `
        <div class="serving-active">
          <div class="serving-token-huge">${escapeHtml(currentToken.number)}</div>
          <div class="serving-patient-name">${escapeHtml(currentToken.patient_name)}</div>
          <div class="serving-patient-meta">${currentToken.age} yrs · ${escapeHtml(currentToken.gender)} · 📞 ${escapeHtml(currentToken.phone)}</div>
          <div class="serving-actions" style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn btn-success btn-lg" data-action="complete-visit" data-department-id="${escapeHtml(departmentId)}">✓ Complete Consultation</button>
            <button class="btn btn-outline" data-action="skip-token" data-department-id="${escapeHtml(departmentId)}">Skip</button>
            <button class="btn btn-danger btn-outline" data-action="no-show-token" data-department-id="${escapeHtml(departmentId)}">No-show</button>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="serving-idle" style="text-align:center; padding:30px 20px;">
        <p style="color:var(--text-muted); margin-bottom:16px;">Counter is currently idle.</p>
        <button
          class="btn btn-primary btn-lg"
          data-action="call-next"
          data-department-id="${escapeHtml(departmentId)}"
          ${waitingCount === 0 ? 'disabled' : ''}
        >
          📢 Call Next Patient
        </button>
      </div>
    `;
  }

  function renderWaitingQueue(waitingTokens, serviceMinutes) {
    const summary = byId('qm-queue-summary');
    const container = byId('qm-waiting-list');

    if (summary) {
      summary.textContent = `${waitingTokens.length} patients waiting · About ${serviceMinutes.toFixed(1)} minutes per visit`;
    }
    if (!container) return;

    if (!waitingTokens.length) {
      container.innerHTML = '<div class="empty-row">Queue is empty.</div>';
      return;
    }

    container.innerHTML = waitingTokens.map((token, index) => `
      <div class="token-row">
        <div class="tr-left">
          <span class="tr-num">${escapeHtml(token.number)}</span>
          <span class="tr-name">${escapeHtml(token.patient_name)}</span>
          <span class="tr-meta">Position #${(token.ahead ?? index) + 1} · Est. Wait: ~${token.wait_minutes ?? 0} min</span>
        </div>
        <div class="tr-right">
          <span class="badge badge-waiting">Waiting</span>
        </div>
      </div>
    `).join('');
  }

  async function callNext(departmentId) {
    showLoading('Calling next patient…');

    try {
      const token = await api.post(`/departments/${encodeURIComponent(departmentId)}/call-next`);
      showToast(`Called token ${token.number}`, 'success');
      await renderQueueManagement();
    } catch (error) {
      console.error('Unable to call the next patient.', error);
      showToast(error.message || 'Could not call the next patient.', 'warning');
    } finally {
      hideLoading();
    }
  }

  async function resolveCurrentToken(departmentId, status, successMessage) {
    showLoading(status === 'completed' ? 'Recording completed visit…' : 'Updating token…');

    try {
      await api.post(`/departments/${encodeURIComponent(departmentId)}/resolve`, { status });
      showToast(successMessage, status === 'completed' ? 'success' : 'info');
      await renderQueueManagement();
    } catch (error) {
      console.error(`Unable to mark token as ${status}.`, error);
      showToast(error.message || 'Could not update the token.', 'warning');
    } finally {
      hideLoading();
    }
  }

  function promptSkipToken(departmentId) {
    showConfirm('Skip Patient', 'Skip this patient? They will need to re-register.', () => (
      resolveCurrentToken(departmentId, 'skipped', 'Token skipped.')
    ));
  }

  function promptNoShowToken(departmentId) {
    showConfirm('Mark No-Show', 'Mark this patient as a no-show?', () => (
      resolveCurrentToken(departmentId, 'noshow', 'Marked as no-show.')
    ));
  }

  function percentage(part, total) {
    return total ? (part / total) * 100 : 0;
  }

  async function renderBedGrid() {
    const hospitalId = byId('bed-hospital')?.value;
    if (!hospitalId) return;

    try {
      const beds = await api.get(`/hospitals/${encodeURIComponent(hospitalId)}/beds`);
      state.bedsById = new Map(beds.map((bed) => [bed.id, bed]));

      const counts = beds.reduce((summary, bed) => {
        summary[bed.status] = (summary[bed.status] || 0) + 1;
        return summary;
      }, {});

      const total = beds.length;
      const occupied = counts.occupied || 0;
      const available = counts.available || 0;
      const cleaning = counts.cleaning || 0;
      const maintenance = counts.maintenance || 0;

      renderBedSummary({ total, occupied, available, cleaning, maintenance });
      renderBeds(beds);
    } catch (error) {
      console.error('Unable to load bed availability.', error);
      showToast(error.message || 'Could not load bed availability.', 'warning');
    }
  }

  function renderBedSummary({ total, occupied, available, cleaning, maintenance }) {
    const container = byId('bed-summary-bar');
    if (!container) return;

    container.innerHTML = `
      <div class="card" style="padding:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <strong>Ward Bed Occupancy</strong>
          <span>${occupied} / ${total} Beds Occupied (${Math.round(percentage(occupied, total))}%)</span>
        </div>
        <div class="bed-bar" style="display:flex; height:12px; border-radius:6px; overflow:hidden; background:var(--surface-sunken);">
          <div style="width:${percentage(occupied, total)}%; background:var(--danger);"></div>
          <div style="width:${percentage(cleaning, total)}%; background:var(--warning);"></div>
          <div style="width:${percentage(maintenance, total)}%; background:var(--text-faint);"></div>
          <div style="width:${percentage(available, total)}%; background:var(--success);"></div>
        </div>
        <div style="display:flex; gap:16px; margin-top:10px; font-size:13px; color:var(--text-muted);">
          <span>● ${available} Available</span>
          <span>● ${occupied} Occupied</span>
          <span>● ${cleaning} Cleaning</span>
          <span>● ${maintenance} Maintenance</span>
        </div>
      </div>
    `;
  }

  function renderBeds(beds) {
    const grid = byId('bed-grid');
    if (!grid) return;

    grid.innerHTML = beds.map((bed) => `
      <div class="bed-card bed-${escapeHtml(bed.status)}" data-bed-id="${escapeHtml(bed.id)}">
        <div class="bed-num">Bed #${bed.number}</div>
        <div class="bed-status-tag">${escapeHtml(bed.status)}</div>
        <div class="bed-patient">${bed.patient_name ? escapeHtml(bed.patient_name) : '—'}</div>
      </div>
    `).join('');
  }

  function openBedModal(bedId) {
    const bed = state.bedsById.get(bedId);
    if (!bed) return;

    state.modalBed = bed;
    byId('modal-bed-title').textContent = `Edit Bed #${bed.number}`;
    byId('bed-status-select').value = bed.status;
    byId('bed-patient-name').value = bed.patient_name || '';
    byId('bed-patient-field').classList.toggle('hidden', bed.status !== 'occupied');
    byId('bed-modal').classList.remove('hidden');
  }

  function closeBedModal() {
    state.modalBed = null;
    byId('bed-modal')?.classList.add('hidden');
  }

  async function saveBedChanges() {
    if (!state.modalBed) return;

    const status = byId('bed-status-select').value;
    const patientName = byId('bed-patient-name').value.trim();
    showLoading('Updating bed…');

    try {
      await api.patch(`/beds/${encodeURIComponent(state.modalBed.id)}`, {
        status,
        patient_name: status === 'occupied' ? patientName : '',
      });
      closeBedModal();
      await renderBedGrid();
      showToast('Bed status updated.', 'success');
    } catch (error) {
      console.error('Unable to update the bed.', error);
      showToast(error.message || 'Could not update the bed.', 'warning');
    } finally {
      hideLoading();
    }
  }

  function promptReleaseBed() {
    if (!state.modalBed) return;
    const bedId = state.modalBed.id;

    showConfirm(
      'Release Bed',
      'Mark this bed as available and discharge the patient?',
      async () => {
        showLoading('Releasing bed…');

        try {
          await api.post(`/beds/${encodeURIComponent(bedId)}/release`);
          closeBedModal();
          await renderBedGrid();
          showToast('Bed released.', 'success');
        } catch (error) {
          console.error('Unable to release the bed.', error);
          showToast(error.message || 'Could not release the bed.', 'warning');
        } finally {
          hideLoading();
        }
      },
    );
  }

  async function renderAdminStats() {
    const scope = byId('admin-hospital')?.value || 'all';

    try {
      const alertQuery = scope === 'all' ? '' : `?hospital_id=${encodeURIComponent(scope)}`;
      const [stats, alerts] = await Promise.all([
        api.get(`/admin/stats?scope=${encodeURIComponent(scope)}`),
        api.get(`/admin/alerts${alertQuery}`),
      ]);

      renderAdminCards(stats);
      renderAdminAlerts(alerts);
    } catch (error) {
      console.error('Unable to load administration data.', error);
      showToast(error.message || 'Could not load administration data.', 'warning');
    }
  }

  function renderAdminCards(stats) {
    const grid = byId('admin-stats-grid');
    if (!grid) return;

    grid.innerHTML = `
      <div class="card stat-card">
        <div class="sc-num" style="color:var(--primary);">${stats.total_waiting}</div>
        <div class="sc-lbl">Total Patients in Queue</div>
      </div>
      <div class="card stat-card">
        <div class="sc-num" style="color:var(--success);">${stats.total_beds}</div>
        <div class="sc-lbl">Total Hospital Beds</div>
      </div>
      <div class="card stat-card">
        <div class="sc-num" style="color:var(--danger);">${stats.occupied_pct}%</div>
        <div class="sc-lbl">Bed Occupancy Rate</div>
      </div>
      <div class="card stat-card">
        <div class="sc-num" style="color:var(--warning);">${(stats.avg_utilization * 100).toFixed(1)}%</div>
        <div class="sc-lbl">Counter Workload</div>
      </div>
    `;
  }

  function renderAdminAlerts(alerts) {
    const list = byId('admin-alerts-list');
    if (!list) return;

    if (!alerts.length) {
      list.innerHTML = '<div class="empty-row">No capacity alerts at this time.</div>';
      return;
    }

    list.innerHTML = alerts.map((alert) => `
      <div class="alert-card alert-${escapeHtml(alert.severity)}">
        <div class="alert-left">
          <strong class="alert-title">${escapeHtml(alert.department_name)} · ${escapeHtml(alert.hospital_name)}</strong>
          <p class="alert-msg">${escapeHtml(alert.message)}</p>
        </div>
        <span class="badge badge-${alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'ok'}">
          ${escapeHtml(alert.severity.toUpperCase())}
        </span>
      </div>
    `).join('');
  }

  async function handleRegistration(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const errorElement = byId('reg-error');
    const hospitalId = byId('reg-hospital').value;
    const departmentId = byId('reg-department').value;
    const patientName = byId('reg-name').value.trim();
    const age = byId('reg-age').value;
    const gender = byId('reg-gender').value;
    const phone = byId('reg-phone').value.trim();

    if (!hospitalId || !departmentId || !patientName || !age || Number(age) <= 0 || !gender || !phone) {
      showFormError(errorElement, 'Please fill in all fields with valid details.');
      return;
    }

    clearFormError(errorElement);
    showLoading('Generating token…');

    try {
      const token = await api.post('/tokens', {
        hospital_id: hospitalId,
        department_id: departmentId,
        patient_name: patientName,
        age: Number(age),
        gender,
        phone,
      });

      showToast(`Token issued: ${token.number}`, 'success');
      form.reset();
      updateDepartmentSelect(byId('reg-department'), byId('reg-hospital').value);
      await renderTodaysTokens();
    } catch (error) {
      console.error('Direct token registration failed.', error);
      showToast(error.message || 'Could not register the token.', 'warning');
    } finally {
      hideLoading();
    }
  }

  function switchTab(button) {
    const tabName = button.dataset.staffTab;
    state.activeTab = tabName;

    document.querySelectorAll('.tab-btn').forEach((tabButton) => {
      tabButton.classList.toggle('active', tabButton === button);
    });
    document.querySelectorAll('.staff-tab').forEach((panel) => panel.classList.remove('active'));
    byId(`tab-${tabName}`)?.classList.add('active');

    if (tabName === 'reception') Promise.all([renderPendingTokens(), renderTodaysTokens()]);
    if (tabName === 'queue-mgmt') renderQueueManagement();
    if (tabName === 'bed-mgmt') renderBedGrid();
    if (tabName === 'admin') renderAdminStats();
  }

  function handleDashboardClick(event) {
    const tabButton = event.target.closest('[data-staff-tab]');
    if (tabButton) {
      switchTab(tabButton);
      return;
    }

    const bedCard = event.target.closest('[data-bed-id]');
    if (bedCard) {
      openBedModal(bedCard.dataset.bedId);
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;

    const { action, tokenId, departmentId } = actionButton.dataset;

    if (action === 'approve-token') approveToken(tokenId);
    if (action === 'hold-token') holdToken(tokenId);
    if (action === 'reject-token') promptRejectToken(tokenId);
    if (action === 'call-next') callNext(departmentId);
    if (action === 'complete-visit') resolveCurrentToken(departmentId, 'completed', 'Consultation marked as completed.');
    if (action === 'skip-token') promptSkipToken(departmentId);
    if (action === 'no-show-token') promptNoShowToken(departmentId);
  }

  function handleWebSocketEvent(message) {
    const event = message.event;
    const data = message.data || {};

    if (event === 'token_requested') {
      showToast(`New patient check-in request: ${data.patient_name || 'Patient'}`, 'info');
      Promise.all([renderPendingTokens(), renderTodaysTokens()]);
      return;
    }

    if (event === 'token_approved' || event === 'token_rejected' || event === 'token_held') {
      Promise.all([renderPendingTokens(), renderTodaysTokens()]);
      if (state.activeTab === 'queue-mgmt') renderQueueManagement();
      return;
    }

    if (event === 'queue_update' || event === 'token_called') {
      renderTodaysTokens();
      if (state.activeTab === 'queue-mgmt') renderQueueManagement();
      if (state.activeTab === 'admin') renderAdminStats();
      return;
    }

    if (event === 'bed_updated') {
      if (state.activeTab === 'bed-mgmt') renderBedGrid();
      if (state.activeTab === 'admin') renderAdminStats();
    }
  }

  async function logout() {
    showLoading('Logging out…');

    try {
      await api.post('/auth/hospital-logout');
    } catch (error) {
      console.warn('The server did not confirm logout; redirecting anyway.', error);
    }

    window.location.href = appUrl('/hospital/login');
  }

  function bindDashboardEvents() {
    document.addEventListener('click', handleDashboardClick);
    byId('register-form')?.addEventListener('submit', handleRegistration);

    byId('reg-hospital')?.addEventListener('change', (event) => {
      updateDepartmentSelect(byId('reg-department'), event.target.value);
      renderTodaysTokens();
    });
    byId('qm-hospital')?.addEventListener('change', (event) => {
      updateDepartmentSelect(byId('qm-department'), event.target.value);
      renderQueueManagement();
    });
    byId('qm-department')?.addEventListener('change', renderQueueManagement);
    byId('bed-hospital')?.addEventListener('change', renderBedGrid);
    byId('admin-hospital')?.addEventListener('change', renderAdminStats);

    byId('refresh-pending-btn')?.addEventListener('click', renderPendingTokens);
    byId('refresh-tokens-btn')?.addEventListener('click', renderTodaysTokens);
    byId('refresh-queue-btn')?.addEventListener('click', renderQueueManagement);

    byId('bed-status-select')?.addEventListener('change', (event) => {
      byId('bed-patient-field').classList.toggle('hidden', event.target.value !== 'occupied');
    });
    byId('close-bed-modal-btn')?.addEventListener('click', closeBedModal);
    byId('cancel-bed-btn')?.addEventListener('click', closeBedModal);
    byId('save-bed-btn')?.addEventListener('click', saveBedChanges);
    byId('release-bed-btn')?.addEventListener('click', promptReleaseBed);
    byId('bed-modal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeBedModal();
    });

    byId('logout-btn')?.addEventListener('click', () => {
      showConfirm('Log Out', 'Are you sure you want to log out of the hospital portal?', logout);
    });

    byId('confirm-yes')?.addEventListener('click', () => {
      const onConfirm = state.pendingConfirm;
      hideConfirm();
      onConfirm?.();
    });
    byId('confirm-no')?.addEventListener('click', hideConfirm);
    byId('confirm-modal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) hideConfirm();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!byId('bed-modal')?.classList.contains('hidden')) closeBedModal();
      if (!byId('confirm-modal')?.classList.contains('hidden')) hideConfirm();
    });
  }

  async function initializeHospitalDashboard() {
    bindDashboardEvents();
    connectWebSocket(handleWebSocketEvent, 'Hospital');

    try {
      await fetchHospitals();
      await Promise.all([renderPendingTokens(), renderTodaysTokens()]);
    } catch (error) {
      console.error('Unable to initialize the hospital dashboard.', error);
      showToast(error.message || 'Could not load the hospital dashboard.', 'warning');
    }
  }

  window.approveToken = approveToken;
  window.promptRejectToken = promptRejectToken;
  window.callNext = callNext;
  window.completeVisit = (departmentId) => resolveCurrentToken(
    departmentId,
    'completed',
    'Consultation marked as completed.',
  );
  window.skipToken = promptSkipToken;
  window.noShowToken = promptNoShowToken;
  window.openBedModal = openBedModal;

  document.addEventListener('DOMContentLoaded', initializeHospitalDashboard);
}());
