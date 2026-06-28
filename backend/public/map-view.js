const LiveMap = (() => {
  const sosIcon = () => L.divIcon({
    className: '',
    html: '<div class="sos-marker"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  const startIcon = () => L.divIcon({
    className: '',
    html: '<div class="start-marker"></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });

  const youIcon = () => L.divIcon({
    className: '',
    html: '<div class="you-marker"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

  let map = null;
  let sosMarker = null;
  let startMarker = null;
  let youMarker = null;
  let trailLine = null;
  let trailPoints = [];
  let pollTimer = null;
  let watchId = null;
  let currentAlertId = null;
  let apiFn = null;
  let mediaBlobFn = null;
  let lastMediaChunkId = null;
  let lastMediaObjectUrl = null;
  let mediaPollTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function initMap(lat, lng) {
    if (map) return;
    map = L.map('live-map', { zoomControl: true }).setView([lat, lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    trailLine = L.polyline([], {
      color: '#d32f2f', weight: 3, opacity: 0.6, dashArray: '6 4',
    }).addTo(map);
  }

  function updateSosMarker(lat, lng, isFirst) {
    if (!sosMarker) {
      sosMarker = L.marker([lat, lng], { icon: sosIcon() }).addTo(map);
      sosMarker.bindPopup('<strong>SOS — Live location</strong>');
    } else {
      sosMarker.setLatLng([lat, lng]);
    }

    const last = trailPoints[trailPoints.length - 1];
    if (!last || last[0] !== lat || last[1] !== lng) {
      trailPoints.push([lat, lng]);
      trailLine.setLatLngs(trailPoints);
    }

    if (isFirst) map.setView([lat, lng], 15);
  }

  function updateStartMarker(lat, lng) {
    if (!startMarker) {
      startMarker = L.marker([lat, lng], { icon: startIcon() }).addTo(map);
      startMarker.bindPopup('<strong>Alert started here</strong>');
    }
  }

  function updateYouMarker(lat, lng) {
    if (!youMarker) {
      youMarker = L.marker([lat, lng], { icon: youIcon() }).addTo(map);
      youMarker.bindPopup('<strong>Your location</strong>');
    } else {
      youMarker.setLatLng([lat, lng]);
    }
  }

  function updateInfo(alert) {
    const liveLat = alert.liveLatitude ?? alert.latitude;
    const liveLng = alert.liveLongitude ?? alert.longitude;
    const isActive = alert.status === 'active';

    $('map-title').textContent =
      `${alert.alertType?.toUpperCase() || 'SOS'} — ${alert.userName || 'Unknown'}`;
    $('map-subtitle').textContent = isActive
      ? 'Tracking live location'
      : 'Alert ended — last known position';
    $('info-user').textContent = alert.userName || 'Unknown';
    $('info-status').textContent = alert.status;
    $('info-coords').textContent = `${liveLat.toFixed(5)}, ${liveLng.toFixed(5)}`;
    $('info-updated').textContent = alert.liveUpdatedAt
      ? new Date(alert.liveUpdatedAt).toLocaleTimeString()
      : '—';

    const badge = $('live-badge');
    badge.textContent = isActive ? 'LIVE' : 'ENDED';
    badge.classList.toggle('inactive', !isActive);
  }

  async function refreshMediaFeed() {
    if (!currentAlertId || !apiFn || !mediaBlobFn) return;

    try {
      const data = await apiFn(`/emergency/${currentAlertId}/media`);
      const panel = $('map-media-panel');
      const video = $('map-media-video');
      const meta = $('map-media-meta');
      const note = $('map-media-note');

      if (!data.chunks?.length) {
        if (panel) panel.hidden = true;
        return;
      }

      if (panel) panel.hidden = false;
      if (note) {
        note.textContent = data.isContactView
          ? 'Live video and audio from your emergency contact — private to contacts only.'
          : 'Live recording from this SOS alert.';
      }

      const latest = data.chunks[data.chunks.length - 1];
      if (meta) {
        meta.textContent = `Clip ${latest.sequence} · ${new Date(latest.createdAt).toLocaleTimeString()}`;
      }

      if (latest.id === lastMediaChunkId || !video) return;
      lastMediaChunkId = latest.id;

      if (lastMediaObjectUrl) URL.revokeObjectURL(lastMediaObjectUrl);
      lastMediaObjectUrl = await mediaBlobFn(latest.url.startsWith('/api/v1') ? latest.url.slice(7) : latest.url);
      video.src = lastMediaObjectUrl;
      video.load();
      video.play().catch(() => {});
    } catch (err) {
      console.warn('Media feed update failed:', err);
    }
  }

  async function fetchLiveAlert() {
    const { alert } = await apiFn(`/emergency/${currentAlertId}/live`);
    const liveLat = alert.liveLatitude ?? alert.latitude;
    const liveLng = alert.liveLongitude ?? alert.longitude;

    initMap(liveLat, liveLng);
    updateStartMarker(alert.latitude, alert.longitude);
    updateSosMarker(liveLat, liveLng, !sosMarker);
    updateInfo(alert);

    return alert;
  }

  function watchYourLocation() {
    if (!navigator.geolocation || watchId != null) return;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!map) return;
        updateYouMarker(pos.coords.latitude, pos.coords.longitude);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000 }
    );
  }

  function stopWatching() {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function resetMarkers() {
    if (map) {
      map.remove();
      map = null;
    }
    sosMarker = null;
    startMarker = null;
    youMarker = null;
    trailLine = null;
    trailPoints = [];
  }

  async function open(alertId, api, mediaBlob) {
    apiFn = api;
    mediaBlobFn = mediaBlob;
    currentAlertId = alertId;
    lastMediaChunkId = null;
    if (lastMediaObjectUrl) {
      URL.revokeObjectURL(lastMediaObjectUrl);
      lastMediaObjectUrl = null;
    }

    $('map-section').hidden = false;
    $('map-subtitle').textContent = 'Loading map...';

    await new Promise((r) => requestAnimationFrame(r));

    try {
      await fetchLiveAlert();
      await refreshMediaFeed();
      if (map) map.invalidateSize();
      watchYourLocation();

      clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        try {
          const alert = await fetchLiveAlert();
          await refreshMediaFeed();
          if (alert.status !== 'active') {
            $('map-subtitle').textContent = 'Alert ended — last known position shown';
          }
        } catch (err) {
          console.warn('Live map update failed:', err);
        }
      }, 5000);

      clearInterval(mediaPollTimer);
      mediaPollTimer = setInterval(refreshMediaFeed, 4000);
    } catch (err) {
      $('map-subtitle').textContent = err.message || 'Failed to load map';
    }
  }

  function close() {
    clearInterval(pollTimer);
    pollTimer = null;
    clearInterval(mediaPollTimer);
    mediaPollTimer = null;
    stopWatching();
    resetMarkers();
    currentAlertId = null;
    lastMediaChunkId = null;
    if (lastMediaObjectUrl) {
      URL.revokeObjectURL(lastMediaObjectUrl);
      lastMediaObjectUrl = null;
    }
    const video = $('map-media-video');
    if (video) video.removeAttribute('src');
    const panel = $('map-media-panel');
    if (panel) panel.hidden = true;
    $('map-section').hidden = true;

    const url = new URL(window.location.href);
    url.searchParams.delete('alertId');
    window.history.replaceState({}, '', url.pathname);
  }

  function setupCloseButton() {
    $('close-map-btn')?.addEventListener('click', close);
  }

  return { open, close, setupCloseButton };
})();
