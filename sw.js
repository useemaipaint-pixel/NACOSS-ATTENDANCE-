/* NACOSS service worker: app opens with no internet. Bump VERSION to force an update. */
var VERSION = 'nacoss-v1';
var SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'config.js', 'sync.js', 'pwa.js',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'apple-touch-icon.png', 'favicon-48.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req, ms) {
  return new Promise(function (resolve) {
    var done = false;
    var fallback = function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); });
    };
    var t = setTimeout(function () { if (!done) fallback().then(function (r) { if (r && !done) { done = true; resolve(r); } }); }, ms);
    fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      if (!done) { done = true; clearTimeout(t); resolve(res); }
    }).catch(function () {
      clearTimeout(t);
      if (!done) fallback().then(function (r) { done = true; resolve(r || Response.error()); });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // never touch the database API
  if (req.mode === 'navigate') { e.respondWith(networkFirst(new Request('index.html'), 3500)); return; }
  if (/\.(js|webmanifest)$/.test(url.pathname) || url.pathname.slice(-1) === '/') { e.respondWith(networkFirst(req, 3000)); return; }
  e.respondWith(caches.match(req).then(function (hit) {       // icons etc: cache first
    return hit || fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  }));
});
