/**
 * store.js — reactive application state with persistence and an audit trail.
 *
 * Design notes
 *  - Single mutable `state` object, mutated only through `actions`/`update`.
 *  - Subscribers are notified with a set of changed top-level keys.
 *  - Writes are debounced to localStorage; a revision counter drives the
 *    "saved / saving" indicator in the app bar.
 *  - Mutations made while the Apps Script bridge is unavailable are queued in
 *    `pendingOps` and replayed on the next successful sync.
 */
window.SP = window.SP || {};

SP.store = (() => {
  const KEY = SP.STORAGE_KEY;
  const listeners = new Set();
  let saveTimer = null;
  let lastError = null;

  /* ────────────────────────────────────────────────────────── defaults */

  function defaultState() {
    return {
      rev: 0,
      createdAt: Date.now(),
      onboarded: false,
      prefs: {
        theme: 'dark',
        density: 'comfortable',
        accent: '#5b8cff',
        warehouse: 'MAIN',
        role: 'storekeeper',
        alerts: { enabled: true, sound: false, desktop: false, onlyCritical: false },
        seenTips: [],
      },
      rules: {
        refillMax: SP.RULES.refillMax,
        targetCoverWeeks: SP.RULES.defaultCoverWeeks,
        deadStockDays: SP.RULES.deadStockDays,
        minOrderValue: SP.RULES.minOrderValue,
        currency: 'BDT',
      },
      users: [],
      sessions: [],
      skus: [],          // { id, sku, specs, brand, colours{}, byWh{}, archived }
      warehouses: SP.WAREHOUSES.map((w) => ({ ...w, active: true })),
      sales: [],         // dispatch / sales ledger
      transfers: [],
      purchases: [],
      audit: [],         // { id, at, by, action, target, detail }
      pendingOps: [],    // queued writes awaiting sheet sync
      notifications: [],
      sheet: {
        connected: false,
        lastSync: null,
        lastReadOk: null,
        mode: 'snapshot', // snapshot | live | error
        error: null,
      },
      insights: { dismissed: [] },
    };
  }

  let state = defaultState();

  /* ─────────────────────────────────────────────────────── persistence */

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;
      state = migrate({ ...defaultState(), ...parsed });
      return true;
    } catch (e) {
      lastError = e;
      console.warn('[store] load failed, starting fresh:', e);
      return false;
    }
  }

  /** Fills in keys introduced by later versions without clobbering user data. */
  function migrate(s) {
    const base = defaultState();
    for (const k of Object.keys(base)) {
      if (s[k] === undefined) s[k] = base[k];
      else if (!Array.isArray(base[k]) && typeof base[k] === 'object' && base[k] !== null) {
        s[k] = { ...base[k], ...s[k] };
      }
    }
    s.prefs = { ...base.prefs, ...s.prefs, alerts: { ...base.prefs.alerts, ...(s.prefs.alerts || {}) } };
    s.rules = { ...base.rules, ...s.rules };
    s.sheet = { ...base.sheet, ...s.sheet };
    if (!Array.isArray(s.prefs.seenTips)) s.prefs.seenTips = [];
    return s;
  }

  function saveNow() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      lastError = null;
      return true;
    } catch (e) {
      lastError = e;
      // Quota exhausted: drop the audit tail and retry once.
      if (state.audit.length > 40) {
        state.audit = state.audit.slice(-40);
        try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { /* fallthrough */ }
      }
      SP.ui?.toast({ tone: 'danger', title: 'Could not save locally', body: 'Storage is full. Export a backup from Settings.' });
      return false;
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 180);
  }

  /* ────────────────────────────────────────────────────── subscriptions */

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function emit(changed) {
    const set = new Set(changed && changed.length ? changed : ['*']);
    for (const fn of listeners) {
      try { fn(state, set); } catch (e) { console.error('[store] subscriber failed', e); }
    }
  }

  /** Mutate state, persist, notify. `keys` lists changed top-level branches. */
  function update(keys, mutator, opts = {}) {
    if (typeof keys === 'function') { mutator = keys; keys = null; opts = {}; }
    const result = mutator ? mutator(state) : undefined;
    state.rev += 1;
    scheduleSave();
    if (!opts.silent) emit(keys);
    return result;
  }

  /* ──────────────────────────────────────────────────────────── audit */

  function audit(action, target, detail, by) {
    const user = by || SP.auth?.current()?.name || 'system';
    state.audit.unshift({
      id: SP.uid('aud'),
      at: Date.now(),
      by: user,
      action,
      target: target || '',
      detail: detail || '',
    });
    if (state.audit.length > 400) state.audit.length = 400;
    return state.audit[0];
  }

  /* ────────────────────────────────────────────────────── notifications */

  function notify(n) {
    const note = {
      id: SP.uid('ntf'),
      at: Date.now(),
      read: false,
      tone: 'info',
      title: '',
      body: '',
      ...n,
    };
    state.notifications.unshift(note);
    if (state.notifications.length > 80) state.notifications.length = 80;
    return note;
  }

  /* ───────────────────────────────────────────── bootstrap from seed */

  /** Populate the catalogue from SP.SEED when no local copy exists. */
  function hydrateFromSeed() {
    const seed = SP.SEED;
    if (!seed || !Array.isArray(seed.skus)) return false;

    state.skus = seed.skus.map((s, i) => ({
      id: s.id || `SKU${String(i + 1).padStart(3, '0')}`,
      sku: s.sku,
      specs: s.specs,
      brand: s.brand,
      colours: { ...s.colours },
      // The snapshot generator emits `byWarehouse`; older exports use `byWh`.
      byWh: { ...(s.byWarehouse || s.byWh) },
      archived: false,
      cost: SP.costFor(s),
      minStock: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      notes: '',
    }));

    if (Array.isArray(seed.warehouses) && seed.warehouses.length) {
      const meta = new Map(SP.WAREHOUSES.map((w) => [w.id, w]));
      state.warehouses = seed.warehouses.map((w) => ({
        ...(meta.get(w.id) || { id: w.id, label: w.id, short: w.id, custodian: '', color: '#5b8cff' }),
        id: w.id,
        baselineUnits: w.units || 0,
        active: true,
      }));
    }

    state.sheet.lastSync = seed.exportedAt ? Date.parse(seed.exportedAt) : null;
    state.sheet.mode = 'snapshot';
    return true;
  }

  /* ───────────────────────────────────────────────────────── ops queue */

  function queueOp(op) {
    state.pendingOps.push({ ...op, id: SP.uid('op'), at: Date.now(), tries: 0 });
    if (state.pendingOps.length > 300) state.pendingOps.shift();
  }

  function clearOps(ids) {
    const kill = new Set(ids);
    state.pendingOps = state.pendingOps.filter((o) => !kill.has(o.id));
  }

  /* ─────────────────────────────────────────────────────── backup/restore */

  function exportBackup() {
    return {
      app: 'StockPilot',
      version: SP.VERSION,
      exportedAt: new Date().toISOString(),
      state: { ...state, pendingOps: [] },
    };
  }

  function importBackup(payload, { merge = false } = {}) {
    if (!payload || !payload.state) throw new Error('Not a StockPilot backup file.');
    if (payload.app !== 'StockPilot') throw new Error('Unrecognised backup format.');
    state = migrate(merge ? mergeState(state, payload.state) : payload.state);
    scheduleSave();
    emit(['*']);
    return true;
  }

  function mergeState(a, b) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (Array.isArray(v)) {
        const seen = new Set((out[k] || []).map((x) => x.id || JSON.stringify(x)));
        out[k] = [...(out[k] || []), ...v.filter((x) => !seen.has(x.id || JSON.stringify(x)))];
      } else if (v && typeof v === 'object') {
        out[k] = { ...(out[k] || {}), ...v };
      } else if (out[k] === undefined) out[k] = v;
    }
    return out;
  }

  function reset({ keepUsers = true } = {}) {
    const users = keepUsers ? state.users : [];
    state = defaultState();
    state.users = users;
    hydrateFromSeed();
    saveNow();
    emit(['*']);
  }

  /* ───────────────────────────────────────────────────────────── API */

  return {
    get state() { return state; },
    get rev() { return state.rev; },
    get lastError() { return lastError; },
    load, saveNow, subscribe, update, audit, notify,
    hydrateFromSeed, queueOp, clearOps,
    exportBackup, importBackup, reset, migrate, defaultState,
  };
})();