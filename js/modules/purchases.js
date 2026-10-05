/**
 * modules/purchases.js — supplier purchase orders with goods receiving.
 * draft → pending → approved → ordered → (partial →) received.
 * Receiving posts `receive` movements into the ledger.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.purchases = (() => {
  const state = { q: '', status: 'all' };

  const MOD = { title: 'Purchases', subtitle: () => `${SP.fmt.pluralise(SP.store.state.purchases.filter((x) => !x.legacy).length, 'purchase order')}`, mount, openForm, openPO };

  function rows() {
    let list = SP.store.state.purchases.filter((x) => !x.legacy).sort((a, b) => b.createdAt - a.createdAt);
    if (state.status !== 'all') list = list.filter((x) => x.status === state.status);
    if (state.q) list = list.filter((x) => `${x.ref} ${x.supplierName}`.toLowerCase().includes(state.q));
    return list;
  }

  function mount(params) {
    if (params?.compose === 'receive') setTimeout(() => quickReceive(), 100);
    if (params?.compose === 'new') setTimeout(() => openForm(), 100);
    if (params?.id) setTimeout(() => openPO(params.id), 100);
    const root = SP.el('div.stack.gap-3');

    const table = SP.table.create({
      columns: [
        { key: 'ref', label: 'Ref', width: '110px', value: (x) => x.ref, render: (x) => SP.el('strong', x.ref) },
        { key: 'createdAt', label: 'Created', width: '110px', value: (x) => x.createdAt, render: (x) => SP.el('span.tiny', SP.fmt.date(x.createdAt)) },
        { key: 'supplierName', label: 'Supplier', value: (x) => x.supplierName || '' },
        { key: 'units', label: 'Units', width: '80px', align: 'right', value: (x) => SP.sum(x.items, (i) => i.qty), render: (x) => SP.fmt.n(SP.sum(x.items, (i) => i.qty)) },
        { key: 'total', label: 'Value', width: '110px', align: 'right', value: (x) => x.total, render: (x) => SP.fmt.money(x.total) },
        { key: 'status', label: 'Status', width: '140px', value: (x) => x.status, render: (x) => SP.ui2.badge('po', x.status, { sm: true }) },
      ],
      rows,
      rowId: (x) => x.id,
      defaultSort: 'createdAt', defaultDir: 'desc',
      empty: { icon: 'cart', title: 'No purchase orders', body: 'Create a PO, then receive goods against it.' },
      onRowClick: (x) => openPO(x.id),
    });

    const filters = SP.ui2.filterBar({ placeholder: 'Search PO, supplier…', onChange: (f) => { state.q = f.q; table.refresh(); } });
    const chips = SP.chipRow(
      [{ value: 'all', label: 'All' }, ...SP.STATUS.po.map((s) => ({ value: s.id, label: s.label }))],
      state.status, (v) => { state.status = v; table.refresh(); });

    const actions = [];
    if (SP.auth.can('purchases:create')) actions.push(SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => openForm() }, SP.icon('plus'), 'New PO'));
    if (SP.auth.can('purchases:receive')) actions.push(SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => quickReceive() }, SP.icon('download'), 'Quick receive'));

    root.append(
      SP.ui2.pageHead({ title: 'Purchases', sub: 'POs, expected arrivals, goods receiving and supplier payments.', actions }),
      filters.el, chips, table.el,
    );
    return root;
  }

  /* ══════════════════════════════════════════════════════════ CREATE */

  async function openForm(preset = {}) {
    const s = SP.store.state;
    const items = [...(preset.items || [])];
    const itemsHost = SP.el('div.stack.gap-1');
    const totalNode = SP.el('b');

    const draw = () => {
      SP.clear(itemsHost);
      items.forEach((it, idx) => {
        const p = s.products.find((x) => x.id === it.productId);
        itemsHost.appendChild(SP.el('div.sale-line',
          SP.el('div.grow',
            SP.el('strong', p?.name || it.productId),
            SP.el('div.row.gap-2', { style: { marginTop: '4px' } },
              SP.el('label.tiny', 'Qty ', SP.el('input.input.input--num', { type: 'number', min: 1, value: it.qty, style: { width: '70px' }, onchange: (e) => { it.qty = Math.max(1, Number(e.target.value) || 1); drawTotal(); } })),
              SP.el('label.tiny', 'Cost ', SP.el('input.input.input--num', { type: 'number', min: 0, value: it.cost ?? p?.cost ?? 0, style: { width: '100px' }, onchange: (e) => { it.cost = Math.max(0, Number(e.target.value) || 0); drawTotal(); } })))),
          SP.el('button.btn.btn--icon.btn--sm.btn--quiet', { type: 'button', 'aria-label': 'Remove', onclick: () => { items.splice(idx, 1); draw(); drawTotal(); } }, SP.icon('x'))));
      });
      itemsHost.appendChild(SP.el('button.btn.btn--ghost.btn--sm.btn--block', {
        type: 'button',
        onclick: async () => {
          const p = await SP.ui2.pickProduct({ title: 'Add product to PO' });
          if (!p) return;
          const ex = items.find((i) => i.productId === p.id);
          if (ex) ex.qty += 1; else items.push({ productId: p.id, qty: 1, cost: p.cost || 0 });
          draw(); drawTotal();
        },
      }, SP.icon('plus'), 'Add product'));
    };
    const drawTotal = () => { totalNode.textContent = SP.fmt.money(SP.sum(items, (i) => i.qty * (i.cost || 0))); };
    draw(); drawTotal();

    const res = await SP.modal({
      title: 'New purchase order', icon: 'cart', okLabel: 'Create PO',
      draftId: 'po-new',
      body: SP.el('div.stack.gap-2', SP.el('strong', { class: 'tiny mute' }, 'LINES'), itemsHost,
        SP.el('div.row', { style: { justifyContent: 'flex-end', gap: '6px' } }, SP.el('span.tiny.mute', 'Total'), totalNode)),
      fields: [
        { key: 'supplierId', label: 'Supplier', type: 'select', options: [{ value: '', label: '— choose —' }, ...s.suppliers.map((sp) => ({ value: sp.id, label: sp.name }))] },
        { key: 'warehouseId', label: 'Deliver to', type: 'select', required: true, options: s.warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: w.name })) },
        { key: 'expectedAt', label: 'Expected arrival', type: 'date' },
        { key: 'submit', label: 'Submit for approval immediately', type: 'checkbox', checkboxLabel: 'Send to approvers now (skip draft)', value: true },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onOk: async (v) => {
        if (!items.length) throw new Error('Add at least one product line.');
        const supplier = s.suppliers.find((x) => x.id === v.supplierId);
        const po = {
          id: SP.uid('pur'), ref: SP.store.nextRef('purchase'),
          supplierId: supplier?.id || null, supplierName: supplier?.name || 'Unspecified supplier',
          warehouseId: v.warehouseId,
          items: items.map((i) => ({ ...i, receivedQty: 0 })),
          status: v.submit ? 'pending' : 'draft',
          total: SP.sum(items, (i) => i.qty * (i.cost || 0)),
          paid: 0,
          expectedAt: v.expectedAt ? Date.parse(v.expectedAt) : null,
          notes: v.notes || '',
          history: [{ at: Date.now(), by: SP.auth.current()?.name || 'system', action: v.submit ? 'submitted' : 'drafted', note: '' }],
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        SP.store.update(['purchases'], (st) => { st.purchases.unshift(po); });
        SP.store.audit('purchase.create', po.ref, `${po.supplierName} · ${SP.fmt.money(po.total)}`);
        if (v.submit) {
          SP.approvals.guard('purchase', { value: po.total }, {
            title: `Purchase ${po.ref}: ${SP.fmt.money(po.total)}`,
            detail: `${po.supplierName} · ${SP.sum(items, (i) => i.qty)} units`,
            refType: 'purchase', refId: po.id,
            resumeKey: 'po_approve', resumeData: { poId: po.id },
          }, () => transition(po, 'approved', 'Auto-approved'));
        }
        SP.ui.toast({ tone: 'ok', title: `PO ${po.ref} created` });
        SP.router.refresh();
        openPO(po.id);
      },
    });
    return res;
  }

  function transition(po, status, note) {
    SP.store.update(['purchases'], (s) => {
      const x = s.purchases.find((y) => y.id === po.id);
      x.status = status; x.updatedAt = Date.now();
      x.history.push({ at: Date.now(), by: SP.auth.current()?.name || 'system', action: status, note: note || '' });
    });
    SP.store.audit(`purchase.${status}`, po.ref, note || '');
  }

  SP.approvals.registerResume('po_approve', (d) => {
    const po = SP.store.state.purchases.find((x) => x.id === d.poId);
    if (po && po.status === 'pending') transition(po, 'approved', 'Approved via approval engine');
  });

  /* ══════════════════════════════════════════════════════════ DETAIL */

  function openPO(id) {
    const po = SP.store.state.purchases.find((x) => x.id === id);
    if (!po) return;
    const s = SP.store.state;
    const due = Math.max(0, (po.total || 0) - (po.paid || 0));

    const actions = [];
    const A = (label, icon, perm, run, danger) => { if (!perm || SP.auth.can(perm)) actions.push(SP.el('button.btn', { type: 'button', class: danger ? 'btn--danger' : 'btn--primary', onclick: () => run(po) }, icon ? SP.icon(icon) : null, label)); };

    if (po.status === 'draft') A('Submit for approval', 'arrowRight', 'purchases:create', (x) => { transition(x, 'pending'); SP.approvals.guard('purchase', { value: x.total }, { title: `Purchase ${x.ref}: ${SP.fmt.money(x.total)}`, refType: 'purchase', refId: x.id, resumeKey: 'po_approve', resumeData: { poId: x.id } }, () => transition(x, 'approved', 'Auto-approved')); });
    if (po.status === 'pending') A('Approve', 'check', 'purchases:approve', (x) => transition(x, 'approved', ''));
    if (po.status === 'approved') A('Mark ordered', 'cart', 'purchases:create', (x) => transition(x, 'ordered', ''));
    if (['ordered', 'approved', 'partial'].includes(po.status)) A('Receive goods', 'download', 'purchases:receive', (x) => receiveForm(x));
    if (due > 0 && ['partial', 'received'].includes(po.status)) A('Pay supplier', 'key', 'payments:create', (x) => payForm(x));
    if (!['received', 'cancelled'].includes(po.status)) A('Cancel', 'x', 'purchases:approve', async (x) => { const ok = await SP.modal({ title: `Cancel ${x.ref}?`, tone: 'danger', okLabel: 'Cancel PO' }); if (ok) transition(x, 'cancelled', ''); }, true);
    actions.push(SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => printPO(po) }, SP.icon('print'), 'Print'));

    SP.sheet({
      title: `PO ${po.ref}`,
      subtitle: `${po.supplierName} · ${SP.fmt.dateTime(po.createdAt)}`,
      content: SP.el('div.stack.gap-3',
        SP.el('div.row.gap-2', SP.ui2.badge('po', po.status), po.legacy ? SP.ui2.tag('Legacy import', 'mute') : null),
        SP.el('dl.kv',
          SP.el('dt', 'Deliver to'), SP.el('dd', s.warehouses.find((w) => w.id === po.warehouseId)?.name || po.warehouseId),
          SP.el('dt', 'Expected'), SP.el('dd', po.expectedAt ? SP.fmt.date(po.expectedAt) : '—'),
          SP.el('dt', 'Total'), SP.el('dd', SP.fmt.money(po.total)),
          SP.el('dt', 'Paid'), SP.el('dd', SP.fmt.money(po.paid || 0)),
          SP.el('dt', 'Due'), SP.el('dd', due > 0 ? SP.el('span', { style: { color: 'var(--danger)' } }, SP.fmt.money(due)) : '—')),
        SP.el('div',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Lines'),
          SP.el('div.stack.gap-1', ...po.items.map((i) => {
            const p = s.products.find((x) => x.id === i.productId);
            return SP.el('div.lrow',
              SP.el('span.lrow__ico', SP.icon('box')),
              SP.el('div.lrow__main', SP.el('strong', p?.name || i.productId), SP.el('small', `${i.qty} × ${SP.fmt.money(i.cost || 0)} · received ${i.receivedQty || 0}`)),
              SP.el('span.lrow__val', SP.fmt.money(i.qty * (i.cost || 0))));
          }))),
        SP.el('div', SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'History'),
          SP.ui2.timeline(po.history.map((h) => ({ at: h.at, title: SP.fmt.titleCase(h.action), body: h.note, meta: h.by })))),
      ),
      actions,
    });
  }

  /* goods receiving */
  async function receiveForm(po) {
    const s = SP.store.state;
    const inputs = po.items.filter((i) => (i.qty - (i.receivedQty || 0)) > 0).map((i) => {
      const p = s.products.find((x) => x.id === i.productId);
      const remaining = i.qty - (i.receivedQty || 0);
      const input = SP.el('input.input.input--num', { type: 'number', min: 0, max: remaining, value: remaining, style: { width: '84px' } });
      return { item: i, p, remaining, input, node: SP.el('div.lrow',
        SP.el('span.lrow__ico', SP.icon('box')),
        SP.el('div.lrow__main', SP.el('strong', p?.name || i.productId), SP.el('small', `awaiting ${remaining} of ${i.qty} @ ${SP.fmt.money(i.cost || 0)}`)),
        input) };
    });
    if (!inputs.length) { SP.ui.toast({ tone: 'info', title: 'Fully received already' }); return; }

    const r = await SP.modal({
      title: `Receive goods — ${po.ref}`,
      subtitle: 'Received quantities post straight into the ledger.',
      icon: 'download', okLabel: 'Post receiving',
      body: SP.el('div.stack.gap-1', ...inputs.map((x) => x.node)),
      onOk: async () => {
        const moves = [];
        for (const x of inputs) {
          const qty = Number(x.input.value) || 0;
          if (qty < 0 || qty > x.remaining) throw new Error(`${x.p?.name}: enter 0–${x.remaining}.`);
          if (qty > 0) {
            moves.push({
              type: 'receive', productId: x.item.productId, qty,
              warehouseId: po.warehouseId, unitCost: x.item.cost,
              refType: 'purchase', refId: po.id, reason: `PO ${po.ref} receiving`,
            });
          }
        }
        if (!moves.length) throw new Error('Nothing to receive.');
        SP.ledger.postBatch(moves);
        SP.store.update(['purchases'], (st) => {
          const x = st.purchases.find((y) => y.id === po.id);
          for (const inp of inputs) inp.item.receivedQty = (inp.item.receivedQty || 0) + (Number(inp.input.value) || 0);
          const done = x.items.every((i) => (i.receivedQty || 0) >= i.qty);
          x.status = done ? 'received' : 'partial';
          x.history.push({ at: Date.now(), by: SP.auth.current()?.name || 'system', action: done ? 'received' : 'partial_receipt', note: '' });
          // Adopt latest purchase cost onto products.
          for (const i of x.items) {
            const p = st.products.find((y) => y.id === i.productId);
            if (p && i.cost > 0) p.cost = i.cost;
          }
        });
        SP.store.audit('purchase.receive', po.ref, `${SP.sum(moves, (m) => m.qty)} units`);
        SP.ui.toast({ tone: 'ok', title: 'Goods received', body: 'Ledger updated.' });
        SP.router.refresh();
      },
    });
    return r;
  }

  async function payForm(po) {
    const due = Math.max(0, po.total - (po.paid || 0));
    return SP.modal({
      title: `Pay supplier — ${po.ref}`, icon: 'key', okLabel: 'Record payment',
      fields: [
        { key: 'amount', label: `Amount (due ${SP.fmt.money(due)})`, type: 'number', min: 1, max: due, required: true, value: due },
        { key: 'method', label: 'Method', type: 'select', value: 'bank', options: ['cash', 'bank', 'bKash', 'Nagad', 'other'].map((m) => ({ value: m, label: SP.fmt.titleCase(m) })) },
        { key: 'note', label: 'Note' },
      ],
      onOk: async (v) => {
        const payment = {
          id: SP.uid('pay'), ref: SP.store.nextRef('payment'), ts: Date.now(),
          kind: 'payment', partyType: 'supplier', partyId: po.supplierId, purchaseId: po.id, saleId: null,
          amount: v.amount, method: v.method, note: v.note || '', by: SP.auth.current()?.name || 'system',
        };
        SP.store.update(['payments', 'purchases'], (st) => {
          st.payments.unshift(payment);
          const t = st.purchases.find((y) => y.id === po.id);
          t.paid = (t.paid || 0) + v.amount;
        });
        SP.store.audit('payment.payment', payment.ref, `${SP.fmt.money(v.amount)} → ${po.supplierName}`);
        SP.ui.toast({ tone: 'ok', title: 'Payment recorded' });
        SP.router.refresh();
      },
    });
  }

  /** Fast goods receiving without paperwork (for the mobile action). */
  async function quickReceive() {
    const open = SP.store.state.purchases.filter((p) => ['ordered', 'approved', 'partial'].includes(p.status));
    if (open.length) {
      const po = await new Promise((resolve) => {
        const body = SP.el('div.stack.gap-1', ...open.map((p) => SP.el('button.lrow', {
          type: 'button', onclick: () => { shell.close(); resolve(p); },
        },
          SP.el('span.lrow__ico', SP.icon('cart')),
          SP.el('div.lrow__main', SP.el('strong', `${p.ref} · ${p.supplierName}`), SP.el('small', `${SP.sum(p.items, (i) => i.qty - (i.receivedQty || 0))} units awaiting`)),
          SP.ui2.badge('po', p.status, { sm: true }))));
        body.appendChild(SP.el('button.btn.btn--ghost.btn--block', { type: 'button', onclick: () => { shell.close(); resolve(null); } }, 'Receive without a PO'));
        const shell = SP.sheet({ title: 'Receive against a PO?', content: body, onClose: () => resolve(null) });
      });
      if (po) return receiveForm(po);
    }
    return SP.modules.movements.receiveForm();
  }

  function printPO(po) {
    const s = SP.store.state;
    SP.impexp.printDocument({
      title: `Purchase Order ${po.ref}`,
      subtitle: `${po.supplierName} · deliver to ${s.warehouses.find((w) => w.id === po.warehouseId)?.name || po.warehouseId} · ${SP.fmt.date(po.createdAt)}`,
      bodyHtml: SP.impexp.tableHtml(['Product', 'Qty', 'Cost', 'Amount'],
        po.items.map((i) => [s.products.find((x) => x.id === i.productId)?.name || i.productId, i.qty, SP.fmt.money(i.cost || 0), SP.fmt.money(i.qty * (i.cost || 0))])),
    });
  }

  return MOD;
})();
