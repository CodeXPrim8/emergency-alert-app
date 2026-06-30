const API = '/api/v1';
const SOS_LIVE_KEY = 'sosLiveSession';
let token = localStorage.getItem('token');
let currentUser = null;
let isRegister = false;
let activeAlert = null;
let countdownTimer = null;
let pollTimer = null;
let liveAlertId = null;
let liveBroadcastTimer = null;
let pushSubscription = null;
const seenAlerts = new Set(JSON.parse(localStorage.getItem('seenAlerts') || '[]'));
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const isAndroid = /Android/i.test(navigator.userAgent);
let deferredInstallPrompt = null;
let locationWatchId = null;
let gpsRadar = null;
let compassListener = null;
let compassClickHandler = null;
let lastCompassHeadingAt = 0;
let compassPermissionState = 'unknown';
let contactDistressAlert = null;
let pendingCompassHeading = null;
let compassRafScheduled = false;
let compassHintHandler = null;
let hardwareStore = null;
let lastGeocodedKey = null;
let geocodeInFlight = null;
let lastServerLocationSend = 0;
let lastSentLocation = null;
let lastBestLocation = null;
let wakeLockRef = null;
let lastLivePushAt = 0;
const LIVE_PUSH_MIN_MS = isMobile ? 4000 : 8000;
const LIVE_BROADCAST_MS = isMobile ? 5000 : 10000;

function cacheLocation(loc) {
  const entry = {
    latitude: loc.latitude,
    longitude: loc.longitude,
    accuracy: loc.accuracy ?? null,
    timestamp: Date.now(),
  };
  localStorage.setItem('lastKnownLocation', JSON.stringify(entry));
  return entry;
}

function loadCachedLocation(maxAgeMs = 600000) {
  try {
    const raw = localStorage.getItem('lastKnownLocation');
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.timestamp < maxAgeMs) return entry;
  } catch (_) {}
  return null;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function positionToLocation(pos) {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? null,
    altitude: pos.coords.altitude ?? null,
    speed: pos.coords.speed ?? null,
    heading: pos.coords.heading ?? null,
    timestamp: pos.timestamp || Date.now(),
  };
}

function isMoreAccurate(newLoc, oldLoc) {
  if (!oldLoc) return true;
  if (newLoc.accuracy == null) return false;
  if (oldLoc.accuracy == null) return true;
  return newLoc.accuracy < oldLoc.accuracy;
}

function setBestLocation(loc) {
  if (isMoreAccurate(loc, lastBestLocation) || !lastBestLocation) {
    lastBestLocation = { ...loc, timestamp: Date.now() };
  }
  cacheLocation(lastBestLocation);
  return lastBestLocation;
}

function geocodeKey(lat, lng) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

async function resolvePlaceName(lat, lng) {
  const key = geocodeKey(lat, lng);
  if (lastGeocodedKey === key && resolvePlaceName.lastResult) {
    return resolvePlaceName.lastResult;
  }

  if (geocodeInFlight?.key === key) return geocodeInFlight.promise;

  const promise = fetch(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
  )
    .then((r) => r.json())
    .then((data) => {
      const parts = [data.locality, data.city, data.principalSubdivision, data.countryName]
        .filter(Boolean);
      const unique = [...new Set(parts)];
      const name = unique.slice(0, 2).join(', ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      lastGeocodedKey = key;
      resolvePlaceName.lastResult = name;
      return name;
    })
    .catch(() => `${lat.toFixed(4)}, ${lng.toFixed(4)}`);

  geocodeInFlight = { key, promise };
  try {
    return await promise;
  } finally {
    if (geocodeInFlight?.key === key) geocodeInFlight = null;
  }
}

async function syncRadarUI(loc) {
  if (!gpsRadar) return;
  if (loc) {
    const acc = loc.accuracy != null ? ` ±${Math.round(loc.accuracy)}m` : '';
    gpsRadar
      .setState('locked')
      .setLabel('')
      .setCoordinates(loc.latitude, loc.longitude)
      .setCaption(`${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}${acc}`);

    if (loc.heading != null && !Number.isNaN(loc.heading)) {
      applyGpsHeading(loc);
    }

    resolvePlaceName(loc.latitude, loc.longitude).then((name) => {
      if (lastBestLocation && geocodeKey(lastBestLocation.latitude, lastBestLocation.longitude) === geocodeKey(loc.latitude, loc.longitude)) {
        gpsRadar?.setLocation(name);
      }
    });
    return;
  }
  lastGeocodedKey = null;
  resolvePlaceName.lastResult = null;
  gpsRadar.setState('idle').setLabel('').setLocation('').setCaption('');
}

function updateDistressRadarBlip() {
  if (!gpsRadar) return;

  if (!contactDistressAlert || !lastBestLocation) {
    gpsRadar.setDistressTarget(null);
    return;
  }

  const lat = contactDistressAlert.live_latitude ?? contactDistressAlert.latitude;
  const lng = contactDistressAlert.live_longitude ?? contactDistressAlert.longitude;

  gpsRadar.setDistressTarget(
    {
      alertId: contactDistressAlert.id,
      name: contactDistressAlert.user_name,
      latitude: lat,
      longitude: lng,
      onSelect: (t) => openLiveMap(t.alertId),
    },
    {
      latitude: lastBestLocation.latitude,
      longitude: lastBestLocation.longitude,
    }
  );
}

async function pollContactDistress() {
  if (!token) return;
  try {
    const { alert } = await api('/emergency/contacts-in-distress');
    contactDistressAlert = alert || null;
    updateDistressRadarBlip();
    if (alert && gpsRadar) {
      gpsRadar.setLabel(`${alert.user_name} — SOS`);
    } else if (gpsRadar && lastBestLocation) {
      gpsRadar.setLabel('');
    }
  } catch (_) {}
}

function applyCompassHeading(heading) {
  if (heading == null || Number.isNaN(heading)) return;
  lastCompassHeadingAt = Date.now();
  if (gpsRadar) {
    gpsRadar.setHeading(heading);
    gpsRadar.setCompassLive(true);
    gpsRadar.setCompassHint('');
    updateDistressRadarBlip();
  }
}

function applyGpsHeading(loc) {
  if (!loc || loc.heading == null || Number.isNaN(loc.heading)) return;
  const recentCompass = lastCompassHeadingAt && Date.now() - lastCompassHeadingAt < 2500;
  const moving = loc.speed != null && loc.speed > 1;
  if (recentCompass && !moving) return;
  applyCompassHeading(loc.heading);
}

function extractCompassHeading(event) {
  if (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)) {
    return ((event.webkitCompassHeading % 360) + 360) % 360;
  }
  if (event.absolute && event.alpha != null && Number.isFinite(event.alpha)) {
    return ((360 - event.alpha) % 360 + 360) % 360;
  }
  if (
    event.alpha != null && Number.isFinite(event.alpha)
    && event.beta != null && Number.isFinite(event.beta)
    && Math.abs(event.beta) <= 60
  ) {
    return ((360 - event.alpha) % 360 + 360) % 360;
  }
  return null;
}

