/**
 * sw.js — offline shell for StockPilot.
 *
 * Strategy
 *   • App shell (HTML/CSS/JS/icons) → cache-first with a background refresh.
 *     Versioned cache names mean a release is picked up on the next load and
 *     old bundles are dropped automatically.
 *   • Navigations → network-first, falling back to the cached shell so the app
 *     still opens with no connection.
 *   • Google Sheets + Apps Script → never cached. Inventory must never be
 *     served stale from the wrong place.
 */

const VERSION = 'v1.0.0';
const SHELL_CACHE = `stockpilot-shell-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './css/tokens.css?v=1.0.0',
  './css/base.css?v=1.0.0',
  './css/components.css?v=1.0.0',
  './css/modules.css?v=1.0.0',
  './js/config.js?v=1.0.0',
  './js/util.js?v=1.0.0',
  './js/crypto.js?v=1.0.0',
  './js/seed.js?v=1.0.0',
  './js/store.js?v=1.0.0',
  './js/engine.js?v=1.0.0',
  './js/charts.js?v=1.0.0',
  './js/ui.js?v=1.0.0',
  './js/auth.js?v=1.0.0',
  './js/sheets.js?v=1.0.0',
  './js/router.js?v=1.0.0',
  './js/app.js?v=1.0.0',
  './js/modules/dashboard.js?v=1.0.0',
  './js/modules/inventory.js?v=1.0.0',
  './js/modules/refill.js?v=1.0.0',
  './js/modules/warehouses.js?v=1.0.0',
  './js/modules/transfers.js?v=1.0.0',
  './js/modules/sales.js?v=1.0.0',
  './js/modules/purchase.js?v=1.0.0',
  './js/modules/insights.js?v=1.0.0',
  './js/modules/admin.js?v=1.0.0',
  './js/modules/settings.js?v=1.0.0',
  './js/modules/help.js?v=1.0.0',
  './assets/icon.svg',
  './assets/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll is all-or-nothing; add individually so one miss cannot break install.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('stockpilot-shell-') && k !== SHELL_CACHE)
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

const isExternal = (url) => url.hostname.endsWith('google.com')
  || url.hostname.endsWith('googleapis.com')
  || url.hostname.includes('script.google');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // never touch the sheet
  if (isExternal(url)) return;

  // Navigations: try the network, fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Static assets: serve from cache, refresh in the background.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(async (res) => {
      if (res && res.ok) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(request, res.clone());
      }
      return res;
    }).catch(() => undefined);
    return cached || (await network) || Response.error();
  })());
});