// PWA Service Worker (precache + runtime cache)
const VERSION = 'v1.0.0';
const PRECACHE = `bookmaker-precache-${VERSION}`;
const RUNTIME = `bookmaker-runtime-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './assets/app.js',
  './assets/ui.js',
  './assets/style.css',
  './assets/achievements.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => ![PRECACHE, RUNTIME].includes(k)).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients && self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Navigation requests: serve index.html for SPA
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  // Same-origin static assets: cache-first, then network
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(RUNTIME).then((cache) => cache.put(req, copy));
            return res;
          })
          .catch(() => cached);
      }),
    );
  }
});