function flushCompassHeading() {
  compassRafScheduled = false;
  if (pendingCompassHeading != null) {
    applyCompassHeading(pendingCompassHeading);
    pendingCompassHeading = null;
  }
}

function onDeviceOrientation(event) {
  const heading = extractCompassHeading(event);
  if (heading == null) return;
  pendingCompassHeading = heading;
  if (!compassRafScheduled) {
    compassRafScheduled = true;
    requestAnimationFrame(flushCompassHeading);
  }
}

function bindCompassTapTarget() {
  const el = document.querySelector('.gps-radar__compass');
  const hintBtn = document.querySelector('.compass-pro__hint');
  if (!el || compassClickHandler) return;
  el.classList.add('compass-pro--needs-tap');

  const activate = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await requestCompassPermission();
  };

  compassClickHandler = activate;
  el.addEventListener('click', compassClickHandler);

  if (hintBtn && !compassHintHandler) {
    compassHintHandler = activate;
    hintBtn.addEventListener('click', compassHintHandler);
  }
}

function unbindCompassTapTarget() {
  const el = document.querySelector('.gps-radar__compass');
  const hintBtn = document.querySelector('.compass-pro__hint');
  if (el && compassClickHandler) {
    el.removeEventListener('click', compassClickHandler);
    el.classList.remove('compass-pro--needs-tap');
  }
  if (hintBtn && compassHintHandler) {
    hintBtn.removeEventListener('click', compassHintHandler);
    compassHintHandler = null;
  }
  compassClickHandler = null;
}

async function requestCompassPermission() {
  if (!window.isSecureContext) {
    gpsRadar?.setCompassHint('HTTPS required');
    return false;
  }
  if (typeof DeviceOrientationEvent === 'undefined') {
    compassPermissionState = 'unsupported';
    gpsRadar?.setCompassHint('');
    gpsRadar?.setHeading(lastBestLocation?.heading ?? null);
    if (lastBestLocation) applyGpsHeading(lastBestLocation);
    return false;
  }

  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') {
        compassPermissionState = 'denied';
        gpsRadar?.setCompassHint('Tap to allow compass');
        return false;
      }
    }
    compassPermissionState = 'granted';
    startCompassListener(true);
    return true;
  } catch {
    compassPermissionState = 'denied';
    gpsRadar?.setCompassHint('Tap to enable compass');
    return false;
  }
}

function startCompassListener(skipTapBind) {
  if (!compassListener) {
    compassListener = onDeviceOrientation;
    window.addEventListener('deviceorientationabsolute', compassListener, true);
    window.addEventListener('deviceorientation', compassListener, true);
  }

  const needsIosPermission = typeof DeviceOrientationEvent !== 'undefined'
    && typeof DeviceOrientationEvent.requestPermission === 'function';

  if (needsIosPermission && compassPermissionState !== 'granted') {
    if (!skipTapBind) bindCompassTapTarget();
    gpsRadar?.setCompassHint('Tap compass to enable');
    return;
  }

  compassPermissionState = 'granted';
  unbindCompassTapTarget();
  gpsRadar?.setCompassHint('');
  if (lastBestLocation) applyGpsHeading(lastBestLocation);
}

function stopCompassListener() {
  if (compassListener) {
    window.removeEventListener('deviceorientationabsolute', compassListener, true);
    window.removeEventListener('deviceorientation', compassListener, true);
    compassListener = null;
  }
  unbindCompassTapTarget();
  lastCompassHeadingAt = 0;
  compassPermissionState = 'unknown';
  gpsRadar?.setCompassLive(false);
}

function setRadarScanning(message) {
  if (!gpsRadar) return;
  gpsRadar.setState('scanning').setLabel('').setLocation('Locating...');
}

function setRadarError(message) {
  if (!gpsRadar) return;
  gpsRadar.setState('error').setLabel(message || '').setLocation('');
}

