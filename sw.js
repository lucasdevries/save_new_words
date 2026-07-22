// Simple service worker: app shell network-first (always fresh when online,
// cache as offline fallback). Same-origin only; Firestore manages its own
// offline cache. Bumping CACHE on a release cleans up old caches.
// Speak audio clips are immutable, so they go cache-first into MEDIA_CACHE,
// which survives releases (no re-download of ~70MB after every bump).
const CACHE = 'wordlist-v0.7.0';
const MEDIA_CACHE = 'wordlist-media-v1';

self.addEventListener('install', e => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== MEDIA_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/speak/media/')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
        if (resp.ok) { const copy = resp.clone(); caches.open(MEDIA_CACHE).then(c => c.put(e.request, copy)); }
        return resp;
      }))
    );
    return;
  }
  e.respondWith(
    fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
