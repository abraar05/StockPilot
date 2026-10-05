/**
 * modules/warehouses.js — multi-site network view.
 * Distribution matrix, site health, and the "pull from a sibling site" flow.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.warehouses = (() => {
  const state = { selected: null, sort: 'units' };

  const MOD = {
    title: 'Warehouses',
    subtitle: () => {
      const n = SP.engine.warehouseBreakdown().length;
      return `${SP.fmt.pluralise(n, 'site')} in the network`;
    },
    mount,
  };

  async function mount(params) {
    if (params?.id) state.selected = params.id;
    const root = SP.el('div.stack.gap-4');
    const list = SP.engine.warehouseBreakdown();
    const overall = SP.engine.summary();

    /* ── Network header ───────────────────────────────────────────── */
    const maxUnits = Math.max(1, ...list.map((w) => w.units));
    root.appendChild(SP.el('div.hero',
      SP.el('div.hero__eyebrow', SP.icon('route'), 'Network'),
      SP.el('div',
        SP.el('div.hero__value', SP.fmt.n(overall.gross)),
        SP.el('p.hero__sub',
          `Units spread across ${SP.fmt.pluralise(list.length, 'warehouse')}. `,
          `The largest holds ${SP.fmt.pct(list[0] ? list[0].share : 0, 0)} of the network.`),
      ),
      SP.el('div.hero__split',
        ...list.slice(0, 3).map((w) => SP.el('div.hero__cell',
          SP.el('b', { style: { color: w.color } }, SP.fmt.compact(w.units)),
          SP.el('span', w.short || w.label),
        )),
      ),
    ));

    /* ── Site cards ───────────────────────────────────────────────── */
    root.appendChild(SP.section('Sites', 'Tap a site to inspect its stock and rebalance it',
      SP.el('div.grid.grid--2', ...list.map((w) => siteCard(w, maxUnits))),
    ));

    /* ── Distribution matrix (warehouse × brand) ──────────────────── */
    root.appendChild(SP.section('Distribution', 'Where each brand sits across the network',
      SP.el('div.card',
        SP.el('div.card__body.stack.gap-4',
          SP.charts.stacked({
            label: 'Brand distribution',
            rows: buildBrandStack(),
            format: (v) => SP.fmt.n(v),
          }),
          SP.el('div.chart__legend', ...list.map((w) => SP.el('div.chart__legend-item',
            SP.el('i.chart__legend-swatch', { style: { background: w.color } }),
            w.label,
            SP.el('b', SP.fmt.n(w.units)),
          ))),
        ),
      ),
    ));

    /* ── Selected site detail ─────────────────────────────────────── */
    if (state.selected && list.some((w) => w.id === state.selected)) {
      root.appendChild(siteDetail(state.selected));
    }

    /* ── Rebalance suggestions ────────────────────────────────────── */
    const moves = rebalanceSuggestions();
    root.appendChild(SP.section('Rebalance suggestions', 'Free moves that would close the biggest gaps',
      moves.length ? SP.el('div.stacklist', ...moves.slice(0, 5).map(moveCard))
        : SP.el('div.card', SP.empty({
          icon: 'checkCircle',
          title: 'The network is balanced',
          body: 'No site is holding a surplus that another site needs.',
        })),
    ));

    const t = SP.TIPS_BY_ID('transfer');
    const tip = t ? SP.tip(t) : null;
    if (tip) root.appendChild(tip);

    return root;
  }

  /* ────────────────────────────────────────────────────────── pieces */

  function siteCard(w, maxUnits) {
    return SP.el('button.stat', {
      type: 'button',
      style: { borderColor: state.selected === w.id ? w.color : undefined },
      onclick: () => { state.selected = state.selected === w.id ? null : w.id; SP.router.refresh(); },
    },
      SP.el('div.stat__label',
        SP.el('i', { style: { width: '8px', height: '8px', borderRadius: '50%', background: w.color } }),
        w.label),
      SP.el('div.stat__value', SP.fmt.n(w.units)),
      SP.el('div.stat__foot', `${SP.fmt.pct(w.share)} of network · ${SP.fmt.pluralise(w.skus, 'SKU')}`),
      SP.el('div.bar', { style: { marginTop: '6px' } },
        SP.el('i', { style: { width: `${Math.max(2, (w.units / maxUnits) * 100)}%`, background: w.color } })),
      SP.el('div.row.gap-1', { style: { marginTop: '8px', flexWrap: 'wrap' } },
        w.critical ? SP.el('span.tag.tag--u-red', `${w.critical} out`) : null,
        w.refill ? SP.el('span.tag.tag--u-amber', `${w.refill} refill`) : null,
        !w.critical && !w.refill && w.units ? SP.el('span.tag.tag--u-green', 'Healthy') : null,
        !w.units ? SP.el('span.tag.tag--mute', 'Empty') : null,
      ),
    );
  }

  function buildBrandStack() {
    const brands = SP.engine.brandBreakdown().slice(0, 9);
    return brands.map((b) => {
      const parts = SP.store.state.warehouses.map((w) => ({
        label: w.label,
        value: SP.sum(SP.store.state.skus.filter((s) => s.brand === b.name && !s.archived),
          (s) => Number(s.byWh?.[w.id]) || 0),
        colour: w.color,
      }));
      return { label: b.name, parts };
    });
  }

  function siteDetail(whId) {
    const wh = SP.store.state.warehouses.find((w) => w.id === whId);
    if (!wh) return SP.el('div');
    const rows = SP.engine.warehouseBreakdown().find((x) => x.id === whId);

    const skus = SP.store.state.skus
      .filter((s) => !s.archived)
      .map((s) => ({ sku: s, qty: Number(s.byWh?.[whId]) || 0 }))
      .filter((r) => r.qty > 0)
      .sort((a, b) => b.qty - a.qty);

    return SP.el('div.card',
      SP.el('div.card__head',
        SP.el('i', { style: { width: '9px', height: '9px', borderRadius: '50%', background: wh.color } }),
        SP.el('h2', wh.label),
        SP.el('span.sub', `${SP.fmt.n(rows?.units || 0)} units`),
        SP.el('button.btn.btn--sm.btn--ghost', {
          type: 'button', onclick: () => { state.selected = null; SP.router.refresh(); },
        }, SP.icon('x')),
      ),
      SP.el('dl.kv', { style: { padding: '0 var(--sp-4) var(--sp-3)' } },
        SP.el('dt', 'Custodian'), SP.el('dd', wh.custodian || '—'),
        SP.el('dt', 'Share of network'), SP.el('dd', SP.fmt.pct(rows?.share || 0)),
        SP.el('dt', 'Healthy lines'), SP.el('dd', SP.fmt.pct(rows?.health || 0)),
        SP.el('dt', 'Needs attention'), SP.el('dd', `${(rows?.critical || 0) + (rows?.refill || 0)}`),
      ),
      SP.el('div.tablewrap', { style: { maxHeight: '340px', overflowY: 'auto' } },
        SP.el('table.table.table--compact',
          SP.el('thead', SP.el('tr',
            SP.el('th', 'Model'), SP.el('th', 'Spec'),
            SP.el('th.num', 'Units'), SP.el('th', 'Status'),
          )),
          SP.el('tbody', ...(skus.length ? skus.map(({ sku, qty }) => {
            const u = SP.engine.urgency(qty);
            return SP.el('tr', { onclick: () => SP.modules.inventory.openSkuSheet(sku.id) },
              SP.el('td', SP.el('div.cell-main',
                SP.el('strong', sku.sku), SP.el('small', sku.brand))),
              SP.el('td', sku.specs),
              SP.el('td.num', SP.fmt.n(qty)),
              SP.el('td', SP.urgencyTag(u, { short: true })),
            );
          }) : [SP.el('tr', SP.el('td', { colspan: 4 },
            SP.el('p.mute', { style: { padding: 'var(--sp-4)', textAlign: 'center' } }, 'This site holds no stock.')))])),
        ),
      ),
    );
  }

  /* ────────────────────────────────────────────── rebalance engine */

  /**
   * Pair up surplus with shortage across sites.
   * Only considers stock above the reorder line as surplus.
   */
  function rebalanceSuggestions() {
    const s = SP.store.state;
    const refillMax = s.rules.refillMax;
    const out = [];

    const surplus = new Map();  // skuId → [{ wh, qty }]
    const shortage = new Map();

    for (const sku of s.skus) {
      if (sku.archived) continue;
      for (const w of s.warehouses) {
        const q = Number(sku.byWh?.[w.id]) || 0;
        if (q > refillMax) {
          if (!surplus.has(sku.id)) surplus.set(sku.id, []);
          surplus.get(sku.id).push({ wh: w.id, qty: q - refillMax });
        }
      }
      const sitesWithStock = s.warehouses.filter((w) => (Number(sku.byWh?.[w.id]) || 0) > 0).length;
      const emptySites = s.warehouses.length - sitesWithStock;
      if (emptySites > 0 || SP.engine.totalOf(sku) <= refillMax) {
        if (!shortage.has(sku.id)) shortage.set(sku.id, []);
        for (const w of s.warehouses) {
          const q = Number(sku.byWh?.[w.id]) || 0;
          if (q === 0) shortage.get(sku.id).push({ wh: w.id, need: refillMax });
        }
      }
    }

    for (const [skuId, froms] of surplus) {
      const needs = shortage.get(skuId);
      if (!needs || !needs.length) continue;
      for (const f of froms) {
        for (const n of needs) {
          if (f.wh === n.wh) continue;
          const qty = Math.min(f.qty, n.need);
          if (qty <= 0) continue;
          const sku = s.skus.find((x) => x.id === skuId);
          out.push({
            skuId,
            from: f.wh,
            to: n.wh,
            qty,
            sku,
            saving: qty * (sku.cost || SP.costFor(sku)),
          });
        }
      }
    }

    return out.sort((a, b) => b.saving - a.saving);
  }

  function moveCard(m) {
    const from = SP.store.state.warehouses.find((w) => w.id === m.from);
    const to = SP.store.state.warehouses.find((w) => w.id === m.to);
    return SP.el('div.insight', { dataset: { tone: 'ok' } },
      SP.el('span.insight__ico', SP.icon('swap')),
      SP.el('div.insight__body',
        SP.el('strong', `Move ${SP.fmt.n(m.qty)} × ${m.sku.sku} ${m.sku.specs}`),
        SP.el('p', `${from?.short || m.from} → ${to?.short || m.to} · avoids ${SP.fmt.money(m.saving)} of purchasing`),
        SP.el('div.insight__act',
          SP.el('button.btn.btn--sm.btn--ghost', {
            type: 'button',
            onclick: () => SP.modules.transfers.openForm({
              skuId: m.skuId, from: m.from, to: m.to, qty: m.qty,
            }),
          }, 'Create transfer'),
        ),
      ),
    );
  }

  return { ...MOD, rebalanceSuggestions };
})();