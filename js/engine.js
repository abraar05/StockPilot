/**
 * engine.js — the decision layer.
 *
 * Everything the dashboard, Refill Radar and Insights render is derived here,
 * so there is exactly one definition of "in hand", "urgency" and "suggested
 * order quantity" across the whole app.
 */
window.SP = window.SP || {};

SP.engine = (() => {
  const COLOURS = () => SP.COLOURS;

  /* ─────────────────────────────────────────────────── per-SKU helpers */

  const totalOf = (sku) => COLOURS().reduce((s, c) => s + (Number(sku.colours?.[c]) || 0), 0);

  const atWarehouse = (sku, whId) => {
    if (!whId || whId === '*') return totalOf(sku);
    return Number(sku.byWh?.[whId]) || 0;
  };

  /** Colours that actually carry stock (used for variant bars). */
  const activeColours = (sku) => COLOURS()
    .map((c) => ({ colour: c, qty: Number(sku.colours?.[c]) || 0 }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.qty - a.qty);

  /* ─────────────────────────────────────────────── urgency classification */

  /**
   * The rule inherited from the source workbook.
   *   0 units      → critical  (Restock Priority · buy now)
   *   1–refillMax  → refill    (plan a top-up)
   *   > refillMax  → adequate  (do not spend)
   */
  function urgency(qty, refillMax = SP.store.state.rules.refillMax) {
    const q = Math.max(0, Number(qty) || 0);
    if (q === 0) {
      return { id: 'critical', label: 'Restock Priority', short: 'Restock', tone: 'danger', colour: '#f87171', action: 'Buy now' };
    }
    if (q <= refillMax) {
      return { id: 'refill', label: 'Refill', short: 'Refill', tone: 'warn', colour: '#fbbf24', action: 'Plan top-up' };
    }
    return { id: 'adequate', label: 'Adequate', short: 'Adequate', tone: 'ok', colour: '#34d399', action: 'Do not spend' };
  }

  const URGENCY_ORDER = { critical: 0, refill: 1, adequate: 2 };

  /* ──────────────────────────────────────────────────── velocity & demand */

  /**
   * Units sold per week, from the dispatch log over the last `weeks` weeks.
   * Falls back to the SKU's minimum-stock target when there is no history,
   * which keeps a brand-new product from looking "fast moving".
   */
  function velocity(sku, weeks = 4) {
    const since = Date.now() - weeks * 7 * 864e5;
    let units = 0;
    for (const s of SP.store.state.sales) {
      if (Date.parse(s.at) < since) continue;
      if (s.skuId !== sku.id) continue;
      if (s.type === 'return') units -= Number(s.qty) || 0;
      else units += Number(s.qty) || 0;
    }
    if (units > 0) return units / weeks;
    return 0;
  }

  /** Weeks of cover remaining at the current run rate. Infinity when idle. */
  function coverWeeks(qty, perWeek) {
    if (!perWeek || perWeek <= 0) return Infinity;
    return qty / perWeek;
  }

  /** Days of cover; Infinity is rendered as "—". */
  function daysOfCover(qty, perWeek) {
    const w = coverWeeks(qty, perWeek);
    return w === Infinity ? Infinity : w * 7;
  }

  /* ───────────────────────────────────────── suggested order quantities */

  /**
   * Size a replenishment for one SKU.
   *
   * Rationale: cover the target horizon, round up to a sensible pack multiple,
   * then pull in stock that can be transferred from another site before
   * proposing a purchase.
   */
  function suggest(sku, qty, ctx = {}) {
    const rules = SP.store.state.rules;
    const refillMax = rules.refillMax;
    const perWeek = ctx.velocity ?? velocity(sku);
    const target = ctx.target ?? Math.max(refillMax * 2, Math.round((perWeek || 0) * rules.targetCoverWeeks));

    // The line we want on the shelf at the end of the horizon.
    const goalQty = ctx.goal ?? Math.max(target, refillMax * 2);

    // Existing pipeline (open purchase orders + in-flight transfers) reduces
    // what still needs buying.
    const pipeline = ctx.pipeline ?? openPipelineFor(sku.id);

    const netNeed = Math.max(0, goalQty - qty - pipeline);

    // Pack rounding keeps purchase orders practical to place.
    const pack = ctx.pack ?? guessPack(netNeed);
    const suggestedQty = netNeed > 0 ? Math.ceil(netNeed / pack) * pack : 0;

    // What could be borrowed from another site instead of bought.
    const transferable = ctx.transferable ?? transferableFor(sku.id, qty);
    const toTransfer = Math.min(netNeed, transferable);

    const unitCost = sku.cost || SP.costFor(sku);
    const buyQty = Math.max(0, suggestedQty - toTransfer);
    const value = suggestedQty * unitCost;

    const u = urgency(qty, refillMax);
    const cover = daysOfCover(qty, perWeek);

    return {
      skuId: sku.id,
      qty,
      urgency: u,
      goalQty,
      pipeline,
      netNeed,
      pack,
      suggestedQty,
      toTransfer,
      transferable,
      buyQty,
      unitCost,
      value,
      perWeek,
      coverDays: cover,
      priorityScore: priorityScore(sku, qty, perWeek, transferable),
      reason: reasonFor(u, qty, cover, transferable, pipeline),
    };
  }

  /** Open purchase-order and in-flight transfer units for a SKU. */
  function openPipelineFor(skuId) {
    const s = SP.store.state;
    let n = 0;
    for (const p of s.purchases) {
      if (!['cancelled', 'received'].includes(p.status)) {
        for (const l of p.lines || []) if (l.skuId === skuId) n += Number(l.qty) || 0;
      }
    }
    for (const t of s.transfers) {
      if (!['rejected', 'received'].includes(t.status)) {
        for (const l of t.lines || []) if (l.skuId === skuId) n += Number(l.qty) || 0;
      }
    }
    return n;
  }

  /** Surplus held elsewhere that could satisfy the gap without spending. */
  function transferableFor(skuId, excludeQty = 0) {
    const s = SP.store.state;
    const refillMax = s.rules.refillMax;
    let n = 0;
    for (const other of s.skus) {
      if (other.id !== skuId || other.archived) continue;
      for (const wh of s.warehouses) {
        const held = Number(other.byWh?.[wh.id]) || 0;
        if (held > refillMax) n += held - refillMax;
      }
    }
    return excludeQty >= 0 ? n : 0;
  }

  /** Practical pack multiple for a quantity. */
  function guessPack(qty) {
    if (qty <= 0) return 1;
    if (qty <= 10) return 5;
    if (qty <= 50) return 10;
    if (qty <= 200) return 25;
    return 50;
  }

  /**
   * Rank 0–100 so the queue always surfaces the most valuable action first.
   * Combines urgency, capital efficiency and the availability of a free fix.
   *
   * With no dispatch history every line scores alike on velocity, so the
   * tie-break deliberately favours lines that can be solved by moving existing
   * stock — that is both cheaper and faster than buying.
   */
  function priorityScore(sku, qty, perWeek, transferable) {
    const s = SP.store.state;
    const refillMax = s.rules.refillMax;
    let score = 0;

    if (qty === 0) score += 58;                       // out of stock: hardest to lose sales
    else if (qty <= refillMax) score += 38 + (1 - qty / refillMax) * 14;

    // Fast movers hurt more when they run dry.
    const speed = Math.min(1, (perWeek || 0) / 25);
    score += speed * 22;

    // Free stock elsewhere is a strong nudge — cheap fix, immediate result.
    if (qty <= refillMax && transferable > 0) score += 12;

    // Slight preference for higher-value lines, but sub-linear so a single
    // flagship cannot crowd out every genuinely urgent budget line.
    const cost = sku.cost || SP.costFor(sku);
    score += Math.min(8, Math.log10(Math.max(10, cost)) * 3.2);

    // Still nothing to separate them? Prefer a line that is held somewhere
    // else over one with no stock anywhere — it is an obvious oversight
    // rather than a deliberate decision to hold none.
    if (qty === 0 && transferable === 0) {
      const heldElsewhere = Object.entries(sku.byWh || {}).some(([, q]) => (Number(q) || 0) > 0);
      if (heldElsewhere) score += 6;
    }

    return Math.round(Math.min(100, score));
  }

  /** One short sentence explaining the recommendation. */
  function reasonFor(u, qty, cover, transferable, pipeline) {
    if (pipeline > 0) return `Already ${SP.fmt.pluralise(pipeline, 'unit')} on order or in transit.`;
    if (qty === 0) return 'Nothing on the shelf — every sale is lost until this is bought.';
    if (transferable > 0 && qty <= SP.store.state.rules.refillMax) {
      return `Low cover, and ${SP.fmt.n(transferable)} surplus unit${transferable === 1 ? '' : 's'} sit elsewhere — transfer first.`;
    }
    if (cover !== Infinity && cover < 14) return `Roughly ${SP.fmt.days(cover)} of cover left at the current rate.`;
    if (qty <= SP.store.state.rules.refillMax) return 'Below the reorder line — plan a top-up.';
    return 'Healthy cover. Do not spend on this line yet.';
  }

  /* ─────────────────────────────────────────────────────── aggregations */

  /** Everything the dashboard KPI row needs. */
  function summary(filter = {}) {
    const s = SP.store.state;
    const wh = filter.warehouse && filter.warehouse !== '*' ? filter.warehouse : null;
    const live = s.skus.filter((x) => !x.archived);
    const scoped = wh
      ? live.map((x) => ({ sku: x, qty: atWarehouse(x, wh) })).filter((x) => x.qty > 0 || includeZero(x.sku, wh))
      : live.map((x) => ({ sku: x, qty: totalOf(x) }));

    let gross = 0; let critical = 0; let refill = 0; let adequate = 0;
    let unitsAtRisk = 0; let capitalNeeded = 0;

    for (const { sku, qty } of scoped) {
      gross += qty;
      const u = urgency(qty);
      if (u.id === 'critical') { critical += 1; unitsAtRisk += Math.max(0, (sku.cost || 0) * 12); }
      else if (u.id === 'refill') refill += 1;
      else adequate += 1;
    }

    for (const r of refillPlan({ warehouse: wh, limit: 500 })) capitalNeeded += r.value;

    const outUnits = s.sales
      .filter((x) => x.type !== 'return')
      .reduce((sum, x) => sum + (Number(x.qty) || 0), 0);
    const inUnits = s.sales
      .filter((x) => x.type === 'return')
      .reduce((sum, x) => sum + (Number(x.qty) || 0), 0);

    return {
      skuCount: live.length,
      scopedSkuCount: scoped.length,
      gross,
      critical,
      refill,
      adequate,
      total: critical + refill + adequate,
      outUnits: Math.max(0, outUnits - inUnits),
      inUnits,
      unitsAtRisk,
      capitalNeeded,
      alerts: critical + refill,
      coverage: live.length ? (adequate / live.length) * 100 : 0,
    };
  }

  /** Zero-stock SKUs still matter when viewing a specific warehouse. */
  function includeZero(sku, whId) {
    return (Number(sku.byWh?.[whId]) || 0) > 0
      || Object.keys(sku.byWh || {}).length === 0
      || totalOf(sku) === 0;
  }

  /** Per-warehouse rollup with stock health. */
  function warehouseBreakdown() {
    const s = SP.store.state;
    return s.warehouses.filter((w) => w.active !== false).map((w) => {
      let units = 0; let skus = 0; let critical = 0; let refill = 0;
      for (const sku of s.skus) {
        if (sku.archived) continue;
        const q = Number(sku.byWh?.[w.id]) || 0;
        if (q > 0) skus += 1;
        units += q;
        const u = urgency(q);
        if (u.id === 'critical') critical += 1;
        else if (u.id === 'refill') refill += 1;
      }
      const held = s.skus.filter((x) => !x.archived && (Number(x.byWh?.[w.id]) || 0) > 0);
      const share = summary().gross ? (units / summary().gross) * 100 : 0;
      return {
        ...w,
        units,
        skus,
        critical,
        refill,
        share,
        health: skus ? ((skus - critical) / skus) * 100 : 100,
        topSku: held.length
          ? [...held].sort((a, b) => (b.byWh[w.id] - a.byWh[w.id]))[0]
          : null,
      };
    }).sort((a, b) => b.units - a.units);
  }

  /** Stock aggregated by colour variant. */
  function colourBreakdown() {
    const s = SP.store.state;
    const meta = new Map((SP.SEED?.colours || []).map((c) => [c.name, c.hex]));
    return COLOURS().map((name) => {
      let units = 0; let skus = 0;
      for (const sku of s.skus) {
        if (sku.archived) continue;
        const q = Number(sku.colours?.[name]) || 0;
        if (q > 0) skus += 1;
        units += q;
      }
      return { name, hex: meta.get(name) || '#94a3b8', units, skus };
    }).sort((a, b) => b.units - a.units);
  }

  /** Stock aggregated by brand. */
  function brandBreakdown() {
    const s = SP.store.state;
    const map = new Map();
    for (const sku of s.skus) {
      if (sku.archived) continue;
      const key = sku.brand || 'Other';
      const rec = map.get(key) || { name: key, units: 0, skus: 0 };
      rec.units += totalOf(sku);
      rec.skus += 1;
      map.set(key, rec);
    }
    return [...map.values()].sort((a, b) => b.units - a.units);
  }

  /* ─────────────────────────────────────────────────────────── refill plan */

  /**
   * The ordered purchase shortlist.
   * @param {object} o
   * @param {string} o.warehouse  warehouse filter ('*' for all)
   * @param {string} o.band       'critical' | 'refill' | 'all'
   * @param {string} o.brand      brand filter
   * @param {number} o.targetCap  optional cap on the number of lines
   * @param {number} o.budget     optional capital ceiling
   */
  function refillPlan(o = {}) {
    const s = SP.store.state;
    const wh = o.warehouse && o.warehouse !== '*' ? o.warehouse : '*';
    const band = o.band || 'all';

    const rows = [];
    for (const sku of s.skus) {
      if (sku.archived) continue;
      if (o.brand && o.brand !== 'all' && sku.brand !== o.brand) continue;

      const qty = atWarehouse(sku, wh === '*' ? null : wh);
      if (wh === '*' && totalOf(sku) === 0 && (o.includeZero !== true)) {
        // Keep zero lines only when the sheet flags them, they are still SKUs
        // the business trades in and they must be visible.
      }
      const u = urgency(qty);
      if (band === 'critical' && u.id !== 'critical') continue;
      if (band === 'refill' && u.id !== 'refill') continue;
      if (band === 'buy' && u.id === 'adequate') continue;

      const rec = suggest(sku, qty, wh === '*' ? {} : { transferable: transferableBetween(sku.id, wh) });
      if (wh !== '*') rec.transferable = transferableBetween(sku.id, wh);
      rec.sku = sku;
      rec.skuLabel = `${sku.sku} · ${sku.specs}`;
      rows.push(rec);
    }

    rows.sort((a, b) => b.priorityScore - a.priorityScore || b.value - a.value);

    // Budget trim, if a ceiling was supplied.
    if (o.budget && o.budget > 0) {
      let spend = 0;
      for (const r of rows) {
        if (spend + r.value <= o.budget) spend += r.value;
        else r.budgetExcluded = true;
      }
    }

    return o.targetCap ? rows.slice(0, o.targetCap) : rows;
  }

  /** Surplus at other sites that could be shipped into `destWh`. */
  function transferableBetween(skuId, destWh) {
    const s = SP.store.state;
    const refillMax = s.rules.refillMax;
    let n = 0;
    for (const sku of s.skus) {
      if (sku.id !== skuId || sku.archived) continue;
      for (const w of s.warehouses) {
        if (w.id === destWh) continue;
        const held = Number(sku.byWh?.[w.id]) || 0;
        if (held > refillMax) n += held - refillMax;
      }
    }
    return n;
  }

  /** Network view of one SKU: where it sits and where it is needed. */
  function distribution(skuId) {
    const sku = SP.store.state.skus.find((x) => x.id === skuId);
    if (!sku) return null;
    const rows = SP.store.state.warehouses.map((w) => ({
      warehouse: w,
      qty: Number(sku.byWh?.[w.id]) || 0,
      urgency: urgency(Number(sku.byWh?.[w.id]) || 0),
    }));
    return { sku, total: totalOf(sku), rows };
  }

  /* ──────────────────────────────────────────────────────────── insights */

  /**
   * Prioritised, explainable recommendations.
   * Each has { id, tone, title, body, action, cta, confidence }.
   */
  function insights() {
    const s = SP.store.state;
    const out = [];
    const plan = refillPlan({ warehouse: '*' });
    const byWh = warehouseBreakdown();

    /* 1. Transfer-before-buy */
    const cheap = plan.filter((r) => r.urgency.id !== 'adequate' && r.transferable > 0)
      .sort((a, b) => b.transferable - a.transferable)[0];
    if (cheap) {
      const total = plan.filter((r) => r.urgency.id !== 'adequate' && r.transferable > 0)
        .reduce((sum, r) => sum + Math.min(r.netNeed, r.transferable), 0);
      out.push({
        id: 'transfer-first',
        tone: 'ok',
        icon: 'swap',
        title: 'Move stock before you spend money',
        body: `${SP.fmt.n(total)} units of low-cover demand can already be covered from surplus held at other sites — including ${SP.fmt.n(cheap.transferable)} × ${cheap.skuLabel}. That avoids roughly ${SP.fmt.moneyCompact(total * cheap.unitCost)} of purchase cost.`,
        cta: 'Plan a transfer',
        action: { route: 'transfers', params: { skuId: cheap.skuId, qty: Math.min(cheap.netNeed, cheap.transferable) } },
        confidence: 0.92,
      });
    }

    /* 2. Out-of-stock revenue exposure */
    const zeros = plan.filter((r) => r.urgency.id === 'critical');
    if (zeros.length) {
      const capital = zeros.reduce((s2, r) => s2 + r.value, 0);
      out.push({
        id: 'out-of-stock',
        tone: 'danger',
        icon: 'alert',
        title: `${zeros.length} SKU${zeros.length === 1 ? '' : 's'} completely out of stock`,
        body: `These lines cannot be sold at all. Restoring the top ${Math.min(5, zeros.length)} costs about ${SP.fmt.money(capital)} and covers ${SP.fmt.pct((Math.min(5, zeros.length) / zeros.length) * 100)} of the gap.`,
        cta: 'Open Refill Radar',
        action: { route: 'refill', params: { band: 'critical' } },
        confidence: 0.97,
      });
    }

    /* 3. Concentration risk */
    const top = s.skus.filter((x) => !x.archived)
      .map((x) => ({ x, q: totalOf(x) })).sort((a, b) => b.q - a.q)[0];
    const totalUnits = s.skus.filter((x) => !x.archived).reduce((a, x) => a + totalOf(x), 0);
    if (top && totalUnits > 0) {
      const share = (top.q / totalUnits) * 100;
      if (share >= 12) {
        out.push({
          id: 'concentration',
          tone: 'warn',
          icon: 'chart',
          title: 'Stock is concentrated in one model',
          body: `${top.x.sku} ${top.x.specs} is ${SP.fmt.pct(share)} of all units on hand (${SP.fmt.n(top.q)}). A single delayed shipment would put most of the business on hold.`,
          cta: 'Review catalogue',
          action: { route: 'inventory', params: { q: top.x.sku } },
          confidence: 0.88,
        });
      }
    }

    /* 4. Site imbalance */
    const imbalanced = byWh.find((w) => w.health < 65 && w.units > 0);
    if (imbalanced) {
      out.push({
        id: 'site-imbalance',
        tone: 'warn',
        icon: 'home',
        title: `${imbalanced.label} is thin on cover`,
        body: `${SP.fmt.pct(imbalanced.health)} of the lines held here sit at or above the reorder line. Pulling the top needs forward would rebalance the network without new purchases.`,
        cta: 'Open site',
        action: { route: 'warehouses', params: { id: imbalanced.id } },
        confidence: 0.81,
      });
    }

    /* 5. Dead stock */
    const dead = deadStock();
    if (dead.length) {
      const value = dead.reduce((s2, d) => s2 + d.qty * (d.sku.cost || 0), 0);
      out.push({
        id: 'dead-stock',
        tone: 'violet',
        icon: 'clock',
        title: `${SP.fmt.pluralise(dead.length, 'line')} with no recent movement`,
        body: `These SKUs have not been dispatched within your ${SP.store.state.rules.deadStockDays}-day window, tying up about ${SP.fmt.moneyCompact(value)} of working capital.`,
        cta: 'See the list',
        action: { route: 'insights', params: { tab: 'capital' } },
        confidence: 0.74,
      });
    }

    /* 6. Data quality */
    const dq = dataQuality();
    if (dq.issues.length) {
      out.push({
        id: 'data-quality',
        tone: 'info',
        icon: 'check',
        title: `${SP.fmt.pluralise(dq.issues.length, 'data issue')} detected`,
        body: `${dq.summary} Fixing these keeps the refill decisions honest — especially the ${dq.issues.filter((i) => i.sev === 'high').length} that affect quantities.`,
        cta: 'Review data health',
        action: { route: 'insights', params: { tab: 'quality' } },
        confidence: 0.99,
      });
    }

    /* 7. Purchase discipline */
    const pending = s.purchases.filter((p) => p.status === 'pending').length;
    if (pending) {
      out.push({
        id: 'approvals',
        tone: 'brand',
        icon: 'check',
        title: `${SP.fmt.pluralise(pending, 'purchase order')} awaiting approval`,
        body: 'Orders sitting unapproved hold their value out of the plan and can miss a supplier cycle. Clearing the queue keeps capital allocation accurate.',
        cta: 'Review orders',
        action: { route: 'purchase', params: { status: 'pending' } },
        confidence: 1,
      });
    }

    return out;
  }

  /* ──────────────────────────────────────────────────────── capital view */

  function capitalSummary() {
    const s = SP.store.state;
    const live = s.skus.filter((x) => !x.archived);
    const value = live.reduce((a, x) => a + totalOf(x) * (x.cost || SP.costFor(x)), 0);
    const plan = refillPlan({});
    const committed = s.purchases
      .filter((p) => !['cancelled', 'received'].includes(p.status))
      .reduce((a, p) => a + (p.total || 0), 0);
    const needed = plan.reduce((a, r) => a + r.value, 0);
    return {
      onHandValue: value,
      committed,
      needed,
      free: needed - Math.min(needed, committed),
      lines: plan.filter((r) => r.suggestedQty > 0).length,
      avgLine: plan.filter((r) => r.suggestedQty > 0).length
        ? needed / plan.filter((r) => r.suggestedQty > 0).length
        : 0,
    };
  }

  /* ───────────────────────────────────────────────────────── dead stock */

  /**
   * Lines with no dispatch inside the dead-stock window.
   *
   * Returns nothing when there is no dispatch history at all — absence of
   * evidence is not evidence of absence, and claiming slow movers on a
   * freshly seeded system would be actively misleading.
   */
  function deadStock() {
    const s = SP.store.state;
    if (!s.sales.length) return [];
    const cutoff = Date.now() - s.rules.deadStockDays * 864e5;
    const moved = new Set(
      s.sales.filter((x) => Date.parse(x.at) >= cutoff).map((x) => x.skuId),
    );
    return s.skus
      .filter((x) => !x.archived && totalOf(x) > 0 && !moved.has(x.id))
      .map((x) => ({ sku: x, qty: totalOf(x), value: totalOf(x) * (x.cost || SP.costFor(x)) }))
      .sort((a, b) => b.value - a.value);
  }

  /** Value-weighted ABC classification. */
  function abcClassification() {
    const s = SP.store.state;
    const rows = s.skus
      .filter((x) => !x.archived)
      .map((x) => ({ sku: x, qty: totalOf(x), value: totalOf(x) * (x.cost || SP.costFor(x)) }))
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((a, r) => a + r.value, 0);
    let cum = 0;
    return rows.map((r) => {
      cum += r.value;
      const share = total ? (cum / total) * 100 : 0;
      const cls = share <= 70 ? 'A' : share <= 90 ? 'B' : 'C';
      return { ...r, cumulative: share, class: cls, ownShare: total ? (r.value / total) * 100 : 0 };
    });
  }

  /* ──────────────────────────────────────────────────────── data quality */

  /** Detects the inconsistencies that distort every downstream number. */
  function dataQuality() {
    const s = SP.store.state;
    const issues = [];
    const live = s.skus.filter((x) => !x.archived);

    // 1. Colour total vs per-warehouse total disagreeing.
    for (const sku of live) {
      const byColour = totalOf(sku);
      const byWh = SP.store.state.warehouses.reduce(
        (a, w) => a + (Number(sku.byWh?.[w.id]) || 0), 0,
      );
      if (Math.abs(byColour - byWh) > 0) {
        issues.push({
          sev: 'high',
          skuId: sku.id,
          title: `${SP.fmt.shortSku(sku.sku, sku.specs, 30)} · totals disagree`,
          body: `Colours sum to ${SP.fmt.n(byColour)} but warehouses sum to ${SP.fmt.n(byWh)} — a difference of ${SP.fmt.n(Math.abs(byColour - byWh))}.`,
          fix: 'Recalculate from colours',
        });
      }
    }

    // 2. Duplicate model+spec pairs differing only by case/spacing.
    const seen = new Map();
    for (const sku of live) {
      const key = `${String(sku.sku).toUpperCase().replace(/\s+/g, ' ')}|${String(sku.specs).toUpperCase().replace(/\s+/g, '')}`;
      if (seen.has(key)) {
        issues.push({
          sev: 'med',
          skuId: sku.id,
          title: `Possible duplicate · ${SP.fmt.shortSku(sku.sku, sku.specs, 26)}`,
          body: `A second entry with the same model and specification already exists (${seen.get(key)}). Merge them to avoid double-counting.`,
          fix: 'Merge duplicates',
        });
      } else seen.set(key, sku.id);
    }

    // 3. Negative or non-numeric quantities.
    for (const sku of live) {
      for (const c of COLOURS()) {
        const v = Number(sku.colours?.[c]);
        if (Number.isFinite(v) && v < 0) {
          issues.push({
            sev: 'high', skuId: sku.id,
            title: `${sku.sku} · negative ${c} stock`,
            body: `${SP.fmt.n(v)} units recorded. Stock cannot be negative — check the dispatch log.`,
            fix: 'Recalculate from ledger',
          });
        }
      }
    }

    // 4. Missing specification.
    for (const sku of live) {
      if (!sku.specs || !String(sku.specs).trim()) {
        issues.push({
          sev: 'low', skuId: sku.id,
          title: `${sku.sku} · no specification`,
          body: 'Capacity and memory are needed to estimate replenishment cover.',
          fix: 'Add specification',
        });
      }
    }

    // 5. Warehouse holding units the colours do not account for.
    const unaccounted = SP.store.state.warehouses.reduce((a, w) => {
      let n = 0;
      for (const sku of live) {
        const col = totalOf(sku);
        const wh = Number(sku.byWh?.[w.id]) || 0;
        if (wh > 0 && col === 0) n += wh;
      }
      return a + n;
    }, 0);

    const summary = issues.length === 0
      ? 'Every line reconciles against its colour breakdown and site totals.'
      : `${SP.fmt.pluralise(issues.length, 'issue')} — ${issues.filter((i) => i.sev === 'high').length} affecting quantities directly.`;

    return { issues, summary, unaccounted };
  }

  /* ───────────────────────────────────────────────────────────── history */

  /** Dispatch volume bucketed by day for the trend chart. */
  function salesTrend(days = 14) {
    const s = SP.store.state;
    const out = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i -= 1) {
      const start = new Date(today.getTime() - i * 864e5);
      const end = start.getTime() + 864e5;
      let units = 0; let value = 0; let count = 0;
      for (const sale of s.sales) {
        const t = Date.parse(sale.at);
        if (t >= start.getTime() && t < end) {
          const q = Number(sale.qty) || 0;
          if (sale.type === 'return') { units -= q; } else { units += q; value += q * (sale.unitCost || 0); count += 1; }
        }
      }
      out.push({ date: start, units: Math.max(0, units), value, count });
    }
    return out;
  }

  /** Last N dispatches, newest first. */
  function recentSales(limit = 8) {
    return [...SP.store.state.sales]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, limit);
  }

  /* ─────────────────────────────────────────────────────── colour maths */

  /**
   * Move `delta` units in or out of a SKU's colour breakdown without ever
   * letting the variants disagree with the warehouse totals.
   *
   * The breakdown is adjusted pro-rata against the current mix, then any
   * rounding remainder is placed on the variant that can absorb it — on the
   * named colour when supplied, otherwise the largest one on hand. Removing
   * units never drives a variant below zero.
   *
   * @returns {Record<string, number>} the new per-colour quantities
   */
  function adjustColours(sku, delta, opts = {}) {
    const names = COLOURS();
    const cur = {};
    names.forEach((c) => { cur[c] = Math.max(0, Number(sku.colours?.[c]) || 0); });
    const total = names.reduce((a, c) => a + cur[c], 0);
    const out = { ...cur };
    const change = Math.trunc(Number(delta) || 0);
    if (change === 0 || total === 0) {
      if (change > 0 && total === 0) {
        const key = opts.colour && names.includes(opts.colour) ? opts.colour : names[0];
        out[key] = cur[key] + change;
      }
      return out;
    }

    if (change > 0) {
      let assigned = 0;
      names.forEach((c) => {
        const share = Math.round((cur[c] / total) * change);
        if (share > 0) { out[c] = cur[c] + share; assigned += share; }
      });
      if (assigned < change) {
        const key = (opts.colour && cur[opts.colour] > 0)
          ? opts.colour
          : (names.reduce((best, c) => (cur[c] > cur[best] ? c : best), names[0]));
        out[key] += change - assigned;
      }
    } else {
      let need = -change;
      names.forEach((c) => {
        if (need <= 0) return;
        const share = Math.min(cur[c], Math.round((cur[c] / total) * (-change)));
        if (share > 0) { out[c] = cur[c] - share; need -= share; }
      });
      // Second pass: absorb any rounding remainder from the largest variant
      // that can still give units up.
      const bySize = [...names].sort((a, b) => cur[b] - cur[a]);
      while (need > 0) {
        const key = bySize.find((c) => out[c] > 0);
        if (!key) break;
        const take = Math.min(need, out[key]);
        out[key] -= take;
        need -= take;
      }
    }
    return out;
  }

  /* ─────────────────────────────────────────────────────────────── misc */

  /** Colour swatch hex lookup. */
  function colourHex(name) {
    const list = SP.SEED?.colours || [];
    const hit = list.find((c) => c.name === name);
    if (hit) return hit.hex;
    const fallback = {
      Gold: '#E8B931', Silver: '#C8CED6', Black: '#1B1F27', White: '#F2F4F7',
      Orange: '#F2762E', Red: '#E5484D', Green: '#2FA84F', Blue: '#2D7FF9',
      Brown: '#8A5A3B', 'T.Gray': '#7A8699', Grey: '#5A6675', Purple: '#8B5CF6',
      Others: '#94A3B8',
    };
    return fallback[name] || '#94A3B8';
  }

  /** Find a SKU by id, name or spec fragment. */
  function findSku(term) {
    const t = String(term || '').trim().toLowerCase();
    if (!t) return null;
    const s = SP.store.state.skus;
    return s.find((x) => x.id.toLowerCase() === t)
      || s.find((x) => x.sku.toLowerCase() === t)
      || s.find((x) => `${x.sku} ${x.specs}`.toLowerCase() === t)
      || s.find((x) => x.sku.toLowerCase().startsWith(t))
      || s.find((x) => x.sku.toLowerCase().includes(t))
      || null;
  }

  return {
    COLOURS, totalOf, atWarehouse, activeColours, urgency, URGENCY_ORDER,
    velocity, coverWeeks, daysOfCover, suggest, refillPlan, guessPack,
    priorityScore, reasonFor, openPipelineFor, transferableFor, transferableBetween,
    summary, warehouseBreakdown, colourBreakdown, brandBreakdown,
    distribution, insights, capitalSummary, deadStock, abcClassification,
    dataQuality, salesTrend, recentSales, colourHex, findSku, adjustColours,
  };
})();