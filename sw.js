const CACHE = 'apex-v6';
const OFFLINE_ASSETS = ['/Apex/', '/Apex/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_ASSETS)).then(() => self.skipWaiting())
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
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (url.includes('supabase.co') || url.includes('googleapis.com') ||
      url.includes('generativelanguage') || url.includes('sentry.io') ||
      url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        // Clone BEFORE doing anything else with the response
        if (res && res.status === 200 && res.type !== 'opaque') {
          const toCache = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, toCache));
        }
        return res;
      }).catch(() => cached || new Response('Offline', {status: 503}));

      // HTML: cache first (fast load), everything else: network first
      return url.includes('index.html') || url.endsWith('/Apex/') || url.endsWith('/Apex')
        ? (cached || networkFetch)
        : networkFetch;
    })
  );
});
