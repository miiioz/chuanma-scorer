// 川麻记分 Service Worker — 离线缓存
const CACHE_NAME = 'chuanma-v27';
const ASSETS = [
  './',
  './index.html',
  './ui.mjs',
  './rules.mjs',
  './engine.mjs',
  './state.mjs',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './sakura-bg.png',
  './panda-head.png',
  './tile-zhong.png',
  './tile-fa.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 缓存优先，回退到网络
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      // 动态缓存新请求
      if (resp && resp.status === 200 && resp.type === 'basic') {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return resp;
    }).catch(() => cached))
  );
});
