/* Service worker: keeps the whole app on the phone so it opens instantly and
   keeps working with no signal. Bump CACHE when you change any file. */
const CACHE = 'rise-door-tracker-v3';

const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/data-packages.js',
  './js/data-lists.js',
  './js/data-ian.js',
  './js/data-russel.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Cache first: the app must open even with no signal. A fresh copy is fetched
   quietly in the background and used next time. */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(hit => {
      const network = fetch(event.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy));
        }
        return res;
      }).catch(() => hit || caches.match('./index.html'));
      return hit || network;
    })
  );
});
