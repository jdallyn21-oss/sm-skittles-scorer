/* Skittles Scorer service worker. Keeps the whole app on the phone so it opens with no signal. */
const VERSION = 'supabase-admin-config-01';
const CACHE = 'skittles-' + VERSION;
const SHELL = [
 "./",
 "./app.js",
 "./config.js",
 "./fonts/patrick-hand-latin-400-normal.woff2",
 "./fonts/rye-latin-400-normal.woff2",
 "./fonts/work-sans-latin-400-normal.woff2",
 "./fonts/work-sans-latin-500-normal.woff2",
 "./fonts/work-sans-latin-600-normal.woff2",
 "./fonts/work-sans-latin-700-normal.woff2",
 "./icons/apple-touch-icon.png",
 "./icons/favicon-32.png",
 "./icons/icon-192.png",
 "./icons/icon-512.png",
 "./icons/icon-maskable-512.png",
 "./index.html",
 "./manifest.webmanifest",
 "./seed.js",
 "./styles.css"
];

self.addEventListener('install', e => {
  // wait, don't take over: the app tells us when it is safe to update (never mid-match)
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('skittles-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // league database calls (later) always go to the network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') { const shell = await cache.match('./index.html'); if (shell) return shell; }
    try { return await fetch(req); } catch (err) { return Response.error(); }
  })());
});
