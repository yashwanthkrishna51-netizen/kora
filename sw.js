// sw.js — deliberately minimal.
//
// Kora is a live-data tool: every page shows current client/integration/AMS
// state, computed fresh on every load. A typical PWA service worker adds
// offline caching — that would be actively harmful here, since a cached,
// stale response could show someone an old RAG status or a "resolved"
// ticket that's actually still open. So this service worker does the
// minimum needed to make the app installable (a registered fetch handler
// is part of the standard installability check in Chrome) and nothing more
// — every request still goes straight to the network, uncached.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Belt-and-suspenders: this SW never creates a cache, but if an earlier
  // (buggy or since-reverted) version of this file ever did, those caches
  // persist in the browser independently of this file being replaced. Wipe
  // anything left behind so no old cached bundle can ever be served again.
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Pure passthrough — no caching, no offline fallback. Every request hits
  // the network exactly as it would with no service worker at all.
  event.respondWith(fetch(event.request));
});