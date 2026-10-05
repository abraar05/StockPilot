/**
 * modules/transfers.js — inter-warehouse transfer workflow.
 *
 * REQUESTED → APPROVED → PICKING → DISPATCHED → IN TRANSIT → RECEIVED → COMPLETED
 *
 * Stock semantics:
 *  - DISPATCH posts transfer_out at the source (units leave the shelf).
 *  - RECEIVE posts transfer_in at the destination per received quantity,
 *    supporting partial receiving and discrepancies (short/excess flagged).
 *  - REJECT/CANCEL before dispatch posts nothing.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.transfers = (() => {
  const state = { q: '', status: 'all' };

  const MOD = { title: 'Transfers', subtitle: () => `${SP.fmt.pluralise(SP.store.state.transfers.length, 'transfer')}`, mount, openForm, openTransfer };

  function rows() {
    let list = [...SP.store.state.transfers].sort((a, b) => b.createdAt - a.createdAt);
    if (state.status !== 'all') list = list.filter((t) => t.status === state.status);
    if (state.q) list = list.filter((t) => `${t.ref} ${t.from} ${t.to} ${t.requester}`.toLowerCase().includes(state.q));
    return list;
  }

  function mount(params) {
    if (params?.status) state.status = params.status;
    if (params?.compose) setTimeout(() => openForm(), 100);
    if (params?.id) setTimeout(() => openTransfer(params.id), 100);
    const root = SP.el('div.stack.gap-3');

    const table = SP.table.create({
      columns: [
        { key: 'ref', label: 'Ref', width: '110px', value: (t) => t.ref, render: (t) => SP.el('strong', t.ref) },
        { key: 'route', label: 'Route', value: (t) => `${t.from}${t.to}`, render: (t) => SP.el('span', `${whName(t.from)} → ${whName(t.to)}`) },
        { key: 'units', label: 'Units', width: '80px', align: 'right', value: (t) => SP.sum(t.items, (i) => i.qty), render: (t) => SP.fmt.n(SP.sum(t.items, (i) => i.qty)) },
        { key: 'status', label: 'Status', width: '130px', value: (t) => t.status, render: (t) => SP.ui2.badge('transfer', t.status, { sm: true }) },
        { key: 'requester', label: 'Requested by', width: '130px', value: (t) => t.requester },
        { key: 'createdAt', label: 'Created', width: '110px', value: (t) => t.createdAt, render: (t) => SP.el('span.tiny', SP.fmt.date(t.createdAt)) },
      ],
      rows,
      rowId: (t) => t.id,
      defaultSort: 'createdAt', defaultDir: 'desc',
      empty: { icon: 'swap', title: 'No transfers', body: 'Move stock between warehouses with full accountability.' },
      onRowClick: (t) => openTransfer(t.id),
    });

    const filters = SP.ui2.filterBar({
      placeholder: 'Search ref, warehouse, requester…',
      onChange: (f) => { state.q = f.q; table.refresh(); },
    });

    const chips = SP.chipRow(
      [{ value: 'all', label: 'All' }, ...SP.STATUS.transfer.map((s) => ({ value: s.id, label: s.label }))],
      state.status, (v) => { state.status = v; table.refresh(); });

    const actions = [];
    if (SP.auth.can('transfers:create')) actions.push(SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => openForm() }, SP.icon('plus'), 'New transfer'));

    root.append(
      SP.ui2.pageHead({ title: 'Transfers', sub: 'Requested → approved → dispatched → received. Fully accountable.', actions }),
      filters.el, chips, table.el,
    );
    return root;
  }

  const whName = (id) => SP.store.state.warehouses.find((w) => w.id === id)?.name || id;

  /* ══════════════════════════════════════════════════════════ CREATE */

  async function openForm(preset = {}) {
    const s = SP.store.state;
    const items = [...(preset.items || [])];

    const itemsHost = SP.el('div.stack.gap-1');
    const drawItems = () => {
      SP.clear(itemsHost);
      items.forEach((it, idx) => {
        const p = s.products.find((x) => x.id === it.productId);
        itemsHost.appendChild(SP.el('div.lrow',
          SP.el('span.lrow__ico', SP.icon('box')),
          SP.el('div.lrow__main', SP.el('strong', p?.name || it.productId)),
          SP.el('div.row.gap-1', { style: { alignItems: 'center' } },
            SP.el('input.input.input--num', {
              type: 'number', min: 1, value: it.qty, style: { width: '76px' },
              onchange: (e) => { it.qty = Math.max(1, Number(e.target.value) || 1); },
            }),
            SP.el('button.btn.btn--icon.btn--sm.btn--quiet', { type: 'button', 'aria-label': 'Remove line', onclick: () => { items.splice(idx, 1); drawItems(); } }, SP.icon('x')))));
      });
      itemsHost.appendChild(SP.el('button.btn.btn--ghost.btn--sm.btn--block', {
        type: 'button',
        onclick: async () => {
          const p = await SP.ui2.pickProduct({ title: 'Add product to transfer' });
          if (!p) return;
          const existing = items.find((i) => i.productId === p.id);
          if (existing) existing.qty += 1; else items.push({ productId: p.id, qty: 1 });
          drawItems();
        },
      }, SP.icon('plus'), 'Add product'));
    };
    drawItems();

    const res = await SP.modal({
      title: 'New transfer',
      subtitle: 'Stock stays put until you dispatch.',
      icon: 'swap', okLabel: 'Request transfer',
      draftId: 'transfer-new',
      body: SP.el('div.stack.gap-2', SP.el('strong', { class: 'tiny mute' }, 'LINES'), itemsHost),
      fields: [
        { key: 'from', label: 'From warehouse', type: 'select', required: true, options: whOptions('write'), value: preset.from || SP.auth.scopeOf()[0] },
        { key: 'to', label: 'To warehouse', type: 'select', required: true, options: SP.store.state.warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: w.name })) },
        { key: 'carrier', label: 'Carrier / method', placeholder: 'e.g. Pathao courier, own van' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onOk: async (v) => {
        if (!items.length) throw new Error('Add at least one product line.');
        if (v.from === v.to) throw new Error('Source and destination must differ.');
        for (const it of items) {
          const avail = SP.ledger.stockOf(it.productId, v.from);
          if (it.qty > avail) {
            const p = SP.store.state.products.find((x) => x.id === it.productId);
            throw new Error(`${p?.name}: only ${avail} available at ${whName(v.from)}.`);
          }
        }
        const transfer = {
          id: SP.uid('trf'),
          ref: SP.store.nextRef('transfer'),
          from: v.from, to: v.to,
          items: items.map((i) => ({ productId: i.productId, qty: i.qty, receivedQty: 0, deviceIds: [] })),
          status: 'requested',
          requester: SP.auth.current()?.name || 'system',
          approver: null, receiver: null,
          carrier: v.carrier || '', tracking: '', notes: v.notes || '',
          history: [{ at: Date.now(), by: SP.auth.current()?.name || 'system', action: 'requested', note: v.notes || '' }],
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        SP.store.update(['transfers'], (st) => { st.transfers.unshift(transfer); });
        SP.store.audit('transfer.create', transfer.ref, `${whName(v.from)} → ${whName(v.to)} · ${SP.sum(items, (i) => i.qty)} units`);
        SP.store.notify({ tone: 'info', kind: 'transfer', route: 'transfers', title: `Transfer ${transfer.ref} requested`, body: `${whName(v.from)} → ${whName(v.to)}` });
        SP.ui.toast({ tone: 'ok', title: `Transfer ${transfer.ref} requested` });
        SP.router.refresh();
        openTransfer(transfer.id);
      },
    });
    return res;
  }

  /* ══════════════════════════════════════════════════════════ DETAIL */

  function openTransfer(id) {
    const t = SP.store.state.transfers.find((x) => x.id === id);
    if (!t) return;
    const s = SP.store.state;

    const itemRows = t.items.map((it) => {
      const p = s.products.find((x) => x.id === it.productId);
      const discrepant = ['received', 'completed'].includes(t.status) && (it.receivedQty ?? 0) !== it.qty;
      return SP.el('div.lrow',
        SP.el('span.lrow__ico', SP.icon('box')),
        SP.el('div.lrow__main', SP.el('strong', p?.name || it.productId), SP.el('small', `${it.deviceIds?.length || 0} devices · sent ${it.qty} · received ${it.receivedQty ?? 0}`)),
        discrepant ? SP.ui2.tag(`Δ ${it.receivedQty - it.qty}`, 'danger') : SP.el('span.lrow__val', SP.fmt.n(it.qty)));
    });

    const next = NEXT_ACTIONS[t.status] || [];
    const actions = next.filter((a) => SP.auth.can(a.perm)).map((a) => SP.el('button.btn', {
      type: 'button', class: a.danger ? 'btn--danger' : 'btn--primary',
      onclick: () => a.run(t),
    }, a.icon ? SP.icon(a.icon) : null, a.label));
    actions.push(SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => printTransfer(t) }, SP.icon('print'), 'Print'));

    SP.sheet({
      title: `Transfer ${t.ref}`,
      subtitle: `${whName(t.from)} → ${whName(t.to)}`,
      content: SP.el('div.stack.gap-3',
        SP.el('div.row.gap-2', { style: { alignItems: 'center', flexWrap: 'wrap' } },
          SP.ui2.badge('transfer', t.status), t.legacy ? SP.ui2.tag('Legacy import', 'mute') : null,
          t.items.some((i) => (i.receivedQty ?? i.qty) !== i.qty && ['received', 'completed'].includes(t.status)) ? SP.ui2.tag('Discrepancy', 'danger') : null),
        SP.el('dl.kv',
          SP.el('dt', 'Requested by'), SP.el('dd', t.requester || '—'),
          SP.el('dt', 'Approver'), SP.el('dd', t.approver || '—'),
          SP.el('dt', 'Received by'), SP.el('dd', t.receiver || '—'),
          SP.el('dt', 'Carrier'), SP.el('dd', t.carrier || '—'),
          SP.el('dt', 'Tracking'), SP.el('dd', t.tracking || '—'),
          SP.el('dt', 'Created'), SP.el('dd', SP.fmt.dateTime(t.createdAt))),
        SP.el('div', SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Lines'), SP.el('div.stack.gap-1', ...itemRows)),
        SP.el('div', SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'History'),
          SP.ui2.timeline(t.history.map((h) => ({ at: h.at, title: SP.fmt.titleCase(h.action.replace(/_/g, ' ')), body: h.note, meta: h.by })))),
      ),
      actions,
    });
  }

  function transition(t, status, note, extra = {}) {
    SP.store.update(['transfers'], (s) => {
      const x = s.transfers.find((y) => y.id === t.id);
      Object.assign(x, { status, updatedAt: Date.now(), ...extra });
      x.history.push({ at: Date.now(), by: SP.auth.current()?.name || 'system', action: status, note: note || '' });
    });
    SP.store.audit(`transfer.${status}`, t.ref, note || '');
    SP.store.notify({ tone: 'info', kind: 'transfer', route: 'transfers', title: `Transfer ${t.ref} ${SP.statusOf('transfer', status).label.toLowerCase()}`, body: `${whName(t.from)} → ${whName(t.to)}` });
  }

  const NEXT_ACTIONS = {
    requested: [
      { id: 'approve', label: 'Approve', icon: 'check', perm: 'transfers:approve', run: (t) => {
        const total = SP.sum(t.items, (i) => i.qty);
        const outcome = SP.approvals.guard('transfer', { qty: total }, {
          title: `Transfer ${t.ref}: ${total} units ${whName(t.from)} → ${whName(t.to)}`,
          refType: 'transfer', refId: t.id,
          resumeKey: 'transfer_approve', resumeData: { transferId: t.id },
        }, () => transition(t, 'approved', '', { approver: SP.auth.current()?.name }));
        if (outcome.status === 'pending') SP.ui.toast({ tone: 'info', title: 'Sent for approval', body: 'Large transfers need admin sign-off.' });
      } },
      { id: 'reject', label: 'Reject', icon: 'x', perm: 'transfers:approve', danger: true, run: async (t) => {
        const r = await SP.modal({ title: `Reject ${t.ref}?`, fields: [{ key: 'note', label: 'Reason', required: true }], okLabel: 'Reject', tone: 'danger' });
        if (r) transition(t, 'rejected', r.note);
      } },
    ],
    approved: [
      { id: 'pick', label: 'Start picking', icon: 'box', perm: 'transfers:dispatch', run: (t) => transition(t, 'picking') },
      { id: 'cancel', label: 'Cancel', icon: 'x', perm: 'transfers:create', danger: true, run: (t) => transition(t, 'cancelled') },
    ],
    picking: [
      { id: 'dispatch', label: 'Dispatch', icon: 'truck', perm: 'transfers:dispatch', run: (t) => dispatchForm(t) },
      { id: 'cancel', label: 'Cancel', icon: 'x', perm: 'transfers:create', danger: true, run: (t) => transition(t, 'cancelled') },
    ],
    dispatched: [
      { id: 'receive', label: 'Receive', icon: 'download', perm: 'transfers:receive', run: (t) => receiveForm(t) },
      { id: 'mark_transit', label: 'Mark in transit', icon: 'route', perm: 'transfers:dispatch', run: (t) => transition(t, 'in_transit') },
    ],
    in_transit: [
      { id: 'receive', label: 'Receive', icon: 'download', perm: 'transfers:receive', run: (t) => receiveForm(t) },
    ],
    received: [
      { id: 'complete', label: 'Complete', icon: 'checkCircle', perm: 'transfers:receive', run: (t) => transition(t, 'completed', '', { receiver: SP.auth.current()?.name }) },
    ],
  };

  /** Dispatch: pick devices for serialized products, post transfer_out. */
  async function dispatchForm(t) {
    const s = SP.store.state;
    for (const item of t.items) {
      const p = s.products.find((x) => x.id === item.productId);
      if (p?.serialized) {
        const devices = await SP.ui2.pickDevices({
          productId: p.id, warehouseId: t.from, qty: item.qty,
          title: `Pick ${item.qty} × ${p.name}`,
        });
        if (!devices) return; // aborted
        if (devices.length !== item.qty) {
          SP.ui.toast({ tone: 'warn', title: `Need exactly ${item.qty} devices`, body: `Selected ${devices.length}.` });
          return;
        }
        item.deviceIds = devices.map((d) => d.id);
      }
    }
    const r = await SP.modal({
      title: `Dispatch ${t.ref}`, icon: 'truck', okLabel: 'Dispatch',
      fields: [
        { key: 'carrier', label: 'Carrier', value: t.carrier },
        { key: 'tracking', label: 'Tracking / reference', value: t.tracking },
        { key: 'note', label: 'Note' },
      ],
      onOk: async (v) => {
        const moves = t.items.map((item) => ({
          type: 'transfer_out', productId: item.productId, qty: item.qty,
          warehouseId: t.from, deviceIds: item.deviceIds || [],
          refType: 'transfer', refId: t.id, reason: `Transfer ${t.ref} dispatched to ${whName(t.to)}`,
        }));
        SP.ledger.postBatch(moves);
        transition(t, 'dispatched', v.note || '', { carrier: v.carrier || t.carrier, tracking: v.tracking || t.tracking });
        SP.ui.toast({ tone: 'ok', title: `${t.ref} dispatched`, body: `${SP.sum(t.items, (i) => i.qty)} units left ${whName(t.from)}.` });
        SP.router.refresh();
      },
    });
    return r;
  }

  /** Receive: confirm quantities per line; post transfer_in. */
  async function receiveForm(t) {
    const s = SP.store.state;
    const inputs = t.items.map((item) => {
      const p = s.products.find((x) => x.id === item.productId);
      const remaining = item.qty - (item.receivedQty || 0);
      const input = SP.el('input.input.input--num', { type: 'number', min: 0, max: remaining, value: remaining, style: { width: '84px' } });
      return { item, p, remaining, input, node: SP.el('div.lrow',
        SP.el('span.lrow__ico', SP.icon('box')),
        SP.el('div.lrow__main', SP.el('strong', p?.name || item.productId), SP.el('small', `awaiting ${remaining} of ${item.qty}`)),
        input) };
    });

    const r = await SP.modal({
      title: `Receive ${t.ref}`,
      subtitle: 'Confirm what actually arrived. Differences are flagged as discrepancies.',
      icon: 'download', okLabel: 'Confirm receiving',
      body: SP.el('div.stack.gap-1', ...inputs.map((x) => x.node)),
      fields: [{ key: 'note', label: 'Receiving note (damage, shortage…)' }],
      onOk: async (v) => {
        const moves = [];
        let anyReceived = 0; let anyDiscrepancy = false;
        for (const x of inputs) {
          const qty = Number(x.input.value) || 0;
          if (qty < 0 || qty > x.remaining) throw new Error(`${x.p?.name}: enter 0–${x.remaining}.`);
          if (qty !== x.remaining) anyDiscrepancy = true;
          if (qty > 0) {
            anyReceived += qty;
            moves.push({
              type: 'transfer_in', productId: x.item.productId, qty,
              warehouseId: t.to, deviceIds: x.item.deviceIds || [],
              refType: 'transfer', refId: t.id, reason: `Transfer ${t.ref} received from ${whName(t.from)}`,
            });
          }
        }
        if (!anyReceived) throw new Error('Receive at least one unit, or cancel.');
        SP.ledger.postBatch(moves);
        SP.store.update(['transfers'], (st) => {
          const x = st.transfers.find((y) => y.id === t.id);
          for (const inp of inputs) inp.item.receivedQty = (inp.item.receivedQty || 0) + (Number(inp.input.value) || 0);
        });
        const allDone = t.items.every((i) => (i.receivedQty || 0) >= i.qty);
        transition(t, allDone ? 'received' : 'received', v.note || (anyDiscrepancy ? 'Received with discrepancy' : ''), { receiver: SP.auth.current()?.name });
        if (anyDiscrepancy) {
          SP.store.notify({ tone: 'warn', kind: 'transfer', priority: 'high', route: 'transfers', title: `Discrepancy on ${t.ref}`, body: 'Received quantities differ from dispatched quantities.' });
        }
        SP.ui.toast({ tone: 'ok', title: `${t.ref} received`, body: anyDiscrepancy ? 'Discrepancy recorded.' : 'All lines matched.' });
        SP.router.refresh();
      },
    });
    return r;
  }

  /* resume after approval */
  SP.approvals.registerResume('transfer_approve', (d) => {
    const t = SP.store.state.transfers.find((x) => x.id === d.transferId);
    if (t && t.status === 'requested') transition(t, 'approved', 'Approved via approval engine', { approver: 'approval engine' });
  });

  /* ─────────────────────────────────────────────────────── print */

  function printTransfer(t) {
    const s = SP.store.state;
    SP.impexp.printDocument({
      title: `Stock Transfer ${t.ref}`,
      subtitle: `${whName(t.from)} → ${whName(t.to)} · ${SP.statusOf('transfer', t.status).label} · ${SP.fmt.dateTime(t.createdAt)}`,
      bodyHtml: SP.impexp.tableHtml(
        ['Product', 'Sent', 'Received', 'IMEIs'],
        t.items.map((i) => [
          s.products.find((x) => x.id === i.productId)?.name || i.productId,
          i.qty, i.receivedQty ?? '—',
          (i.deviceIds || []).map((d) => s.devices.find((x) => x.id === d)?.imei1).filter(Boolean).join(', ') || '—',
        ])) + `<p style="margin-top:14px">Requested by: ${SP.esc(t.requester || '—')} · Approver: ${SP.esc(t.approver || '—')} · Receiver: ${SP.esc(t.receiver || '—')}</p>
        <div style="display:flex;gap:60px;margin-top:46px"><span>Dispatch signature: ____________</span><span>Receiving signature: ____________</span></div>`,
    });
  }

  const whOptions = (scope) => SP.store.state.warehouses
    .filter((w) => w.active && (scope !== 'write' || SP.auth.inScope(w.id)))
    .map((w) => ({ value: w.id, label: w.name }));

  return MOD;
})();
