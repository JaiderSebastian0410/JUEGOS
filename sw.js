/* =========================================================
   Space Defender Pro — Service Worker v3
   Offline-first: caches ALL assets including skins & fonts
   ========================================================= */

const CACHE_VERSION = 'space-defender-v18';
const STATIC_ASSETS = [
  './',
  './juego.html',
  './styles.css',
  './game.js',
  './manifest.json',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './skin_classic.png',
  './skin_phantom.png',
  './skin_golden.png',
  './space_bg.png',
  './game_bg_detailed.png',
  './menu_bg_colorful.png',
  './nebula_1.png',
  './nebula_2.png',
  './sw.js'
];

/* ---- Install: Pre-cache ALL core assets ---- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ---- Activate: Clean old caches & claim clients ---- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ---- Fetch: Cache-first with network update ---- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Google Fonts: stale-while-revalidate
  if (request.url.includes('fonts.googleapis.com') || request.url.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(request).then((cached) => {
          const fetchPromise = fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // All other requests: cache-first, network fallback, auto-cache new
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    }).catch(() => {
      if (request.mode === 'navigate') {
        return caches.match('./juego.html');
      }
    })
  );
});
