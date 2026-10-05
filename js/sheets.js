/**
 * sheets.js — Google Sheets bridge integration (optional).
 *
 * HONESTY CONTRACT: until the Apps Script bridge answers a real ping,
 * StockPilot reports "not connected" and keeps every byte of data local.
 * Nothing simulates a connection.
 *
 * The bridge (gas/Code.gs) is the only server-side piece: it holds the
 * Google credentials a browser cannot hold. v2 keeps this transport layer;
 * entity sync beyond the legacy catalogue is a planned extension and is
 * labelled as such in Settings → Integrations.
 */
window.SP = window.SP || {};

SP.sheets = (() => {
  let autoTimer = null;
  let syncing = false;

  const cfg = () => SP.store.state.settings.integrations.googleSheets;
  const bridgeReady = () => !!(cfg().connected && cfg().bridgeUrl);

  function status() {
    const s = SP.store.state.sheet;
    return {
      mode: syncing ? 'syncing' : bridgeReady() ? (s.mode === 'error' ? 'error' : 'live') : 'snapshot',
      pending: SP.store.state.pendingOps.length,
      lastSync: cfg().lastSync || s.lastSync,
      error: s.error,
    };
  }

  /* ─────────────────────────────────────────────────────────── ping */

  async function testBridge(url) {
    const target = ((url ?? cfg().bridgeUrl) || '').trim();
    if (!target) return { ok: false, error: 'No bridge URL configured.' };
    try {
      const res = await callRaw(target, 'ping', {}, 8000);
      return { ok: res?.ok === true, info: res };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function callRaw(url, fn, payload = {}, timeoutMs = SP.sheet.timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight on GAS
        body: JSON.stringify({ fn, ...payload }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`Bridge answered HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  const call = (fn, payload = {}) => callRaw(cfg().bridgeUrl, fn, payload);

  /* ─────────────────────────────────────────────── credentials */

  /** Server-side credential check when the bridge is live. */
  async function verifyCredentials(email, password) {
    if (!bridgeReady()) return { ok: false, error: 'Bridge not connected.' };
    try {
      const res = await call('verifyUser', { email, password });
      return res && res.ok ? { ok: true, user: res.user } : { ok: false, error: res?.error || 'Rejected by the bridge.' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* ─────────────────────────────────────────────────── write queue */

  function queue(op) { SP.store.queueOp(op); }

  /** Flush queued operations to the bridge, in order. */
  async function flush() {
    const ops = SP.store.state.pendingOps;
    if (!ops.length) return { ok: true, sent: 0 };
    if (!bridgeReady()) return { ok: false, queued: true, error: 'Google Sheets bridge not connected.' };
    syncing = true;
    SP.app?.paintConnection?.();
    try {
      for (const op of ops) {
        const res = await call('applyOp', { op });
        if (!res?.ok) throw new Error(res?.error || `Bridge rejected ${op.kind}`);
        SP.store.clearOps([op.id]);
      }
      SP.store.update(['sheet'], (st) => { st.sheet.error = null; }, { silent: true });
      return { ok: true, sent: ops.length };
    } catch (e) {
      SP.store.update(['sheet'], (st) => { st.sheet.error = e.message; }, { silent: true });
      return { ok: false, error: e.message };
    } finally {
      syncing = false;
      SP.app?.paintConnection?.();
    }
  }

  /**
   * Catalogue pull from the legacy sheet. The v1 sheet shape does not map
   * losslessly onto the 2.0 ledger, so pulls are advisory: the user reviews
   * and imports through the Import wizard instead of silent overwrites.
   */
  async function refresh() {
    if (!bridgeReady()) return { ok: false, error: 'Google Sheets integration not connected.' };
    syncing = true;
    SP.app?.paintConnection?.();
    try {
      const res = await call('readInventory');
      if (!res?.ok) throw new Error(res?.error || 'Bridge read failed');
      SP.store.update(['sheet', 'settings'], (st) => {
        st.sheet.lastSync = Date.now();
        st.settings.integrations.googleSheets.lastSync = Date.now();
        st.sheet.error = null;
      }, { silent: true });
      return { ok: true, count: res.items?.length || 0, advisory: true };
    } catch (e) {
      SP.store.update(['sheet'], (st) => { st.sheet.error = e.message; }, { silent: true });
      return { ok: false, error: e.message };
    } finally {
      syncing = false;
      SP.app?.paintConnection?.();
    }
  }

  /* ─────────────────────────────────────────────────────────── init */

  function init() {
    const s = SP.store.state;
    s.sheet.mode = bridgeReady() ? 'live' : 'snapshot';
    if (bridgeReady() && SP.sheet.autoSyncMinutes > 0) {
      clearInterval(autoTimer);
      autoTimer = setInterval(() => { if (navigator.onLine) flush(); }, SP.sheet.autoSyncMinutes * 60000);
    }
  }

  return { init, status, bridgeReady, testBridge, refresh, verifyCredentials, queue, flush, call };
})();
