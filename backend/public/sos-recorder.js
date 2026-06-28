/**
 * SOS video + audio recorder — uploads chunks only while an alert is active.
 */
(function (global) {
  const API = '/api/v1';
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const CHUNK_MS = isIOS ? 5000 : 8000;

  let mediaStream = null;
  let recorder = null;
  let alertId = null;
  let sequence = 0;
  let getAuthToken = null;
  let previewEl = null;
  let statusCallback = null;
  let fileExt = '.webm';
  let mediaType = 'audiovideo';

  function setStatus(msg) {
    if (typeof statusCallback === 'function') statusCallback(msg);
  }

  function pickMimeType() {
    const iosTypes = [
      'video/mp4',
      'video/mp4;codecs=avc1',
      'audio/mp4',
      'audio/aac',
    ];
    const defaultTypes = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm',
      'audio/webm;codecs=opus',
      'audio/webm',
    ];
    const types = isIOS ? [...iosTypes, ...defaultTypes] : defaultTypes;
    return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  function extForMime(mime) {
    if (!mime) return isIOS ? '.mp4' : '.webm';
    if (mime.includes('mp4')) return '.mp4';
    return '.webm';
  }

  async function uploadChunk(blob, seq, type, durationMs) {
    const authToken = typeof getAuthToken === 'function' ? getAuthToken(alertId) : null;
    if (!authToken || !alertId || !blob?.size) return;

    const form = new FormData();
    form.append('chunk', blob, `sos-${seq}${fileExt}`);
    form.append('sequence', String(seq));
    form.append('mediaType', type);
    form.append('durationMs', String(durationMs || CHUNK_MS));

    const res = await fetch(`${API}/emergency/${alertId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: form,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Media upload failed');
    }
  }

  function bindRecorderEvents(rec) {
    rec.addEventListener('dataavailable', async (event) => {
      if (!event.data?.size || !alertId) return;
      sequence += 1;
      const seq = sequence;
      try {
        await uploadChunk(event.data, seq, mediaType, CHUNK_MS);
        const hasVideo = mediaType === 'audiovideo';
        setStatus(hasVideo ? `Recording video + audio (${seq})` : `Recording audio (${seq})`);
      } catch (err) {
        console.warn('SOS media upload failed:', err);
        setStatus('Upload retrying on next clip…');
      }
    });

    rec.addEventListener('stop', () => {
      if (previewEl) previewEl.srcObject = null;
    });

    rec.addEventListener('error', (e) => {
      console.warn('MediaRecorder error:', e);
      setStatus('Recording error — retrying…');
    });
  }

  function startRecorder() {
    const mimeType = pickMimeType();
    fileExt = extForMime(mimeType);
    const hasVideo = mediaStream.getVideoTracks().length > 0;
    mediaType = hasVideo ? 'audiovideo' : 'audio';

    recorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);

    bindRecorderEvents(recorder);
    recorder.start(CHUNK_MS);
  }

  async function start(id, authFn, options = {}) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('Recording not supported in this browser.');
      return false;
    }

    stop();
    alertId = id;
    getAuthToken = authFn;
    sequence = 0;
    statusCallback = options.onStatus || null;
    previewEl = options.previewEl || null;

    const wantVideo = options.video !== false;

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: wantVideo
          ? {
              facingMode: { ideal: 'environment' },
              width: { ideal: 640, max: 1280 },
              height: { ideal: 480, max: 720 },
            }
          : false,
      });
    } catch (err) {
      if (wantVideo) {
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
          });
          setStatus('Camera blocked — recording audio only.');
        } catch (audioErr) {
          setStatus('Microphone denied — SOS location still active.');
          return false;
        }
      } else {
        setStatus('Microphone access denied.');
        return false;
      }
    }

    if (previewEl) {
      previewEl.srcObject = mediaStream;
      previewEl.muted = true;
      previewEl.playsInline = true;
      previewEl.setAttribute('webkit-playsinline', 'true');
      previewEl.play().catch(() => {});
    }

    try {
      startRecorder();
    } catch (err) {
      console.warn('MediaRecorder start failed:', err);
      setStatus('Could not start recorder on this device.');
      stop();
      return false;
    }

    const hasVideo = mediaStream.getVideoTracks().length > 0;
    setStatus(
      hasVideo
        ? 'Recording live video + audio for emergency contacts…'
        : 'Recording live audio for emergency contacts…'
    );
    return true;
  }

  function stop() {
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (_) {}
    }
    recorder = null;

    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }

    if (previewEl) previewEl.srcObject = null;
    alertId = null;
    getAuthToken = null;
    sequence = 0;
  }

  function isActive() {
    return Boolean(recorder && recorder.state === 'recording');
  }

  global.SosRecorder = { start, stop, isActive };
})(typeof window !== 'undefined' ? window : globalThis);
