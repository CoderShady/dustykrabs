/** Public hospital insight pages: wait times, bed availability, and crowd predictions. */

'use strict';

(function createHospitalInsights() {
  const { api, byId, escapeHtml, hideLoading, showLoading, showToast } = window.OPD;
  const pageType = document.body.dataset.insightPage;
  if (!['wait', 'beds', 'crowd'].includes(pageType)) return;

  const PAGE_LABELS = {
    wait: 'wait times',
    beds: 'bed availability',
    crowd: 'crowd predictions',
  };

  const state = {
    hospitals: [],
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

  function hospitalQuickFact(hospital) {
    if (pageType === 'wait') {
      return `${hospital.avg_wait_minutes || 0} min avg · ${hospital.department_count || 0} departments`;
    }
    if (pageType === 'beds') {
      return `${hospital.total_inpatient_beds ?? '—'} declared beds`;
    }
    return `${hospital.total_waiting || 0} patients currently queued`;
  }

  function filteredHospitals() {
    const query = byId('insight-hospital-search')?.value.trim().toLowerCase() || '';
    return state.hospitals.filter((hospital) => searchableText(hospital).includes(query));
  }

  function renderHospitalResults() {
    const results = byId('insight-hospital-results');
    const status = byId('insight-hospital-status');
    if (!results || !status) return;

    const query = byId('insight-hospital-search')?.value.trim() || '';
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
        data-hospital-id="${escapeHtml(hospital.id)}"
      >
        <span class="insight-option-main">
          <strong>${escapeHtml(hospital.name)}</strong>
          <small>📍 ${escapeHtml(hospitalMeta(hospital))}</small>
        </span>
        <span class="insight-option-meta">
          ${escapeHtml(hospitalQuickFact(hospital))}<br>
          <b>View details →</b>
        </span>
      </button>
    `).join('');
  }

  function metricCard(value, label, tone = '') {
    return `
      <div class="insight-stat-card ${tone ? `tone-${tone}` : ''}">
        <span class="insight-stat-value">${escapeHtml(value)}</span>
        <span class="insight-stat-label">${escapeHtml(label)}</span>
      </div>
    `;
  }

  function renderSelectedHospitalHeading(hospital) {
    byId('insight-hospital-heading').innerHTML = `
      <p class="eyebrow">Selected hospital</p>
      <h2>${escapeHtml(hospital.name)}</h2>
      <p class="insight-location">📍 ${escapeHtml(hospitalMeta(hospital))}</p>
    `;
  }

  function waitTone(minutes) {
    if (minutes <= 15) return 'success';
    if (minutes <= 30) return 'warning';
    return 'danger';
  }

  function waitLabel(minutes) {
    if (minutes <= 15) return 'Short wait';
    if (minutes <= 30) return 'Moderate wait';
    return 'Longer wait';
  }

  function renderWaitTimes(hospital) {
    const departments = [...hospital.departments]
      .sort((first, second) => second.estimated_wait_minutes - first.estimated_wait_minutes);

    byId('insight-summary').innerHTML = [
      metricCard(`${hospital.avg_wait_minutes || 0} min`, 'Average predicted wait'),
      metricCard(hospital.total_waiting || 0, 'Patients across live queues'),
      metricCard(hospital.department_count || departments.length, 'Declared departments'),
    ].join('');

    if (!departments.length) {
      byId('insight-details').innerHTML = `
        <div class="card insight-empty-data">
          <span class="empty-icon">⏱️</span>
          <h3>Department-level wait data is not configured yet</h3>
          <p>This hospital has ${hospital.department_count || 0} declared departments, but their queue definitions have not been added to the database. Live wait predictions will appear here when those records are available.</p>
        </div>
      `;
      return;
    }

    byId('insight-details').innerHTML = `
      <div class="insight-section-heading">
        <div><h2>Department wait predictions</h2><p>Calculated from the current queue and active consultation counters.</p></div>
      </div>
      <div class="insight-detail-grid">
        ${departments.map((department) => {
          const wait = Number(department.estimated_wait_minutes || 0);
          const tone = waitTone(wait);
          const meterWidth = Math.min(100, Math.max(4, (wait / 60) * 100));
          return `
            <article class="insight-detail-card wait-detail tone-${tone}">
              <div class="insight-card-top">
                <div><h3>${escapeHtml(department.name)}</h3><span class="badge badge-${tone === 'danger' ? 'critical' : tone === 'warning' ? 'warning' : 'ok'}">${waitLabel(wait)}</span></div>
                <strong class="wait-prediction">${wait} min</strong>
              </div>
              <div class="prediction-meter"><span style="width:${meterWidth}%"></span></div>
              <dl class="insight-facts">
                <div><dt>Queue</dt><dd>${department.queue_size} patient${department.queue_size === 1 ? '' : 's'}</dd></div>
                <div><dt>Now serving</dt><dd>${escapeHtml(department.now_serving || 'Not active')}</dd></div>
                <div><dt>Active counters</dt><dd>${department.num_counters}</dd></div>
              </dl>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function capacityOutlook(stats, trackedCount) {
    if (!trackedCount) {
      return {
        tone: 'muted',
        title: 'Capacity listed; live tracking pending',
        copy: 'The hospital’s declared capacity is available, but individual bed-status records have not been configured yet.',
      };
    }
    if (stats.occupied_pct >= 90) {
      return { tone: 'danger', title: 'High occupancy pressure', copy: 'Bed capacity is tight. Confirm availability with the hospital before planning an admission.' };
    }
    if (stats.occupied_pct >= 70) {
      return { tone: 'warning', title: 'Capacity should be watched', copy: 'Beds remain available, but current occupancy is approaching a busy level.' };
    }
    return { tone: 'success', title: 'Capacity outlook is comfortable', copy: 'Tracked occupancy is currently below the hospital’s warning level.' };
  }

  function renderBeds(hospital, beds, stats) {
    const counts = beds.reduce((summary, bed) => {
      summary[bed.status] = (summary[bed.status] || 0) + 1;
      return summary;
    }, {});
    const outlook = capacityOutlook(stats, beds.length);

    byId('insight-summary').innerHTML = [
      metricCard(stats.total_beds, 'Declared bed capacity'),
      metricCard(stats.available_beds, beds.length ? 'Estimated available beds' : 'Capacity not marked occupied', 'success'),
      metricCard(stats.occupied_beds, 'Tracked occupied beds', stats.occupied_beds ? 'danger' : ''),
      metricCard(`${stats.occupied_pct}%`, 'Tracked occupancy rate'),
    ].join('');

    const bedCards = beds.length
      ? `
        <div class="insight-section-heading"><div><h2>Live tracked beds</h2><p>${beds.length} individual bed records are reporting status.</p></div></div>
        <div class="public-bed-grid">
          ${beds.map((bed) => `
            <article class="public-bed-card bed-${escapeHtml(bed.status)}">
              <strong>Bed #${bed.number}</strong>
              <span class="badge badge-${escapeHtml(bed.status)}">${escapeHtml(bed.status)}</span>
              <small>${bed.status === 'occupied' ? 'Currently occupied' : bed.status === 'available' ? 'Available now' : `Status: ${escapeHtml(bed.status)}`}</small>
            </article>
          `).join('')}
        </div>
      `
      : `
        <div class="card insight-empty-data compact">
          <h3>No individual bed-status feed yet</h3>
          <p>${hospital.name} has a declared capacity of ${stats.total_beds} beds. Occupancy cannot be confirmed until its individual bed records are connected.</p>
        </div>
      `;

    byId('insight-details').innerHTML = `
      <div class="capacity-outlook tone-${outlook.tone}">
        <div class="capacity-outlook-icon">${outlook.tone === 'danger' ? '!' : outlook.tone === 'warning' ? '△' : outlook.tone === 'success' ? '✓' : 'i'}</div>
        <div><p class="eyebrow">Current outlook</p><h3>${escapeHtml(outlook.title)}</h3><p>${escapeHtml(outlook.copy)}</p></div>
      </div>
      ${beds.length ? `
        <div class="bed-capacity-bar" aria-label="Bed occupancy ${stats.occupied_pct}%">
          <span class="bed-capacity-used" style="width:${Math.min(100, stats.occupied_pct)}%"></span>
        </div>
        <div class="bed-capacity-legend">
          <span>${counts.available || 0} tracked available</span>
          <span>${counts.occupied || 0} occupied</span>
          <span>${counts.cleaning || 0} cleaning</span>
          <span>${counts.maintenance || 0} maintenance</span>
        </div>
      ` : ''}
      ${bedCards}
    `;
  }

  function predictionTime(alert) {
    if (alert.eta_hours == null) return 'No overload predicted in the next 6 hours';
    const hours = Number(alert.eta_hours);
    if (hours < 1) return `Capacity may be reached in about ${Math.max(1, Math.round(hours * 60))} minutes`;
    return `Capacity may be reached in about ${hours.toFixed(1)} hours`;
  }

  function renderCrowdPredictions(hospital, alerts, stats) {
    const severityOrder = { critical: 0, warning: 1, ok: 2 };
    const sortedAlerts = [...alerts].sort((first, second) => severityOrder[first.severity] - severityOrder[second.severity]);
    const critical = alerts.filter((alert) => alert.severity === 'critical').length;
    const warning = alerts.filter((alert) => alert.severity === 'warning').length;
    const stable = alerts.filter((alert) => alert.severity === 'ok').length;

    byId('insight-summary').innerHTML = [
      metricCard(critical, 'Critical departments', critical ? 'danger' : 'success'),
      metricCard(warning, 'Departments to watch', warning ? 'warning' : ''),
      metricCard(stable, 'Stable departments', 'success'),
      metricCard(`${Math.round((stats.avg_utilization || 0) * 100)}%`, 'Average counter workload'),
    ].join('');

    if (!sortedAlerts.length) {
      byId('insight-details').innerHTML = `
        <div class="card insight-empty-data">
          <span class="empty-icon">⚠️</span>
          <h3>Department predictions are not configured yet</h3>
          <p>${hospital.name} has ${hospital.department_count || 0} declared departments, but department queue parameters are still needed before crowd forecasts can be calculated.</p>
        </div>
      `;
      return;
    }

    byId('insight-details').innerHTML = `
      <div class="insight-section-heading">
        <div><h2>Department capacity forecast</h2><p>Predictions use current queue growth, service speed, active counters, and configured capacity.</p></div>
      </div>
      <div class="public-alert-list">
        ${sortedAlerts.map((alert) => `
          <article class="public-alert-card alert-${escapeHtml(alert.severity)}">
            <div class="public-alert-icon">${alert.severity === 'critical' ? '!' : alert.severity === 'warning' ? '△' : '✓'}</div>
            <div class="public-alert-copy">
              <div class="insight-card-top">
                <div><h3>${escapeHtml(alert.department_name)}</h3><span class="badge badge-${alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'ok'}">${escapeHtml(alert.severity)}</span></div>
                <strong>${alert.current_queue_len} / ${alert.capacity_threshold}</strong>
              </div>
              <p>${escapeHtml(alert.message)}</p>
              <small>${escapeHtml(predictionTime(alert))} · Net queue change ${Number(alert.net_growth_per_hour).toFixed(1)} patients/hour</small>
            </div>
          </article>
        `).join('')}
      </div>
    `;
  }

  async function selectHospital(hospitalId, options = {}) {
    const hospitalSummary = state.hospitals.find((hospital) => hospital.id === hospitalId);
    if (!hospitalSummary) return;

    state.selectedHospitalId = hospitalId;
    renderHospitalResults();
    showLoading(`Loading ${PAGE_LABELS[pageType]}…`);

    try {
      const detailPromise = api.get(`/hospitals/${encodeURIComponent(hospitalId)}`);
      let detail;

      if (pageType === 'wait') {
        detail = await detailPromise;
        renderSelectedHospitalHeading(detail);
        renderWaitTimes(detail);
      } else if (pageType === 'beds') {
        const [hospital, beds, stats] = await Promise.all([
          detailPromise,
          api.get(`/hospitals/${encodeURIComponent(hospitalId)}/beds`),
          api.get(`/admin/stats?scope=${encodeURIComponent(hospitalId)}`),
        ]);
        detail = hospital;
        renderSelectedHospitalHeading(hospital);
        renderBeds(hospital, beds, stats);
      } else {
        const [hospital, alerts, stats] = await Promise.all([
          detailPromise,
          api.get(`/admin/alerts?hospital_id=${encodeURIComponent(hospitalId)}`),
          api.get(`/admin/stats?scope=${encodeURIComponent(hospitalId)}`),
        ]);
        detail = hospital;
        renderSelectedHospitalHeading(hospital);
        renderCrowdPredictions(hospital, alerts, stats);
      }

      byId('insight-output').classList.remove('hidden');
      const url = new URL(window.location.href);
      url.searchParams.set('hospital', hospitalId);
      window.history.replaceState({}, '', url);
      if (!options.keepPosition) {
        byId('insight-output').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (error) {
      console.error(`Unable to load ${PAGE_LABELS[pageType]}.`, error);
      showToast(error.message || `Could not load ${PAGE_LABELS[pageType]}.`, 'error');
    } finally {
      hideLoading();
    }
  }

  async function loadHospitals() {
    try {
      state.hospitals = await api.get('/hospitals');
      renderHospitalResults();

      const requestedHospital = new URLSearchParams(window.location.search).get('hospital');
      if (requestedHospital && state.hospitals.some((hospital) => hospital.id === requestedHospital)) {
        await selectHospital(requestedHospital);
      }
    } catch (error) {
      console.error('Unable to load participating hospitals.', error);
      byId('insight-hospital-status').textContent = 'Hospitals could not be loaded. Make sure the backend server is running.';
    }
  }

  function bindEvents() {
    byId('insight-hospital-search')?.addEventListener('input', renderHospitalResults);
    byId('insight-hospital-search')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && filteredHospitals().length === 1) {
        event.preventDefault();
        selectHospital(filteredHospitals()[0].id);
      }
    });
    byId('clear-insight-search')?.addEventListener('click', () => {
      byId('insight-hospital-search').value = '';
      renderHospitalResults();
      byId('insight-hospital-search').focus();
    });
    byId('insight-hospital-results')?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-hospital-id]');
      if (option) selectHospital(option.dataset.hospitalId);
    });
    byId('refresh-insight')?.addEventListener('click', () => {
      if (state.selectedHospitalId) selectHospital(state.selectedHospitalId, { keepPosition: true });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadHospitals();
  });
}());
