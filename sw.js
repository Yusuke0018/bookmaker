// sw.js: 簡易プリキャッシュ（S0）
const CACHE = "bookmaker-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./assets/style.css",
  "./assets/app.js",
  "./assets/achievements.js",
  "./assets/achievements.json",
  "./assets/db.js",
  "./assets/ui.js",
  "./manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req).then(
      (res) =>
        res ||
        fetch(req).then((net) => {
          const copy = net.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(req, copy))
            .catch(() => {});
          return net;
        }),
    ),
  );
});