function updateLocationUI(loc) {
  syncRadarUI(loc);
  if (!loc) return;
  const acc =
    loc.accuracy != null ? ` ±${Math.round(loc.accuracy)}m` : '';
  $('status-text').textContent = 'GPS tracking active — location updates automatically';
  const coords = $('location-coords');
  if (coords) {
    coords.hidden = false;
    coords.textContent = `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}${acc}`;
  }
  $('status-indicator').className = 'status ready';
  $('status-indicator').textContent = 'Ready';
}

function shouldPushLocationToServer(loc) {
  const now = Date.now();
  if (!lastSentLocation) return true;
  if (now - lastServerLocationSend >= 60000) return true;
  if (now - lastServerLocationSend < 10000) return false;
  if (haversineMeters(lastSentLocation, loc) >= 10) return true;
  if (
    loc.accuracy != null &&
    lastSentLocation.accuracy != null &&
    loc.accuracy < lastSentLocation.accuracy - 5
  ) {
    return true;
  }
  return false;
}

async function pushLocationToServer(loc) {
  if (!token) return;
  await api('/location', {
    method: 'POST',
    body: JSON.stringify({
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: loc.accuracy,
    }),
  });
  lastServerLocationSend = Date.now();
  lastSentLocation = { ...loc };
}

function onLocationUpdate(pos) {
  const loc = positionToLocation(pos);
  setBestLocation(loc);
  updateLocationUI(lastBestLocation);
  applyGpsHeading(loc);
  hideLocationPrompt();
  $('location-fallback').hidden = true;
  $('main-error').textContent = '';
  resetLocatingUI();

  if (shouldPushLocationToServer(loc)) {
    pushLocationToServer(loc).catch(() => {});
  }
  pushLiveLocationIfActive(loc);
  updateDistressRadarBlip();
}

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (wakeLockRef) return;
    wakeLockRef = await navigator.wakeLock.request('screen');
    wakeLockRef.addEventListener('release', () => {
      wakeLockRef = null;
    });
  } catch (_) {}
}

async function releaseWakeLock() {
  if (!wakeLockRef) return;
  try {
    await wakeLockRef.release();
  } catch (_) {}
  wakeLockRef = null;
}

async function pushLiveLocationIfActive(loc) {
  if (!liveAlertId || !loc) return;
  const now = Date.now();
  if (now - lastLivePushAt < LIVE_PUSH_MIN_MS) return;

  const authToken = getLiveBroadcastToken(liveAlertId);
  if (!authToken) return;

  lastLivePushAt = now;
  try {
    await api(
      `/emergency/${liveAlertId}/live`,
      {
        method: 'POST',
        body: JSON.stringify({
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy,
        }),
      },
      authToken
    );
  } catch (_) {}
}

async function resumeActiveSosSession() {
  if (!liveAlertId && !activeAlert?.id) return;
  const id = liveAlertId || activeAlert.id;
  startLocationWatch();
  await acquireWakeLock();
  if (id && !liveBroadcastTimer) startLiveBroadcast(id);
  if (id && typeof SosRecorder !== 'undefined' && !SosRecorder.isActive()) {
    await startSosRecording(id);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    resumeActiveSosSession().catch(() => {});
  }
});

function onLocationError(err) {
  if (lastBestLocation) return;

  const messages = {
    1: 'Location denied — allow in device Settings, then refresh.',
    2: 'GPS unavailable — turn on Location Services.',
    3: 'GPS timed out — still trying automatically in background.',
  };
  resetLocatingUI();
  setRadarError(messages[err.code] || 'Waiting for GPS...');
  $('status-text').textContent = messages[err.code] || 'Waiting for GPS...';
  showLocationPrompt('Allow location when prompted, or tap Enable GPS below.');
  if (err.code === 1) {
    $('main-error').textContent = messages[err.code];
    showLocationFallback(new Error(messages[err.code]));
  }
}

function resetLocatingUI() {
  $('status-indicator').className = 'status ready';
  $('status-indicator').textContent = 'Ready';
}

function hideLocationPrompt() {
  const el = $('location-prompt');
  if (el) el.hidden = true;
}

function showLocationPrompt(message) {
  const el = $('location-prompt');
  if (!el) return;
  el.hidden = false;
  if (message) $('location-prompt-text').textContent = message;
}

function gpsBlockedReason() {
  if (!navigator.geolocation) return 'Geolocation is not supported in this browser.';
  if (!window.isSecureContext) {
    return 'GPS is blocked on HTTP. Open the HTTPS link shown above (https://...) — required on iPhone.';
  }
  return null;
}

async function acquireGPS({ userInitiated = false } = {}) {
  const blocked = gpsBlockedReason();
  if (blocked) {
    $('main-error').textContent = blocked;
    $('https-warning').hidden = false;
    $('https-warning').textContent = blocked;
    showLocationPrompt(blocked);
    return;
  }

  if (userInitiated) $('main-error').textContent = '';
  $('https-warning').hidden = true;
  if (!lastBestLocation) {
    $('status-indicator').className = 'status sending';
    $('status-indicator').textContent = 'Locating';
    $('status-text').textContent = 'Acquiring GPS automatically...';
    setRadarScanning('Scanning for GPS...');
  }
  $('enable-gps-btn').disabled = true;

  startLocationWatch();

  if (userInitiated) {
    await requestCompassPermission();
  }

  try {
    const loc = await withTimeout(
      locateOnce({
        highAccuracy: true,
        timeout: isMobile ? 30000 : 15000,
        maximumAge: 0,
      }),
      isMobile ? 31000 : 16000,
      'GPS timed out — still trying in background'
    );

    const best = setBestLocation(loc);
    updateLocationUI(best);
    await pushLocationToServer(best);
    hideLocationPrompt();
    $('location-fallback').hidden = true;
  } catch (err) {
    if (!lastBestLocation) {
      resetLocatingUI();
      $('status-text').textContent = 'Waiting for GPS — allow location if prompted.';
      setRadarScanning('Waiting for GPS signal...');
      showLocationPrompt('Allow location when your device asks, or tap Enable GPS below.');
      if (userInitiated) {
        $('main-error').textContent = err.message;
        showLocationFallback(err);
      }
    }
  } finally {
    $('enable-gps-btn').disabled = false;
  }
}

