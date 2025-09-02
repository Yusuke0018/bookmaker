// sw.js: 強制更新用の軽量SW（バージョン付与でキャッシュ回避）
const VERSION = "v20250902-04";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        // 既存Cache APIを全削除
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {}
      await self.clients.claim();
      // クライアントへバージョン通知（必要なら再読み込み）
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: "VERSION", version: VERSION }));
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === "GET" && url.origin === location.origin) {
    const dest = req.destination;
    const shouldBust = ["script", "style", "image", "font"].includes(dest) || /\.(js|css|png|jpg|jpeg|svg|ico)$/.test(url.pathname);
    if (shouldBust && !url.searchParams.has("v")) {
      url.searchParams.set("v", VERSION);
      event.respondWith(fetch(url.toString(), { cache: "no-store" }));
      return;
    }
  }
  event.respondWith(fetch(req, { cache: "no-store" }));
});
