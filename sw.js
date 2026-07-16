// Simpele service worker: app-schil network-first (altijd vers online, cache
// als offline-fallback). Alleen same-origin; Firestore regelt zijn eigen
// offline-cache. Bumping CACHE bij een release ruimt oude caches op.
const CACHE = 'zwart-boekje-v0.1.0';

self.addEventListener('install', e => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
