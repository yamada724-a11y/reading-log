/* アプリを更新したら、この番号を1つ上げること。 */
const CACHE_VERSION = 'v5';

const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const COVER_CACHE = 'covers';
const SDK_CACHE = 'firebase-sdk';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './api.js',
  './cloud.js',
  './lock.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== SHELL_CACHE && name !== COVER_CACHE && name !== SDK_CACHE)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request) || await cache.match('./index.html');
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Firebaseの部品は中身が変わらないので、一度取れたら控えを使う（電波がなくても起動できる）
  if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) {
    event.respondWith(cacheFirst(request, SDK_CACHE));
    return;
  }

  if (request.destination === 'image') {
    event.respondWith(cacheFirst(request, COVER_CACHE));
  }
});
