/* Service worker: app shell is cache-first (works fully offline),
   API GETs are network-first with cache fallback, mutations pass through
   (the page-side outbox in js/api.js queues them when offline). */
const SHELL_CACHE = 'shell-v2';   // bump on every release so installed clients refresh
const API_CACHE = 'api-v1';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest',
  '/css/app.css',
  '/js/app.js', '/js/api.js', '/js/db.js', '/js/ui.js',
  '/js/views-core.js', '/js/views-academic.js', '/js/views-money.js', '/js/views-more.js',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => ![SHELL_CACHE, API_CACHE].includes(k)).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;           // mutations handled by page outbox

  if (url.pathname.startsWith('/api/')) {
    // network-first, fall back to last good response
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok && !url.pathname.includes('/auth/')) {
          const copy = resp.clone();
          caches.open(API_CACHE).then(c => c.put(e.request, copy));
        }
        return resp;
      }).catch(() =>
        caches.match(e.request).then(hit =>
          hit || new Response(JSON.stringify({ error: 'offline', offline: true }), {
            status: 503, headers: { 'Content-Type': 'application/json' },
          })
        )
      )
    );
    return;
  }

  // shell + uploads: cache-first
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      if (resp.ok && (url.pathname.startsWith('/uploads/') || SHELL.includes(url.pathname))) {
        const copy = resp.clone();
        caches.open(SHELL_CACHE).then(c => c.put(e.request, copy));
      }
      return resp;
    }).catch(() => url.pathname === '/' || url.pathname.startsWith('/#')
      ? caches.match('/index.html') : Response.error()))
  );
});
