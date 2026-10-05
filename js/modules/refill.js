/**
 * modules/refill.js — the purchase decision engine.
 * Ranks every SKU by urgency, suggests quantities, splits transfer vs. buy,
 * and respects a capital budget.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.refill = (() => {
  const state = { band: 'all', warehouse: '*', brand: 'all', budget: 0, sort: 'priority' };

  const MOD = {
    title: 'Refill Radar',
    subtitle: () => {
      const n = SP.engine.refillPlan({ warehouse: state.warehouse, band: 'all' })
        .filter((r) => r.urgency.id !== 'adequate' && r.suggestedQty > 0).length;
      return `${SP.fmt.pluralise(n, 'line')} need buying`;
    },
    mount,
  };

  async function mount(params) {
    if (params) {
      if (params.band) state.band = params.band;
      if (params.wh) state.warehouse = params.wh;
      if (params.skuId) setTimeout(() => openSkuSheet(params.skuId), 140);
    }

    const root = SP.el('div.stack.gap-4');
    const rules = SP.store.state.rules;

    /* ── Summary ──────────────────────────────────────────────────── */
    const all = SP.engine.refillPlan({ warehouse: state.warehouse });
    const buy = all.filter((r) => r.urgency.id !== 'adequate' && r.suggestedQty > 0);
    const transfer = all.filter((r) => r.urgency.id !== 'adequate' && r.toTransfer > 0 && r.buyQty === 0);
    const totalValue = buy.reduce((a, r) => a + r.value, 0);
    const totalUnits = buy.reduce((a, r) => a + r.suggestedQty, 0);

    root.appendChild(SP.el('div.hero',
      SP.el('div.hero__eyebrow', SP.icon('target'), 'Capital required'),
      SP.el('div',
        SP.el('div.hero__value', SP.fmt.money(totalValue)),
        SP.el('p.hero__sub',
          `${SP.fmt.pluralise(totalUnits, 'unit')} across ${SP.fmt.pluralise(buy.length, 'line')}`,
          transfer.length ? `, plus ${SP.fmt.pluralise(transfer.length, 'line')} that can be covered by transferring existing stock.` : '.'),
      ),
      SP.el('div.hero__split',
        heroCell(SP.fmt.n(all.filter((r) => r.urgency.id === 'critical').length), 'Out of stock', 'var(--danger)'),
        heroCell(SP.fmt.n(all.filter((r) => r.urgency.id === 'refill').length), 'Need refill', 'var(--warn)'),
        heroCell(SP.fmt.moneyCompact(SP.sum(transfer, (r) => r.toTransfer * r.unitCost)), 'Avoidable spend', 'var(--ok)'),
      ),
    ));

    /* ── Filters ──────────────────────────────────────────────────── */
    root.appendChild(SP.el('div.grid.grid--2',
      SP.el('select.select', {
        'aria-label': 'Warehouse',
        onchange: (e) => { state.warehouse = e.target.value; SP.router.refresh(); },
      },
        SP.el('option', { value: '*', selected: state.warehouse === '*' }, 'All warehouses'),
        ...SP.store.state.warehouses.map((w) => SP.el('option', {
          value: w.id, selected: state.warehouse === w.id,
        }, w.label)),
      ),
      SP.el('select.select', {
        'aria-label': 'Brand',
        onchange: (e) => { state.brand = e.target.value; SP.router.refresh(); },
      },
        SP.el('option', { value: 'all', selected: state.brand === 'all' }, 'All brands'),
        ...SP.unique(all.map((r) => r.sku.brand)).sort()
          .map((b) => SP.el('option', { value: b, selected: state.brand === b }, b)),
      ),
    ));

    const bandCounts = {
      all: all.length,
      critical: all.filter((r) => r.urgency.id === 'critical').length,
      refill: all.filter((r) => r.urgency.id === 'refill').length,
      adequate: all.filter((r) => r.urgency.id === 'adequate').length,
    };

    root.appendChild(SP.segmented([
      { value: 'all', label: 'All', count: bandCounts.all },
      { value: 'critical', label: 'Restock', count: bandCounts.critical },
      { value: 'refill', label: 'Refill', count: bandCounts.refill },
      { value: 'adequate', label: 'Adequate', count: bandCounts.adequate },
    ], state.band, (v) => { state.band = v; SP.router.refresh(); }));

    /* ── Budget planner ───────────────────────────────────────────── */
    root.appendChild(budgetCard());

    /* ── The queue ────────────────────────────────────────────────── */
    const rows = all.filter((r) => {
      if (state.band !== 'all' && r.urgency.id !== state.band) return false;
      if (state.band === 'adequate') return false;
      return true;
    });

    const sorted = [...rows].sort((a, b) => {
      if (state.sort === 'value') return b.value - a.value;
      if (state.sort === 'qty') return b.suggestedQty - a.suggestedQty;
      if (state.sort === 'name') return a.sku.sku.localeCompare(b.sku.sku);
      return b.priorityScore - a.priorityScore;
    });

    // Which lines the configured ceiling can fund, walking the queue in the
    // same priority order the user sees.
    const overBudget = new Set();
    if (state.budget > 0) {
      let spend = 0;
      for (const r of SP.engine.refillPlan({ warehouse: state.warehouse })
        .filter((x) => x.urgency.id !== 'adequate' && x.suggestedQty > 0)
        .sort((a, b) => b.priorityScore - a.priorityScore)) {
        if (spend + r.value > state.budget) overBudget.add(r.skuId);
        else spend += r.value;
      }
    }

    if (!sorted.length) {
      root.appendChild(SP.el('div.card',
        SP.empty({
          icon: 'checkCircle',
          title: 'Nothing needs attention here',
          body: state.band === 'adequate'
            ? 'Every line in this selection is above the reorder line. No spending recommended.'
            : 'All lines in this selection are adequately stocked.',
        }),
      ));
      return root;
    }

    root.appendChild(SP.section(
      `${sorted.length} line${sorted.length === 1 ? '' : 's'} to review`,
      'Ranked by urgency, sales velocity and whether a transfer can solve it for free',
      SP.el('div.row.gap-2.row--wrap', { style: { marginBottom: 'var(--sp-1)' } },
        SP.el('span.tiny.mute', 'Sort'),
        ...[['priority', 'Priority'], ['value', 'Cost'], ['qty', 'Qty'], ['name', 'Name']].map(([k, l]) =>
          SP.el('button.chip', {
            type: 'button', class: state.sort === k ? 'is-active' : '',
            onclick: () => { state.sort = k; SP.router.refresh(); },
          }, l)),
      ),
      SP.el('div.matrix', ...sorted.map((r, i) => matrixRow(r, i, overBudget.has(r.skuId)))),
    ));

    /* ── Bulk actions ─────────────────────────────────────────────── */
    root.appendChild(SP.el('div.card.card--pad.stack.gap-3',
      SP.el('div.row.gap-3',
        SP.el('div.grow',
          SP.el('strong', { style: { fontSize: 'var(--fs-md)' } }, 'Turn this into a purchase order'),
          SP.el('p.tiny.mute', `${SP.fmt.pluralise(sorted.filter((r) => r.buyQty > 0).length, 'line')} would be bought · ${SP.fmt.money(SP.sum(sorted.filter((r) => r.buyQty > 0), (r) => r.value))}`),
        ),
      ),
      SP.el('div.row.gap-2',
        SP.el('button.btn.btn--primary.grow', {
          type: 'button',
          onclick: () => SP.modules.purchase.createFromPlan(sorted),
        }, SP.icon('cart'), 'Draft purchase order'),
        SP.el('button.btn.btn--ghost', {
          type: 'button', onclick: printPlan,
        }, SP.icon('print'), 'Print'),
      ),
    ));

    return root;
  }

  function heroCell(v, label, colour) {
    return SP.el('div.hero__cell', SP.el('b', { style: { color: colour } }, v), SP.el('span', label));
  }

  /* ───────────────────────────────────────────────── budget planner */

  function budgetCard() {
    const s = SP.store.state;
    const body = SP.el('div');

    const card = SP.el('div.card',
      SP.el('div.card__head',
        SP.icon('scale'),
        SP.el('h2', 'Capital planner'),
        SP.el('span.sub', 'Optional'),
      ),
      body,
    );

    const redraw = () => {
      SP.clear(body);
      const rows = SP.engine.refillPlan({ warehouse: state.warehouse })
        .filter((r) => r.urgency.id !== 'adequate' && r.suggestedQty > 0)
        .sort((a, b) => b.priorityScore - a.priorityScore);
      const need = SP.sum(rows, (r) => r.value);

      const input = SP.el('input.input.input--num', {
        type: 'number', min: 0, step: 500, value: state.budget,
        placeholder: String(Math.ceil(need)),
        'aria-label': 'Budget ceiling',
        oninput: SP.debounce((e) => {
          state.budget = SP.clamp(e.target.value, 0, 1e12);
          redraw();
        }, 400),
      });

      // Walk the queue in priority order and take lines until the budget runs out.
      let spend = 0;
      const within = [];
      for (const r of rows) {
        if (state.budget > 0 && spend + r.value > state.budget) break;
        spend += r.value;
        within.push(r);
      }

      body.appendChild(SP.el('div.card__body.stack.gap-3',
        SP.el('div.grid-form',
          SP.el('div.field',
            SP.el('label.field__label', 'Budget ceiling'),
            SP.el('div.input-affix', input, SP.el('span.field__suffix', s.rules.currency)),
            SP.el('p.field__hint', `Full plan needs ${SP.fmt.money(need)}`),
          ),
          SP.el('div.field',
            SP.el('label.field__label', 'Global reorder line'),
            SP.el('div.input-affix',
              SP.el('input.input.input--num', {
                type: 'number', min: 1, max: 999, value: s.rules.refillMax,
                oninput: SP.debounce((e) => {
                  const v = SP.clamp(e.target.value, 1, 999);
                  SP.store.update(['rules'], (st) => { st.rules.refillMax = v; });
                  SP.store.audit('rules.refillMax', String(v));
                  SP.router.refresh();
                }, 600),
              }),
              SP.el('span.field__suffix', 'units'),
            ),
            SP.el('p.field__hint', 'Admin can adjust this globally'),
          ),
        ),
        state.budget > 0 ? SP.el('div.callout', {
          dataset: { tone: spend >= need ? 'ok' : 'warn' },
        },
          SP.el('span.callout__ico', SP.icon(spend >= need ? 'checkCircle' : 'alert')),
          SP.el('div.callout__body',
            SP.el('strong', spend >= need ? 'Budget covers the whole plan' : 'Budget will not cover everything'),
            SP.el('p', `You can fund ${SP.fmt.pluralise(within.length, 'line')} worth ${SP.fmt.money(spend)}. `,
              spend >= need
                ? 'Nothing needs deprioritising.'
                : `${SP.fmt.pluralise(rows.length - within.length, 'line')} totalling ${SP.fmt.money(need - spend)} will be flagged in the list below.`),
          ),
        ) : null,
      ));
    };

    redraw();
    return card;
  }

  /* ──────────────────────────────────────────────── matrix row */

  function matrixRow(r, index, isOverBudget) {
    const top = index === 0;
    const withinBudget = !isOverBudget;

    return SP.el('div.matrix__row', {
      class: `${top ? 'is-top' : ''}${withinBudget ? '' : ' is-over'}`,
      style: withinBudget ? null : { opacity: '.62' },
      onclick: () => openSkuSheet(r.skuId),
      role: 'button', tabIndex: 0,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSkuSheet(r.skuId); } },
    },
      SP.el('div.matrix__rank', String(index + 1)),
      SP.el('div.matrix__main',
        SP.el('strong', r.sku.sku),
        SP.el('small', `${r.sku.specs} · ${r.sku.brand}`),
        SP.el('div.row.gap-1', { style: { marginTop: '5px', flexWrap: 'wrap' } },
          SP.urgencyTag(r.urgency, { short: true }),
          r.toTransfer > 0 ? SP.el('span.tag.tag--info',
            SP.icon('swap'), `${SP.fmt.n(r.toTransfer)} transferable`) : null,
          r.pipeline > 0 ? SP.el('span.tag.tag--violet', `${SP.fmt.n(r.pipeline)} inbound`) : null,
          r.perWeek > 0 ? SP.el('span.tag.tag--mute', `${SP.fmt.n(r.perWeek)}/wk`) : null,
          withinBudget ? null : SP.el('span.tag.tag--mute', 'over budget'),
        ),
      ),
      SP.el('div.matrix__qty',
        SP.el('b', SP.fmt.n(r.suggestedQty)),
        SP.el('span', SP.fmt.moneyCompact(r.value)),
      ),
    );
  }

  /* ──────────────────────────────────────── detail sheet (shared) */

  function openSkuSheet(skuId) {
    const sku = SP.store.state.skus.find((s) => s.id === skuId);
    if (!sku) return;
    const qty = state.warehouse === '*'
      ? SP.engine.totalOf(sku)
      : Number(sku.byWh?.[state.warehouse]) || 0;
    const r = SP.engine.suggest(sku, qty, state.warehouse === '*' ? {} : { transferable: SP.engine.transferableBetween(sku.id, state.warehouse) });

    const body = SP.el('div.stack.gap-4',
      SP.el('div.row.gap-3',
        SP.el('div.grow',
          SP.el('div', { style: { fontFamily: 'var(--font-num)', fontSize: 'var(--fs-3xl)', fontWeight: '750' } }, SP.fmt.n(r.suggestedQty)),
          SP.el('div.tiny.mute', `units to buy · ${SP.fmt.money(r.value)}`),
        ),
        SP.el('div.gauge', SP.charts.gauge({
          value: r.priorityScore, label: 'priority',
          colour: r.urgency.colour, display: String(r.priorityScore),
        })),
      ),
      SP.el('div.callout', { dataset: { tone: 'brand' } },
        SP.el('span.callout__ico', SP.icon('sparkles')),
        SP.el('div.callout__body', SP.el('strong', 'Why this amount'), SP.el('p', r.reason)),
      ),
      SP.el('dl.kv',
        SP.el('dt', 'Current stock'), SP.el('dd', SP.fmt.n(qty)),
        SP.el('dt', 'Reorder line'), SP.el('dd', SP.fmt.n(SP.store.state.rules.refillMax)),
        SP.el('dt', 'Target level'), SP.el('dd', SP.fmt.n(r.goalQty)),
        SP.el('dt', 'Already inbound'), SP.el('dd', SP.fmt.n(r.pipeline)),
        SP.el('dt', 'Net gap'), SP.el('dd', SP.fmt.n(r.netNeed)),
        SP.el('dt', 'Pack multiple'), SP.el('dd', `×${r.pack}`),
        SP.el('dt', 'Transfer first'), SP.el('dd', SP.fmt.n(r.toTransfer)),
        SP.el('dt', 'Then buy'), SP.el('dd', SP.fmt.n(r.buyQty)),
        SP.el('dt', 'Unit cost'), SP.el('dd', SP.fmt.money(r.unitCost)),
        r.coverDays !== Infinity
          ? SP.el('dt', 'Days of cover') : null,
        r.coverDays !== Infinity ? SP.el('dd', SP.fmt.days(r.coverDays)) : null,
      ),
      r.toTransfer > 0 ? SP.el('div.card.card--flat.card--pad',
        SP.el('div.row.gap-3',
          SP.el('span.insight__ico', { style: { background: 'var(--info-soft)', color: 'var(--info)' } }, SP.icon('swap')),
          SP.el('div.grow',
            SP.el('strong', `${SP.fmt.n(r.toTransfer)} units could be moved instead`),
            SP.el('p.tiny.mute', `Saving about ${SP.fmt.money(r.toTransfer * r.unitCost)} in purchasing.`),
          ),
        ),
      ) : null,
    );

    const sheet = SP.sheet({
      title: sku.sku,
      subtitle: `${sku.specs} · ${sku.brand}`,
      content: body,
      actions: [
        SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => sheet.close() }, 'Close'),
        SP.el('button.btn.btn--ghost', {
          type: 'button',
          onclick: () => { sheet.close(); setTimeout(() => SP.modules.sales.openForm({ skuId: sku.id }), 200); },
        }, SP.icon('truck'), 'Dispatch'),
        SP.el('button.btn.btn--primary', {
          type: 'button',
          onclick: () => { sheet.close(); setTimeout(() => SP.modules.purchase.createFromPlan([r]), 200); },
        }, SP.icon('cart'), 'Add to PO'),
      ],
    });
  }

  /* ──────────────────────────────────────────────────── printing */

  function printPlan() {
    const rows = SP.engine.refillPlan({ warehouse: state.warehouse })
      .filter((r) => r.urgency.id !== 'adequate' && r.suggestedQty > 0)
      .sort((a, b) => b.priorityScore - a.priorityScore);

    const head = SP.el('div.report-head',
      SP.el('div.report-head__mark', SP.icon('cart')),
      SP.el('div.grow',
        SP.el('h1', 'Purchase Recommendation'),
        SP.el('p', `Generated ${SP.fmt.dateTime(Date.now())} · ${state.warehouse === '*' ? 'All warehouses' : state.warehouse} · ${SP.fmt.money(SP.sum(rows, (r) => r.value))} total`),
      ),
    );

    const table = SP.el('table.table',
      SP.el('thead', SP.el('tr',
        SP.el('th', '#'), SP.el('th', 'Model'), SP.el('th', 'Spec'),
        SP.el('th.num', 'In hand'), SP.el('th.num', 'Transfer'), SP.el('th.num', 'Order'),
        SP.el('th.num', 'Est. cost'), SP.el('th', 'Priority'),
      )),
      SP.el('tbody', ...rows.map((r, i) => SP.el('tr',
        SP.el('td', String(i + 1)),
        SP.el('td', SP.el('div.cell-main', SP.el('strong', r.sku.sku), SP.el('small', r.sku.brand))),
        SP.el('td', r.sku.specs),
        SP.el('td.num', SP.fmt.n(r.qty)),
        SP.el('td.num', r.toTransfer ? SP.fmt.n(r.toTransfer) : '—'),
        SP.el('td.num', SP.el('strong', SP.fmt.n(r.buyQty))),
        SP.el('td.num', SP.fmt.money(r.buyQty * r.unitCost)),
        SP.el('td', SP.urgencyTag(r.urgency, { short: true })),
      ))),
      SP.el('tfoot', SP.el('tr',
        SP.el('td', { colspan: 5 }, 'Total'),
        SP.el('td.num', SP.fmt.n(SP.sum(rows, (r) => r.buyQty))),
        SP.el('td.num', SP.fmt.money(SP.sum(rows, (r) => r.buyQty * r.unitCost))),
        SP.el('td', ''),
      )),
    );

    const win = window.open('', '_blank');
    if (!win) {
      SP.ui.toast({ tone: 'warn', title: 'Pop-up blocked', body: 'Allow pop-ups to print the plan.' });
      return;
    }
    win.document.write(`<!DOCTYPE html><html><head><title>Purchase Recommendation</title>
      <link rel="stylesheet" href="css/tokens.css"><link rel="stylesheet" href="css/base.css"><link rel="stylesheet" href="css/components.css">
      <style>body{background:#fff;color:#111;padding:24px;font-family:system-ui,sans-serif}
      .table th{background:#f4f6fa}.table td,.table th{border-color:#dde3ec}
      .tag--u-red{background:#fee2e2;color:#b91c1c}.tag--u-amber{background:#fef3c7;color:#b45309}.tag--u-green{background:#d1fae5;color:#047857}
      .sign__box{border-color:#94a3b8}</style></head><body></body></html>`);
    win.document.body.appendChild(head);
    win.document.body.appendChild(table);
    win.document.body.appendChild(SP.el('div.sign',
      SP.el('div.sign__box', 'Prepared by'),
      SP.el('div.sign__box', 'Verified by'),
      SP.el('div.sign__box', 'Approved by'),
    ));
    win.document.close();
    setTimeout(() => win.print(), 400);
    SP.store.audit('report.print', 'purchase-plan', `${rows.length} lines`);
  }

  return { ...MOD, openSkuSheet, printPlan };
})();