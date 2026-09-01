/**
 * Shared frontend utilities for the OPD Queue & Bed System.
 *
 * Page-specific behavior lives in patient.js and hospital.js. This file owns the
 * common API, notification, loading, WebSocket, and hospital-login behavior used
 * across those pages.
 */

'use strict';

(function createSharedFrontend() {
  function resolveBackendOrigin() {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

    if (window.location.protocol === 'file:') {
      return 'http://127.0.0.1:8000';
    }

    const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
    if (!isLocalHost) {
      return '';
    }

    const port = window.location.port;
    if (!port || port === '8000') {
      return 'http://127.0.0.1:8000';
    }

    return `${protocol}//${hostname}:8000`;
  }

  const BACKEND_ORIGIN = resolveBackendOrigin();
  const API_BASE = `${BACKEND_ORIGIN}/api`;
  const DEFAULT_TOAST_DURATION = 3500;
  const WEBSOCKET_RETRY_DELAY = 3000;
  const HOSPITAL_COORDINATES = Object.freeze({
    h1: { latitude: 22.5763, longitude: 88.4170 },
    h2: { latitude: 22.5880, longitude: 88.4140 },
    h3: { latitude: 22.5552, longitude: 88.3064 },
  });

  const homeFinderState = {
    hospitals: [],
    location: null,
  };

  class ApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.payload = payload;
    }
  }

  async function request(path, options = {}) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        ...options,
      });

      const contentType = response.headers.get('content-type') || '';
      let payload = null;

      if (response.status !== 204) {
        payload = contentType.includes('application/json')
          ? await response.json()
          : await response.text();
      }

      if (!response.ok) {
        const message = payload?.detail || payload?.message || `Request failed (${response.status}).`;
        throw new ApiError(message, response.status, payload);
      }

      return payload;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      const backendHint = BACKEND_ORIGIN
        ? 'The OPD backend may be offline or unreachable.'
        : 'The frontend is not targeting the OPD backend. Open the app through the main server or start the backend at http://127.0.0.1:8000.';
      throw new ApiError(`${backendHint} ${error.message || 'Failed to fetch.'}`, 0, null);
    }
  }

  function write(method, path, payload) {
    const options = { method };

    if (payload !== undefined) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(payload);
    }

    return request(path, options);
  }

  const api = Object.freeze({
    get: (path) => request(path),
    post: (path, payload) => write('POST', path, payload),
    patch: (path, payload) => write('PATCH', path, payload),
  });

  function byId(id) {
    return document.getElementById(id);
  }

  function appUrl(path) {
    return `${BACKEND_ORIGIN}${path}`;
  }

  function escapeHtml(value) {
    if (value == null) return '';

    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, type = 'info') {
    const container = byId('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    window.setTimeout(() => toast.remove(), DEFAULT_TOAST_DURATION);
  }

  function showLoading(message = 'Loading…') {
    const overlay = byId('loading-overlay');
    const label = byId('loading-text');

    if (label) label.textContent = message;
    if (overlay) overlay.classList.remove('hidden');
  }

  function hideLoading() {
    byId('loading-overlay')?.classList.add('hidden');
  }

  function showFormError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.classList.remove('hidden');
  }

  function clearFormError(element) {
    if (!element) return;
    element.textContent = '';
    element.classList.add('hidden');
  }

  function setButtonBusy(button, isBusy, busyLabel) {
    if (!button) return;

    if (isBusy) {
      button.dataset.originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = busyLabel;
      return;
    }

    button.disabled = false;
    if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  }

  function connectWebSocket(onEvent, label = 'App') {
    let socket = null;
    let reconnectTimer = null;
    let stopped = false;

    function connect() {
      if (stopped) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = BACKEND_ORIGIN ? new URL(BACKEND_ORIGIN).host : window.location.host;
      const url = `${protocol}//${host}/ws`;

      try {
        socket = new WebSocket(url);
        socket.addEventListener('open', () => console.info(`${label} WebSocket connected.`));
        socket.addEventListener('message', (event) => {
          try {
            onEvent(JSON.parse(event.data));
          } catch (error) {
            console.warn(`${label} received an invalid WebSocket message.`, error);
          }
        });
        socket.addEventListener('close', () => {
          if (!stopped) {
            reconnectTimer = window.setTimeout(connect, WEBSOCKET_RETRY_DELAY);
          }
        });
        socket.addEventListener('error', () => socket?.close());
      } catch (error) {
        console.warn(`${label} WebSocket connection failed.`, error);
        reconnectTimer = window.setTimeout(connect, WEBSOCKET_RETRY_DELAY);
      }
    }

    function close() {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    }

    connect();
    window.addEventListener('pagehide', close, { once: true });
    return { close };
  }

  async function handleHospitalLogin(event) {
    event.preventDefault();

    const username = byId('hospital-username')?.value.trim();
    const password = byId('hospital-password')?.value || '';
    const errorElement = byId('hospital-login-error');
    const submitButton = byId('hospital-login-btn');

    if (!username || !password) {
      showFormError(errorElement, 'Please enter both username and password.');
      return;
    }

    clearFormError(errorElement);
    setButtonBusy(submitButton, true, 'Authenticating…');

    try {
      const result = await api.post('/auth/hospital-login', { username, password });

      if (!result.success) {
        showFormError(
          errorElement,
          result.message || 'Invalid credentials. Please try staff / staff123.',
        );
        setButtonBusy(submitButton, false);
        return;
      }

      showToast('Authenticated successfully! Redirecting…', 'success');
      window.setTimeout(() => {
        window.location.href = appUrl('/hospital');
      }, 400);
    } catch (error) {
      console.error('Hospital login failed.', error);
      showFormError(errorElement, error.message || 'Server connection error. Please try again.');
      setButtonBusy(submitButton, false);
    }
  }

  function distanceInKm(from, to) {
    const earthRadiusKm = 6371;
    const toRadians = (degrees) => degrees * (Math.PI / 180);
    const latitudeChange = toRadians(to.latitude - from.latitude);
    const longitudeChange = toRadians(to.longitude - from.longitude);
    const firstLatitude = toRadians(from.latitude);
    const secondLatitude = toRadians(to.latitude);
    const a = Math.sin(latitudeChange / 2) ** 2
      + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeChange / 2) ** 2;

    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function hospitalsForFinder(searchText = '') {
    const query = searchText.trim().toLowerCase();
    const hospitals = homeFinderState.hospitals
      .filter((hospital) => `${hospital.name} ${hospital.location}`.toLowerCase().includes(query))
      .map((hospital) => {
        const coordinates = HOSPITAL_COORDINATES[hospital.id];
        const distance = homeFinderState.location && coordinates
          ? distanceInKm(homeFinderState.location, coordinates)
          : null;
        return { ...hospital, distance };
      });

    if (homeFinderState.location) {
      hospitals.sort((first, second) => (first.distance ?? Infinity) - (second.distance ?? Infinity));
    }

    return hospitals;
  }

  function renderHospitalFinder() {
    const results = byId('hospital-finder-results');
    const status = byId('hospital-finder-status');
    const searchInput = byId('hospital-search-input');
    if (!results || !status) return;

    const hospitals = hospitalsForFinder(searchInput?.value || '');
    const hasSearch = Boolean(searchInput?.value.trim());

    if (!hospitals.length) {
      status.textContent = hasSearch
        ? 'No participating hospitals match that search.'
        : 'No participating hospitals are available right now.';
      results.innerHTML = '';
      return;
    }

    if (hasSearch) {
      status.textContent = `${hospitals.length} hospital${hospitals.length === 1 ? '' : 's'} found`;
    } else if (homeFinderState.location) {
      status.textContent = 'Hospitals nearest to your live location';
    } else {
      status.textContent = `${hospitals.length} participating hospitals`;
    }

    results.innerHTML = hospitals.map((hospital) => {
      const distanceLabel = hospital.distance == null
        ? `${hospital.avg_wait_minutes || 0} min average wait`
        : `${hospital.distance.toFixed(1)} km away`;

      return `
        <a class="finder-hospital" href="./patient.html?hospital=${encodeURIComponent(hospital.id)}">
          <div>
            <h3>${escapeHtml(hospital.name)}</h3>
            <p>📍 ${escapeHtml(hospital.location)}</p>
          </div>
          <div class="finder-hospital-meta">
            <span>${escapeHtml(distanceLabel)}</span><br>
            <span>${hospital.department_count || 0} departments →</span>
          </div>
        </a>
      `;
    }).join('');
  }

  async function loadHospitalFinder() {
    const status = byId('hospital-finder-status');
    if (homeFinderState.hospitals.length) {
      renderHospitalFinder();
      return;
    }

    if (status) status.textContent = 'Loading participating hospitals…';

    try {
      homeFinderState.hospitals = await api.get('/hospitals');
      renderHospitalFinder();
    } catch (error) {
      console.error('Unable to load the hospital finder.', error);
      if (status) {
        status.textContent = window.location.protocol === 'file:'
          ? 'Start the hospital server, then try again.'
          : 'Hospitals could not be loaded. Please try again.';
      }
    }
  }

  function openHospitalFinder(event) {
    event?.preventDefault();
    byId('hospital-finder-modal')?.classList.remove('hidden');
    loadHospitalFinder();
    window.setTimeout(() => byId('hospital-search-input')?.focus(), 50);
  }

  function closeHospitalFinder() {
    byId('hospital-finder-modal')?.classList.add('hidden');
  }

  function requestLiveLocation() {
    const button = byId('use-location-btn');
    const status = byId('hospital-finder-status');

    if (!navigator.geolocation) {
      if (status) status.textContent = 'Live location is not available. Search by landmark or city instead.';
      return;
    }

    setButtonBusy(button, true, 'Getting your location…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        homeFinderState.location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setButtonBusy(button, false);
        if (button) button.textContent = '✓ Live location enabled';
        renderHospitalFinder();
      },
      () => {
        setButtonBusy(button, false);
        if (status) status.textContent = 'Location was not shared. Search by landmark or city instead.';
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
    );
  }

  function initializeHospitalFinder() {
    byId('patient-entry-btn')?.addEventListener('click', openHospitalFinder);
    byId('close-hospital-finder')?.addEventListener('click', closeHospitalFinder);
    byId('use-location-btn')?.addEventListener('click', requestLiveLocation);
    byId('hospital-search-input')?.addEventListener('input', renderHospitalFinder);
    byId('hospital-finder-modal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeHospitalFinder();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeHospitalFinder();
    });
  }

  function initializeSharedPage() {
    byId('hospital-login-form')?.addEventListener('submit', handleHospitalLogin);
    initializeHospitalFinder();
  }

  window.OPD = Object.freeze({
    ApiError,
    api,
    appUrl,
    byId,
    clearFormError,
    connectWebSocket,
    escapeHtml,
    hideLoading,
    setButtonBusy,
    showFormError,
    showLoading,
    showToast,
  });

  document.addEventListener('DOMContentLoaded', initializeSharedPage);
}());