function startLocationWatch() {
  if (!navigator.geolocation || locationWatchId != null) return;

  locationWatchId = navigator.geolocation.watchPosition(
    onLocationUpdate,
    onLocationError,
    {
      enableHighAccuracy: true,
      maximumAge: isMobile ? 3000 : 5000,
      timeout: isMobile ? 90000 : 30000,
    }
  );
}

function stopLocationWatch() {
  if (locationWatchId != null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
}

async function initAutoLocation() {
  const blocked = gpsBlockedReason();
  if (blocked) {
    $('https-warning').hidden = false;
    $('https-warning').textContent = blocked;
    $('status-text').textContent = isMobile ? 'Open the HTTPS link on your phone to enable GPS and SOS.' : 'GPS requires HTTPS on phones.';
    setRadarError('GPS requires HTTPS');
    showLocationPrompt(blocked);
    return;
  }

  const permission = await queryLocationPermission();
  if (permission === 'denied') {
    $('status-text').textContent = isMobile
      ? 'Location denied — enable in Settings, then tap Enable GPS or SOS.'
      : 'Location denied — enable in device Settings.';
    setRadarError('Location denied');
    showLocationPrompt('Location is blocked. Enable it in Settings, then tap Enable GPS.');
    return;
  }

  if (isMobile && permission !== 'granted') {
    $('status-text').textContent = 'Tap Enable GPS or SOS to allow location on your phone.';
    showLocationPrompt('Allow location when your device asks — required for SOS.');
  }

  const cached = loadCachedLocation(300000);
  if (cached) {
    lastBestLocation = cached;
    updateLocationUI(cached);
    pushLocationToServer(cached).catch(() => {});
    hideLocationPrompt();
  }

  await acquireGPS();
}

const $ = (id) => document.getElementById(id);

function saveSeenAlerts() {
  localStorage.setItem('seenAlerts', JSON.stringify([...seenAlerts].slice(-100)));
}

function saveSosLiveSession(alertId, liveToken) {
  if (!alertId || !liveToken) return;
  localStorage.setItem(SOS_LIVE_KEY, JSON.stringify({ alertId, liveToken }));
}

function loadSosLiveSession() {
  try {
    const raw = localStorage.getItem(SOS_LIVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSosLiveSession() {
  localStorage.removeItem(SOS_LIVE_KEY);
}

function getLiveBroadcastToken(alertId) {
  const session = loadSosLiveSession();
  if (session?.alertId === alertId && session.liveToken) return session.liveToken;
  return token;
}

function hasActiveSosSession() {
  return Boolean(activeAlert?.id || loadSosLiveSession()?.alertId);
}

function applyActiveAlertUI(alert) {
  if (!alert) return;
  activeAlert = alert;
  $('status-indicator').className = 'status alert';
  $('status-indicator').textContent = 'Alert Active';
  $('status-text').textContent = 'SOS active — sharing live location.';
  $('alert-details').textContent =
    `Location: ${Number(alert.latitude).toFixed(4)}, ${Number(alert.longitude).toFixed(4)}`;
  const viewOwnMap = $('view-own-map');
  viewOwnMap.hidden = false;
  viewOwnMap.onclick = () => openLiveMap(alert.id);
  $('cancel-panel').hidden = false;
}

async function apiMediaBlob(path, authToken = null) {
  const bearer = authToken || token;
  const res = await fetch(`${API}${path}`, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  });
  if (!res.ok) throw new Error('Media fetch failed');
  return URL.createObjectURL(await res.blob());
}

async function startSosRecording(alertId) {
  if (typeof SosRecorder === 'undefined') return;
  const preview = $('sos-recorder-preview');
  const started = await SosRecorder.start(alertId, getLiveBroadcastToken, {
    previewEl: preview,
    onStatus: (msg) => {
      const el = $('sos-recorder-status');
      if (el) el.textContent = msg;
      if (preview) preview.hidden = !SosRecorder.isActive();
    },
  });
  if (preview) preview.hidden = !started;
}

function stopSosRecording() {
  if (typeof SosRecorder !== 'undefined') SosRecorder.stop();
  const preview = $('sos-recorder-preview');
  if (preview) {
    preview.hidden = true;
    preview.srcObject = null;
  }
  const status = $('sos-recorder-status');
  if (status) status.textContent = '';
}

async function api(path, options = {}, authToken = null) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const bearer = authToken || token;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  let res;
  try {
    res = await fetch(`${API}${path}`, { ...options, headers });
  } catch {
    throw new Error('Cannot reach the server. Check your internet connection and reload the page.');
  }

  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) {
        const plain = text.replace(/\s+/g, ' ').trim();
        throw new Error(plain || `Server error (${res.status})`);
      }
    }
  }

  if (!res.ok) {
    throw new Error(data.error || data.message || `Server error (${res.status})`);
  }
  return data;
}

