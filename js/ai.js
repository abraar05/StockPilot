/**
 * ai.js — StockPilot Intelligence: a data-grounded assistant.
 *
 * HONESTY CONTRACT: there is no external AI service connected. Every answer
 * is computed from the live ledger by deterministic intent handlers. The
 * interface is architected so a real LLM endpoint can be attached later
 * (Settings → Integrations → AI) — until then the assistant says exactly
 * what it is.
 */
window.SP = window.SP || {};

SP.ai = (() => {
  const st = () => SP.store.state;

  /** Small helpers to phrase results. */
  const productLine = (p) => {
    const qty = SP.ledger.stockOf(p.id);
    return { text: `${p.name} — ${SP.fmt.n(qty)} units${p.reorderPoint ? ` (reorder at ${p.reorderPoint})` : ''}`, route: 'products', params: { id: p.id } };
  };

  function findProducts(q) {
    const needle = String(q || '').toLowerCase();
    return st().products.filter((p) => !p.archived
      && [p.name, p.sku, p.brand, p.model, p.color, String(p.ram || ''), String(p.storage || '')]
        .some((f) => String(f || '').toLowerCase().includes(needle)));
  }

  /* ───────────────────────────────────────────── intent handlers */

  const INTENTS = [
    {
      name: 'low_stock',
      match: (q) => /(below|under|low).*(reorder|stock|level)|reorder (level|point)|low stock/.test(q),
      run(q) {
        let rows = st().products.filter((p) => !p.archived);
        const brand = extractBrand(q);
        if (brand) rows = rows.filter((p) => p.brand.toLowerCase().includes(brand));
        rows = rows.filter((p) => {
          const floor = p.reorderPoint || p.minStock || 0;
          return floor > 0 && SP.ledger.stockOf(p.id) <= floor;
        });
        if (!rows.length) return { answer: brand ? `No ${brand} products are below their reorder level.` : 'No products are below their reorder level right now.', rows: [] };
        return {
          answer: `${rows.length} product${rows.length === 1 ? ' is' : 's are'} at or below reorder level${brand ? ` for ${brand}` : ''}:`,
          rows: rows.slice(0, 12).map(productLine),
        };
      },
    },
    {
      name: 'dead_stock',
      match: (q) => /dead stock|not moved|no movement|haven.?t sold|hasn.?t sold|slow(est)? (moving|mover)/.test(q),
      run(q) {
        const days = extractDays(q) || st().rules.deadStockDays || 60;
        const cutoff = Date.now() - days * 864e5;
        const rows = st().products.filter((p) => !p.archived)
          .map((p) => ({ p, qty: SP.ledger.stockOf(p.id), last: SP.ledger.lastActivityAt(p.id) }))
          .filter((r) => r.qty > 0 && (!r.last || r.last < cutoff))
          .sort((a, b) => (a.last || 0) - (b.last || 0));
        if (!rows.length) return { answer: `No stocked product has been idle for ${days}+ days.`, rows: [] };
        return {
          answer: `${rows.length} product${rows.length === 1 ? ' has' : 's have'} had no stock movement for at least ${days} days:`,
          rows: rows.slice(0, 12).map((r) => ({
            text: `${r.p.name} — ${SP.fmt.n(r.qty)} units, last movement ${r.last ? SP.fmt.ago(r.last) : 'never'}`,
            route: 'products', params: { id: r.p.id },
          })),
        };
      },
    },
    {
      name: 'unusual_adjustments',
      match: (q) => /unusual|suspicious|abnormal|adjustment/.test(q) && /(today|yesterday|adjust)/.test(q),
      run(q) {
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const rows = st().movements.filter((m) => ['adjust_in', 'adjust_out'].includes(m.type) && m.ts >= dayStart.getTime());
        if (!rows.length) return { answer: 'No stock adjustments have been recorded today.', rows: [] };
        return {
          answer: `${rows.length} adjustment${rows.length === 1 ? '' : 's'} recorded today:`,
          rows: rows.map((m) => {
            const p = st().products.find((x) => x.id === m.productId);
            return { text: `${m.ref} · ${p?.name || '?'} · ${m.direction > 0 ? '+' : '−'}${m.qty} by ${m.by}${m.reason ? ` — ${m.reason}` : ''}`, route: 'movements', params: { q: m.ref } };
          }),
        };
      },
    },
    {
      name: 'warehouse_excess',
      match: (q) => /excess|overstock|too much/.test(q),
      run(q) {
        const brand = extractBrand(q);
        const perWh = {};
        for (const w of st().warehouses) {
          const map = SP.ledger.stockMap(w.id);
          for (const [pid, qty] of map) {
            const p = st().products.find((x) => x.id === pid);
            if (!p || p.archived) continue;
            if (brand && !p.brand.toLowerCase().includes(brand)) continue;
            if (p.maxStock && qty > p.maxStock) {
              (perWh[w.id] = perWh[w.id] || []).push({ p, qty, over: qty - p.maxStock });
            }
          }
        }
        const whs = Object.entries(perWh);
        if (!whs.length) return { answer: `No warehouse is above max-stock${brand ? ` for ${brand}` : ''}. Set max stock levels on products to enable overstock detection.`, rows: [] };
        const rows = [];
        for (const [wid, list] of whs) {
          const w = st().warehouses.find((x) => x.id === wid);
          for (const r of list.slice(0, 5)) rows.push({ text: `${w?.name || wid}: ${r.p.name} — ${SP.fmt.n(r.qty)} on hand (${SP.fmt.n(r.over)} over max)`, route: 'inventory', params: { wh: wid } });
        }
        return { answer: `Overstock detected in ${whs.length} warehouse${whs.length === 1 ? '' : 's'}:`, rows };
      },
    },
    {
      name: 'transfer_suggestion',
      match: (q) => /what should (we|i) transfer|transfer (suggestion|recommend)|rebalance/.test(q),
      run(q) {
        const suggestions = suggestTransfers();
        if (!suggestions.length) return { answer: 'No beneficial transfers found — either stock is balanced or warehouses lack the demand signals (reorder points) to compare against.', rows: [] };
        return {
          answer: `${suggestions.length} transfer suggestion${suggestions.length === 1 ? '' : 's'} based on reorder points and surplus:`,
          rows: suggestions.slice(0, 10).map((s) => ({
            text: `${s.qty} × ${s.product.name}: ${s.from.name} → ${s.to.name} (${s.fromQty} spare vs ${s.toQty} on hand)`,
            route: 'transfers', params: { compose: '1' },
          })),
        };
      },
    },
    {
      name: 'duplicate_imei',
      match: (q) => /duplicate imei|dup.*imei|imei.*dup/.test(q),
      run() {
        const dupes = SP.imei.duplicates();
        if (!dupes.size) return { answer: 'No duplicate IMEIs found across the fleet.', rows: [] };
        const rows = [];
        for (const [imei, devices] of [...dupes].slice(0, 10)) {
          rows.push({ text: `${imei} — shared by ${devices.length} devices`, route: 'devices', params: { q: imei } });
        }
        return { answer: `${dupes.size} duplicate IMEI${dupes.size === 1 ? '' : 's'} found:`, rows };
      },
    },
    {
      name: 'explain_qty',
      match: (q) => /why (is|does)|explain.*(stock|qty|units)|how many.*(have|left)/.test(q),
      run(q) {
        const num = /(\d+)\s*units?/.exec(q);
        const prods = findProducts(q.replace(/why (is|does)|explain|stock|qty|units?|showing|has|have|this sku|the/gi, '').replace(/\d+/g, '').trim());
        const p = prods[0];
        if (!p) return { answer: 'Tell me which product you mean — e.g. "why is Xiaomi 14 Ultra showing 37 units?"', rows: [] };
        const moves = SP.ledger.explain(p.id);
        const total = SP.ledger.stockOf(p.id);
        const last = moves.slice(-6).reverse();
        return {
          answer: `${p.name} currently holds ${SP.fmt.n(total)} unit${total === 1 ? '' : 's'}${num ? `, not ${num[1]}` : ''}. It is the net of ${moves.length} ledger movement${moves.length === 1 ? '' : 's'}. Most recent:`,
          rows: last.map((m) => ({
            text: `${SP.fmt.date(m.ts)} · ${SP.movementType(m.type).label} ${m.direction > 0 ? '+' : m.direction < 0 ? '−' : ''}${m.qty} → balance ${m.balance} (${m.by})`,
            route: 'movements', params: { q: m.ref },
          })),
          footer: 'Open the product page for the complete calculation.',
        };
      },
    },
    {
      name: 'daily_report',
      match: (q) => /(today|daily).*(report|summary)|prepare.*report/.test(q),
      run() {
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const moves = st().movements.filter((m) => m.ts >= dayStart.getTime());
        const ins = SP.sum(moves.filter((m) => m.direction > 0), (m) => m.qty);
        const outs = SP.sum(moves.filter((m) => m.direction < 0), (m) => m.qty);
        const sales = st().sales.filter((s) => !s.legacy && s.ts >= dayStart.getTime() && s.status !== 'cancelled');
        return {
          answer: `Today so far: ${SP.fmt.n(ins)} units in, ${SP.fmt.n(outs)} units out across ${moves.length} movements. ${sales.length} sale${sales.length === 1 ? '' : 's'} worth ${SP.fmt.money(SP.sum(sales, (x) => x.total))}.`,
          rows: [{ text: 'Open the full Daily Stock Report', route: 'reports', params: { rpt: 'daily_stock' } }],
        };
      },
    },
    {
      name: 'find',
      match: () => true, // fallback: product / IMEI / document search
      run(q) {
        const imeiLike = SP.imei.clean(q);
        if (imeiLike.length >= 8) {
          const devices = SP.imei.find(imeiLike);
          if (devices.length) {
            return {
              answer: `${devices.length} device${devices.length === 1 ? '' : 's'} match that IMEI:`,
              rows: devices.slice(0, 5).map((d) => {
                const p = st().products.find((x) => x.id === d.productId);
                const w = st().warehouses.find((x) => x.id === d.warehouseId);
                return { text: `${p?.name || '?'} · ${SP.deviceStatus(d.status).label} · ${w?.name || '—'}`, route: 'devices', params: { q: imeiLike } };
              }),
            };
          }
        }
        const prods = findProducts(q).slice(0, 8);
        if (prods.length) return { answer: `${prods.length} matching product${prods.length === 1 ? '' : 's'}:`, rows: prods.map(productLine) };
        return {
          answer: 'I can answer questions about your live data — try "which products are below reorder level", "what has not moved for 90 days", "show today\'s adjustments", "find duplicate IMEIs", or "why is <product> showing N units".',
          rows: [],
        };
      },
    },
  ];

  function extractBrand(q) {
    const brands = SP.unique(st().products.map((p) => p.brand).filter(Boolean));
    return brands.find((b) => q.toLowerCase().includes(b.toLowerCase())) || null;
  }
  function extractDays(q) { const m = /(\d+)\s*days?/.exec(q); return m ? Number(m[1]) : null; }

  /** Deterministic transfer recommendations used by AI + Reorder Radar. */
  function suggestTransfers() {
    const out = [];
    for (const p of st().products) {
      if (p.archived) continue;
      const byWh = SP.ledger.stockByWarehouse(p.id);
      const floor = p.reorderPoint || p.minStock || 0;
      if (!floor) continue;
      const needy = []; const surplus = [];
      for (const w of st().warehouses) {
        if (!w.active) continue;
        const qty = byWh[w.id] || 0;
        if (qty <= floor) needy.push({ w, qty });
        else if (qty > floor * 2) surplus.push({ w, qty });
      }
      for (const n of needy) {
        const donor = surplus.sort((a, b) => b.qty - a.qty)[0];
        if (!donor) continue;
        const qty = Math.min(floor * 2 - n.qty, donor.qty - floor);
        if (qty > 0) out.push({ product: p, from: donor.w, to: n.w, qty, fromQty: donor.qty, toQty: n.qty });
      }
    }
    return out.sort((a, b) => b.qty - a.qty);
  }

  /** Ask the assistant. Returns { answer, rows, footer, intent }. */
  function ask(question) {
    const q = String(question || '').trim().toLowerCase();
    if (!q) return { answer: 'Ask me anything about your inventory data.', rows: [] };
    const intent = INTENTS.find((i) => i.match(q));
    try {
      return { ...intent.run(q), intent: intent.name };
    } catch (e) {
      console.error('[ai] handler failed', e);
      return { answer: `I could not compute that answer: ${e.message}`, rows: [] };
    }
  }

  /* ───────────────────────────────────────── anomaly detection */

  /**
   * Deterministic anomaly scans. Findings are recommendations for a human
   * to review — they never trigger actions by themselves.
   */
  function detectAnomalies() {
    const findings = [];
    const moves = st().movements;
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);

    // 1. Unusual stock decrease: today's OUT for a product > 3× its 30-day daily average.
    for (const p of st().products) {
      const outs30 = moves.filter((m) => m.productId === p.id && m.direction < 0 && m.ts > Date.now() - 30 * 864e5);
      const outToday = SP.sum(moves.filter((m) => m.productId === p.id && m.direction < 0 && m.ts >= dayStart.getTime()), (m) => m.qty);
      const avg = SP.sum(outs30, (m) => m.qty) / 30;
      if (outToday > Math.max(10, avg * 3)) {
        findings.push({
          severity: 'high', kind: 'unusual_decrease',
          title: `Unusual stock decrease: ${p.name}`,
          body: `${SP.fmt.n(outToday)} units out today vs a 30-day average of ${avg.toFixed(1)}/day.`,
          route: 'movements', params: { productId: p.id },
        });
      }
    }

    // 2. Repeated manual adjustments by the same user.
    const adjByUser = SP.groupBy(moves.filter((m) => ['adjust_in', 'adjust_out'].includes(m.type) && m.ts > Date.now() - 7 * 864e5), (m) => m.by);
    for (const [user, list] of Object.entries(adjByUser)) {
      if (list.length >= 5) {
        findings.push({
          severity: 'medium', kind: 'repeated_adjustments',
          title: `${list.length} manual adjustments by ${user} in 7 days`,
          body: 'Frequent manual corrections can indicate process issues or misuse.',
          route: 'audit', params: { q: 'movement.adjust' },
        });
      }
    }

    // 3. Duplicate IMEIs.
    const dupes = SP.imei.duplicates();
    if (dupes.size) {
      findings.push({
        severity: 'high', kind: 'duplicate_imei',
        title: `${dupes.size} duplicate IMEI${dupes.size === 1 ? '' : 's'}`,
        body: 'The same IMEI appears on multiple devices. Investigate before selling.',
        route: 'devices', params: { dupes: '1' },
      });
    }

    // 4. Abnormal discounts.
    for (const s of st().sales.filter((x) => !x.legacy && x.subtotal > 0)) {
      const pct = (x.discountTotal || 0) / x.subtotal * 100;
      if (pct > 20) {
        findings.push({
          severity: 'medium', kind: 'abnormal_discount',
          title: `Discount of ${pct.toFixed(0)}% on ${s.ref}`,
          body: `${SP.fmt.money(s.discountTotal)} off ${SP.fmt.money(s.subtotal)} — sold by ${s.salesperson || '—'}.`,
          route: 'sales', params: { id: s.id },
        });
      }
    }

    // 5. Transfer dispatched but source movements missing.
    for (const t of st().transfers.filter((x) => ['dispatched', 'in_transit', 'received', 'completed'].includes(x.status) && !x.legacy)) {
      for (const item of t.items) {
        const has = moves.some((m) => m.refType === 'transfer' && m.refId === t.id && m.type === 'transfer_out' && m.productId === item.productId);
        if (!has) {
          findings.push({
            severity: 'high', kind: 'movement_gap',
            title: `Transfer ${t.ref} has no matching OUT movement`,
            body: 'Ledger and transfer document disagree. Review required.',
            route: 'transfers', params: { id: t.id },
          });
        }
      }
    }

    return findings.sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1));
  }

  return { ask, detectAnomalies, suggestTransfers };
})();
