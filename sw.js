// عامل الخدمة: يجعل اللعبة تعمل كتطبيق وبدون إنترنت (عدا المبارزة الأونلاين)
const VERSION = 'op-tcg-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'op-tcg-cards').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // الخطوط ومكتبة الاتصال تُطلب من الشبكة مباشرة
  if (url.pathname.includes('/cards/')) {               // صور البطاقات: من الذاكرة أولاً ثم تُحفظ
    e.respondWith(caches.open('op-tcg-cards').then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
    }));
    return;
  }
  // الصفحة والملفات الأساسية: من الشبكة أولاً (لتصلك التحديثات) ثم من الذاكرة بدون إنترنت
  e.respondWith(fetch(req).then(res => { if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone())); return res; })
    .catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
});
