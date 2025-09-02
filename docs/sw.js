// プレースホルダ（M8で強化）
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', () => { if (self.clients) self.clients.claim(); });
