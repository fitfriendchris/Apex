const CACHE = 'apex-v9';
const APP_SHELL = ['/', '/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (!url.startsWith('http')) return;
  if (e.request.method !== 'GET') return;
  // Skip API calls and third-party services
  if (url.includes('supabase.co') || url.includes('googleapis.com') ||
      url.includes('generativelanguage') || url.includes('sentry.io') ||
      url.includes('fonts.googleapis') || url.includes('fonts.gstatic') ||
      url.includes('anthropic.com')) return;

  // HTML pages: cache-first with network update (offline-resilient)
  const isHTML = url.endsWith('/') || url.includes('index.html') || e.request.headers.get('Accept')?.includes('text/html');

  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const toCache = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, toCache));
        }
        // Notify clients when back online after a cache-served response
        if (cached && isHTML) {
          self.clients.matchAll().then(clients => {
            clients.forEach(client => client.postMessage({ type: 'ONLINE_RESTORED' }));
          });
        }
        return res;
      }).catch(() => {
        // Notify clients they are offline
        self.clients.matchAll().then(clients => {
          clients.forEach(client => client.postMessage({ type: 'OFFLINE' }));
        });
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      });

      // Cache-first for HTML (fast offline load), network-first for assets
      return isHTML ? (cached || networkFetch) : networkFetch;
    })
  );
});
