/**
 * store.js — reactive application state with persistence and an audit trail.
 *
 * StockPilot 2.0 schema (v3)
 *  - Entity collections: products, devices, warehouses, locations, movements
 *    (the ledger), transfers, purchases, sales, customers, suppliers,
 *    payments, approvals, counts, notifications, audit.
 *  - Stock quantities are NEVER stored on products. They are derived from
 *    the movement ledger by SP.ledger. Products only cache nothing.
 *  - Migrates v2 state: the old colour-matrix catalogue becomes products +
 *    opening movements so every migrated quantity stays explainable.
 *
 * Design notes
 *  - Single mutable `state` object, mutated only through `update`.
 *  - Subscribers are notified with a set of changed top-level keys.
 *  - Writes are debounced to localStorage; a revision counter drives the
 *    "saved / saving" indicator.
 */
window.SP = window.SP || {};

SP.store = (() => {
  const KEY = SP.STORAGE_KEY;
  const listeners = new Set();
  let saveTimer = null;
  let lastError = null;

  /* ────────────────────────────────────────────────────────── defaults */

  function defaultSettings() {
    return {
      company: {
        name: 'StockPilot Demo Organisation',
        address: '', phone: '', email: '',
        currency: 'BDT', locale: 'en',
        invoiceFooter: 'Thank you for your business.',
        taxLabel: 'VAT', defaultTaxPct: 0,
      },
      numbering: { sale: 'INV', purchase: 'PO', transfer: 'TRF', movement: 'MOV', count: 'CNT', payment: 'PAY', returnPrefix: 'RET' },
      stockTypes: [],            // extra user-defined stock classifications
      approvalRules: SP.deepClone ? SP.deepClone(SP.DEFAULT_APPROVAL_RULES) : JSON.parse(JSON.stringify(SP.DEFAULT_APPROVAL_RULES)),
      lowStockDefault: 10,
      demo: false,               // true while demo data is loaded
      backup: { lastAt: null, auto: false },
      integrations: {
        googleSheets: { connected: false, bridgeUrl: '', lastSync: null },
        whatsapp: { connected: false },
        ai: { connected: false, endpoint: '' },
      },
    };
  }

  function defaultState() {
    return {
      schema: 3,
      rev: 0,
      createdAt: Date.now(),
      onboarded: false,
      prefs: {
        theme: 'dark',
        density: 'comfortable',
        accent: '#5b8cff',
        warehouse: '*',          // '*' = all warehouses
        role: null,
        alerts: { enabled: true, sound: false, desktop: false, onlyCritical: false },
        seenTips: [],
        dashboardLayout: null,   // saved widget order/visibility
      },
      rules: {
        refillMax: SP.RULES.refillMax,
        targetCoverWeeks: SP.RULES.defaultCoverWeeks,
        deadStockDays: SP.RULES.deadStockDays,
        minOrderValue: SP.RULES.minOrderValue,
        currency: 'BDT',
      },
      settings: defaultSettings(),

      /* directory */
      users: [],
      sessions: [],

      /* catalogue */
      products: [],              // { id, sku, name, brand, model, category, variant, network, ram, storage, color, country, condition, cost, price, barcode, description, status, stockType, minStock, maxStock, reorderPoint, leadTimeDays, preferredSupplierId, images[], attributes{}, serialized, archived, createdAt, updatedAt }
      devices: [],               // { id, imei1, imei2, serial, productId, warehouseId, locationId, status, condition, cost, purchaseRef, saleRef, receivedAt, updatedAt, notes }

      /* network */
      warehouses: [],            // { id, code, name, type, address, phone, managerId, color, capacity, active, createdAt }
      locations: [],             // { id, warehouseId, zone, rack, shelf, bin, code, capacity, notes }

      /* ledger & operations */
      movements: [],             // { id, ref, ts, type, direction, productId, qty, warehouseId, locationId, deviceIds[], unitCost, refType, refId, reason, notes, by, before, after, approvalId }
      transfers: [],
      counts: [],                // physical verification sessions

      /* commerce */
      purchases: [],
      sales: [],
      customers: [],
      suppliers: [],
      payments: [],              // { id, ref, ts, kind: 'receipt'|'payment', partyType, partyId, saleId?, purchaseId?, amount, method, note, by }

      /* governance */
      approvals: [],
      audit: [],
      notifications: [],

      /* sync & misc */
      pendingOps: [],
      counters: { sale: 0, purchase: 0, transfer: 0, movement: 0, count: 0, payment: 0 },
      savedViews: [],
      sheet: {
        connected: false,
        lastSync: null,
        lastReadOk: null,
        mode: 'snapshot',        // snapshot | live | error
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
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          state = migrate({ ...defaultState(), ...parsed });
          return true;
        }
      }
      // One-way migration from a v1/v2 install.
      for (const legacyKey of SP.LEGACY_STORAGE_KEYS || []) {
        const legacy = localStorage.getItem(legacyKey);
        if (!legacy) continue;
        try {
          const old = JSON.parse(legacy);
          if (old && typeof old === 'object') {
            state = migrateFromV2(old);
            saveNow();
            return true;
          }
        } catch (e) { console.warn('[store] legacy parse failed', e); }
      }
      return false;
    } catch (e) {
      lastError = e;
      console.warn('[store] load failed, starting fresh:', e);
      return false;
    }
  }

  /** Fill in keys introduced by later versions without clobbering data. */
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
    s.settings = migrateSettings(s.settings);
    if (!Array.isArray(s.prefs.seenTips)) s.prefs.seenTips = [];
    s.schema = 3;
    return s;
  }

  function migrateSettings(s) {
    const base = defaultSettings();
    const out = { ...base, ...(s || {}) };
    out.company = { ...base.company, ...(s?.company || {}) };
    out.numbering = { ...base.numbering, ...(s?.numbering || {}) };
    out.backup = { ...base.backup, ...(s?.backup || {}) };
    out.integrations = { ...base.integrations, ...(s?.integrations || {}) };
    out.integrations.googleSheets = { ...base.integrations.googleSheets, ...(s?.integrations?.googleSheets || {}) };
    out.integrations.whatsapp = { ...base.integrations.whatsapp, ...(s?.integrations?.whatsapp || {}) };
    out.integrations.ai = { ...base.integrations.ai, ...(s?.integrations?.ai || {}) };
    if (!Array.isArray(out.approvalRules) || !out.approvalRules.length) out.approvalRules = base.approvalRules;
    if (!Array.isArray(out.stockTypes)) out.stockTypes = [];
    return out;
  }

  /**
   * Convert a StockPilot 1.x (v2 schema) state into the v3 schema.
   * Every migrated unit is backed by an `opening` movement so the ledger
   * explains the quantity from day one.
   */
  function migrateFromV2(old) {
    const s = defaultState();
    s.createdAt = old.createdAt || Date.now();
    s.onboarded = !!old.onboarded;
    s.prefs = { ...s.prefs, ...(old.prefs || {}), seenTips: [] };
    s.rules = { ...s.rules, ...(old.rules || {}) };

    // Users: map legacy roles forward; verifiers are preserved untouched.
    s.users = (old.users || []).map((u) => ({
      ...u,
      role: SP.ROLE_MIGRATION[u.role] || u.role || 'viewer',
      warehouses: u.warehouse && u.warehouse !== '*' ? [u.warehouse] : [],
    }));

    // Warehouses.
    const whColor = ['#5b8cff', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#38bdf8'];
    s.warehouses = (old.warehouses || []).map((w, i) => ({
      id: w.id,
      code: w.id,
      name: w.label || w.id,
      type: 'warehouse',
      address: '',
      phone: '',
      managerId: null,
      color: w.color || whColor[i % whColor.length],
      capacity: 0,
      active: w.active !== false,
      createdAt: Date.now(),
    }));
    if (!s.warehouses.length) {
      s.warehouses.push({ id: 'MAIN', code: 'MAIN', name: 'Main Warehouse', type: 'warehouse', address: '', phone: '', managerId: null, color: whColor[0], capacity: 0, active: true, createdAt: Date.now() });
    }

    // Products + opening movements.
    const now = Date.now();
    let movSeq = 0;
    for (const sku of old.skus || []) {
      const spec = SP.fmt.parseSpec(sku.specs || '');
      const pid = sku.id || SP.uid('prd');
      s.products.push({
        id: pid,
        sku: sku.sku,
        name: `${sku.sku} ${sku.specs || ''}`.trim(),
        brand: sku.brand || '',
        model: sku.sku || '',
        category: 'Smartphone',
        variant: '', network: /5G/i.test(sku.sku || '') ? '5G' : '4G',
        ram: spec.ram, storage: spec.storage,
        color: '', country: '', condition: 'new',
        cost: sku.cost || 0, price: Math.round((sku.cost || 0) * 1.08),
        barcode: '', description: '', status: 'active',
        stockType: 'regular',
        minStock: sku.minStock || 0, maxStock: 0, reorderPoint: 0,
        leadTimeDays: 7, preferredSupplierId: null,
        images: [], attributes: {}, serialized: false,
        notes: sku.notes || '',
        archived: !!sku.archived,
        createdAt: sku.createdAt || now, updatedAt: now,
        legacyColours: sku.colours || {},
      });
      for (const [whId, qtyRaw] of Object.entries(sku.byWh || {})) {
        const qty = Number(qtyRaw) || 0;
        if (qty <= 0) continue;
        movSeq += 1;
        s.movements.push({
          id: SP.uid('mov'),
          ref: `MOV-MIG-${String(movSeq).padStart(4, '0')}`,
          ts: now, type: 'opening', direction: 1,
          productId: pid, qty,
          warehouseId: whId, locationId: null,
          deviceIds: [], unitCost: sku.cost || 0,
          refType: 'migration', refId: 'v2',
          reason: 'Migrated from StockPilot 1.0 snapshot',
          notes: '', by: 'system',
          before: 0, after: qty,
        });
      }
    }
    s.counters.movement = movSeq;

    // Legacy sales / transfers / purchases are kept as documents for history
    // but marked legacy: their stock effect is already inside opening stock.
    s.sales = (old.sales || []).map((d) => ({
      id: d.id || SP.uid('sal'),
      ref: d.ref || d.id || 'LEGACY',
      legacy: true,
      ts: d.at || d.ts || now,
      customerId: null, customerName: d.customer || d.note || 'Walk-in (legacy)',
      warehouseId: d.warehouse || d.wh || s.warehouses[0].id,
      items: (d.lines || d.items || []).map((l) => ({
        productId: l.skuId || l.productId, qty: l.qty, price: 0, discount: 0, deviceIds: [],
      })),
      status: 'delivered', paymentStatus: 'paid',
      salesperson: d.by || 'system',
      notes: 'Imported from StockPilot 1.0 dispatch log',
      payments: [], subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0, paid: 0,
    }));
    s.transfers = (old.transfers || []).map((t) => ({
      id: t.id || SP.uid('trf'),
      ref: t.ref || t.id || 'LEGACY',
      legacy: true,
      from: t.from, to: t.to,
      items: (t.items || []).map((i) => ({ productId: i.skuId || i.productId, qty: i.qty, receivedQty: i.qty, deviceIds: [] })),
      status: t.status === 'received' ? 'completed' : (t.status || 'completed'),
      requester: t.by || 'system', approver: null, receiver: null,
      carrier: '', tracking: '', notes: 'Imported from StockPilot 1.0',
      history: [{ at: t.at || now, by: 'system', action: 'migrated', note: 'Legacy transfer imported' }],
      createdAt: t.at || now, updatedAt: t.at || now,
    }));
    s.purchases = (old.purchases || []).map((p) => ({
      id: p.id || SP.uid('pur'),
      ref: p.ref || p.id || 'LEGACY',
      legacy: true,
      supplierId: null, supplierName: p.supplier || 'Legacy supplier',
      warehouseId: p.warehouse || s.warehouses[0].id,
      items: (p.items || []).map((i) => ({ productId: i.skuId || i.productId, qty: i.qty, receivedQty: i.received || 0, cost: i.cost || 0 })),
      status: p.status || 'received',
      expectedAt: null, notes: 'Imported from StockPilot 1.0',
      payments: [], total: 0, paid: 0,
      createdAt: p.at || now, updatedAt: p.at || now,
    }));

    s.audit = (old.audit || []).map((a) => ({ ...a, migrated: true }));
    s.notifications = [];
    s.settings.demo = false;
    console.info(`[store] migrated v2 state: ${s.products.length} products, ${s.movements.length} opening movements, ${s.users.length} users`);
    return s;
  }

  function saveNow() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      lastError = null;
      return true;
    } catch (e) {
      lastError = e;
      // Quota exhausted: trim the notification tail and retry once. The
      // ledger and audit trail are never trimmed automatically.
      if (state.notifications.length > 20) {
        state.notifications = state.notifications.slice(0, 20);
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

  /* ─────────────────────────────────────────────── references & audit */

  /** Sequential human reference: INV-0007. Counters persist across reloads. */
  function nextRef(kind) {
    const prefix = state.settings.numbering[kind] || kind.toUpperCase().slice(0, 3);
    state.counters[kind] = (state.counters[kind] || 0) + 1;
    return `${prefix}-${String(state.counters[kind]).padStart(4, '0')}`;
  }

  /**
   * Append an immutable audit record. Audit entries are never edited or
   * deleted through the application; the cap only guards storage exhaustion
   * and is set high enough for years of normal use.
   */
  function audit(action, target, detail, by, extra = {}) {
    const user = by || SP.auth?.current()?.name || 'system';
    state.audit.unshift({
      id: SP.uid('aud'),
      at: Date.now(),
      by: user,
      userId: SP.auth?.current()?.id || null,
      action,
      target: target || '',
      detail: detail || '',
      ...extra,
    });
    if (state.audit.length > 10000) state.audit.length = 10000;
    return state.audit[0];
  }

  /* ────────────────────────────────────────────────────── notifications */

  function notify(n) {
    const note = {
      id: SP.uid('ntf'),
      at: Date.now(),
      read: false,
      archived: false,
      priority: 'normal',
      tone: 'info',
      kind: 'system',
      title: '',
      body: '',
      ...n,
    };
    state.notifications.unshift(note);
    if (state.notifications.length > 300) state.notifications.length = 300;
    return note;
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
      schema: 3,
      exportedAt: new Date().toISOString(),
      state: { ...state, pendingOps: [] },
    };
  }

  function importBackup(payload, { merge = false } = {}) {
    if (!payload || !payload.state) throw new Error('Not a StockPilot backup file.');
    if (payload.app !== 'StockPilot') throw new Error('Unrecognised backup format.');
    const incoming = payload.schema === 3 || payload.state.schema === 3
      ? payload.state
      : migrateFromV2(payload.state);
    state = migrate(merge ? mergeState(state, incoming) : incoming);
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
    saveNow();
    emit(['*']);
  }

  /* ───────────────────────────────────────────────────────────── API */

  return {
    get state() { return state; },
    get rev() { return state.rev; },
    get lastError() { return lastError; },
    load, saveNow, subscribe, update, audit, notify, nextRef,
    queueOp, clearOps,
    exportBackup, importBackup, reset, migrate, migrateFromV2, defaultState, defaultSettings,
  };
})();
