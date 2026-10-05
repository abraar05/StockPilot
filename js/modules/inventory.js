/**
 * modules/inventory.js — live stock on hand, derived from the ledger.
 * Search / filter / sort / bulk actions / export. Row → product 360° page.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.inventory = (() => {
  const state = { q: '', warehouse: '*', band: 'all', stockType: 'all', onlyInStock: false };

  const MOD = { title: 'Inventory', subtitle: () => `${SP.fmt.pluralise(visibleRows().length, 'stocked product')}`, mount };

  function visibleRows() {
    const s = SP.store.state;
    const map = SP.ledger.stockMap(state.warehouse === '*' ? null : state.warehouse);
    let rows = s.products.filter((p) => !p.archived).map((p) => {
      const qty = map.get(p.id) || 0;
      return { p, qty, reserved: SP.ledger.reservedOf(p.id, state.warehouse === '*' ? null : state.warehouse), inTransit: SP.ledger.inTransitOf(p.id) };
    });
    if (state.onlyInStock) rows = rows.filter((r) => r.qty !== 0);
    if (state.q) {
      rows = rows.filter((r) => `${r.p.name} ${r.p.sku} ${r.p.brand} ${r.p.color} ${r.p.ram} ${r.p.storage}`.toLowerCase().includes(state.q));
    }
    if (state.stockType !== 'all') rows = rows.filter((r) => r.p.stockType === state.stockType);
    if (state.band !== 'all') {
      rows = rows.filter((r) => {
        const u = SP.ledger.urgency(r.qty);
        return state.band === 'adequate' ? u.id === 'adequate' : u.id === state.band;
      });
    }
    return rows;
  }

  function mount(params) {
    if (params) {
      if (params.wh) state.warehouse = params.wh;
      if (params.q !== undefined) state.q = params.q;
      if (params.band) state.band = params.band;
    }
    const root = SP.el('div.stack.gap-3');

    let tableRef = null;
    const table = SP.table.create({
      columns: [
        { key: 'name', label: 'Product', value: (r) => r.p.name, render: (r) => SP.el('div.stack', SP.el('strong', r.p.name), SP.el('small.mute', `${r.p.sku} · ${r.p.brand}${r.p.serialized ? ' · IMEI' : ''}`)) },
        { key: 'warehouse', label: 'Warehouses', width: '110px', value: (r) => Object.keys(SP.ledger.stockByWarehouse(r.p.id)).length, render: (r) => whBreakdown(r) },
        { key: 'qty', label: 'On hand', width: '90px', align: 'right', value: (r) => r.qty, render: (r) => SP.el('strong', { style: { color: r.qty <= 0 ? 'var(--danger)' : undefined } }, SP.fmt.n(r.qty)) },
        { key: 'reserved', label: 'Reserved', width: '80px', align: 'right', value: (r) => r.reserved, render: (r) => r.reserved ? SP.fmt.n(r.reserved) : SP.el('span.mute', '—') },
        { key: 'inTransit', label: 'In transit', width: '80px', align: 'right', value: (r) => r.inTransit, render: (r) => r.inTransit ? SP.fmt.n(r.inTransit) : SP.el('span.mute', '—') },
        { key: 'value', label: 'Value', width: '110px', align: 'right', value: (r) => r.qty * (r.p.cost || 0), hidden: !SP.auth.can('cost:view'), render: (r) => SP.fmt.money(r.qty * (r.p.cost || 0)) },
        { key: 'band', label: 'Status', width: '110px', value: (r) => SP.ledger.urgency(r.qty).label, render: (r) => SP.urgencyTag(SP.ledger.urgency(r.qty), { short: true }) },
      ],
      rows: visibleRows,
      rowId: (r) => r.p.id,
      defaultSort: 'qty', defaultDir: 'desc',
      selectable: true,
      pageSize: 25,
      empty: { icon: 'box', title: 'No stock found', body: 'Adjust filters, or receive stock to get started.' },
      onRowClick: (r) => SP.router.go('products', { id: r.p.id }),
      bulkActions: [
        { id: 'transfer', label: 'Transfer', icon: 'swap', run: (rows) => SP.modules.transfers.openForm({ items: rows.map((r) => ({ productId: r.p.id, qty: 1 })) }) },
        { id: 'export', label: 'Export CSV', icon: 'download', run: (rows) => exportCsv(rows) },
      ],
    });

    const filters = SP.ui2.filterBar({
      placeholder: 'Search SKU, model, brand, colour…',
      onChange: (f) => { state.q = f.q; table.refresh(); },
    });

    const scopeRow = SP.el('div.row.gap-2', { style: { flexWrap: 'wrap', alignItems: 'center' } },
      SP.ui2.warehouseSelect({
        value: state.warehouse,
        onChange: (v) => { state.warehouse = v; table.refresh(); MOD._sub && 0; },
      }),
      SP.chipRow([
        { value: 'all', label: 'All bands' },
        { value: 'critical', label: 'Out of stock' },
        { value: 'refill', label: 'Low' },
        { value: 'adequate', label: 'Healthy' },
      ], state.band, (v) => { state.band = v; table.refresh(); }),
      stockTypeChips(),
      SP.el('label.check.check--sm',
        SP.el('input', { type: 'checkbox', checked: state.onlyInStock, onchange: (e) => { state.onlyInStock = e.target.checked; table.refresh(); } }),
        SP.el('span.check__box'), SP.el('span.check__text', 'In stock only')),
    );

    const canReceive = SP.auth.can('movements:create') || SP.auth.can('purchases:receive');
    const actions = SP.el('div.row.gap-2', { style: { flexWrap: 'wrap' } },
      canReceive ? SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => SP.modules.movements.receiveForm() }, SP.icon('download'), 'Receive stock') : null,
      SP.auth.can('movements:adjust') ? SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => SP.modules.movements.adjustForm() }, SP.icon('edit'), 'Adjust') : null,
      SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => exportCsv(visibleRows()) }, SP.icon('upload'), 'Export'),
      SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => SP.router.go('products', { compose: 'import' }) }, SP.icon('file'), 'Import'),
    );

    root.append(
      SP.ui2.pageHead({ title: 'Inventory', sub: 'Ledger-derived stock on hand — every quantity is explainable.', actions: [actions] }),
      filters.el, scopeRow, table.el,
    );
    tableRef = table;
    return root;
  }

  function stockTypeChips() {
    const types = [...SP.STOCK_TYPES, ...SP.store.state.settings.stockTypes];
    return SP.el('select.select', {
      onchange: (e) => { state.stockType = e.target.value; tableRef?.refresh(); },
    },
      SP.el('option', { value: 'all', selected: state.stockType === 'all' }, 'All stock types'),
      ...types.map((t) => SP.el('option', { value: t.id, selected: state.stockType === t.id }, t.label)),
    );
  }

  function whBreakdown(r) {
    const byWh = SP.ledger.stockByWarehouse(r.p.id);
    const entries = Object.entries(byWh).filter(([, q]) => q > 0);
    if (!entries.length) return SP.el('span.mute', '—');
    if (state.warehouse !== '*') return SP.el('span', SP.fmt.n(byWh[state.warehouse] || 0));
    return SP.el('span.tiny', entries.map(([w, q]) => `${w} ${q}`).join(' · '));
  }

  function exportCsv(rows) {
    const data = rows.map((r) => ({
      sku: r.p.sku, name: r.p.name, brand: r.p.brand, ram: r.p.ram, storage: r.p.storage, color: r.p.color,
      qty: r.qty, reserved: r.reserved, in_transit: r.inTransit,
      cost: r.p.cost, value: r.qty * (r.p.cost || 0),
      warehouses: Object.entries(SP.ledger.stockByWarehouse(r.p.id)).map(([w, q]) => `${w}:${q}`).join(' '),
    }));
    SP.impexp.downloadCSV(data, ['sku', 'name', 'brand', 'ram', 'storage', 'color', 'qty', 'reserved', 'in_transit', 'cost', 'value', 'warehouses'],
      `stockpilot-inventory-${Date.now()}.csv`);
    SP.store.audit('inventory.export', `${rows.length} rows`, '', undefined);
    SP.ui.toast({ tone: 'ok', title: 'Exported', body: `${rows.length} rows as CSV.` });
  }

  return MOD;
})();

