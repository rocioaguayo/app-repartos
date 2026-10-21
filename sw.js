const CACHE_NAME = 'app-repartos-v8';
const CACHE_LIBRERIAS = 'app-repartos-librerias-v1';
const urlsToCache = [
  './',
  './index.html',
  './login.html',
  './panel-admin.html',
  './dashboard-repartidor.html',
  './ver-pedidos.html',
  './pagina-web.html',
  './seguimiento.html',
  './portal-cliente.html',
  './seguimiento-comun.js',
  './etiquetas.js',
  './entrega.js',
  './cuenta.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Librerías externas (Firebase, mapas, escáner, fuentes, logo): se guardan la primera vez
// que se usan, para que la app abra aunque no haya señal.
const HOSTS_LIBRERIAS = [
  'www.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'lh3.googleusercontent.com'
];

self.addEventListener('install', event => {
  // Cada archivo se cachea por separado: si uno falla, la instalación no se cae entera.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(urlsToCache.map(url => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME && k !== CACHE_LIBRERIAS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Librerías: primero la copia guardada (no cambian, las URLs llevan versión).
  if (HOSTS_LIBRERIAS.indexOf(url.hostname) > -1) {
    event.respondWith(
      caches.open(CACHE_LIBRERIAS).then(cache =>
        cache.match(req).then(guardada => guardada || fetch(req).then(resp => {
          if (resp.ok || resp.type === 'opaque') cache.put(req, resp.clone());
          return resp;
        }))
      )
    );
    return;
  }

  // Solo archivos de la propia app; Firestore, mapas y rutas siempre van a internet.
  if (url.origin !== self.location.origin) return;

  // Páginas y archivos propios: primero internet (para tener siempre la última versión)
  // y, sin señal, la copia guardada. Las páginas con ?parámetros usan la misma copia.
  event.respondWith(
    fetch(req).then(resp => {
      if (resp.ok) {
        const copia = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copia));
      }
      return resp;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }))
  );
});
