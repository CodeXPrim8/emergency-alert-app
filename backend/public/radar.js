/**
 * Portable GPS status widget with background radar + pro compass.
 */
(function (global) {
  const STATES = new Set(['idle', 'scanning', 'locked', 'error']);
  const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  function resolveTarget(target) {
    if (!target) return null;
    return typeof target === 'string' ? document.querySelector(target) : target;
  }

  function headingToCardinal(deg) {
    return CARDINALS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  }

  function toDms(decimal, isLat) {
    if (decimal == null || Number.isNaN(decimal)) return '—';
    const abs = Math.abs(decimal);
    const d = Math.floor(abs);
    const mTotal = (abs - d) * 60;
    const m = Math.floor(mTotal);
    const s = ((mTotal - m) * 60).toFixed(1);
    const hemi = isLat ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
    return `${d}°${String(m).padStart(2, '0')}'${s.padStart(4, '0')}"${hemi}`;
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

  function bearingBetween(lat1, lng1, lat2, lng2) {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function blipPosition(userLat, userLng, targetLat, targetLng, heading, maxRangeM) {
    const distance = haversineMeters(
      { latitude: userLat, longitude: userLng },
      { latitude: targetLat, longitude: targetLng }
    );
    const bearing = bearingBetween(userLat, userLng, targetLat, targetLng);
    const relative = ((bearing - (heading || 0)) + 360) % 360;
    const rad = ((relative - 90) * Math.PI) / 180;
    const ratio = Math.min(distance / maxRangeM, 1);
    const radius = 12 + ratio * 36;
    return {
      left: 50 + Math.cos(rad) * radius,
      top: 50 + Math.sin(rad) * radius,
      distance,
      bearing,
    };
  }

  function buildRoseMarkup() {
    const ticks = [];
    for (let deg = 0; deg < 360; deg += 5) {
      const major = deg % 30 === 0;
      const len = major ? 7 : 4;
      ticks.push(
        `<line x1="50" y1="${6 + (major ? 0 : 1)}" x2="50" y2="${6 + len}" transform="rotate(${deg} 50 50)" `
        + `stroke="${major ? '#f5f5f5' : 'rgba(255,255,255,0.45)'}" stroke-width="${major ? 1.2 : 0.6}" />`
      );
    }

    const labels = [
      { t: 'N', d: 0, c: '#ef5350', s: 9, w: 700 },
      { t: 'E', d: 90, c: '#fff', s: 8, w: 700 },
      { t: 'S', d: 180, c: '#fff', s: 8, w: 700 },
      { t: 'W', d: 270, c: '#fff', s: 8, w: 700 },
      { t: 'NE', d: 45, c: 'rgba(255,255,255,0.75)', s: 5.5, w: 600 },
      { t: 'SE', d: 135, c: 'rgba(255,255,255,0.75)', s: 5.5, w: 600 },
      { t: 'SW', d: 225, c: 'rgba(255,255,255,0.75)', s: 5.5, w: 600 },
      { t: 'NW', d: 315, c: 'rgba(255,255,255,0.75)', s: 5.5, w: 600 },
    ];

    const labelSvg = labels.map(({ t, d, c, s, w }) => {
      const rad = ((d - 90) * Math.PI) / 180;
      const r = t.length === 1 ? 34 : 30;
      const x = 50 + Math.cos(rad) * r;
      const y = 50 + Math.sin(rad) * r;
      return `<text x="${x.toFixed(2)}" y="${(y + s * 0.35).toFixed(2)}" fill="${c}" font-size="${s}" font-weight="${w}" text-anchor="middle">${t}</text>`;
    }).join('');

    const nums = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((d) => {
      const rad = ((d - 90) * Math.PI) / 180;
      const x = 50 + Math.cos(rad) * 39;
      const y = 50 + Math.sin(rad) * 39;
      const atCardinal = d % 90 === 0 && d !== 0;
      const label = String(d);
      return `<text x="${x.toFixed(2)}" y="${(y + 2.5).toFixed(2)}" fill="rgba(255,255,255,${atCardinal ? '0.35' : '0.55'})" font-size="4.5" text-anchor="middle">${label}</text>`;
    }).join('');

    return `
      <circle cx="50" cy="50" r="47" fill="#121212" stroke="#333" stroke-width="1"/>
      <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(76,175,80,0.35)" stroke-width="2"
        stroke-dasharray="8 4" transform="rotate(-90 50 50)"/>
      ${ticks}
      ${nums}
      ${labelSvg}
    `;
  }

  function mount(target, options = {}) {
    const host = resolveTarget(target);
    if (!host) return null;

    host.classList.add('gps-radar-widget');
    host.innerHTML = `
      <div class="gps-radar" data-state="idle" aria-live="polite" aria-label="GPS status">
        <div class="gps-radar__bg" aria-hidden="true">
          <div class="gps-radar__bg-rings"></div>
          <div class="gps-radar__bg-sweep"></div>
          <button type="button" class="gps-radar__bg-blip gps-radar__bg-blip--distress" hidden aria-label="Emergency contact in distress"></button>
        </div>
        <div class="gps-radar__compass" aria-label="Compass">
          <button type="button" class="compass-pro__hint" hidden>Tap to enable compass</button>
          <div class="compass-pro">
            <div class="compass-pro__lubber" aria-hidden="true"></div>
            <div class="compass-pro__face">
              <div class="compass-pro__dial-wrap">
                <svg class="compass-pro__svg" viewBox="0 0 100 100" aria-hidden="true">
                  <g class="compass-pro__dial">${buildRoseMarkup()}</g>
                </svg>
              </div>
              <div class="compass-pro__hub">
                <p class="compass-pro__heading">—°</p>
                <p class="compass-pro__cardinal">—</p>
                <div class="compass-pro__pin" aria-hidden="true">📍</div>
                <p class="compass-pro__coords">
                  <span class="compass-pro__lat">—</span>
                  <span class="compass-pro__lng">—</span>
                </p>
              </div>
            </div>
          </div>
        </div>
        <div class="gps-radar__content">
          <p class="gps-radar__badge"></p>
          <p class="gps-radar__label"></p>
          <div class="gps-radar__meta">
            <p class="gps-radar__time"></p>
            <p class="gps-radar__date"></p>
            <p class="gps-radar__place"></p>
          </div>
          <p class="gps-radar__caption"></p>
        </div>
      </div>
    `;

    const root = host.querySelector('.gps-radar');
    const badgeEl = host.querySelector('.gps-radar__badge');
    const labelEl = host.querySelector('.gps-radar__label');
    const timeEl = host.querySelector('.gps-radar__time');
    const dateEl = host.querySelector('.gps-radar__date');
    const placeEl = host.querySelector('.gps-radar__place');
    const captionEl = host.querySelector('.gps-radar__caption');
    const dialWrapEl = host.querySelector('.compass-pro__dial-wrap');
    const hintEl = host.querySelector('.compass-pro__hint');
    const compassEl = host.querySelector('.gps-radar__compass');
    const headingEl = host.querySelector('.compass-pro__heading');
    const cardinalEl = host.querySelector('.compass-pro__cardinal');
    const latEl = host.querySelector('.compass-pro__lat');
    const lngEl = host.querySelector('.compass-pro__lng');
    const distressBlipEl = host.querySelector('.gps-radar__bg-blip--distress');
    let captionClickHandler = null;
    let clockTimer = null;
    let lastHeading = null;
    let distressTarget = null;
    let distressViewer = null;
    let distressClickHandler = null;
    const DISTRESS_RANGE_M = 5000;

    const BADGE = {
      idle: 'Standby',
      scanning: 'Scanning',
      locked: 'GPS locked',
      error: 'GPS error',
    };

    function setState(state) {
      const next = STATES.has(state) ? state : 'idle';
      root.dataset.state = next;
      badgeEl.textContent = BADGE[next];
      root.setAttribute('aria-label', `GPS status: ${BADGE[next]}`);
      return api;
    }

    function refreshDistressBlip() {
      if (!distressTarget || !distressViewer || !distressBlipEl) return api;
      const pos = blipPosition(
        distressViewer.latitude,
        distressViewer.longitude,
        distressTarget.latitude,
        distressTarget.longitude,
        lastHeading || 0,
        DISTRESS_RANGE_M
      );
      distressBlipEl.style.left = `${pos.left}%`;
      distressBlipEl.style.top = `${pos.top}%`;
      const distLabel = pos.distance >= 1000
        ? `${(pos.distance / 1000).toFixed(1)}km`
        : `${Math.round(pos.distance)}m`;
      distressBlipEl.title = `${distressTarget.name || 'Contact'} — SOS ${distLabel}`;
      return api;
    }

    function setDistressTarget(target, viewer) {
      if (distressClickHandler && distressBlipEl) {
        distressBlipEl.removeEventListener('click', distressClickHandler);
        distressClickHandler = null;
      }

      distressTarget = target || null;
      distressViewer = viewer || null;

      if (!distressTarget || !distressViewer) {
        distressBlipEl.hidden = true;
        root.classList.remove('gps-radar--distress');
        return api;
      }

      distressBlipEl.hidden = false;
      root.classList.add('gps-radar--distress');
      refreshDistressBlip();

      if (typeof distressTarget.onSelect === 'function') {
        distressClickHandler = (e) => {
          e.stopPropagation();
          distressTarget.onSelect(distressTarget);
        };
        distressBlipEl.addEventListener('click', distressClickHandler);
      }

      return api;
    }

    function setHeading(degrees) {
      if (degrees == null || Number.isNaN(degrees)) return api;
      const normalized = ((degrees % 360) + 360) % 360;
      lastHeading = normalized;
      dialWrapEl.style.transform = `rotate(${-normalized}deg)`;
      const cardinal = headingToCardinal(normalized);
      const rounded = Math.round(normalized);
      headingEl.textContent = `${rounded}° ${cardinal}`;
      cardinalEl.textContent = cardinal;
      compassEl?.setAttribute(
        'aria-label',
        `Compass heading ${rounded} degrees ${cardinal}. Dial rotated to match device orientation.`
      );
      refreshDistressBlip();
      return api;
    }

    function setCompassHint(text) {
      if (!hintEl) return api;
      const show = Boolean(text);
      hintEl.hidden = !show;
      hintEl.textContent = text || 'Tap to enable compass';
      compassEl?.classList.toggle('compass-pro--needs-tap', show);
      return api;
    }

    function setCompassLive(active) {
      compassEl?.classList.toggle('compass-pro--live', Boolean(active));
      return api;
    }

    function setCoordinates(lat, lng) {
      latEl.textContent = toDms(lat, true);
      lngEl.textContent = toDms(lng, false);
      return api;
    }

    function setLabel(text) {
      labelEl.textContent = text || '';
      labelEl.hidden = !text;
      return api;
    }

    function setMeta({ time, date, location } = {}) {
      if (time !== undefined) timeEl.textContent = time || '';
      if (date !== undefined) dateEl.textContent = date || '';
      if (location !== undefined) {
        placeEl.textContent = location || '';
        placeEl.hidden = !location;
      }
      return api;
    }

    function setTime(text) {
      timeEl.textContent = text || '';
      return api;
    }

    function setDate(text) {
      dateEl.textContent = text || '';
      return api;
    }

    function setLocation(text) {
      placeEl.textContent = text || '';
      placeEl.hidden = !text;
      return api;
    }

    function tickClock() {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDate(now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
    }

    function startClock() {
      stopClock();
      tickClock();
      clockTimer = setInterval(tickClock, 1000);
      return api;
    }

    function stopClock() {
      if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
      return api;
    }

    function setCaption(text, { copyable = false, onCopy } = {}) {
      captionEl.textContent = text || '';
      captionEl.hidden = !text;
      captionEl.classList.toggle('is-copyable', Boolean(copyable && text));

      if (captionClickHandler) {
        captionEl.removeEventListener('click', captionClickHandler);
        captionClickHandler = null;
      }

      if (copyable && text) {
        captionClickHandler = async () => {
          try {
            await navigator.clipboard.writeText(text);
            if (typeof onCopy === 'function') onCopy(true);
          } catch {
            if (typeof onCopy === 'function') onCopy(false);
          }
        };
        captionEl.addEventListener('click', captionClickHandler);
      }

      return api;
    }

    function destroy() {
      stopClock();
      if (captionClickHandler) {
        captionEl.removeEventListener('click', captionClickHandler);
      }
      host.innerHTML = '';
      host.classList.remove('gps-radar-widget');
    }

    const api = {
      el: host,
      root,
      setState,
      setHeading,
      setCoordinates,
      setCompassHint,
      setCompassLive,
      setDistressTarget,
      refreshDistressBlip,
      getHeading: () => lastHeading,
      setLabel,
      setMeta,
      setTime,
      setDate,
      setLocation,
      startClock,
      stopClock,
      setCaption,
      destroy,
    };

    setState(options.state || 'idle');
    setLabel(options.label || '');
    setMeta(options.meta || {});
    setCaption(options.caption || '', options.captionOptions || {});
    if (options.heading != null) setHeading(options.heading);
    if (options.lat != null && options.lng != null) setCoordinates(options.lat, options.lng);

    return api;
  }

  global.GpsRadar = { mount, STATES: [...STATES], headingToCardinal, toDms, bearingBetween, haversineMeters };
})(typeof window !== 'undefined' ? window : globalThis);
