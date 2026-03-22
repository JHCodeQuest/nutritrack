const CACHE = 'nutritrack-v1';

// Local files to pre-cache on install
const PRECACHE = ['/index.html', '/app.css', '/app.js', '/icon.svg', '/manifest.json'];

// CDN hosts whose responses are safe to cache (static, versioned assets)
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',   // Quagga barcode library
  'fonts.googleapis.com',   // Google Fonts CSS
  'fonts.gstatic.com',      // Google Fonts files
  'www.gstatic.com',        // Firebase SDK JS
];

// Requests to always send to the network — never serve stale
const SKIP_HOSTS = [
  'firestore.googleapis.com',      // Firestore data
  'identitytoolkit.googleapis.com',// Firebase Auth
  'securetoken.googleapis.com',    // Auth token refresh
  'firebase.googleapis.com',       // Firebase REST
  'openfoodfacts.org',             // Food Facts API (dynamic)
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const { hostname } = new URL(e.request.url);

  // Let Firebase and dynamic API calls go straight to the network
  if (SKIP_HOSTS.some(h => hostname.includes(h))) return;

  const isCDN = CDN_HOSTS.some(h => hostname.includes(h));

  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(response => {
        if (response.ok) {
          caches.open(CACHE).then(c => c.put(e.request, response.clone()));
        }
        return response;
      });

      // CDN assets: serve from cache immediately, update in background
      // Local/other: try network first, fall back to cache if offline
      return isCDN
        ? (cached || networkFetch)
        : networkFetch.catch(() => cached);
    })
  );
});
