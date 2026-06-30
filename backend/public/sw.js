const CACHE = 'emergency-alert-v31';
const SHELL = ['/', '/index.html', '/app.js', '/supabase-client.js', '/map-view.js', '/radar.js', '/hardware-store.js', '/sos-recorder.js', '/styles.css', '/map-view.css', '/radar.css', '/hardware-store.css', '/manifest.json', '/icon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request).then((res) => {
        if (res.ok && event.request.url.startsWith(self.location.origin)) {
          caches.open(CACHE).then((cache) => cache.put(event.request, res.clone()));
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Emergency Alert', body: 'SOS alert nearby' };
  try {
    if (event.data) data = event.data.json();
  } catch (_) {}

  const mapUrl = data.mapUrl || (data.alertId ? `/?alertId=${data.alertId}` : '/');

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    data: { url: mapUrl, alertId: data.alertId, mapUrl },
    requireInteraction: true,
    actions: [{ action: 'open-map', title: 'View on Map' }],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.mapUrl || data.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('navigate' in client) {
          return client.focus().then(() => client.navigate(url));
        }
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
