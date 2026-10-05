/**
 * sheets.js — Google Sheets integration.
 *
 * Two paths:
 *
 *  1. BRIDGE (recommended). An Apps Script web app deployed from `gas/Code.gs`
 *     exposes `readInventory` / `applyOps` / `verifyCredentials`. Because it is
 *     served from scripts.google.com with CORS enabled, the browser can call it
 *     directly, and it holds the credentials needed to *write* to the sheet —
 *     which a browser alone can never do.
 *
 *  2. DIRECT CSV. A read-only GET of the published sheet. Google does not send
 *     CORS headers, so this only succeeds when the app is served from a Google
 *     origin (Apps Script, Drive) or a proxy. Used opportunistically.
 *
 * Everything degrades gracefully: with no bridge the app runs on the bundled
 * snapshot and queues writes for later.
 */
window.SP = window.SP || {};

SP.sheets = (() => {
  const cfg = () => SP.sheet;

  /* ───────────────────────────────────────────────────────── state */

  let bridge = { url: '', ok: false, lastError: null, checkedAt: 0 };
  let inflight = null;
  const listeners = new Set();

  const onStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = () => { for (const fn of listeners) { try { fn(status()); } catch { /* noop */ } } };

  function status() {
    const s = SP.store.state.sheet;
    return {
      mode: s.mode,
      lastSync: s.lastSync,
      connected: s.connected,
      error: s.error,
      pending: SP.store.state.pendingOps.length,
      bridge: !!bridge.url,
      bridgeOk: bridge.ok,
    };
  }

  /* ───────────────────────────────────────────────────────── config */

  function setBridge(url) {
    bridge.url = String(url || '').trim().replace(/\/+$/, '');
    bridge.ok = false;
    bridge.lastError = null;
    SP.store.update(['sheet'], (st) => { st.sheet.bridgeUrl = bridge.url; });
    if (!bridge.url) {
      SP.store.update(['sheet'], (st) => { st.sheet.connected = false; st.sheet.mode = 'snapshot'; st.sheet.error = null; });
      emit();
    }
    return bridge.url;
  }

  const bridgeReady = () => !!bridge.url;
  const bridgeHealthy = () => bridge.ok;

  /** Latency-check the bridge; called by Settings → Test connection. */
  async function testBridge() {
    if (!bridge.url) return { ok: false, error: 'No bridge URL configured.' };
    try {
      const res = await call('ping', {}, { timeout: 8000 });
      bridge.ok = !!res?.ok;
      bridge.lastError = bridge.ok ? null : (res?.error || 'Unreachable');
      SP.store.update(['sheet'], (st) => {
        st.sheet.connected = bridge.ok;
        st.sheet.error = bridge.lastError;
        if (bridge.ok) st.sheet.mode = 'live';
      }, { silent: true });
      emit();
      return { ok: bridge.ok, info: res };
    } catch (e) {
      bridge.ok = false;
      bridge.lastError = e.message;
      SP.store.update(['sheet'], (st) => { st.sheet.connected = false; st.sheet.error = e.message; }, { silent: true });
      emit();
      return { ok: false, error: e.message };
    }
  }

  /* ────────────────────────────────────────────────────── transport */

  async function call(fn, payload = {}, o = {}) {
    const timeout = o.timeout || cfg().timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(bridge.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fn, ...payload }),
        signal: controller.signal,
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { throw new Error(`Unexpected response (${res.status}). Is the URL a deployed web app?`); }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('The request timed out.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ──────────────────────────────────────────────────── CSV parsing */

  /** RFC4180-ish CSV row splitter. */
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
        } else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r') { /* skip */ }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  const toInt = (v) => {
    const n = parseInt(String(v ?? '').replace(/,/g, '').trim(), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const normSku = (s) => String(s).replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  const skuKey = (s) => normSku(s).toUpperCase();

  function specKey(raw) {
    const parts = String(raw ?? '').replace(/\s+/g, ' ').trim().split('|').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return '';
    if (parts.every((p) => !/\d/.test(p))) return parts.join('|').toUpperCase();
    const ram = parts[0] ? String(parseFloat(parts[0])).replace(/\.0$/, '') : '';
    const store = parts[1] ? parts[1].toUpperCase().replace(/\s+/g, '') : '';
    return `${ram}|${store}`.toUpperCase();
  }

  const BRAND_RULES = [
    [/PAD|TAB/i, 'Pad'], [/^XIAOMI/i, 'Xiaomi'], [/^REDMI/i, 'REDMI'],
    [/^ONEPLUS/i, 'OnePlus'], [/^REALME/i, 'Realme'], [/^SAMSUNG/i, 'Samsung'],
    [/^VIVO/i, 'Vivo'], [/^OPPO/i, 'OPPO'], [/^NOVA|HUAWEI/i, 'Huawei'],
    [/^IPHONE/i, 'iPhone'], [/^HONOR/i, 'HONOR'],
  ];
  const brandOf = (sku) => (BRAND_RULES.find(([re]) => re.test(normSku(sku))) || [null, 'Other'])[1];

  /**
   * Turn raw sheet rows into the app's SKU shape.
   * Layout is documented in tools/build-seed.mjs.
   */
  function rowsToCatalogue(rows) {
    const COLOURS = SP.COLOURS;
    const catalogue = new Map();
    let warehouse = 'MAIN';

    for (const r of rows) {
      const b = (r[1] || '').trim();
      const c = (r[2] || '').trim();
      const d = (r[3] || '').trim();
      if (/^(.+)_Series$/.test(b)) continue;
      if (c === 'REGULAR STOCK') { warehouse = d || warehouse; continue; }
      if (!/^\d+$/.test(b) || !c || /^Specs$/i.test(c)) continue;

      const key = `${skuKey(c)}|${specKey(d)}`;
      if (!catalogue.has(key)) {
        catalogue.set(key, {
          sku: normSku(c),
          specs: specKey(d).replace('|', ' | ').replace(/(\d+ \| \d+)([A-Z]+)/, '$1$2'),
          brand: brandOf(c),
          colours: Object.fromEntries(COLOURS.map((x) => [x, 0])),
          byWh: {},
        });
      }
      const entry = catalogue.get(key);
      let qty = 0;
      COLOURS.forEach((colour, i) => {
        const v = toInt(r[4 + i]);
        entry.colours[colour] += v;
        qty += v;
      });
      if (qty > 0) entry.byWh[warehouse] = (entry.byWh[warehouse] || 0) + qty;
    }

    return [...catalogue.values()].map((s) => {
      const total = COLOURS.reduce((a, c) => a + s.colours[c], 0);
      return { ...s, total };
    }).sort((a, b) => b.total - a.total);
  }

  /* ──────────────────────────────────────────────────────── reading */

  /**
   * Refresh inventory from the sheet.
   * @returns {Promise<{ok:boolean, source?:string, count?:number, error?:string}>}
   */
  async function refresh({ force = false } = {}) {
    if (inflight) return inflight;

    inflight = (async () => {
      setMode('syncing');
      try {
        let catalogue = null;
        let source = '';

        if (bridgeReady()) {
          const res = await call('readInventory', {}, { timeout: 20000 });
          if (!res?.ok) throw new Error(res?.error || 'Bridge returned no data.');
          catalogue = res.inventory.map(normaliseBridgeItem);
          source = 'bridge';
          bridge.ok = true;
        } else {
          const text = await fetchCSV();
          catalogue = rowsToCatalogue(parseCSV(text));
          source = 'csv';
        }

        if (!catalogue.length) throw new Error('The sheet returned no inventory rows.');

        applyCatalogue(catalogue);
        SP.store.update(['sheet'], (st) => {
          st.sheet.connected = true;
          st.sheet.lastSync = Date.now();
          st.sheet.lastReadOk = Date.now();
          st.sheet.mode = 'live';
          st.sheet.error = null;
          st.sheet.source = source;
        });
        SP.store.audit('sheet.sync', source, `${catalogue.length} SKUs read`);
        emit();
        return { ok: true, source, count: catalogue.length };
      } catch (e) {
        bridge.lastError = e.message;
        SP.store.update(['sheet'], (st) => {
          st.sheet.mode = 'error';
          st.sheet.error = e.message;
          st.sheet.lastReadOk = null;
        });
        SP.store.notify({
          tone: 'warn', title: 'Sheet sync failed',
          body: `${e.message} — still showing the last known data.`,
        });
        emit();
        return { ok: false, error: e.message };
      } finally {
        inflight = null;
        void force;
      }
    })();

    return inflight;
  }

  function setMode(mode) {
    SP.store.update(['sheet'], (st) => { st.sheet.mode = mode; }, { silent: true });
    emit();
  }

  async function fetchCSV() {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg().timeoutMs);
    try {
      const res = await fetch(`${cfg().csvUrl}&t=${Date.now()}`, { signal: ctl.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`Sheet returned HTTP ${res.status}.`);
      const text = await res.text();
      if (text.startsWith('<')) throw new Error('The sheet is private. Publish it, or connect the Apps Script bridge.');
      return text;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Timed out reaching the sheet.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  function normaliseBridgeItem(it) {
    return {
      sku: it.sku,
      specs: it.specs,
      brand: it.brand || brandOf(it.sku),
      colours: it.colours || {},
      byWh: it.byWarehouse || it.byWh || {},
      total: it.total ?? SP.COLOURS.reduce((a, c) => a + (Number(it.colours?.[c]) || 0), 0),
    };
  }

  /**
   * Merge fresh catalogue data into state, preserving user-authored fields
   * (cost, minStock, notes, archived flag).
   */
  function applyCatalogue(catalogue) {
    SP.store.update(['skus'], (st) => {
      const prev = new Map(st.skus.map((x) => [`${skuKey(x.sku)}|${specKey(x.specs)}`, x]));
      let idSeq = st.skus.length;

      st.skus = catalogue.map((c) => {
        const key = `${skuKey(c.sku)}|${specKey(c.specs)}`;
        const old = prev.get(key);
        idSeq += 1;
        const merged = old || {};
        return {
          ...merged,
          id: merged.id || `SKU${String(idSeq).padStart(3, '0')}`,
          sku: c.sku,
          specs: c.specs,
          brand: c.brand || merged.brand || 'Other',
          colours: { ...c.colours },
          byWh: { ...c.byWh },
          archived: merged.archived || false,
          cost: merged.cost ?? SP.costFor(c),
          minStock: merged.minStock ?? 0,
          notes: merged.notes || '',
          createdAt: merged.createdAt || Date.now(),
          updatedAt: Date.now(),
        };
      });
    }, { silent: true });
  }

  /* ──────────────────────────────────────────────────────── writing */

  /**
   * Queue a write. When the bridge is available it is attempted immediately,
   * otherwise it stays in the outbox until the next successful sync.
   */
  async function push(op, opts = {}) {
    SP.store.update(['pendingOps'], (st) => { st.pendingOps.push({ ...op, id: SP.uid('op'), at: Date.now(), tries: 0 }); }, { silent: true });
    emit();

    if (!bridgeReady() && !opts.force) return { ok: true, queued: true };

    const flushed = await flush();
    return { ok: flushed.ok, queued: flushed.ok ? false : true, error: flushed.error };
  }

  /** Attempt to send everything in the outbox. */
  async function flush() {
    const ops = SP.store.state.pendingOps;
    if (!ops.length) return { ok: true, sent: 0 };
    if (!bridgeReady()) {
      return { ok: false, queued: true, error: 'Connect the Apps Script bridge to write to the sheet.' };
    }

    try {
      setMode('syncing');
      const res = await call('applyOps', { ops }, { timeout: 25000 });
      if (!res?.ok) throw new Error(res?.error || 'Write rejected.');

      SP.store.update(['pendingOps', 'sheet'], (st) => {
        st.pendingOps = [];
        st.sheet.connected = true;
        st.sheet.lastSync = Date.now();
        st.sheet.mode = 'live';
        st.sheet.error = null;
      }, { silent: true });

      SP.store.audit('sheet.push', 'bridge', `${ops.length} operation(s) written`);
      SP.ui?.toast({
        tone: 'ok', title: 'Sheet updated',
        body: `${SP.fmt.pluralise(ops.length, 'change')} written to Google Sheets.`,
      });
      emit();
      return { ok: true, sent: ops.length };
    } catch (e) {
      SP.store.update(['sheet'], (st) => { st.sheet.mode = 'error'; st.sheet.error = e.message; }, { silent: true });
      emit();
      return { ok: false, error: e.message };
    }
  }

  /** Optional server-side credential check used by the sign-in gate. */
  async function verifyCredentials(email, password) {
    if (!bridgeReady()) return null;
    try {
      return await call('verifyCredentials', { email, password }, { timeout: 10000 });
    } catch {
      return null;
    }
  }

  /* ─────────────────────────────────────────────────── sheet exports */

  /** Flattened matrix for CSV export / Apps Script writes. */
  function toMatrix() {
    const COLOURS = SP.COLOURS;
    const s = SP.store.state;
    return s.skus.filter((x) => !x.archived).map((sku) => {
      const row = { sku: sku.sku, specs: sku.specs, brand: sku.brand };
      COLOURS.forEach((c) => { row[c] = Number(sku.colours?.[c]) || 0; });
      row.TOTAL = COLOURS.reduce((a, c) => a + row[c], 0);
      s.warehouses.forEach((w) => { row[w.id] = Number(sku.byWh?.[w.id]) || 0; });
      return row;
    });
  }

  /** Full backup including everything needed to rebuild the app offline. */
  function exportPayload() {
    const COLOURS = SP.COLOURS;
    return {
      generatedAt: new Date().toISOString(),
      app: 'StockPilot',
      version: SP.VERSION,
      docId: cfg().docId,
      colours: COLOURS,
      warehouses: SP.store.state.warehouses.map((w) => w.id),
      rules: SP.store.state.rules,
      inventory: SP.store.state.skus.map((sku) => ({
        id: sku.id, sku: sku.sku, specs: sku.specs, brand: sku.brand,
        colours: sku.colours, byWarehouse: sku.byWh,
        cost: sku.cost, minStock: sku.minStock, archived: !!sku.archived, notes: sku.notes || '',
      })),
      sales: SP.store.state.sales,
      transfers: SP.store.state.transfers,
      purchases: SP.store.state.purchases,
    };
  }

  /** Restore catalogue + ledger from an export payload. */
  function importPayload(payload, { replace = false } = {}) {
    if (!payload || !Array.isArray(payload.inventory)) throw new Error('Not a StockPilot export.');
    SP.store.update(['skus', 'sales', 'transfers', 'purchases', 'rules'], (st) => {
      if (replace) { st.sales = []; st.transfers = []; st.purchases = []; }
      const byKey = new Map(st.skus.map((x) => [`${skuKey(x.sku)}|${specKey(x.specs)}`, x]));
      for (const it of payload.inventory) {
        const key = `${skuKey(it.sku)}|${specKey(it.specs)}`;
        const old = byKey.get(key);
        if (old) {
          old.colours = { ...it.colours };
          old.byWh = { ...(it.byWarehouse || it.byWh || {}) };
          old.cost = it.cost ?? old.cost;
          old.minStock = it.minStock ?? old.minStock;
          old.archived = !!it.archived;
          old.notes = it.notes ?? old.notes;
        } else {
          st.skus.push({
            id: it.id || SP.uid('SKU'),
            sku: it.sku, specs: it.specs, brand: it.brand || brandOf(it.sku),
            colours: { ...it.colours }, byWh: { ...(it.byWarehouse || it.byWh || {}) },
            cost: it.cost ?? SP.costFor(it), minStock: it.minStock ?? 0,
            archived: !!it.archived, notes: it.notes || '',
            createdAt: Date.now(), updatedAt: Date.now(),
          });
        }
      }
      if (payload.rules) st.rules = { ...st.rules, ...payload.rules };
      for (const key of ['sales', 'transfers', 'purchases']) {
        if (Array.isArray(payload[key])) st[key].push(...payload[key]);
      }
    });
    SP.store.audit('data.import', replace ? 'replace' : 'merge', `${payload.inventory.length} SKUs`);
    return payload.inventory.length;
  }

  /* ───────────────────────────────────────────────────── auto-sync */

  let timer = null;

  function startAutoSync() {
    stopAutoSync();
    const mins = Number(cfg().autoSyncMinutes) || 30;
    if (mins <= 0) return;
    timer = setInterval(async () => {
      if (document.hidden) return;
      if (!navigator.onLine) return;
      await refresh();
      await flush();
    }, mins * 60000);
  }

  function stopAutoSync() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /** Wire up the online/offline + visibility behaviour. */
  function init() {
    setBridge(localStorage.getItem('stockpilot.bridge') || SP.sheet.bridgeUrl || '');
    onStatus(() => SP.app?.paintConnection?.());

    addEventListener('online', async () => {
      SP.ui?.toast({ tone: 'ok', title: 'Back online', body: 'Syncing queued changes…' });
      await refresh();
      await flush();
    });
    addEventListener('offline', () => {
      SP.ui?.toast({ tone: 'warn', title: 'You are offline', body: 'Changes are saved locally and will sync later.' });
      setMode('snapshot');
    });
    startAutoSync();
  }

  return {
    init, status, onStatus, setBridge, bridgeReady, bridgeHealthy, testBridge,
    refresh, flush, push, verifyCredentials, parseCSV, rowsToCatalogue,
    toMatrix, exportPayload, importPayload, startAutoSync, stopAutoSync,
  };
})();