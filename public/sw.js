// Tally service worker: network-first app shell with a short timeout, cached Firebase SDK,
// so the app opens offline and every deploy reaches phones on the next open.
const VERSION = 'tally-v17';
const SHELL = [
  './', './index.html', './css/app.css', './config.js', './manifest.json', './icon.svg', './icon-192.png', './badge-96.png', './apple-touch-icon.png',
  './fonts/jakarta-latin.woff2', './fonts/jakarta-latin-ext.woff2',
  './js/main.js', './js/app.js', './js/backend/firebase.js', './js/ui/views.js', './js/ui/sheets.js', './js/ui/icons.js',
  './js/core/money.js', './js/core/keypad.js', './js/core/dates.js', './js/core/entries.js', './js/core/budget.js',
  './js/core/bills.js', './js/core/debts.js', './js/core/text.js', './js/core/rates.js', './js/core/profile.js', './js/core/reminders.js', './js/core/month.js', './js/core/paycheque.js', './js/ui/v2.js', './js/push.js',
];
const SDK = ['firebase-app', 'firebase-auth', 'firebase-firestore'].map((m) => `https://www.gstatic.com/firebasejs/10.14.1/${m}.js`);
const TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await Promise.all(SDK.map((url) => cache.add(new Request(url, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/__/')) return; // sign-in helper, always live
    if (url.pathname.startsWith('/api/')) return; // server functions, never cached
    event.respondWith(networkFirst(request));
  } else if (url.href.startsWith('https://www.gstatic.com/firebasejs/')) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  const lookup = request.mode === 'navigate' ? './index.html' : request;
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request.mode === 'navigate' ? './index.html' : request, response.clone());
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS));
  try {
    const winner = await Promise.race([network, timeout]);
    if (winner) return winner;
    return (await cache.match(lookup, { ignoreSearch: true })) || (await network);
  } catch {
    const cached = await cache.match(lookup, { ignoreSearch: true });
    if (cached) return cached;
    throw new Error('offline and not cached');
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// A reminder arrives as a notification; tapping it opens Plan.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* not JSON: show the default title */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Tally', {
    body: data.body || '',
    tag: data.tag || 'tally',
    icon: './icon-192.png',
    badge: './badge-96.png', // white silhouette: Android draws it in the status bar
    data: { route: 'plan' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (app) {
      await app.focus();
      app.postMessage({ route: event.notification.data?.route || 'plan' });
      return;
    }
    await self.clients.openWindow(`${self.registration.scope}#/${event.notification.data?.route || 'plan'}`);
  })());
});
