// Scribe service worker — minimal offline fallback.
//
// Strategy: network-first for navigations, with a cached offline.html shown
// when the network is unreachable. Static assets fall back to cache on error
// but aren't pre-cached (Vite fingerprints them, so a stale SW could serve
// mismatched hashes). Bump CACHE_NAME whenever the offline shell changes.

const CACHE_NAME = 'scribe-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never intercept API or websocket traffic — realtime collab depends on
  // fresh responses; stale JSON would be actively harmful.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  // Navigations: network-first, falling back to the cached offline shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        return net;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(OFFLINE_URL);
        return cached || new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // Same-origin static assets: try network, fall back to cache if present.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        if (cached) return cached;
        throw new Error('offline and not cached');
      }
    })());
  }
});
