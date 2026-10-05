/**
 * modules/movements.js — the stock movement ledger browser plus the
 * Receive / Adjust posting forms. Every quantity change in StockPilot
 * flows through here (or through transfers/sales/purchases, which post
 * into the same ledger).
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.movements = (() => {
  const state = { q: '', type: 'all', warehouse: '*', productId: null };

  const MOD = { title: 'Stock Movements', subtitle: () => `${SP.fmt.pluralise(SP.store.state.movements.length, 'ledger entries')}`, mount, receiveForm, adjustForm };

  function rows() {
    const s = SP.store.state;
    let list = [...s.movements].sort((a, b) => b.ts - a.ts);
    if (state.productId) list = list.filter((m) => m.productId === state.productId);
    if (state.type !== 'all') list = list.filter((m) => m.type === state.type);
    if (state.warehouse !== '*') list = list.filter((m) => m.warehouseId === state.warehouse);
    if (state.q) {
      list = list.filter((m) => {
        const p = s.products.find((x) => x.id === m.productId);
        return `${m.ref} ${p?.name} ${p?.sku} ${m.by} ${m.reason} ${m.refId}`.toLowerCase().includes(state.q);
      });
    }
    return list;
  }

  function mount(params) {
    if (params?.q) state.q = params.q.toLowerCase();
    if (params?.productId) state.productId = params.productId;
    const root = SP.el('div.stack.gap-3');

    const table = SP.table.create({
      columns: [
        { key: 'ts', label: 'When', width: '130px', value: (m) => m.ts, render: (m) => SP.el('span.tiny', SP.fmt.dateTime(m.ts)) },
        { key: 'ref', label: 'Ref', width: '110px', value: (m) => m.ref, render: (m) => SP.el('span.tiny.mute', m.ref) },
        { key: 'type', label: 'Type', width: '130px', value: (m) => m.type, render: (m) => SP.ui2.tag(SP.movementType(m.type).label, SP.movementType(m.type).tone) },
        { key: 'product', label: 'Product', value: (m) => productOf(m)?.name || '', render: (m) => SP.el('span', productOf(m)?.name || '—') },
        { key: 'warehouse', label: 'Warehouse', width: '110px', value: (m) => m.warehouseId },
        { key: 'qty', label: 'Qty', width: '80px', align: 'right', value: (m) => m.direction * m.qty, render: (m) => SP.el('strong', { style: { color: m.direction > 0 ? 'var(--ok)' : m.direction < 0 ? 'var(--danger)' : undefined } }, `${m.direction > 0 ? '+' : m.direction < 0 ? '−' : ''}${SP.fmt.n(m.qty)}`) },
        { key: 'after', label: 'Balance', width: '80px', align: 'right', value: (m) => m.after, render: (m) => SP.fmt.n(m.after) },
        { key: 'by', label: 'By', width: '110px', value: (m) => m.by },
      ],
      rows,
      rowId: (m) => m.id,
      defaultSort: 'ts', defaultDir: 'desc',
      pageSize: 50,
      empty: { icon: 'history', title: 'No movements', body: 'The ledger is empty — receive stock to begin.' },
      onRowClick: (m) => movementSheet(m),
    });

    const filters = SP.ui2.filterBar({
      placeholder: 'Search ref, product, user, reason…',
      onChange: (f) => { state.q = f.q; table.refresh(); },
    });

    const scopeRow = SP.el('div.row.gap-2', { style: { flexWrap: 'wrap', alignItems: 'center' } },
      SP.ui2.warehouseSelect({ value: state.warehouse, onChange: (v) => { state.warehouse = v; table.refresh(); } }),
      SP.el('select.select', { onchange: (e) => { state.type = e.target.value; table.refresh(); } },
        SP.el('option', { value: 'all' }, 'All types'),
        ...SP.MOVEMENT_TYPES.map((t) => SP.el('option', { value: t.id, selected: state.type === t.id }, t.label))),
      state.productId ? SP.el('button.chip.is-active', { type: 'button', onclick: () => { state.productId = null; table.refresh(); } }, 'Product filter ×') : null,
      SP.el('span.grow'),
      SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => exportLedger(rows()) }, SP.icon('download'), 'Export'),
    );

    const actions = [];
    if (SP.auth.can('movements:create')) actions.push(SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => receiveForm() }, SP.icon('download'), 'Receive'));
    if (SP.auth.can('movements:create')) actions.push(SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => issueForm() }, SP.icon('upload'), 'Issue'));
    if (SP.auth.can('movements:adjust')) actions.push(SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => adjustForm() }, SP.icon('edit'), 'Adjust'));

    root.append(
      SP.ui2.pageHead({ title: 'Stock Movements', sub: 'The immutable ledger behind every quantity.', actions }),
      filters.el, scopeRow, table.el,
    );
    return root;
  }

  const productOf = (m) => SP.store.state.products.find((x) => x.id === m.productId);

  function movementSheet(m) {
    const p = productOf(m);
    const w = SP.store.state.warehouses.find((x) => x.id === m.warehouseId);
    const approval = m.approvalId ? SP.store.state.approvals.find((a) => a.id === m.approvalId) : null;
    SP.sheet({
      title: `${SP.movementType(m.type).label} · ${m.ref}`,
      subtitle: p?.name,
      content: SP.el('dl.kv',
        SP.el('dt', 'When'), SP.el('dd', SP.fmt.dateTime(m.ts)),
        SP.el('dt', 'Product'), SP.el('dd', p?.name || '—'),
        SP.el('dt', 'Quantity'), SP.el('dd', `${m.direction > 0 ? '+' : m.direction < 0 ? '−' : ''}${SP.fmt.n(m.qty)}`),
        SP.el('dt', 'Balance'), SP.el('dd', `${m.before} → ${m.after}`),
        SP.el('dt', 'Warehouse'), SP.el('dd', w?.name || m.warehouseId),
        SP.el('dt', 'Location'), SP.el('dd', SP.store.state.locations.find((l) => l.id === m.locationId)?.code || '—'),
        SP.el('dt', 'Devices'), SP.el('dd', m.deviceIds?.length ? `${m.deviceIds.length} device(s)` : '—'),
        SP.el('dt', 'Unit cost'), SP.el('dd', m.unitCost != null ? SP.fmt.money(m.unitCost) : '—'),
        SP.el('dt', 'Reference'), SP.el('dd', m.refType ? `${m.refType}${m.refId ? ` · ${docRef(m)}` : ''}` : '—'),
        SP.el('dt', 'Reason'), SP.el('dd', m.reason || '—'),
        SP.el('dt', 'Notes'), SP.el('dd', m.notes || '—'),
        SP.el('dt', 'Recorded by'), SP.el('dd', m.by),
        approval ? [SP.el('dt', 'Approval'), SP.el('dd', `${approval.status} by ${approval.decidedBy || '—'}`)] : null,
        m.negativeOverride ? [SP.el('dt', 'Override'), SP.el('dd', 'Negative stock override — audited')] : null),
    });
  }

  function docRef(m) {
    const s = SP.store.state;
    const doc = m.refType === 'transfer' ? s.transfers.find((t) => t.id === m.refId)
      : m.refType === 'sale' ? s.sales.find((x) => x.id === m.refId)
        : m.refType === 'purchase' ? s.purchases.find((x) => x.id === m.refId)
          : m.refType === 'count' ? s.counts.find((x) => x.id === m.refId) : null;
    return doc?.ref || m.refId || '—';
  }

  /* ═══════════════════════════════════════════════════════════ FORMS */

  /** Goods receive (ad-hoc, without a PO). */
  async function receiveForm(preset = {}) {
    const product = preset.productId
      ? SP.store.state.products.find((x) => x.id === preset.productId)
      : await SP.ui2.pickProduct({ title: 'Receive stock — which product?' });
    if (!product) return;

    const res = await SP.modal({
      title: `Receive — ${product.name}`,
      icon: 'download', okLabel: 'Post to ledger',
      fields: [
        { key: 'warehouseId', label: 'Warehouse', type: 'select', required: true, value: preset.warehouseId || defaultWh(), options: whOptions() },
        { key: 'locationId', label: 'Location (optional)', type: 'select', options: locOptions() },
        { key: 'qty', label: 'Quantity', type: 'number', min: 1, required: true, value: preset.qty || 1 },
        { key: 'unitCost', label: 'Unit cost (৳)', type: 'number', min: 0, value: product.cost },
        { key: 'reason', label: 'Reason / reference', placeholder: 'e.g. Supplier delivery, GRN-123' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onOk: async (v) => {
        let deviceIds = [];
        if (product.serialized) {
          const want = await registerInline(product, v);
          if (want === null) return false; // aborted
          deviceIds = want;
          if (deviceIds.length && deviceIds.length !== v.qty) {
            throw new Error(`${v.qty} units declared but ${deviceIds.length} devices registered. Receive them as separate movements.`);
          }
        }
        SP.ledger.post({
          type: 'receive', productId: product.id, qty: v.qty,
          warehouseId: v.warehouseId, locationId: v.locationId || null,
          deviceIds, unitCost: v.unitCost,
          refType: 'manual', reason: v.reason || 'Goods received', notes: v.notes,
        });
        if (v.unitCost > 0 && v.unitCost !== product.cost) {
          SP.store.update(['products'], (s) => { const t = s.products.find((x) => x.id === product.id); if (t) { t.cost = v.unitCost; t.updatedAt = Date.now(); } });
        }
        SP.ui.toast({ tone: 'ok', title: `Received ${v.qty} × ${product.sku}`, body: 'Ledger updated.' });
        SP.router.refresh();
      },
    });
    return res;
  }

  /** Offer to register IMEIs for the units being received. */
  async function registerInline(product, v) {
    const choice = await SP.modal({
      title: 'Register devices for these units?',
      body: `${product.name} is IMEI-tracked. Register the ${v.qty} device${v.qty === 1 ? '' : 's'} now (one per line: IMEI1, optional IMEI2, optional serial — comma separated)?`,
      okLabel: 'Register now', cancelLabel: 'Skip for now', icon: 'layers',
      fields: [{ key: 'lines', label: 'Devices', type: 'textarea', placeholder: '868123456789012, 868123456789013, SN001\n868123456789014,,SN002' }],
    });
    if (choice === false) return []; // skipped
    if (!choice) return null; // dismissed entirely
    const devices = [];
    const lines = String(choice.lines || '').split('\n').map((l) => l.trim()).filter(Boolean);
    for (const [i, line] of lines.entries()) {
      const [i1, i2, sn] = line.split(',').map((x) => (x || '').trim());
      const c1 = SP.imei.clean(i1);
      if (!c1) continue;
      if (c1.length !== 15 || !SP.imei.valid(c1)) throw new Error(`Line ${i + 1}: IMEI ${c1} is invalid (15 digits, Luhn).`);
      if (SP.imei.find(c1).length) throw new Error(`Line ${i + 1}: IMEI ${c1} is already registered.`);
      devices.push({
        id: SP.uid('dev'), imei1: c1, imei2: SP.imei.clean(i2), serial: sn || '',
        productId: product.id, warehouseId: v.warehouseId, locationId: v.locationId || null,
        status: 'available', condition: 'new', cost: v.unitCost || product.cost || 0,
        purchaseRef: null, saleRef: null, receivedAt: Date.now(), updatedAt: Date.now(), notes: '',
      });
    }
    if (devices.length) {
      SP.store.update(['devices'], (s) => { s.devices.push(...devices); });
      SP.store.audit('device.register', `${devices.length} devices`, product.name);
    }
    return devices.map((d) => d.id);
  }

  /** Issue stock out (damage / write-off / manual out). */
  async function issueForm(preset = {}) {
    const product = preset.productId
      ? SP.store.state.products.find((x) => x.id === preset.productId)
      : await SP.ui2.pickProduct({ title: 'Issue stock — which product?', onlyInStock: true });
    if (!product) return;

    const res = await SP.modal({
      title: `Issue — ${product.name}`,
      icon: 'upload', okLabel: 'Post to ledger', tone: 'danger',
      fields: [
        { key: 'type', label: 'Issue type', type: 'select', required: true, options: [
          { value: 'damage', label: 'Damage' },
          { value: 'write_off', label: 'Write-off' },
          { value: 'repair_out', label: 'Send to repair' },
        ] },
        { key: 'warehouseId', label: 'Warehouse', type: 'select', required: true, value: preset.warehouseId || defaultWh(), options: whOptions() },
        { key: 'qty', label: 'Quantity', type: 'number', min: 1, required: true, value: 1 },
        { key: 'reason', label: 'Reason', required: true, placeholder: 'Why is this stock leaving?' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onOk: async (v) => {
        const exec = (approval) => {
          let deviceIds = [];
          return SP.ledger.post({
            type: v.type, productId: product.id, qty: v.qty, warehouseId: v.warehouseId,
            deviceIds, reason: v.reason, notes: v.notes, refType: 'manual',
            approvalId: approval?.id || null,
          });
        };
        const outcome = SP.approvals.guard('write_off', { qty: v.qty }, {
          title: `${SP.movementType(v.type).label}: ${v.qty} × ${product.name}`,
          detail: v.reason,
          refType: 'movement',
          resumeKey: 'issue', resumeData: { productId: product.id, ...v },
        }, exec);
        if (outcome.status === 'pending') SP.ui.toast({ tone: 'info', title: 'Sent for approval', body: 'A manager must approve this before stock changes.' });
        else { SP.ui.toast({ tone: 'ok', title: 'Ledger updated' }); SP.router.refresh(); }
      },
    });
    return res;
  }

  /** Stock adjustment with approval guard. */
  async function adjustForm(preset = {}) {
    const product = preset.productId
      ? SP.store.state.products.find((x) => x.id === preset.productId)
      : await SP.ui2.pickProduct({ title: 'Adjust stock — which product?' });
    if (!product) return;

    const res = await SP.modal({
      title: `Adjust — ${product.name}`,
      icon: 'edit', okLabel: 'Submit adjustment',
      fields: [
        { key: 'warehouseId', label: 'Warehouse', type: 'select', required: true, value: preset.warehouseId || defaultWh(), options: whOptions() },
        { key: 'direction', label: 'Direction', type: 'select', required: true, options: [{ value: 'adjust_in', label: 'Increase stock' }, { value: 'adjust_out', label: 'Decrease stock' }] },
        { key: 'qty', label: 'Quantity', type: 'number', min: 1, required: true, value: 1 },
        { key: 'reason', label: 'Reason', required: true, placeholder: 'e.g. Physical verification, found in back room' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onOk: async (v) => {
        const current = SP.ledger.stockOf(product.id, v.warehouseId);
        const exec = (approval) => SP.ledger.post({
          type: v.direction, productId: product.id, qty: v.qty, warehouseId: v.warehouseId,
          reason: v.reason, notes: v.notes, refType: 'manual',
          approvalId: approval?.id || null,
        });
        const outcome = SP.approvals.guard('adjustment', { qty: v.qty, before: current }, {
          title: `Adjust ${product.name} ${v.direction === 'adjust_in' ? '+' : '−'}${v.qty}`,
          detail: `${v.reason} · current stock at ${v.warehouseId}: ${current}`,
          refType: 'movement',
          resumeKey: 'adjust', resumeData: { productId: product.id, ...v },
        }, exec);
        if (outcome.status === 'pending') SP.ui.toast({ tone: 'info', title: 'Sent for approval', body: `Current: ${current}. Stock changes after approval.` });
        else { SP.ui.toast({ tone: 'ok', title: `Adjusted: ${current} → ${SP.ledger.stockOf(product.id, v.warehouseId)}` }); SP.router.refresh(); }
      },
    });
    return res;
  }

  /* resume handlers so approved actions still execute after reload */
  SP.approvals.registerResume('adjust', (d, approval) => {
    SP.ledger.post({
      type: d.direction, productId: d.productId, qty: d.qty, warehouseId: d.warehouseId,
      reason: d.reason, notes: d.notes, refType: 'approval', refId: approval.id, approvalId: approval.id,
    });
    SP.store.notify({ tone: 'ok', kind: 'approval', title: 'Adjustment posted', body: `Approved adjustment is now in the ledger.` });
  });
  SP.approvals.registerResume('issue', (d, approval) => {
    SP.ledger.post({
      type: d.type, productId: d.productId, qty: d.qty, warehouseId: d.warehouseId,
      reason: d.reason, notes: d.notes, refType: 'approval', refId: approval.id, approvalId: approval.id,
    });
    SP.store.notify({ tone: 'ok', kind: 'approval', title: 'Issue posted', body: 'Approved write-off/damage is now in the ledger.' });
  });

  /* ──────────────────────────────────────────────────────── helpers */

  const defaultWh = () => {
    const scoped = SP.auth.scopeOf();
    return scoped[0] || SP.store.state.warehouses[0]?.id;
  };
  const whOptions = () => SP.store.state.warehouses
    .filter((w) => w.active && SP.auth.inScope(w.id))
    .map((w) => ({ value: w.id, label: w.name }));
  const locOptions = () => [{ value: '', label: '—' },
    ...SP.store.state.locations.map((l) => ({ value: l.id, label: l.code }))];

  function exportLedger(list) {
    SP.impexp.downloadCSV(list.map((m) => ({
      ref: m.ref, date: new Date(m.ts).toISOString(), type: m.type,
      product: productOf(m)?.name || '', sku: productOf(m)?.sku || '',
      qty: m.direction * m.qty, warehouse: m.warehouseId, before: m.before, after: m.after,
      unit_cost: m.unitCost, ref_type: m.refType, ref_id: m.refId,
      reason: m.reason, notes: m.notes, by: m.by,
    })), ['ref', 'date', 'type', 'product', 'sku', 'qty', 'warehouse', 'before', 'after', 'unit_cost', 'ref_type', 'ref_id', 'reason', 'notes', 'by'],
      `stockpilot-movements-${Date.now()}.csv`);
    SP.store.audit('movements.export', `${list.length} rows`, '');
  }

  return MOD;
})();
