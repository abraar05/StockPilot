/**
 * modules/inventory.js — the catalogue.
 * Search, layered filtering, sorting, colour-level editing, SKU lifecycle.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.inventory = (() => {
  const state = {
    q: '',
    brand: 'all',
    warehouse: '*',
    band: 'all',
    sort: 'qty',
    dir: 'desc',
    showArchived: false,
  };

  const MOD = {
    title: 'Inventory',
    subtitle: () => `${SP.fmt.pluralise(SP.store.state.skus.filter((s) => !s.archived).length, 'SKU')} tracked`,
    mount,
  };

  /* ───────────────────────────────────────────────────────── derived */

  function scope(sku) {
    return state.warehouse === '*'
      ? SP.engine.totalOf(sku)
      : Number(sku.byWh?.[state.warehouse]) || 0;
  }

  function visible() {
    const q = state.q.trim().toLowerCase();
    let rows = SP.store.state.skus.filter((s) => (state.showArchived ? true : !s.archived));

    if (q) {
      rows = rows.filter((s) => `${s.sku} ${s.specs} ${s.brand} ${s.id}`.toLowerCase().includes(q));
    }
    if (state.brand !== 'all') rows = rows.filter((s) => s.brand === state.brand);
    if (state.band !== 'all') {
      rows = rows.filter((s) => {
        const u = SP.engine.urgency(scope(s));
        return state.band === 'adequate' ? u.id === 'adequate' : u.id === state.band;
      });
    }

    const dir = state.dir === 'asc' ? 1 : -1;
    const key = state.sort;
    rows.sort((a, b) => {
      if (key === 'qty') return (scope(a) - scope(b)) * dir;
      if (key === 'value') return ((scope(a) * (a.cost || 0)) - (scope(b) * (b.cost || 0))) * dir;
      if (key === 'sku') return a.sku.localeCompare(b.sku) * dir;
      if (key === 'specs') return a.specs.localeCompare(b.specs) * dir;
      if (key === 'brand') return a.brand.localeCompare(b.brand) * dir;
      return 0;
    });
    return rows;
  }

  /* ─────────────────────────────────────────────────────────── view */

  async function mount(params) {
    if (params) {
      if (params.q !== undefined) state.q = params.q;
      if (params.wh) state.warehouse = params.wh;
      if (params.band) state.band = params.band;
      if (params.skuId) setTimeout(() => openSkuSheet(params.skuId), 120);
    }

    const root = SP.el('div.stack.gap-4');
    const canEdit = SP.auth.can('edit:stock');

    /* ── Search + actions ──────────────────────────────────────────── */
    const search = SP.el('div.searchbar',
      SP.icon('search'),
      SP.el('input.input', {
        type: 'search', placeholder: 'Search SKU, spec or brand…',
        value: state.q, 'aria-label': 'Search inventory',
        oninput: SP.debounce((e) => { state.q = e.target.value; renderList(); }, 200),
      }),
      state.q ? SP.el('button.searchbar__clear', {
        type: 'button', 'aria-label': 'Clear search',
        onclick: (e) => {
          state.q = '';
          const inp = e.target.closest('.searchbar').querySelector('input');
          inp.value = ''; inp.focus();
          renderList();
        },
      }, SP.icon('x')) : null,
    );
    root.appendChild(search);

    root.appendChild(SP.el('div.row.gap-2.row--wrap',
      SP.el('button.btn.btn--sm.btn--ghost', {
        type: 'button', onclick: exportCsv,
      }, SP.icon('download'), 'CSV'),
      SP.el('button.btn.btn--sm.btn--ghost', {
        type: 'button', onclick: () => SP.router.go('insights', { tab: 'quality' }),
      }, SP.icon('checkCircle'), 'Data health'),
      SP.el('div.grow'),
      canEdit ? SP.el('button.btn.btn--sm.btn--primary', {
        type: 'button', onclick: () => editSku(null),
      }, SP.icon('plus'), 'Add SKU') : null,
    ));

    /* ── Filters ───────────────────────────────────────────────────── */
    const brands = SP.unique(SP.store.state.skus.filter((s) => !s.archived).map((s) => s.brand)).sort();
    root.appendChild(SP.chipRow(
      [{ value: 'all', label: 'All', count: SP.store.state.skus.filter((s) => !s.archived).length },
        ...brands.map((b) => ({ value: b, label: b, count: SP.store.state.skus.filter((s) => s.brand === b && !s.archived).length }))],
      state.brand,
      (v) => { state.brand = v; SP.router.refresh(); },
    ));

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
        'aria-label': 'Urgency',
        onchange: (e) => { state.band = e.target.value; SP.router.refresh(); },
      },
        ...[['all', 'Any stock level'], ['critical', 'Restock priority'], ['refill', 'Needs refill'], ['adequate', 'Adequate']]
          .map(([v, l]) => SP.el('option', { value: v, selected: state.band === v }, l)),
      ),
    ));

    /* ── Summary strip ─────────────────────────────────────────────── */
    root.appendChild(SP.el('div.row.gap-3.row--wrap', { style: { fontSize: 'var(--fs-xs)', color: 'var(--text-mute)' } },
      SP.el('span', SP.el('b', { style: { color: 'var(--text)' } }, 'Sort:')),
      ...[
        ['qty', 'Qty'], ['value', 'Value'], ['sku', 'Model'], ['specs', 'Spec'], ['brand', 'Brand'],
      ].map(([k, l]) => SP.el('button.chip', {
        type: 'button',
        class: state.sort === k ? 'is-active' : '',
        onclick: () => {
          if (state.sort === k) state.dir = state.dir === 'desc' ? 'asc' : 'desc';
          else { state.sort = k; state.dir = 'desc'; }
          SP.router.refresh();
        },
      }, l, state.sort === k ? (state.dir === 'desc' ? ' ↓' : ' ↑') : '')),
      SP.el('div.grow'),
      SP.el('label.check.check--sm',
        SP.el('input', {
          type: 'checkbox', checked: state.showArchived,
          onchange: (e) => { state.showArchived = e.target.checked; SP.router.refresh(); },
        }),
        SP.el('span.check__box'),
        SP.el('span.check__text', 'Show archived'),
      ),
    ));

    /* ── List ──────────────────────────────────────────────────────── */
    const listHost = SP.el('div');
    root.appendChild(listHost);

    function renderList() {
      const rows = visible();
      SP.clear(listHost);

      if (!rows.length) {
        listHost.appendChild(SP.empty({
          icon: 'search',
          title: 'No matching SKUs',
          body: state.q
            ? `Nothing matches “${state.q}”. Try a shorter search or clear the filters.`
            : 'Adjust the filters, or add a new SKU to the catalogue.',
          action: canEdit ? { label: 'Add SKU', onClick: () => editSku(null) } : null,
        }));
        return;
      }

      const totals = rows.reduce((a, s) => {
        const q = scope(s);
        a.units += q;
        a.value += q * (s.cost || 0);
        return a;
      }, { units: 0, value: 0 });

      listHost.appendChild(SP.el('div.card',
        SP.el('div.card__head',
          SP.el('h2', `${SP.fmt.n(rows.length)} of ${SP.fmt.n(SP.store.state.skus.length)}`),
          SP.el('span.sub', `${SP.fmt.n(totals.units)} units · ${SP.fmt.moneyCompact(totals.value)}`),
        ),
        ...rows.map((sku) => {
          const qty = scope(sku);
          const u = SP.engine.urgency(qty);
          const variants = SP.engine.activeColours(sku);
          return SP.el('button.lrow', {
            type: 'button', onclick: () => openSkuSheet(sku.id),
          },
            SP.el('span.lrow__ico', {
              style: {
                background: `color-mix(in srgb, ${u.colour} 16%, transparent)`,
                color: u.colour,
              },
            }, SP.icon('box')),
            SP.el('div.lrow__main',
              SP.el('strong', sku.sku, sku.archived ? SP.el('span.tag.tag--mute', { style: { marginLeft: '6px' } }, 'archived') : null),
              SP.el('small', `${sku.specs} · ${sku.brand}${variants.length ? ` · ${variants.map((v) => v.colour).slice(0, 3).join(', ')}` : ''}`),
              variants.length
                ? SP.el('div.variants', { style: { marginTop: '5px', maxWidth: '180px' } },
                  ...variants.map((v) => SP.el('i', {
                    style: {
                      width: `${(v.qty / variants.reduce((a, x) => a + x.qty, 0)) * 100}%`,
                      background: SP.engine.colourHex(v.colour),
                    },
                    title: `${v.colour}: ${SP.fmt.n(v.qty)}`,
                  })))
                : null,
            ),
            SP.el('div.lrow__end',
              SP.el('span.lrow__val', { style: { color: qty === 0 ? 'var(--danger)' : undefined } }, SP.fmt.n(qty)),
              SP.urgencyTag(u, { short: true }),
            ),
            SP.icon('chevron', 'lrow__chev'),
          );
        }),
      ));
    }

    renderList();

    const t = SP.TIPS_BY_ID('quickstock');
    const tipNode = t ? SP.tip(t) : null;
    if (tipNode) root.appendChild(tipNode);

    return root;
  }

  /* ──────────────────────────────────────────────── SKU detail sheet */

  /** Full detail + editing surface for one SKU. */
  function openSkuSheet(skuId) {
    const sku = SP.store.state.skus.find((s) => s.id === skuId);
    if (!sku) {
      SP.ui.toast({ tone: 'warn', title: 'SKU not found', body: 'It may have been removed.' });
      return;
    }

    const canEdit = SP.auth.can('edit:stock');
    const scopeAllowed = SP.auth.can('edit:anywhere')
      || SP.auth.scopeOf().includes(SP.store.state.prefs.warehouse)
      || SP.auth.roleOf() === 'admin';

    const body = SP.el('div.stack.gap-4');
    const sheet = SP.sheet({
      title: sku.sku,
      subtitle: sku.specs,
      content: body,
      actions: [
        SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => sheet.close() }, 'Close'),
        canEdit ? SP.el('button.btn.btn--primary', {
          type: 'button', onclick: () => editSku(sku.id, () => sheet.close()),
        }, SP.icon('edit'), 'Edit SKU') : null,
      ].filter(Boolean),
    });

    const rerender = () => {
      SP.clear(body);
      const fresh = SP.store.state.skus.find((s) => s.id === skuId);
      if (fresh) build(body, fresh);
    };

    build(body, sku);
    void rerender;
    void canEdit;
    void scopeAllowed;
    return sheet;
  }

  function build(body, sku) {
    const total = SP.engine.totalOf(sku);
    const u = SP.engine.urgency(total);
    const variants = SP.engine.activeColours(sku);
    const vmax = Math.max(1, ...variants.map((v) => v.qty));
    const dist = SP.engine.distribution(sku.id);
    const sales = SP.store.state.sales.filter((s) => s.skuId === sku.id);
    const unitsSold = sales.reduce((a, s) => a + (s.type === 'return' ? -(s.qty || 0) : (s.qty || 0)), 0);
    const plan = SP.engine.suggest(sku, total);

    /* headline */
    body.appendChild(SP.el('div.row.gap-3.row--wrap',
      SP.el('div.grow',
        SP.el('div', { style: { fontFamily: 'var(--font-num)', fontSize: 'var(--fs-3xl)', fontWeight: '750', letterSpacing: '-0.04em', color: u.colour } }, SP.fmt.n(total)),
        SP.el('div.tiny.mute', 'units on hand across all sites'),
      ),
      SP.urgencyTag(u),
    ));

    /* quick actions */
    body.appendChild(SP.el('div.row.gap-2.row--wrap',
      SP.el('button.btn.btn--sm.btn--ghost', {
        type: 'button',
        onclick: () => { sheetCloseThen(() => SP.modules.sales.openForm({ skuId: sku.id })); },
      }, SP.icon('truck'), 'Dispatch'),
      SP.el('button.btn.btn--sm.btn--ghost', {
        type: 'button',
        onclick: () => { sheetCloseThen(() => SP.modules.transfers.openForm({ skuId: sku.id })); },
      }, SP.icon('swap'), 'Transfer'),
      plan.netNeed > 0 ? SP.el('button.btn.btn--sm.btn--primary', {
        type: 'button',
        onclick: () => { sheetCloseThen(() => SP.modules.purchase.createFromPlan([plan])); },
      }, SP.icon('cart'), `Buy ${SP.fmt.n(plan.suggestedQty)}`) : null,
    ));

    /* colour variants */
    body.appendChild(SP.el('div',
      SP.el('div.divider-label', { style: { marginBottom: 'var(--sp-3)' } }, 'Colour variants'),
      variants.length ? SP.el('div.variant-bars', ...variants.map((v) => SP.el('div.vb',
        SP.el('div.vb__name',
          SP.el('i', { style: { background: SP.engine.colourHex(v.colour) } }),
          v.colour),
        SP.el('div.vb__track',
          SP.el('i.vb__fill', {
            style: { width: `${(v.qty / vmax) * 100}%`, background: SP.engine.colourHex(v.colour) },
          })),
        SP.el('div.vb__val', SP.fmt.n(v.qty)),
      ))) : SP.el('p.tiny.mute', 'No colour-level stock recorded.'),
    ));

    /* warehouse distribution */
    if (dist) {
      const maxWh = Math.max(1, ...dist.rows.map((r) => r.qty));
      body.appendChild(SP.el('div',
        SP.el('div.divider-label', { style: { marginBottom: 'var(--sp-3)' } }, 'By warehouse'),
        SP.el('div.variant-bars', ...dist.rows.map((r) => SP.el('div.vb',
          SP.el('div.vb__name', r.warehouse.short || r.warehouse.id),
          SP.el('div.vb__track',
            SP.el('i.vb__fill', {
              style: {
                width: `${(r.qty / maxWh) * 100}%`,
                background: r.urgency.colour,
              },
            })),
          SP.el('div.vb__val', SP.fmt.n(r.qty)),
        ))),
      ));
    }

    /* recommendation */
    body.appendChild(SP.el('div.callout', { dataset: { tone: plan.suggestedQty > 0 ? 'brand' : 'ok' } },
      SP.el('span.callout__ico', SP.icon(plan.suggestedQty > 0 ? 'cart' : 'checkCircle')),
      SP.el('div.callout__body',
        SP.el('strong', plan.suggestedQty > 0 ? `Suggested purchase: ${SP.fmt.n(plan.suggestedQty)} units` : 'No purchase needed'),
        SP.el('p', plan.reason),
        SP.el('p', { style: { marginTop: '4px' } },
          `Estimated ${SP.fmt.money(plan.value)} at ${SP.fmt.money(plan.unitCost)} per unit`,
          plan.toTransfer > 0 ? ` · ${SP.fmt.n(plan.toTransfer)} could be transferred instead` : '',
          unitsSold > 0 ? ` · ${SP.fmt.n(unitsSold)} units moved historically` : '',
        ),
      ),
    ));

    /* facts */
    body.appendChild(SP.el('dl.kv.kv--stack',
      SP.el('dt', 'Reference'), SP.el('dd', SP.el('code', sku.id)),
      SP.el('dt', 'Brand / series'), SP.el('dd', sku.brand),
      SP.el('dt', 'Unit cost'), SP.el('dd', SP.fmt.money(sku.cost || SP.costFor(sku))),
      SP.el('dt', 'Stock value'), SP.el('dd', SP.fmt.money(total * (sku.cost || SP.costFor(sku)))),
      SP.el('dt', 'Last updated'), SP.el('dd', SP.fmt.ago(sku.updatedAt)),
      sku.notes ? SP.el('dt', 'Notes') : null,
      sku.notes ? SP.el('dd', sku.notes) : null,
    ));
  }

  let activeSheet = null;
  function sheetCloseThen(fn) {
    if (activeSheet) activeSheet.close();
    setTimeout(fn, 180);
  }

  /* ──────────────────────────────────────────────── create / edit */

  async function editSku(skuId, onDone) {
    const existing = skuId ? SP.store.state.skus.find((s) => s.id === skuId) : null;

    const fields = [
      { key: 'sku', label: 'Model name', value: existing?.sku || '', required: true, placeholder: 'HONOR X9a' },
      { key: 'specs', label: 'Specification', value: existing?.specs || '', placeholder: '8 | 256GB' },
      {
        key: 'brand', label: 'Brand / series', type: 'select', value: existing?.brand || 'HONOR',
        options: SP.unique([...SP.store.state.skus.map((s) => s.brand), 'HONOR', 'REDMI', 'Xiaomi', 'Realme', 'Samsung', 'OnePlus', 'OPPO', 'Vivo', 'iPhone'])
          .filter(Boolean).sort().map((b) => ({ value: b, label: b })),
      },
      { key: 'cost', label: 'Unit cost', type: 'number', value: existing?.cost ?? 5000, min: 0, step: 50 },
      { key: 'minStock', label: 'Reorder floor', type: 'number', value: existing?.minStock ?? 0, min: 0, hint: 'Optional per-line override of the global threshold' },
    ];

    if (!existing) {
      SP.COLOURS.forEach((c) => fields.push({
        key: `c_${c}`, label: `${c} qty`, type: 'number', value: 0, min: 0,
      }));
    }

    const res = await SP.modal({
      title: existing ? 'Edit SKU' : 'Add a new SKU',
      subtitle: existing ? `${existing.id} · ${existing.sku}` : 'It will appear in Refill Radar straight away.',
      icon: existing ? 'edit' : 'plus',
      fields,
      okLabel: existing ? 'Save changes' : 'Add SKU',
      onOk: (v) => {
        const colours = {};
        if (existing) {
          SP.COLOURS.forEach((c) => { colours[c] = Number(existing.colours?.[c]) || 0; });
        } else {
          SP.COLOURS.forEach((c) => { colours[c] = v[`c_${c}`] || 0; });
        }

        if (existing) {
          SP.store.update(['skus'], (st) => {
            const t = st.skus.find((x) => x.id === existing.id);
            if (!t) return;
            t.sku = v.sku.trim();
            t.specs = (v.specs || '').trim();
            t.brand = v.brand;
            t.cost = v.cost;
            t.minStock = v.minStock;
            t.colours = colours;
            t.updatedAt = Date.now();
          });
          SP.store.audit('sku.update', existing.id, `${v.sku} · ${v.specs}`);
          SP.sheets.push({ type: 'sku.update', id: existing.id, sku: v.sku, specs: v.specs, brand: v.brand, cost: v.cost });
          SP.ui.toast({ tone: 'ok', title: 'SKU updated', body: `${v.sku} ${v.specs}` });
        } else {
          const id = SP.uid('SKU');
          const byWh = {};
          SP.store.state.warehouses.forEach((w) => {
            const sum = SP.COLOURS.reduce((a, c) => a + colours[c], 0);
            if (sum > 0) byWh[w.id] = sum;
          });
          SP.store.update(['skus'], (st) => {
            st.skus.push({
              id, sku: v.sku.trim(), specs: (v.specs || '').trim(), brand: v.brand,
              colours, byWh, cost: v.cost, minStock: v.minStock, archived: false,
              notes: '', createdAt: Date.now(), updatedAt: Date.now(),
            });
          });
          SP.store.audit('sku.create', id, `${v.sku} · ${v.specs}`);
          SP.sheets.push({ type: 'sku.create', id, sku: v.sku, specs: v.specs, brand: v.brand, colours });
          SP.ui.toast({ tone: 'ok', title: 'SKU added', body: `${v.sku} ${v.specs}` });
        }
        SP.router.refresh();
      },
    });

    if (res && onDone) onDone();
  }

  /* ─────────────────────────────────────────── colour quick adjust */

  /** In-place colour-level editor used from the SKU sheet and inventory row. */
  function adjustColours(skuId) {
    const sku = SP.store.state.skus.find((s) => s.id === skuId);
    if (!sku) return;

    const draft = { ...sku.colours };
    const body = SP.el('div.stack.gap-3');

    const grid = SP.el('div.grid.grid--2');
    const redraw = () => {
      SP.clear(grid);
      SP.COLOURS.forEach((c) => {
        const input = SP.el('input.input.input--num', {
          type: 'number', min: 0, value: draft[c] ?? 0, 'aria-label': `${c} quantity`,
          oninput: (e) => { draft[c] = SP.clamp(e.target.value, 0, 999999); },
        });
        grid.appendChild(SP.el('div.field',
          SP.el('label.field__label',
            SP.el('i', {
              style: {
                display: 'inline-block', width: '9px', height: '9px', borderRadius: '2px',
                background: SP.engine.colourHex(c), marginRight: '6px',
              },
            }),
            c),
          input,
        ));
      });
    };
    redraw();

    body.appendChild(SP.el('div.callout', { dataset: { tone: 'info' } },
      SP.el('span.callout__ico', SP.icon('info')),
      SP.el('div.callout__body',
        SP.el('strong', 'Adjust colour-level stock'),
        SP.el('p', 'Warehouse split is recalculated from the main warehouse unless you change it separately.'),
      ),
    ));
    body.appendChild(grid);

    const whSel = SP.el('select.select', { 'aria-label': 'Warehouse' },
      SP.el('option', { value: '*' }, 'Recalculate main warehouse'),
      ...SP.store.state.warehouses.map((w) => SP.el('option', { value: w.id }, `Set ${w.label} total`)),
    );
    body.appendChild(SP.el('div.field',
      SP.el('label.field__label', 'Warehouse allocation'), whSel));

    SP.modal({
      title: `Update · ${SP.fmt.shortSku(sku.sku, sku.specs, 24)}`,
      subtitle: `${SP.fmt.n(SP.engine.totalOf(sku))} units currently`,
      icon: 'edit',
      body,
      okLabel: 'Save quantities',
      onOk: () => {
        const colours = {};
        SP.COLOURS.forEach((c) => { colours[c] = SP.clamp(draft[c], 0, 999999); });
        const total = SP.COLOURS.reduce((a, c) => a + colours[c], 0);

        SP.store.update(['skus'], (st) => {
          const t = st.skus.find((x) => x.id === skuId);
          if (!t) return;
          t.colours = colours;
          if (whSel.value === '*') {
            const main = st.prefs.warehouse || 'MAIN';
            t.byWh[main] = total;
          } else {
            t.byWh[whSel.value] = total;
          }
          t.updatedAt = Date.now();
        });
        SP.store.audit('stock.adjust', skuId, `${total} units total`);
        SP.sheets.push({ type: 'stock.set', id: skuId, colours, warehouse: whSel.value === '*' ? (SP.store.state.prefs.warehouse || 'MAIN') : whSel.value, total });
        SP.ui.toast({ tone: 'ok', title: 'Stock updated', body: `${SP.fmt.n(total)} units for ${sku.sku}` });
        SP.router.refresh();
      },
    });
  }

  /* ──────────────────────────────────────────────────── export */

  function exportCsv() {
    const rows = visible().map((s) => {
      const row = { SKU: s.sku, Specs: s.specs, Brand: s.brand };
      SP.COLOURS.forEach((c) => { row[c] = Number(s.colours?.[c]) || 0; });
      row.Total = SP.engine.totalOf(s);
      SP.store.state.warehouses.forEach((w) => { row[w.id] = Number(s.byWh?.[w.id]) || 0; });
      row.Urgency = SP.engine.urgency(SP.engine.totalOf(s)).label;
      return row;
    });
    const headers = ['SKU', 'Specs', 'Brand', ...SP.COLOURS, 'Total', ...SP.store.state.warehouses.map((w) => w.id), 'Urgency'];
    SP.download(SP.toCSV(rows, headers), `stockpilot-inventory-${SP.fmt.date(Date.now())}.csv`, 'text/csv');
    SP.ui.toast({ tone: 'ok', title: 'Export ready', body: `${rows.length} SKUs exported.` });
  }

  return { ...MOD, openSkuSheet, editSku, adjustColours, exportCsv };
})();