const CACHE_NAME = 'app-repartos-v1';
const urlsToCache = [
  './',
  './index.html',
  './login.html',
  './panel-admin.html',
  './dashboard-repartidor.html',
  './ver-pedidos.html',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
