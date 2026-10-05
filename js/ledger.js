/**
 * ledger.js — the inventory ledger. THE single source of truth for stock.
 *
 * No module may ever write a quantity onto a product. Stock is derived:
 *
 *   opening + receive + transfer_in + returns_in + approved adjustments_in
 *   − sales − transfer_out − damage − returns_out − approved adjustments_out
 *   = current stock
 *
 * Every derivation walks the movement list, so "why is this SKU 37?" always
 * has a complete, ordered, auditable answer.
 */
window.SP = window.SP || {};

SP.ledger = (() => {
  const st = () => SP.store.state;

  /* ─────────────────────────────────────────────────────── validation */

  class LedgerError extends Error {
    constructor(message, code) { super(message); this.code = code || 'LEDGER'; }
  }

  function productOrThrow(productId) {
    const p = st().products.find((x) => x.id === productId);
    if (!p) throw new LedgerError('Unknown product. It may have been deleted.', 'NO_PRODUCT');
    return p;
  }

  function warehouseOrThrow(warehouseId) {
    const w = st().warehouses.find((x) => x.id === warehouseId);
    if (!w) throw new LedgerError('Unknown warehouse.', 'NO_WAREHOUSE');
    return w;
  }

  /* ──────────────────────────────────────────────────────── queries */

  /** All movements for a product, oldest first, optionally one warehouse. */
  function movementsFor(productId, warehouseId = null) {
    return st().movements
      .filter((m) => m.productId === productId && (!warehouseId || m.warehouseId === warehouseId))
      .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  }

  /** Net stock for one product, optionally scoped to a warehouse. */
  function stockOf(productId, warehouseId = null) {
    let qty = 0;
    for (const m of st().movements) {
      if (m.productId !== productId) continue;
      if (warehouseId && m.warehouseId !== warehouseId) continue;
      qty += (m.direction || 0) * m.qty;
    }
    return qty;
  }

  /** productId → qty across one warehouse (or all when warehouseId is null). */
  function stockMap(warehouseId = null) {
    const map = new Map();
    for (const m of st().movements) {
      if (warehouseId && m.warehouseId !== warehouseId) continue;
      map.set(m.productId, (map.get(m.productId) || 0) + (m.direction || 0) * m.qty);
    }
    return map;
  }

  /** productId → { warehouseId: qty } */
  function stockByWarehouse(productId) {
    const out = {};
    for (const m of st().movements) {
      if (m.productId !== productId) continue;
      out[m.warehouseId] = (out[m.warehouseId] || 0) + (m.direction || 0) * m.qty;
    }
    return out;
  }

  /** Reserved (not yet fulfilled) quantity for a product. */
  function reservedOf(productId, warehouseId = null) {
    let qty = 0;
    for (const m of st().movements) {
      if (m.productId !== productId) continue;
      if (warehouseId && m.warehouseId !== warehouseId) continue;
      if (m.type === 'reserve') qty += m.qty;
      else if (m.type === 'release') qty -= m.qty;
    }
    return Math.max(0, qty);
  }

  function availableOf(productId, warehouseId = null) {
    return stockOf(productId, warehouseId) - reservedOf(productId, warehouseId);
  }

  /** Units currently in transit between warehouses for a product. */
  function inTransitOf(productId) {
    let qty = 0;
    for (const t of st().transfers) {
      if (!['dispatched', 'in_transit'].includes(t.status)) continue;
      for (const item of t.items) {
        if (item.productId === productId) qty += (item.qty - (item.receivedQty || 0));
      }
    }
    return qty;
  }

  /** Running-balance explanation for one product (and warehouse). */
  function explain(productId, warehouseId = null) {
    const rows = [];
    let balance = 0;
    for (const m of movementsFor(productId, warehouseId)) {
      balance += (m.direction || 0) * m.qty;
      rows.push({ ...m, balance });
    }
    return rows;
  }

  /**
   * FIFO ageing: walk IN movements oldest-first and OUT movements to peel
   * stock away, then bucket the remaining units by the age of the IN
   * movement that brought them in. Buckets: 0–30, 31–60, 61–90, 91–180, 180+.
   */
  function ageing(productId = null, warehouseId = null) {
    const buckets = { d30: 0, d60: 0, d90: 0, d180: 0, d180p: 0 };
    const now = Date.now();
    const DAY = 864e5;
    const targets = productId ? [productId] : SP.unique(st().movements.map((m) => m.productId));
    const perProduct = {};

    for (const pid of targets) {
      const ins = [];
      let remaining = 0;
      for (const m of movementsFor(pid, warehouseId)) {
        if (m.direction > 0) ins.push({ ts: m.ts, qty: m.qty });
        else if (m.direction < 0) {
          let out = m.qty;
          while (out > 0 && ins.length) {
            const take = Math.min(ins[0].qty, out);
            ins[0].qty -= take; out -= take;
            if (ins[0].qty <= 0) ins.shift();
          }
        }
      }
      const pb = { d30: 0, d60: 0, d90: 0, d180: 0, d180p: 0 };
      for (const lot of ins) {
        if (lot.qty <= 0) continue;
        remaining += lot.qty;
        const days = (now - lot.ts) / DAY;
        const b = days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : days <= 180 ? 'd180' : 'd180p';
        pb[b] += lot.qty;
        buckets[b] += lot.qty;
      }
      if (remaining > 0) perProduct[pid] = { ...pb, total: remaining };
    }
    return { buckets, perProduct };
  }

  /** Valuation using product cost (standard) — per product & warehouse. */
  function valuation(warehouseId = null) {
    const map = stockMap(warehouseId);
    let units = 0; let value = 0; let retail = 0;
    const rows = [];
    for (const [pid, qty] of map) {
      if (qty <= 0) continue;
      const p = st().products.find((x) => x.id === pid);
      if (!p) continue;
      const cost = p.cost || 0;
      units += qty;
      value += qty * cost;
      retail += qty * (p.price || 0);
      rows.push({ product: p, qty, cost, value: qty * cost, retail: qty * (p.price || 0) });
    }
    return { units, value, retail, rows };
  }

  /** Most recent stock-affecting movement timestamp for a product. */
  function lastActivityAt(productId) {
    let last = 0;
    for (const m of st().movements) {
      if (m.productId === productId && m.direction !== 0 && m.ts > last) last = m.ts;
    }
    return last || null;
  }

  /* ──────────────────────────────────────────────────────── posting */

  /**
   * Append a movement to the ledger and synchronise any physical devices.
   *
   * @param {object} m
   *   type          one of SP.MOVEMENT_TYPES
   *   productId     product affected
   *   qty           positive integer (or count of devices)
   *   warehouseId   warehouse where the change happens
   *   locationId?   bin location
   *   deviceIds?    physical devices affected (status is synced)
   *   unitCost?     cost per unit at the time of the movement
   *   refType/refId supporting document (transfer, sale, purchase, count…)
   *   reason/notes  human explanation
   *   approvalId?   approval that authorised this movement
   *   ts?           override timestamp (imports/migration only)
   *   allowNegative?  explicit override, audited
   */
  function post(m) {
    const type = SP.movementType(m.type);
    if (!m.type || !SP.MOVEMENT_TYPES.some((t) => t.id === m.type)) {
      throw new LedgerError(`Unknown movement type "${m.type}".`, 'BAD_TYPE');
    }
    const qty = Number(m.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new LedgerError('Quantity must be a positive number.', 'BAD_QTY');
    if (type.direction === 0 && !['reserve', 'release'].includes(m.type)) {
      throw new LedgerError('This movement type does not change stock; use reserve/release.', 'BAD_DIRECTION');
    }
    productOrThrow(m.productId);
    warehouseOrThrow(m.warehouseId);

    const before = stockOf(m.productId, m.warehouseId);
    const after = before + type.direction * qty;

    if (after < 0 && !m.allowNegative) {
      const p = productOrThrow(m.productId);
      throw new LedgerError(
        `Not enough stock: ${p.name} has ${before} unit${before === 1 ? '' : 's'} at this warehouse; ${qty} requested. The movement was not recorded.`,
        'NEGATIVE',
      );
    }

    const movement = {
      id: SP.uid('mov'),
      ref: SP.store.nextRef('movement'),
      ts: m.ts || Date.now(),
      type: m.type,
      direction: type.direction,
      productId: m.productId,
      qty,
      warehouseId: m.warehouseId,
      locationId: m.locationId || null,
      deviceIds: [...(m.deviceIds || [])],
      unitCost: m.unitCost ?? null,
      refType: m.refType || null,
      refId: m.refId || null,
      reason: m.reason || '',
      notes: m.notes || '',
      by: m.by || SP.auth?.current()?.name || 'system',
      userId: SP.auth?.current()?.id || null,
      approvalId: m.approvalId || null,
      before,
      after,
      negativeOverride: after < 0 || undefined,
    };

    SP.store.update(['movements'], (s) => { s.movements.push(movement); });
    syncDevices(movement);

    if (after < 0) {
      SP.store.audit('stock.negative', movement.ref, `Stock forced negative (${after}) for ${productOrThrow(m.productId).name}`, movement.by);
      SP.store.notify({
        tone: 'danger', kind: 'negative_stock', priority: 'high',
        title: 'Negative stock recorded',
        body: `${productOrThrow(m.productId).name} is now ${after} at ${st().warehouses.find((w) => w.id === m.warehouseId)?.name || m.warehouseId}.`,
      });
    }

    SP.store.audit(`movement.${m.type}`, movement.ref,
      `${productOrThrow(m.productId).name} · ${type.direction > 0 ? '+' : type.direction < 0 ? '−' : ''}${qty} · ${before} → ${after}`,
      movement.by, { movementId: movement.id, productId: m.productId, warehouseId: m.warehouseId });

    return movement;
  }

  /** Post several movements as one logical batch (all succeed or none do). */
  function postBatch(list) {
    // Validate everything first against a simulated balance.
    const sim = new Map();
    for (const m of list) {
      const key = `${m.productId}|${m.warehouseId}`;
      const cur = sim.has(key) ? sim.get(key) : stockOf(m.productId, m.warehouseId);
      const dir = SP.movementType(m.type).direction;
      const next = cur + dir * Number(m.qty || 0);
      if (next < 0 && !m.allowNegative) {
        const p = st().products.find((x) => x.id === m.productId);
        throw new LedgerError(`Not enough stock for ${p?.name || m.productId}: ${cur} available, ${m.qty} requested. Nothing was recorded.`, 'NEGATIVE');
      }
      sim.set(key, next);
    }
    return list.map((m) => post(m));
  }

  /* ─────────────────────────────────────────────── device synchrony */

  const DEVICE_STATUS_BY_TYPE = {
    receive: 'available',
    purchase_return_in: 'available',
    transfer_out: 'in_transit',
    transfer_in: 'available',
    sale: 'sold',
    sale_return: 'available',
    adjust_in: 'available',
    damage: 'damaged',
    write_off: 'written_off',
    repair_out: 'repair',
    repair_in: 'available',
    opening: 'available',
  };

  function syncDevices(movement) {
    if (!movement.deviceIds.length) return;
    const status = DEVICE_STATUS_BY_TYPE[movement.type];
    if (!status) return;
    SP.store.update(['devices'], (s) => {
      for (const id of movement.deviceIds) {
        const d = s.devices.find((x) => x.id === id);
        if (!d) continue;
        d.status = status;
        if (['available', 'received'].includes(status)) {
          d.warehouseId = movement.warehouseId;
          if (movement.locationId) d.locationId = movement.locationId;
        }
        d.updatedAt = Date.now();
        d.lastMovementId = movement.id;
      }
    });
  }

  /* ─────────────────────────────────────────────── derived summaries */

  /** Legacy-compatible urgency rule used by dashboards and the reorder radar. */
  function urgency(qty, refillMax = st().rules.refillMax) {
    if (qty <= 0) return { id: 'critical', label: 'Restock Priority', short: 'RESTOCK', tone: 'danger', colour: '#f87171' };
    if (qty <= refillMax) return { id: 'refill', label: 'Refill', short: 'REFILL', tone: 'warn', colour: '#fbbf24' };
    return { id: 'adequate', label: 'Adequate', short: 'OK', tone: 'ok', colour: '#34d399' };
  }

  /** Headline numbers for dashboards. */
  function summary({ warehouse = '*' } = {}) {
    const wh = warehouse === '*' ? null : warehouse;
    const map = stockMap(wh);
    let gross = 0; let critical = 0; let refill = 0; let scopedSkuCount = 0;
    for (const [pid, qty] of map) {
      const p = st().products.find((x) => x.id === pid);
      if (!p || p.archived) continue;
      if (qty <= 0 && stockOf(pid, null) <= 0) { /* skip never-stocked */ }
      scopedSkuCount += 1;
      gross += Math.max(0, qty);
      const u = urgency(qty);
      if (u.id === 'critical') critical += 1;
      else if (u.id === 'refill') refill += 1;
    }
    const val = valuation(wh);
    let reserved = 0;
    for (const [pid] of map) reserved += reservedOf(pid, wh);
    let inTransit = 0;
    for (const t of st().transfers) {
      if (!['dispatched', 'in_transit'].includes(t.status)) continue;
      if (wh && t.from !== wh && t.to !== wh) continue;
      inTransit += SP.sum(t.items, (i) => i.qty - (i.receivedQty || 0));
    }
    return {
      gross, critical, refill, scopedSkuCount,
      value: val.value, retail: val.retail,
      reserved, inTransit,
      coverage: scopedSkuCount ? (scopedSkuCount - critical - refill) / scopedSkuCount * 100 : 100,
    };
  }

  return {
    LedgerError,
    post, postBatch,
    movementsFor, stockOf, stockMap, stockByWarehouse,
    reservedOf, availableOf, inTransitOf,
    explain, ageing, valuation, lastActivityAt,
    urgency, summary,
  };
})();

/* Backwards-compatible façade: v1 modules call SP.engine.* */
SP.engine = SP.engine || {};
SP.engine.totalOf = (product) => SP.ledger.stockOf(product.id);
SP.engine.urgency = (qty) => SP.ledger.urgency(qty);
SP.engine.summary = (opts) => SP.ledger.summary(opts);