function normalizePhone(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const compact = trimmed.replace(/[\s()-]/g, '');
  if (compact.startsWith('+')) return compact;
  const digits = compact.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function showAuth(options = {}) {
  const keepSosBroadcast = options.keepSosBroadcast === true;
  stopBackgroundTasks({ keepSosBroadcast });
  currentUser = null;
  $('auth-section').hidden = false;
  $('main-section').hidden = true;
  const banner = $('sos-active-banner');
  if (banner) banner.hidden = !keepSosBroadcast;
  if (keepSosBroadcast) startSosOnlyBackground();
}

function showAuthWithActiveSos() {
  showAuth({ keepSosBroadcast: true });
}

function showMain(user) {
  currentUser = user;
  $('auth-section').hidden = true;
  $('main-section').hidden = false;
  const banner = $('sos-active-banner');
  if (banner) banner.hidden = true;
  $('user-info').textContent = user ? `Signed in as ${user.name}` : '';
  initHardwareStore();
  startBackgroundTasks();
  restoreActiveSos();
}

async function restoreActiveSos() {
  if (!token) return;
  try {
    const data = await api('/emergency/active');
    if (!data.alert) {
      clearSosLiveSession();
      if (liveAlertId) stopLiveBroadcast();
      return;
    }
    if (data.liveToken) saveSosLiveSession(data.alert.id, data.liveToken);
    applyActiveAlertUI(data.alert);
    await startSosSession(data.alert.id);
  } catch (_) {}
}

function startSosOnlyBackground() {
  initAutoLocation();
  const session = loadSosLiveSession();
  if (session?.alertId) {
    liveAlertId = session.alertId;
    startLocationWatch();
    acquireWakeLock();
    if (!liveBroadcastTimer) startLiveBroadcast(session.alertId);
    if (typeof SosRecorder !== 'undefined' && !SosRecorder.isActive()) {
      startSosRecording(session.alertId).catch(() => {});
    }
  }
}

function initHardwareStore() {
  if (hardwareStore || typeof HardwareStore === 'undefined') return;
  hardwareStore = HardwareStore.mount('#hardware-store-host', {
    api,
    getUser: () => currentUser,
    onMessage: (msg, isError) => {
      $('main-error').textContent = isError ? msg : '';
      if (!isError && msg) {
        $('main-error').textContent = '';
        $('main-error').style.color = '#81c784';
        $('main-error').textContent = msg;
        setTimeout(() => {
          $('main-error').style.color = '';
          if ($('main-error').textContent === msg) $('main-error').textContent = '';
        }, 4000);
      }
    },
  });
}

function hideSubPanels(except) {
  ['contacts-panel', 'history-panel', 'hardware-panel'].forEach((id) => {
    if (id !== except) $(id).hidden = true;
  });
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const pendingAlertId = params.get('alertId');

  setupGpsRadar();
  setupInstallPrompt();
  LiveMap.setupCloseButton();
  if (window.SupabaseClient) SupabaseClient.init().catch(() => {});

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.warn('Service worker registration failed:', err);
    }
  }

  if (token) {
    try {
      const { user } = await api('/auth/me', { method: 'GET' });
      showMain(user);
      if (pendingAlertId) openLiveMap(pendingAlertId);
      return;
    } catch {
      token = null;
      localStorage.removeItem('token');
    }
  }

  const sosSession = loadSosLiveSession();
  if (sosSession?.alertId && sosSession.liveToken) {
    activeAlert = { id: sosSession.alertId };
    showAuthWithActiveSos();
    return;
  }

  showAuth();
}

$('toggle-auth').addEventListener('click', () => {
  isRegister = !isRegister;
  $('auth-title').textContent = isRegister ? 'Create Account' : 'Sign In';
  $('auth-submit').textContent = isRegister ? 'Register' : 'Sign In';
  $('toggle-auth').textContent = isRegister ? 'Already have an account? Sign In' : 'Need an account? Register';
  $('name').hidden = !isRegister;
  $('password-confirm').hidden = !isRegister;
  $('password').autocomplete = isRegister ? 'new-password' : 'current-password';
  $('auth-error').textContent = '';
});

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('auth-error').textContent = '';
  const phone = normalizePhone($('phone').value);
  const email = $('email').value.trim().toLowerCase();
  const password = $('password').value;
  const confirmPassword = $('password-confirm').value;

  if (!password || (!phone && !email)) {
    $('auth-error').textContent = 'Enter your phone or email and password.';
    return;
  }

  if (isRegister && password !== confirmPassword) {
    $('auth-error').textContent = 'Passwords do not match.';
    return;
  }

  if (isRegister && password.length < 6) {
    $('auth-error').textContent = 'Password must be at least 6 characters.';
    return;
  }

  if (isRegister && !$('name').value.trim()) {
    $('auth-error').textContent = 'Enter your full name to register.';
    return;
  }

  $('auth-submit').disabled = true;

  try {
    const path = isRegister ? '/auth/register' : '/auth/login';
    const body = isRegister
      ? {
          name: $('name').value.trim(),
          phone: phone || undefined,
          email: email || undefined,
          password,
          confirmPassword,
        }
      : { phone: phone || undefined, email: email || undefined, password };

    const data = await api(path, { method: 'POST', body: JSON.stringify(body) });
    token = data.token;
    localStorage.setItem('token', token);
    showMain(data.user);
    await requestCompassPermission();
  } catch (err) {
    $('auth-error').textContent = err.message;
  } finally {
    $('auth-submit').disabled = false;
  }
});

