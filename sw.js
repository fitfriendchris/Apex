const CACHE = 'apex-v7';
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
  const url = e.request.url;
  // Skip non-http, chrome-extension, and API calls entirely
  if (!url.startsWith('http')) return;
  if (e.request.method !== 'GET') return;
  if (url.includes('supabase.co') || url.includes('googleapis.com') ||
      url.includes('generativelanguage') || url.includes('sentry.io') ||
      url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const toCache = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, toCache));
        }
        return res;
      }).catch(() => cached || new Response('Offline', {status: 503}));
      return url.includes('index.html') || url.endsWith('/Apex/') || url.endsWith('/Apex')
        ? (cached || networkFetch)
        : networkFetch;
    })
  );
});
