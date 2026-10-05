const VERSION = 'v2.0.0';
const SHELL_CACHE = `stockpilot-shell-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './css/tokens.css?v=2.0.0',
  './css/base.css?v=2.0.0',
  './css/components.css?v=2.0.0',
  './css/modules.css?v=2.0.0',
  './css/v2.css?v=2.0.0',
  './js/config.js?v=2.0.0',
  './js/util.js?v=2.0.0',
  './js/crypto.js?v=2.0.0',
  './js/seed.js?v=2.0.0',
  './js/seed2.js?v=2.0.0',
  './js/store.js?v=2.0.0',
  './js/ledger.js?v=2.0.0',
  './js/approvals.js?v=2.0.0',
  './js/alerts.js?v=2.0.0',
  './js/impexp.js?v=2.0.0',
  './js/ai.js?v=2.0.0',
  './js/charts.js?v=2.0.0',
  './js/ui.js?v=2.0.0',
  './js/table.js?v=2.0.0',
  './js/auth.js?v=2.0.0',
  './js/sheets.js?v=2.0.0',
  './js/router.js?v=2.0.0',
  './js/app.js?v=2.0.0',
  './js/modules/_shared.js?v=2.0.0',
  './js/modules/dashboard.js?v=2.0.0',
  './js/modules/inventory.js?v=2.0.0',
  './js/modules/products.js?v=2.0.0',
  './js/modules/devices.js?v=2.0.0',
  './js/modules/warehouses.js?v=2.0.0',
  './js/modules/movements.js?v=2.0.0',
  './js/modules/transfers.js?v=2.0.0',
  './js/modules/sales.js?v=2.0.0',
  './js/modules/purchases.js?v=2.0.0',
  './js/modules/customers.js?v=2.0.0',
  './js/modules/suppliers.js?v=2.0.0',
  './js/modules/verify.js?v=2.0.0',
  './js/modules/approvals.js?v=2.0.0',
  './js/modules/reports.js?v=2.0.0',
  './js/modules/analytics.js?v=2.0.0',
  './js/modules/users.js?v=2.0.0',
  './js/modules/settings.js?v=2.0.0',
  './js/modules/help.js?v=2.0.0',
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