$('logout-btn').addEventListener('click', () => {
  const sosSession = loadSosLiveSession();
  token = null;
  localStorage.removeItem('token');
  currentUser = null;

  if (sosSession?.alertId && sosSession.liveToken) {
    activeAlert = { id: sosSession.alertId };
    liveAlertId = sosSession.alertId;
    showAuthWithActiveSos();
    return;
  }

  activeAlert = null;
  showAuth();
});

function getManualLocation() {
  if (isMobile) return null;
  const lat = parseFloat(localStorage.getItem('testLat'));
  const lng = parseFloat(localStorage.getItem('testLng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

async function queryLocationPermission() {
  if (!navigator.permissions?.query) return null;
  try {
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return result.state;
  } catch {
    return null;
  }
}

function showLocationFallback(err) {
  $('location-fallback').hidden = false;
  const hint = $('location-fallback-hint');
  if (hint) {
    hint.textContent = isMobile
      ? 'Allow location when prompted, or check Settings → Privacy → Location Services.'
      : 'Desktop browsers often can\'t get GPS. Use test coordinates below, or enable Windows Location.';
  }
  if (!isMobile) {
    const saved = getManualLocation();
    if (saved) {
      $('manual-lat').value = saved.latitude;
      $('manual-lng').value = saved.longitude;
    }
    $('location-fallback').querySelectorAll('label').forEach((el) => { el.style.display = 'block'; });
    $('use-manual-location').hidden = false;
  } else {
    $('location-fallback').querySelectorAll('label').forEach((el) => { el.style.display = 'none'; });
    $('use-manual-location').hidden = true;
  }
  $('main-error').textContent =
    err?.message?.includes('network service')
      ? 'Could not get GPS. On phone: allow location permission and try again.'
      : (err?.message || 'Location unavailable');
}

async function setupGpsRadar() {
  const host = $('gps-radar-host');
  if (!host || typeof GpsRadar === 'undefined') return;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  gpsRadar = GpsRadar.mount(host, { state: 'idle' });
  gpsRadar.startClock();
  startCompassListener();

  host.hidden = false;

  try {
    const info = await fetch('/api/v1/info').then((r) => r.json());
    const url = info.primaryPhoneUrl || window.location.origin;

    if (isMobile && !window.isSecureContext && info.primaryPhoneUrl) {
      $('https-warning').hidden = false;
      $('https-warning').textContent =
        `For GPS on your phone, open: ${info.primaryPhoneUrl} (accept the security warning once)`;
      gpsRadar.setCaption(url, {
        copyable: true,
        onCopy: (ok) => {
          if (ok) gpsRadar.setCaption('HTTPS link copied — open on your phone');
        },
      });
    } else if (!isMobile && !isStandalone) {
      gpsRadar.setCaption(`On Wi-Fi: ${url} — tap to copy`, {
        copyable: true,
        onCopy: (ok) => {
          if (ok) gpsRadar.setCaption('Phone link copied');
        },
      });
    }
  } catch {
    if (!isMobile) {
      gpsRadar.setCaption(`${window.location.origin} — tap to copy`, {
        copyable: true,
        onCopy: (ok) => {
          if (ok) gpsRadar.setCaption('Link copied');
        },
      });
    }
  }
}

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = $('install-btn');
    if (btn) {
      btn.hidden = false;
      btn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        btn.hidden = true;
      });
    }
  });
}

function locateOnce(options = {}) {
  const { highAccuracy = true, timeout = 20000, maximumAge = 0 } = options;
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(positionToLocation(pos)),
      (err) => {
        const messages = {
          1: 'Location permission denied — allow Location in your phone settings.',
          2: 'Location unavailable — turn on GPS/Location Services.',
          3: 'Location timed out — try again near a window or use coordinates below.',
        };
        reject(new Error(messages[err.code] || err.message || 'Could not get location'));
      },
      { enableHighAccuracy: highAccuracy, timeout, maximumAge }
    );
  });
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function getLocation({ forSos = false } = {}) {
  const manual = getManualLocation();
  if (manual) return manual;

  const maxAgeMs = forSos ? 300000 : 120000;
  const maxAccuracy = forSos ? 500 : 150;

  if (
    lastBestLocation &&
    Date.now() - lastBestLocation.timestamp < maxAgeMs &&
    (lastBestLocation.accuracy == null || lastBestLocation.accuracy <= maxAccuracy)
  ) {
    return lastBestLocation;
  }

  const cached = loadCachedLocation(forSos && isMobile ? 1800000 : 600000);
  if (forSos && cached) {
    if (!lastBestLocation || Date.now() - lastBestLocation.timestamp > maxAgeMs) {
      return cached;
    }
  }

  const locateTimeout = forSos ? (isMobile ? 45000 : 25000) : (isMobile ? 30000 : 20000);
  const raceTimeout = locateTimeout + 5000;

  try {
    const loc = await withTimeout(
      locateOnce({
        highAccuracy: true,
        timeout: locateTimeout,
        maximumAge: forSos ? 5000 : 0,
      }),
      raceTimeout,
      isMobile ? 'GPS timed out — move near a window or enable Location in Settings' : 'GPS timed out'
    );
    return setBestLocation(loc);
  } catch (err) {
    if (lastBestLocation && forSos) return lastBestLocation;
    if (cached && forSos) return cached;
    throw err;
  }
}

