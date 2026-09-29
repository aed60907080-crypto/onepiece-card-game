// Ø¹Ø§Ù…Ù„ Ø§Ù„Ø®Ø¯Ù…Ø©: ÙŠØ¬Ø¹Ù„ Ø§Ù„Ù„Ø¹Ø¨Ø© ØªØ¹Ù…Ù„ ÙƒØªØ·Ø¨ÙŠÙ‚ ÙˆØ¨Ø¯ÙˆÙ† Ø¥Ù†ØªØ±Ù†Øª (Ø¹Ø¯Ø§ Ø§Ù„Ù…Ø¨Ø§Ø±Ø²Ø© Ø§Ù„Ø£ÙˆÙ†Ù„Ø§ÙŠÙ†)
const VERSION = 'op-tcg-v4';
const CORE = ['./', './index.html', './cards-data.js', './autofx.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

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
  if (url.origin !== location.origin) return;           // Ø§Ù„Ø®Ø·ÙˆØ· ÙˆÙ…ÙƒØªØ¨Ø© Ø§Ù„Ø§ØªØµØ§Ù„ ØªÙØ·Ù„Ø¨ Ù…Ù† Ø§Ù„Ø´Ø¨ÙƒØ© Ù…Ø¨Ø§Ø´Ø±Ø©
  if (url.pathname.includes('/cards/')) {               // ØµÙˆØ± Ø§Ù„Ø¨Ø·Ø§Ù‚Ø§Øª: Ù…Ù† Ø§Ù„Ø°Ø§ÙƒØ±Ø© Ø£ÙˆÙ„Ø§Ù‹ Ø«Ù… ØªÙØ­ÙØ¸
    e.respondWith(caches.open('op-tcg-cards').then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
    }));
    return;
  }
  // Ø§Ù„ØµÙØ­Ø© ÙˆØ§Ù„Ù…Ù„ÙØ§Øª Ø§Ù„Ø£Ø³Ø§Ø³ÙŠØ©: Ù…Ù† Ø§Ù„Ø´Ø¨ÙƒØ© Ø£ÙˆÙ„Ø§Ù‹ (Ù„ØªØµÙ„Ùƒ Ø§Ù„ØªØ­Ø¯ÙŠØ«Ø§Øª) Ø«Ù… Ù…Ù† Ø§Ù„Ø°Ø§ÙƒØ±Ø© Ø¨Ø¯ÙˆÙ† Ø¥Ù†ØªØ±Ù†Øª
  e.respondWith(fetch(req).then(res => { if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone())); return res; })
    .catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
});
