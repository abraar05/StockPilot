/**
 * modules/reports.js — the report catalog with date/warehouse filters
 * and one-tap export or print.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.reports = (() => {
  const MOD = { title: 'Reports', subtitle: 'Every important report, generated from the ledger', mount };

  const REPORTS = [
    { id: 'daily_stock', label: 'Daily Stock Report', desc: 'Stock position and today\'s movements', icon: 'box' },
    { id: 'daily_sales', label: 'Daily Sales Report', desc: 'Invoices, totals and dues for a day', icon: 'truck' },
    { id: 'purchase', label: 'Purchase Report', desc: 'POs, receiving and supplier spend', icon: 'cart' },
    { id: 'transfer', label: 'Transfer Report', desc: 'Movement between warehouses', icon: 'swap' },
    { id: 'warehouse', label: 'Warehouse Report', desc: 'Per-site stock and valuation', icon: 'home' },
    { id: 'product', label: 'Product Report', desc: 'Catalogue with live stock', icon: 'tag' },
    { id: 'imei', label: 'IMEI Report', desc: 'Full device registry', icon: 'layers' },
    { id: 'ageing', label: 'Ageing Report', desc: 'FIFO ageing buckets per product', icon: 'clock' },
    { id: 'dead_stock', label: 'Dead Stock Report', desc: 'Stock with no movement', icon: 'alert' },
    { id: 'valuation', label: 'Stock Valuation Report', desc: 'Cost and retail value of holdings', icon: 'database' },
    { id: 'margin', label: 'Margin Report', desc: 'Sales vs cost of goods sold', icon: 'chart' },
    { id: 'customer_due', label: 'Customer Due Report', desc: 'Outstanding receivables', icon: 'users' },
    { id: 'supplier_due', label: 'Supplier Due Report', desc: 'Outstanding payables', icon: 'building' },
    { id: 'adjustment', label: 'Adjustment Report', desc: 'All manual adjustments with reasons', icon: 'edit' },
    { id: 'audit', label: 'Audit Report', desc: 'Governance trail for a period', icon: 'shield' },
    { id: 'verification', label: 'Physical Verification Report', desc: 'Count sessions and variances', icon: 'scale' },
  ];

  function mount(params) {
    const root = SP.el('div.stack.gap-3');
    root.appendChild(SP.ui2.pageHead({ title: 'Reports', sub: 'Filtered by date range and warehouse. Export as CSV or print to PDF.' }));

    const grid = SP.el('div.grid.grid--3.gap-3');
    for (const r of REPORTS) {
      grid.appendChild(SP.el('button.card.card--pad', { type: 'button', style: { textAlign: 'left' }, onclick: () => openReport(r) },
        SP.el('span.lrow__ico', { style: { marginBottom: 'var(--sp-2)' } }, SP.icon(r.icon)),
        SP.el('strong', { style: { display: 'block' } }, r.label),
        SP.el('small.mute', r.desc)));
    }
    root.appendChild(grid);
    if (params?.rpt) { const r = REPORTS.find((x) => x.id === params.rpt); if (r) setTimeout(() => openReport(r), 100); }
    return root;
  }

  /* ─────────────────────────────────────────── shared report shell */

  async function openReport(def) {
    const r = await SP.modal({
      title: def.label, icon: def.icon, okLabel: 'Generate',
      fields: [
        { key: 'from', label: 'From', type: 'date', value: isoDay(Date.now() - 30 * 864e5) },
        { key: 'to', label: 'To', type: 'date', value: isoDay(Date.now()) },
        { key: 'warehouseId', label: 'Warehouse', type: 'select', options: [{ value: '*', label: 'All warehouses' }, ...SP.store.state.warehouses.map((w) => ({ value: w.id, label: w.name }))] },
      ],
    });
    if (!r) return;
    const from = Date.parse(r.from); const to = Date.parse(r.to) + 864e5 - 1;
    const wh = r.warehouseId === '*' ? null : r.warehouseId;
    const { columns, rows, summary } = BUILDERS[def.id]({ from, to, wh });
    showReport(def, columns, rows, summary);
  }

  function showReport(def, columns, rows, summary) {
    const body = SP.el('div.stack.gap-3');
    if (summary) body.appendChild(SP.el('div.kpi-grid', ...summary.map((k) => SP.ui2.kpi(k))));
    const table = SP.table.create({
      columns: columns.map((c) => ({ key: c.key, label: c.label, align: c.align, width: c.width, value: (row) => row[c.key], render: c.render })),
      rows: () => rows, rowId: (row, i) => row.__id || JSON.stringify(row).slice(0, 40) + Math.random(),
      pageSize: 50,
      empty: { icon: 'file', title: 'No data in range', body: 'Try a wider date range.' },
    });
    body.appendChild(table.el);
    body.appendChild(SP.el('div.row.gap-2',
      SP.el('button.btn.btn--ghost', {
        type: 'button',
        onclick: () => {
          SP.impexp.downloadCSV(rows.map((row) => { const o = {}; for (const c of columns) o[c.key] = typeof c.csv === 'function' ? c.csv(row) : row[c.key]; return o; }),
            columns.map((c) => c.key), `stockpilot-${def.id}-${Date.now()}.csv`);
          SP.store.audit('report.export', def.id, `${rows.length} rows`);
        },
      }, SP.icon('download'), 'Export CSV'),
      SP.el('button.btn.btn--ghost', {
        type: 'button',
        onclick: () => SP.impexp.printDocument({
          title: def.label, subtitle: `Generated ${SP.fmt.dateTime(Date.now())}`,
          bodyHtml: SP.impexp.tableHtml(columns.map((c) => c.label), rows.map((row) => columns.map((c) => typeof c.csv === 'function' ? c.csv(row) : row[c.key]))),
        }),
      }, SP.icon('print'), 'Print / PDF'),
    ));
    SP.sheet({ title: def.label, content: body });
  }

  const isoDay = (ts) => new Date(ts).toISOString().slice(0, 10);
  const money = (v) => SP.fmt.money(v);
  const inRange = (ts, from, to) => ts >= from && ts <= to;

  /* ───────────────────────────────────────────── report builders */

  const BUILDERS = {
    daily_stock({ from, to, wh }) {
      const rows = SP.store.state.products.filter((p) => !p.archived).map((p) => {
        const moves = SP.store.state.movements.filter((m) => m.productId === p.id && (!wh || m.warehouseId === wh) && inRange(m.ts, from, to));
        const ins = SP.sum(moves.filter((m) => m.direction > 0), (m) => m.qty);
        const outs = SP.sum(moves.filter((m) => m.direction < 0), (m) => m.qty);
        return { __id: p.id, sku: p.sku, name: p.name, opening: SP.ledger.stockOf(p.id, wh) - ins + outs, in: ins, out: outs, closing: SP.ledger.stockOf(p.id, wh) };
      }).filter((r) => r.opening || r.in || r.out || r.closing);
      return {
        columns: [
          { key: 'sku', label: 'SKU', width: '110px' }, { key: 'name', label: 'Product' },
          { key: 'opening', label: 'Opening', align: 'right', width: '80px' },
          { key: 'in', label: 'In', align: 'right', width: '70px' },
          { key: 'out', label: 'Out', align: 'right', width: '70px' },
          { key: 'closing', label: 'Closing', align: 'right', width: '80px' },
        ],
        rows,
        summary: [
          { label: 'Units in', value: SP.fmt.n(SP.sum(rows, (r) => r.in)) },
          { label: 'Units out', value: SP.fmt.n(SP.sum(rows, (r) => r.out)) },
          { label: 'Closing units', value: SP.fmt.n(SP.sum(rows, (r) => r.closing)) },
        ],
      };
    },

    daily_sales({ from, to }) {
      const rows = SP.store.state.sales.filter((x) => !x.legacy && inRange(x.ts, from, to) && x.status !== 'cancelled')
        .map((x) => ({ __id: x.id, ref: x.ref, date: SP.fmt.date(x.ts), customer: x.customerName, total: x.total, paid: x.paid || 0, due: Math.max(0, x.total - (x.paid || 0)), by: x.salesperson }));
      return {
        columns: [
          { key: 'ref', label: 'Invoice', width: '100px' }, { key: 'date', label: 'Date', width: '100px' },
          { key: 'customer', label: 'Customer' }, { key: 'total', label: 'Total', align: 'right', width: '100px' },
          { key: 'paid', label: 'Paid', align: 'right', width: '100px' }, { key: 'due', label: 'Due', align: 'right', width: '100px' },
          { key: 'by', label: 'Salesperson', width: '120px' },
        ],
        rows,
        summary: [
          { label: 'Invoices', value: SP.fmt.n(rows.length) },
          { label: 'Revenue', value: money(SP.sum(rows, (r) => r.total)) },
          { label: 'Outstanding', value: money(SP.sum(rows, (r) => r.due)) },
        ],
      };
    },

    purchase({ from, to }) {
      const rows = SP.store.state.purchases.filter((x) => !x.legacy && inRange(x.createdAt, from, to))
        .map((x) => ({ __id: x.id, ref: x.ref, date: SP.fmt.date(x.createdAt), supplier: x.supplierName, units: SP.sum(x.items, (i) => i.qty), received: SP.sum(x.items, (i) => i.receivedQty || 0), total: x.total, status: SP.statusOf('po', x.status).label }));
      return {
        columns: [
          { key: 'ref', label: 'PO', width: '100px' }, { key: 'date', label: 'Date', width: '100px' },
          { key: 'supplier', label: 'Supplier' }, { key: 'units', label: 'Units', align: 'right', width: '70px' },
          { key: 'received', label: 'Received', align: 'right', width: '80px' },
          { key: 'total', label: 'Value', align: 'right', width: '100px' }, { key: 'status', label: 'Status', width: '110px' },
        ],
        rows,
        summary: [{ label: 'Orders', value: SP.fmt.n(rows.length) }, { label: 'Spend', value: money(SP.sum(rows, (r) => r.total)) }],
      };
    },

    transfer({ from, to }) {
      const rows = SP.store.state.transfers.filter((t) => !t.legacy && inRange(t.createdAt, from, to))
        .map((t) => ({ __id: t.id, ref: t.ref, date: SP.fmt.date(t.createdAt), from: t.from, to: t.to, units: SP.sum(t.items, (i) => i.qty), received: SP.sum(t.items, (i) => i.receivedQty || 0), status: SP.statusOf('transfer', t.status).label, by: t.requester }));
      return {
        columns: [
          { key: 'ref', label: 'Ref', width: '100px' }, { key: 'date', label: 'Date', width: '100px' },
          { key: 'from', label: 'From', width: '90px' }, { key: 'to', label: 'To', width: '90px' },
          { key: 'units', label: 'Sent', align: 'right', width: '70px' }, { key: 'received', label: 'Received', align: 'right', width: '80px' },
          { key: 'status', label: 'Status', width: '110px' }, { key: 'by', label: 'By', width: '110px' },
        ],
        rows,
        summary: [{ label: 'Transfers', value: SP.fmt.n(rows.length) }, { label: 'Units moved', value: SP.fmt.n(SP.sum(rows, (r) => r.received)) }],
      };
    },

    warehouse({ wh }) {
      const rows = SP.store.state.warehouses.filter((w) => !wh || w.id === wh).map((w) => {
        const sum = SP.ledger.summary({ warehouse: w.id });
        return { __id: w.id, name: w.name, units: sum.gross, value: sum.value, out: sum.critical, low: sum.refill, inTransit: sum.inTransit };
      });
      return {
        columns: [
          { key: 'name', label: 'Warehouse' }, { key: 'units', label: 'Units', align: 'right', width: '90px' },
          { key: 'value', label: 'Value', align: 'right', width: '120px', csv: (r) => r.value, render: (r) => money(r.value) },
          { key: 'out', label: 'Out', align: 'right', width: '70px' }, { key: 'low', label: 'Low', align: 'right', width: '70px' },
          { key: 'inTransit', label: 'In transit', align: 'right', width: '90px' },
        ],
        rows,
      };
    },

    product() {
      const rows = SP.store.state.products.filter((p) => !p.archived).map((p) => ({
        __id: p.id, sku: p.sku, name: p.name, brand: p.brand, spec: [p.ram && `${p.ram}GB`, p.storage && `${p.storage}GB`, p.color].filter(Boolean).join(' · '),
        stock: SP.ledger.stockOf(p.id), cost: p.cost, price: p.price,
      }));
      return {
        columns: [
          { key: 'sku', label: 'SKU', width: '110px' }, { key: 'name', label: 'Product' }, { key: 'brand', label: 'Brand', width: '90px' },
          { key: 'spec', label: 'Spec', width: '150px' }, { key: 'stock', label: 'Stock', align: 'right', width: '80px' },
          { key: 'cost', label: 'Cost', align: 'right', width: '100px' }, { key: 'price', label: 'Price', align: 'right', width: '100px' },
        ],
        rows,
      };
    },

    imei() {
      const s = SP.store.state;
      const rows = s.devices.map((d) => ({
        __id: d.id, imei1: d.imei1, imei2: d.imei2 || '', serial: d.serial || '',
        product: s.products.find((x) => x.id === d.productId)?.name || '',
        warehouse: s.warehouses.find((x) => x.id === d.warehouseId)?.name || '',
        status: SP.deviceStatus(d.status).label, received: SP.fmt.date(d.receivedAt),
      }));
      return {
        columns: [
          { key: 'imei1', label: 'IMEI 1', width: '150px' }, { key: 'imei2', label: 'IMEI 2', width: '150px' },
          { key: 'serial', label: 'Serial', width: '110px' }, { key: 'product', label: 'Product' },
          { key: 'warehouse', label: 'Warehouse', width: '110px' }, { key: 'status', label: 'Status', width: '100px' },
          { key: 'received', label: 'Received', width: '100px' },
        ],
        rows,
      };
    },

    ageing() {
      const { perProduct } = SP.ledger.ageing();
      const rows = Object.entries(perProduct).map(([pid, b]) => {
        const p = SP.store.state.products.find((x) => x.id === pid);
        return { __id: pid, name: p?.name || pid, d30: b.d30, d60: b.d60, d90: b.d90, d180: b.d180, d180p: b.d180p, total: b.total };
      });
      return {
        columns: [
          { key: 'name', label: 'Product' },
          { key: 'd30', label: '0–30d', align: 'right', width: '70px' }, { key: 'd60', label: '31–60d', align: 'right', width: '70px' },
          { key: 'd90', label: '61–90d', align: 'right', width: '70px' }, { key: 'd180', label: '91–180d', align: 'right', width: '80px' },
          { key: 'd180p', label: '180d+', align: 'right', width: '70px' }, { key: 'total', label: 'Total', align: 'right', width: '80px' },
        ],
        rows,
      };
    },

    dead_stock() {
      const horizon = SP.store.state.rules.deadStockDays || 60;
      const cutoff = Date.now() - horizon * 864e5;
      const rows = SP.store.state.products.filter((p) => !p.archived).map((p) => {
        const qty = SP.ledger.stockOf(p.id);
        const last = SP.ledger.lastActivityAt(p.id);
        return { __id: p.id, name: p.name, qty, last: last ? SP.fmt.date(last) : 'never', idleDays: last ? Math.floor((Date.now() - last) / 864e5) : '∞', value: qty * (p.cost || 0) };
      }).filter((r) => r.qty > 0 && (r.idleDays === '∞' || r.idleDays >= horizon));
      return {
        columns: [
          { key: 'name', label: 'Product' }, { key: 'qty', label: 'Units', align: 'right', width: '80px' },
          { key: 'idleDays', label: 'Idle days', align: 'right', width: '90px' }, { key: 'last', label: 'Last movement', width: '110px' },
          { key: 'value', label: 'Tied-up value', align: 'right', width: '120px', render: (r) => money(r.value) },
        ],
        rows,
        summary: [{ label: 'Idle products', value: SP.fmt.n(rows.length) }, { label: 'Capital idle', value: money(SP.sum(rows, (r) => r.value)) }],
      };
    },

    valuation({ wh }) {
      const v = SP.ledger.valuation(wh);
      const rows = v.rows.map((r) => ({ __id: r.product.id, name: r.product.name, qty: r.qty, cost: r.cost, value: r.value, retail: r.retail }));
      return {
        columns: [
          { key: 'name', label: 'Product' }, { key: 'qty', label: 'Units', align: 'right', width: '80px' },
          { key: 'cost', label: 'Unit cost', align: 'right', width: '100px' }, { key: 'value', label: 'Cost value', align: 'right', width: '110px', render: (r) => money(r.value) },
          { key: 'retail', label: 'Retail value', align: 'right', width: '110px', render: (r) => money(r.retail) },
        ],
        rows,
        summary: [
          { label: 'Units', value: SP.fmt.n(v.units) },
          { label: 'Cost value', value: money(v.value) },
          { label: 'Retail value', value: money(v.retail) },
        ],
      };
    },

    margin({ from, to }) {
      const s = SP.store.state;
      const rows = s.sales.filter((x) => !x.legacy && inRange(x.ts, from, to) && x.status !== 'cancelled').map((x) => {
        let cogs = 0;
        for (const i of x.items) {
          const p = s.products.find((y) => y.id === i.productId);
          cogs += (p?.cost || 0) * i.qty;
        }
        const margin = x.total - cogs;
        return { __id: x.id, ref: x.ref, date: SP.fmt.date(x.ts), customer: x.customerName, revenue: x.total, cogs, margin, pct: x.total ? Math.round(margin / x.total * 100) : 0 };
      });
      return {
        columns: [
          { key: 'ref', label: 'Invoice', width: '100px' }, { key: 'date', label: 'Date', width: '100px' },
          { key: 'customer', label: 'Customer' }, { key: 'revenue', label: 'Revenue', align: 'right', width: '100px', render: (r) => money(r.revenue) },
          { key: 'cogs', label: 'COGS', align: 'right', width: '100px', render: (r) => money(r.cogs) },
          { key: 'margin', label: 'Margin', align: 'right', width: '100px', render: (r) => money(r.margin) },
          { key: 'pct', label: '%', align: 'right', width: '60px' },
        ],
        rows,
        summary: [
          { label: 'Revenue', value: money(SP.sum(rows, (r) => r.revenue)) },
          { label: 'Margin', value: money(SP.sum(rows, (r) => r.margin)) },
        ],
      };
    },

    customer_due() {
      const rows = SP.store.state.customers.map((c) => ({
        __id: c.id, name: c.name, phone: c.phone || '',
        due: SP.sum(SP.store.state.sales.filter((x) => !x.legacy && x.customerId === c.id && x.status !== 'cancelled'), (x) => Math.max(0, x.total - (x.paid || 0))),
      })).filter((r) => r.due > 0).sort((a, b) => b.due - a.due);
      return {
        columns: [{ key: 'name', label: 'Customer' }, { key: 'phone', label: 'Phone', width: '130px' }, { key: 'due', label: 'Due', align: 'right', width: '120px', render: (r) => money(r.due) }],
        rows,
        summary: [{ label: 'Total receivable', value: money(SP.sum(rows, (r) => r.due)) }],
      };
    },

    supplier_due() {
      const rows = SP.store.state.suppliers.map((c) => ({
        __id: c.id, name: c.name, phone: c.phone || '',
        due: SP.sum(SP.store.state.purchases.filter((x) => !x.legacy && x.supplierId === c.id && x.status !== 'cancelled'), (x) => Math.max(0, x.total - (x.paid || 0))),
      })).filter((r) => r.due > 0).sort((a, b) => b.due - a.due);
      return {
        columns: [{ key: 'name', label: 'Supplier' }, { key: 'phone', label: 'Phone', width: '130px' }, { key: 'due', label: 'Payable', align: 'right', width: '120px', render: (r) => money(r.due) }],
        rows,
        summary: [{ label: 'Total payable', value: money(SP.sum(rows, (r) => r.due)) }],
      };
    },

    adjustment({ from, to }) {
      const s = SP.store.state;
      const rows = s.movements.filter((m) => ['adjust_in', 'adjust_out'].includes(m.type) && inRange(m.ts, from, to))
        .map((m) => ({
          __id: m.id, date: SP.fmt.dateTime(m.ts), ref: m.ref,
          product: s.products.find((x) => x.id === m.productId)?.name || '',
          qty: `${m.direction > 0 ? '+' : '−'}${m.qty}`, warehouse: m.warehouseId,
          reason: m.reason || '', by: m.by, approved: m.approvalId ? 'Yes' : '—',
        }));
      return {
        columns: [
          { key: 'date', label: 'When', width: '140px' }, { key: 'ref', label: 'Ref', width: '110px' },
          { key: 'product', label: 'Product' }, { key: 'qty', label: 'Qty', align: 'right', width: '70px' },
          { key: 'warehouse', label: 'WH', width: '80px' }, { key: 'reason', label: 'Reason' },
          { key: 'by', label: 'By', width: '110px' }, { key: 'approved', label: 'Approved', width: '80px' },
        ],
        rows,
      };
    },

    audit({ from, to }) {
      const rows = SP.store.state.audit.filter((a) => inRange(a.at, from, to))
        .map((a) => ({ __id: a.id, at: SP.fmt.dateTime(a.at), by: a.by, action: a.action, target: a.target, detail: a.detail }));
      return {
        columns: [
          { key: 'at', label: 'When', width: '140px' }, { key: 'by', label: 'Who', width: '120px' },
          { key: 'action', label: 'Action', width: '160px' }, { key: 'target', label: 'Target', width: '130px' },
          { key: 'detail', label: 'Detail' },
        ],
        rows,
      };
    },

    verification() {
      const rows = SP.store.state.counts.map((c) => ({
        __id: c.id, ref: c.ref, date: SP.fmt.date(c.createdAt),
        warehouse: SP.store.state.warehouses.find((w) => w.id === c.warehouseId)?.name || '',
        lines: c.lines.length,
        variances: c.lines.filter((l) => (l.physical ?? l.expected) !== l.expected).length,
        status: SP.statusOf('count', c.status).label, by: c.createdBy,
      }));
      return {
        columns: [
          { key: 'ref', label: 'Ref', width: '100px' }, { key: 'date', label: 'Date', width: '100px' },
          { key: 'warehouse', label: 'Warehouse' }, { key: 'lines', label: 'Lines', align: 'right', width: '70px' },
          { key: 'variances', label: 'Variances', align: 'right', width: '90px' },
          { key: 'status', label: 'Status', width: '100px' }, { key: 'by', label: 'By', width: '110px' },
        ],
        rows,
      };
    },
  };

  return MOD;
})();