function assertPhoneCanSendSos() {
  if (!token) {
    throw new Error('Sign in to send SOS.');
  }
  if (!navigator.geolocation) {
    throw new Error('Geolocation is not supported on this device.');
  }
  if (isMobile && !window.isSecureContext) {
    throw new Error('GPS and SOS require HTTPS on your phone. Open the https:// link shown at the top (not http://).');
  }
}

async function preparePhoneSosLocation() {
  startLocationWatch();
}

async function sendLocationToServer(location) {
  await pushLocationToServer(location);
  setBestLocation(location);
  $('location-fallback').hidden = true;
  $('main-error').textContent = '';
  updateLocationUI(lastBestLocation);
  return location;
}

async function updateLocation() {
  return acquireGPS({ userInitiated: true });
}

$('use-manual-location').addEventListener('click', async () => {
  const lat = parseFloat($('manual-lat').value);
  const lng = parseFloat($('manual-lng').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    $('main-error').textContent = 'Enter valid latitude and longitude.';
    return;
  }
  localStorage.setItem('testLat', String(lat));
  localStorage.setItem('testLng', String(lng));
  cacheLocation({ latitude: lat, longitude: lng });
  try {
    await sendLocationToServer({ latitude: lat, longitude: lng });
  } catch (err) {
    $('main-error').textContent = err.message;
  }
});

async function setupPushNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    $('status-text').textContent = 'Enable notifications to receive nearby SOS alerts.';
    return;
  }

  try {
    const { publicKey } = await api('/push/vapid-public-key');
    const registration = await navigator.serviceWorker.ready;
    pushSubscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await api('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription: pushSubscription.toJSON() }),
    });
  } catch (err) {
    console.warn('Push setup failed:', err);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function openLiveMap(alertId) {
  LiveMap.open(alertId, api, apiMediaBlob);
}

async function openLatestNearbyMap() {
  try {
    const { alerts } = await api('/emergency/nearby');
    if (alerts.length > 0) {
      openLiveMap(alerts[0].id);
      return;
    }
    if (activeAlert?.id) {
      openLiveMap(activeAlert.id);
      return;
    }
    $('main-error').textContent = 'No active SOS alerts nearby to show on map.';
  } catch (err) {
    $('main-error').textContent = err.message;
  }
}

function startLiveBroadcast(alertId) {
  liveAlertId = alertId;
  clearInterval(liveBroadcastTimer);
  lastLivePushAt = 0;

  const broadcast = async () => {
    if (!liveAlertId) return;
    const authToken = getLiveBroadcastToken(liveAlertId);
    if (!authToken) return;
    try {
      startLocationWatch();
      const loc = lastBestLocation || (await getLocation({ forSos: true }));
      lastLivePushAt = Date.now();
      await api(
        `/emergency/${liveAlertId}/live`,
        {
          method: 'POST',
          body: JSON.stringify({
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy: loc.accuracy,
          }),
        },
        authToken
      );
    } catch (err) {
      if (String(err.message).includes('not found') || String(err.message).includes('Active alert')) {
        stopLiveBroadcast();
      }
    }
  };

  broadcast();
  liveBroadcastTimer = setInterval(broadcast, LIVE_BROADCAST_MS);
}

function stopLiveBroadcast() {
  clearInterval(liveBroadcastTimer);
  liveBroadcastTimer = null;
  liveAlertId = null;
  lastLivePushAt = 0;
  clearSosLiveSession();
  stopSosRecording();
  releaseWakeLock();
}

async function startSosSession(alertId) {
  startLocationWatch();
  await acquireWakeLock();
  startLiveBroadcast(alertId);
  await startSosRecording(alertId);
}

function showNearbyAlert(alert) {
  if (seenAlerts.has(alert.id)) return;
  seenAlerts.add(alert.id);
  saveSeenAlerts();

  const banner = $('nearby-alert-banner');
  banner.hidden = false;
  banner.innerHTML = `
    <strong>🚨 SOS Nearby</strong>
    <p>${alert.user_name || 'Someone'} sent an emergency alert nearby (${alert.alert_type?.toUpperCase() || 'SOS'})</p>
    <button type="button" id="view-live-map" class="secondary-btn">View Live Map</button>
    <button type="button" id="dismiss-banner" class="link-btn">Dismiss</button>
  `;
  document.getElementById('view-live-map').onclick = () => openLiveMap(alert.id);
  document.getElementById('dismiss-banner').onclick = () => { banner.hidden = true; };

  if (Notification.permission === 'granted') {
    const n = new Notification('Emergency Alert Nearby', {
      body: `${alert.user_name || 'Someone'} sent an SOS alert nearby — tap to view live map`,
      icon: '/icon-192.png',
    });
    n.onclick = () => { window.focus(); openLiveMap(alert.id); };
  }
}

async function pollNearbyAlerts() {
  try {
    const { alerts } = await api('/emergency/nearby');
    alerts.forEach(showNearbyAlert);
  } catch (_) {}
}

function startBackgroundTasks() {
  stopBackgroundTasks();
  initAutoLocation();
  if (!isIOS) {
    setupPushNotifications();
  } else {
    setTimeout(() => setupPushNotifications(), 3000);
  }
  pollTimer = setInterval(() => {
    pollNearbyAlerts();
    pollContactDistress();
  }, 10000);
  pollNearbyAlerts();
  pollContactDistress();
}

function stopBackgroundTasks({ keepSosBroadcast = false } = {}) {
  clearInterval(pollTimer);
  stopCompassListener();
  if (!keepSosBroadcast) {
    stopLocationWatch();
    stopLiveBroadcast();
    contactDistressAlert = null;
    gpsRadar?.setDistressTarget(null);
    lastBestLocation = null;
    lastSentLocation = null;
  }
}

function startCountdown(seconds) {
  let remaining = seconds;
  $('countdown').textContent = remaining;
  $('cancel-panel').hidden = false;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    remaining -= 1;
    $('countdown').textContent = remaining;
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      $('cancel-panel').hidden = true;
    }
  }, 1000);
}

