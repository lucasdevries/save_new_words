// Simple service worker: app shell network-first (always fresh when online,
// cache as offline fallback). Same-origin only; Firestore manages its own
// offline cache. Bumping CACHE on a release cleans up old caches.
// Speak audio clips are immutable, so they go cache-first into MEDIA_CACHE,
// which survives releases (no re-download of ~140MB after every bump).
const CACHE = 'wordlist-v0.7.1';
const MEDIA_CACHE = 'wordlist-media-v1';

self.addEventListener('install', e => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== MEDIA_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

// iOS Safari requests media with Range headers and refuses to play when a
// service worker answers those with a plain 200 — so serve the clip from the
// media cache (fetching the full file by URL, never with the Range header,
// to avoid caching a partial response) and slice the requested bytes into a
// proper 206 ourselves.
async function mediaResponse(req) {
  const cache = await caches.open(MEDIA_CACHE);
  let resp = await cache.match(req.url);
  if (!resp) {
    resp = await fetch(req.url);
    if (resp.status !== 200) return resp;
    await cache.put(req.url, resp.clone());
  }
  const range = /bytes=(\d+)-(\d+)?/.exec(req.headers.get('range') || '');
  if (!range) return resp;
  const buf = await resp.arrayBuffer();
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': resp.headers.get('Content-Type') || 'audio/mp4',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/speak/media/')) {
    e.respondWith(mediaResponse(e.request));
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
