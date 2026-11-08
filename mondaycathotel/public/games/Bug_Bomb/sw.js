const CACHE_NAME = 'bomber-arena-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/src/main.js',
  '/src/style.css',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