$('sos-btn').addEventListener('click', async () => {
  if (!confirm('Send SOS alert with your location to emergency contacts and nearby users?')) return;

  $('main-error').textContent = '';
  $('sos-btn').disabled = true;
  $('status-indicator').className = 'status sending';
  $('status-indicator').textContent = 'Sending';
  $('status-text').textContent = isMobile ? 'Getting GPS from your phone…' : 'Getting your location...';

  try {
    assertPhoneCanSendSos();
    await preparePhoneSosLocation();
    $('status-text').textContent = isMobile ? 'Locking GPS fix for SOS…' : 'Getting precise GPS for SOS...';
    const location = await getLocation({ forSos: true });
    $('status-text').textContent = 'Sending alert...';

    const data = await api('/emergency', {
      method: 'POST',
      body: JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        alertType: 'sos',
        deviceId: isMobile ? 'web-mobile' : 'web-desktop',
        timestamp: Date.now(),
        accuracy: location.accuracy,
      }),
    });

    activeAlert = data.alert;
    if (data.liveToken) saveSosLiveSession(data.alert.id, data.liveToken);
    await startSosSession(data.alert.id);
    $('status-indicator').className = 'status alert';
    $('status-indicator').textContent = 'Alert Active';
    $('status-text').textContent = `Alert sent! ${data.nearbyUsersNotified || 0} nearby user(s) notified. Sharing live location.`;
    $('alert-details').textContent =
      `Location: ${data.alert.latitude.toFixed(4)}, ${data.alert.longitude.toFixed(4)}`;
    const viewOwnMap = $('view-own-map');
    viewOwnMap.hidden = false;
    viewOwnMap.onclick = () => openLiveMap(data.alert.id);
    startCountdown(data.alert.cancelGraceSeconds || 30);
    hideLocationPrompt();
    $('location-fallback').hidden = true;
  } catch (err) {
    $('main-error').textContent = err.message;
    $('status-indicator').className = 'status ready';
    $('status-indicator').textContent = 'Ready';
    $('status-text').textContent = isMobile
      ? 'Allow Location when prompted, then tap SOS again.'
      : 'Tap SOS to send an alert.';
    showLocationFallback(err);
    if (isMobile) showLocationPrompt('Allow Location access to send SOS with your position.');
  } finally {
    $('sos-btn').disabled = false;
  }
});

$('cancel-btn').addEventListener('click', async () => {
  if (!activeAlert) return;
  try {
    await api(`/emergency/${activeAlert.id}/cancel`, { method: 'POST', body: '{}' });
    stopLiveBroadcast();
    clearInterval(countdownTimer);
    $('cancel-panel').hidden = true;
    activeAlert = null;
    $('status-indicator').className = 'status ready';
    $('status-indicator').textContent = 'Ready';
    $('status-text').textContent = 'False alarm cancelled.';
  } catch (err) {
    $('main-error').textContent = err.message;
  }
});

async function loadContacts() {
  const { contacts } = await api('/contacts');
  const list = $('contacts-list');
  list.innerHTML = '';
  contacts.forEach((c) => {
    const li = document.createElement('li');
    li.innerHTML = `<span><strong>${c.name}</strong><br><small>${c.phone || c.email || ''}</small></span>`;
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = async () => {
      await api(`/contacts/${c.id}`, { method: 'DELETE' });
      loadContacts();
    };
    li.appendChild(del);
    list.appendChild(li);
  });
}

$('contacts-btn').addEventListener('click', async () => {
  hideSubPanels('contacts-panel');
  $('contacts-panel').hidden = !$('contacts-panel').hidden;
  if (!$('contacts-panel').hidden) await loadContacts();
});

$('contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/contacts', {
    method: 'POST',
    body: JSON.stringify({
      name: $('contact-name').value.trim(),
      phone: $('contact-phone').value.trim(),
      email: $('contact-email').value.trim(),
    }),
  });
  e.target.reset();
  loadContacts();
});

async function loadHistory() {
  const { alerts } = await api('/emergency');
  const list = $('history-list');
  list.innerHTML = '';
  alerts.forEach((a) => {
    const li = document.createElement('li');
    const date = new Date(a.created_at).toLocaleString();
    li.innerHTML = `<span><strong>${a.alert_type.toUpperCase()}</strong> — ${a.status}<br><small>${date}</small></span>
      <button type="button" class="history-map-btn secondary-btn">Map</button>`;
    li.querySelector('.history-map-btn').onclick = () => openLiveMap(a.id);
    list.appendChild(li);
  });
}

$('history-btn').addEventListener('click', async () => {
  hideSubPanels('history-panel');
  $('history-panel').hidden = !$('history-panel').hidden;
  if (!$('history-panel').hidden) await loadHistory();
});

$('hardware-btn').addEventListener('click', async () => {
  hideSubPanels('hardware-panel');
  $('hardware-panel').hidden = !$('hardware-panel').hidden;
  if (!$('hardware-panel').hidden && hardwareStore) await hardwareStore.open();
});

$('map-btn').addEventListener('click', openLatestNearbyMap);

$('enable-gps-btn')?.addEventListener('click', () => acquireGPS({ userInitiated: true }));

init();
