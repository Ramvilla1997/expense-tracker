// Network-first so every deploy reaches phones on the next open; cache is the offline fallback.
const CACHE = 'tally-v2';
const SHELL = ['./', './index.html', './style.css', './app.js', './config.js', './manifest.json', './icon.svg', './icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isAuthPath = url.pathname.startsWith('/__/');
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || isAuthPath) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
