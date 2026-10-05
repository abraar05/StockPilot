/**
 * modules/sales.js — quotation → order → invoice → delivery → payment,
 * with returns, customer dues, printable invoices and WhatsApp sharing.
 * Selling posts `sale` movements into the ledger.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.sales = (() => {
  const state = { q: '', status: 'all' };

  const MOD = { title: 'Sales', subtitle: () => `${SP.fmt.pluralise(SP.store.state.sales.filter((x) => !x.legacy).length, 'document')}`, mount, openForm, openSale };

  function rows() {
    let list = SP.store.state.sales.filter((x) => !x.legacy).sort((a, b) => b.ts - a.ts);
    if (state.status !== 'all') list = list.filter((x) => x.status === state.status);
    if (state.q) list = list.filter((x) => `${x.ref} ${x.customerName} ${x.salesperson}`.toLowerCase().includes(state.q));
    return list;
  }

  function mount(params) {
    if (params?.compose) setTimeout(() => openForm(), 100);
    if (params?.id) setTimeout(() => openSale(params.id), 100);
    const root = SP.el('div.stack.gap-3');

    const table = SP.table.create({
      columns: [
        { key: 'ref', label: 'Ref', width: '110px', value: (x) => x.ref, render: (x) => SP.el('strong', x.ref) },
        { key: 'ts', label: 'Date', width: '110px', value: (x) => x.ts, render: (x) => SP.el('span.tiny', SP.fmt.date(x.ts)) },
        { key: 'customerName', label: 'Customer', value: (x) => x.customerName || '' },
        { key: 'warehouseId', label: 'Warehouse', width: '110px', value: (x) => x.warehouseId },
        { key: 'total', label: 'Total', width: '110px', align: 'right', value: (x) => x.total, render: (x) => SP.el('strong', SP.fmt.money(x.total)) },
        { key: 'due', label: 'Due', width: '100px', align: 'right', value: (x) => Math.max(0, (x.total || 0) - (x.paid || 0)), render: (x) => { const d = Math.max(0, (x.total || 0) - (x.paid || 0)); return d > 0 ? SP.el('span', { style: { color: 'var(--danger)' } }, SP.fmt.money(d)) : SP.el('span.mute', '—'); } },
        { key: 'status', label: 'Status', width: '120px', value: (x) => x.status, render: (x) => SP.ui2.badge('sale', x.status, { sm: true }) },
      ],
      rows,
      rowId: (x) => x.id,
      defaultSort: 'ts', defaultDir: 'desc',
      empty: { icon: 'truck', title: 'No sales yet', body: 'Create a quotation, order or direct invoice.' },
      onRowClick: (x) => openSale(x.id),
    });

    const filters = SP.ui2.filterBar({
      placeholder: 'Search invoice, customer…',
      onChange: (f) => { state.q = f.q; table.refresh(); },
    });
    const chips = SP.chipRow(
      [{ value: 'all', label: 'All' }, ...SP.STATUS.sale.map((s) => ({ value: s.id, label: s.label }))],
      state.status, (v) => { state.status = v; table.refresh(); });

    const actions = [];
    if (SP.auth.can('sales:create')) actions.push(SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => openForm() }, SP.icon('plus'), 'New sale'));

    root.append(
      SP.ui2.pageHead({ title: 'Sales', sub: 'Quotation → order → invoice → delivery → payment.', actions }),
      filters.el, chips, table.el,
    );
    return root;
  }

  /* ══════════════════════════════════════════════════════════ CREATE */

  async function openForm(preset = {}) {
    const s = SP.store.state;
    const items = (preset.items || []).map((i) => ({ ...i, price: i.price ?? 0, discount: 0 }));

    const itemsHost = SP.el('div.stack.gap-1');
    const totalsNode = SP.el('div.sale-total');

    const compute = () => {
      const subtotal = SP.sum(items, (i) => i.qty * i.price);
      const discount = SP.sum(items, (i) => (i.qty * i.price) * ((i.discount || 0) / 100));
      return { subtotal, discount, total: subtotal - discount };
    };
    const drawTotals = () => {
      const t = compute();
      SP.clear(totalsNode);
      totalsNode.append(
        SP.el('div.sale-total__row', SP.el('span', 'Subtotal'), SP.el('b', SP.fmt.money(t.subtotal))),
        SP.el('div.sale-total__row', SP.el('span', 'Discount'), SP.el('b', `− ${SP.fmt.money(t.discount)}`)),
        SP.el('div.sale-total__row.sale-total__row--grand', SP.el('span', 'Total'), SP.el('b', SP.fmt.money(t.total))),
      );
    };

    const drawItems = () => {
      SP.clear(itemsHost);
      items.forEach((it, idx) => {
        const p = s.products.find((x) => x.id === it.productId);
        itemsHost.appendChild(SP.el('div.sale-line',
          SP.el('div.grow',
            SP.el('strong', p?.name || it.productId),
            SP.el('div.row.gap-2', { style: { marginTop: '4px', flexWrap: 'wrap' } },
              SP.el('label.tiny', 'Qty ', SP.el('input.input.input--num', { type: 'number', min: 1, value: it.qty, style: { width: '64px' }, onchange: (e) => { it.qty = Math.max(1, Number(e.target.value) || 1); drawTotals(); } })),
              SP.el('label.tiny', 'Price ', SP.el('input.input.input--num', { type: 'number', min: 0, value: it.price, style: { width: '96px' }, onchange: (e) => { it.price = Math.max(0, Number(e.target.value) || 0); drawTotals(); } })),
              SP.el('label.tiny', 'Disc % ', SP.el('input.input.input--num', { type: 'number', min: 0, max: 100, value: it.discount, style: { width: '60px' }, onchange: (e) => { it.discount = SP.clamp(Number(e.target.value) || 0, 0, 100); drawTotals(); } })))),
          SP.el('button.btn.btn--icon.btn--sm.btn--quiet', { type: 'button', 'aria-label': 'Remove', onclick: () => { items.splice(idx, 1); drawItems(); drawTotals(); } }, SP.icon('x'))));
      });
      itemsHost.appendChild(SP.el('button.btn.btn--ghost.btn--sm.btn--block', {
        type: 'button',
        onclick: async () => {
          const p = await SP.ui2.pickProduct({ title: 'Add product to sale', onlyInStock: false });
          if (!p) return;
          const existing = items.find((i) => i.productId === p.id);
          if (existing) existing.qty += 1;
          else items.push({ productId: p.id, qty: 1, price: p.price || 0, discount: 0 });
          drawItems(); drawTotals();
        },
      }, SP.icon('plus'), 'Add product'));
    };
    drawItems(); drawTotals();

    const customers = s.customers;
    const res = await SP.modal({
      title: 'New sale',
      subtitle: 'Stock is deducted when the invoice is issued.',
      icon: 'truck', okLabel: 'Issue invoice',
      draftId: 'sale-new',
      body: SP.el('div.stack.gap-2', SP.el('strong', { class: 'tiny mute' }, 'LINES'), itemsHost, totalsNode),
      fields: [
        { key: 'customerId', label: 'Customer', type: 'select', options: [{ value: '', label: 'Walk-in customer' }, ...customers.map((c) => ({ value: c.id, label: c.name }))], value: preset.customerId || '' },
        { key: 'warehouseId', label: 'From warehouse', type: 'select', required: true, options: SP.store.state.warehouses.filter((w) => w.active && SP.auth.inScope(w.id)).map((w) => ({ value: w.id, label: w.name })) },
        { key: 'paidNow', label: 'Paid now (৳)', type: 'number', min: 0, value: 0 },
        { key: 'dueAt', label: 'Payment due date', type: 'date' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onOk: async (v) => {
        if (!items.length) throw new Error('Add at least one product line.');
        for (const it of items) {
          const avail = SP.ledger.availableOf(it.productId, v.warehouseId);
          if (it.qty > avail) {
            const p = s.products.find((x) => x.id === it.productId);
            throw new Error(`${p?.name}: only ${avail} available at this warehouse.`);
          }
        }
        const t = compute();
        const maxDisc = t.subtotal ? t.discount / t.subtotal * 100 : 0;
        const customer = customers.find((c) => c.id === v.customerId);

        const issue = (approval) => {
          const sale = {
            id: SP.uid('sal'), ref: SP.store.nextRef('sale'),
            ts: Date.now(),
            customerId: customer?.id || null, customerName: customer?.name || 'Walk-in customer',
            warehouseId: v.warehouseId,
            items: items.map((i) => ({ ...i, deviceIds: [] })),
            status: 'invoiced',
            subtotal: t.subtotal, discountTotal: t.discount, taxTotal: 0, total: t.total,
            paid: Math.min(v.paidNow || 0, t.total),
            dueAt: v.dueAt ? Date.parse(v.dueAt) : null,
            salesperson: SP.auth.current()?.name || 'system',
            notes: v.notes || '',
            approvalId: approval?.id || null,
            history: [{ at: Date.now(), by: SP.auth.current()?.name || 'system', action: 'invoiced', note: '' }],
          };
          // Pick devices for serialized products.
          SP.store.update(['sales'], (st) => { st.sales.unshift(sale); });
          const moves = sale.items.map((i) => ({
            type: 'sale', productId: i.productId, qty: i.qty, warehouseId: sale.warehouseId,
            refType: 'sale', refId: sale.id, unitCost: i.price,
            reason: `Invoice ${sale.ref}`,
          }));
          SP.ledger.postBatch(moves);
          if (sale.paid > 0) recordPayment('receipt', 'customer', sale.customerId, sale.paid, { saleId: sale.id, method: 'cash', note: `Payment on ${sale.ref}` });
          if (customer) {
            SP.store.update(['customers'], (st) => {
              const c = st.customers.find((x) => x.id === customer.id);
              if (c) { c.updatedAt = Date.now(); }
            });
          }
          SP.store.audit('sale.create', sale.ref, `${sale.customerName} · ${SP.fmt.money(sale.total)} · paid ${SP.fmt.money(sale.paid)}`);
          return sale;
        };

        const outcome = SP.approvals.guard('discount', { discountPct: maxDisc, value: t.total }, {
          title: `Sale discount ${maxDisc.toFixed(1)}% (${SP.fmt.money(t.discount)})`,
          detail: `Customer: ${customer?.name || 'Walk-in'} · total ${SP.fmt.money(t.total)}`,
          refType: 'sale',
          resumeKey: 'sale_issue', resumeData: { items, v },
        }, issue);
        if (outcome.status === 'pending') {
          SP.ui.toast({ tone: 'info', title: 'Discount needs approval', body: 'The invoice is issued after a manager approves the discount.' });
          return;
        }
        const sale = outcome.result;
        SP.ui.toast({ tone: 'ok', title: `Invoice ${sale.ref} issued`, body: SP.fmt.money(sale.total) });
        SP.router.refresh();
        openSale(sale.id);
      },
    });
    return res;
  }

  SP.approvals.registerResume('sale_issue', (d) => {
    SP.ui.toast({ tone: 'info', title: 'Discount approved', body: 'Re-open Sales → New sale to issue the invoice. (Draft preserved below.)' });
    // Re-open the form prefilled so a single tap issues the invoice.
    SP.modules.sales.openForm({ items: d.items, customerId: d.v.customerId });
  });

  /* ══════════════════════════════════════════════════════════ DETAIL */

  function openSale(id) {
    const x = SP.store.state.sales.find((y) => y.id === id);
    if (!x) return;
    const s = SP.store.state;
    const due = Math.max(0, (x.total || 0) - (x.paid || 0));

    const payments = s.payments.filter((p) => p.saleId === x.id);
    const actions = [];

    if (due > 0 && SP.auth.can('payments:create') && x.status !== 'cancelled') {
      actions.push(SP.el('button.btn.btn--primary', {
        type: 'button',
        onclick: async () => {
          const r = await SP.modal({
            title: `Receive payment — ${x.ref}`, icon: 'key', okLabel: 'Record payment',
            fields: [
              { key: 'amount', label: `Amount (due ${SP.fmt.money(due)})`, type: 'number', min: 1, max: due, required: true, value: due },
              { key: 'method', label: 'Method', type: 'select', value: 'cash', options: ['cash', 'bank', 'bKash', 'Nagad', 'card', 'other'].map((m) => ({ value: m, label: SP.fmt.titleCase(m) })) },
              { key: 'note', label: 'Note' },
            ],
            onOk: async (v) => {
              recordPayment('receipt', 'customer', x.customerId, v.amount, { saleId: x.id, method: v.method, note: v.note });
              SP.store.update(['sales'], (st) => { const t = st.sales.find((y) => y.id === x.id); t.paid = (t.paid || 0) + v.amount; });
              SP.ui.toast({ tone: 'ok', title: 'Payment recorded' });
              SP.router.refresh();
            },
          });
          void r;
        },
      }, SP.icon('key'), 'Receive payment'));
    }
    actions.push(SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => printInvoice(x) }, SP.icon('print'), 'Print invoice'));
    actions.push(SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => shareWhatsApp(x) }, SP.icon('external'), 'WhatsApp'));
    if (!['cancelled', 'returned'].includes(x.status) && SP.auth.can('sales:create')) {
      actions.push(SP.el('button.btn.btn--danger', { type: 'button', onclick: () => returnForm(x) }, SP.icon('refresh'), 'Return'));
    }

    SP.sheet({
      title: `Invoice ${x.ref}`,
      subtitle: `${x.customerName} · ${SP.fmt.dateTime(x.ts)}`,
      content: SP.el('div.stack.gap-3',
        SP.el('div.row.gap-2', SP.ui2.badge('sale', x.status), SP.ui2.badge('payment', due <= 0 ? 'paid' : (x.paid > 0 ? 'partial' : 'unpaid'))),
        SP.el('div.stack.gap-1', ...x.items.map((i) => {
          const p = s.products.find((y) => y.id === i.productId);
          return SP.el('div.lrow',
            SP.el('span.lrow__ico', SP.icon('box')),
            SP.el('div.lrow__main', SP.el('strong', p?.name || i.productId), SP.el('small', `${i.qty} × ${SP.fmt.money(i.price)}${i.discount ? ` · −${i.discount}%` : ''}`)),
            SP.el('span.lrow__val', SP.fmt.money(i.qty * i.price * (1 - (i.discount || 0) / 100))));
        })),
        SP.el('dl.kv',
          SP.el('dt', 'Subtotal'), SP.el('dd', SP.fmt.money(x.subtotal)),
          SP.el('dt', 'Discount'), SP.el('dd', `− ${SP.fmt.money(x.discountTotal || 0)}`),
          SP.el('dt', 'Total'), SP.el('dd', SP.el('strong', SP.fmt.money(x.total))),
          SP.el('dt', 'Paid'), SP.el('dd', SP.fmt.money(x.paid || 0)),
          SP.el('dt', 'Due'), SP.el('dd', due > 0 ? SP.el('span', { style: { color: 'var(--danger)' } }, SP.fmt.money(due)) : '—'),
          x.dueAt ? [SP.el('dt', 'Due date'), SP.el('dd', SP.fmt.date(x.dueAt))] : null,
          SP.el('dt', 'Sold by'), SP.el('dd', x.salesperson || '—'),
          SP.el('dt', 'Warehouse'), SP.el('dd', s.warehouses.find((w) => w.id === x.warehouseId)?.name || x.warehouseId)),
        payments.length ? SP.el('div',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Payments'),
          SP.ui2.timeline(payments.map((p) => ({ at: p.ts, title: `${SP.fmt.money(p.amount)} · ${p.method}`, meta: `${p.ref} · ${p.by}` })))) : null,
      ),
      actions,
    });
  }

  function recordPayment(kind, partyType, partyId, amount, { saleId, purchaseId, method, note } = {}) {
    const payment = {
      id: SP.uid('pay'), ref: SP.store.nextRef('payment'), ts: Date.now(),
      kind, partyType, partyId, saleId: saleId || null, purchaseId: purchaseId || null,
      amount, method: method || 'cash', note: note || '',
      by: SP.auth.current()?.name || 'system',
    };
    SP.store.update(['payments'], (st) => { st.payments.unshift(payment); });
    SP.store.audit(`payment.${kind}`, payment.ref, `${SP.fmt.money(amount)}${saleId ? ' · sale' : ''}${purchaseId ? ' · purchase' : ''}`);
    return payment;
  }

  /* returns: restock + optional refund */
  async function returnForm(x) {
    const r = await SP.modal({
      title: `Return against ${x.ref}`, icon: 'refresh', okLabel: 'Process return', tone: 'danger',
      fields: [
        { key: 'qtys', label: 'Quantities to return', type: 'textarea', required: true, placeholder: x.items.map((i) => `${i.productId}: ${i.qty}`).join('\n'), hint: 'One per line: productId: qty' },
        { key: 'refund', label: 'Refund now (৳)', type: 'number', min: 0, value: 0 },
        { key: 'reason', label: 'Reason', required: true },
      ],
      onOk: async (v) => {
        const lines = String(v.qtys).split('\n').map((l) => l.trim()).filter(Boolean);
        const moves = [];
        for (const line of lines) {
          const [pid, qtyRaw] = line.split(':').map((z) => z.trim());
          const qty = Number(qtyRaw);
          const item = x.items.find((i) => i.productId === pid);
          if (!item || !Number.isFinite(qty) || qty <= 0 || qty > item.qty) throw new Error(`Bad line: ${line}`);
          moves.push({ type: 'sale_return', productId: pid, qty, warehouseId: x.warehouseId, refType: 'sale', refId: x.id, reason: `Return on ${x.ref}: ${v.reason}` });
        }
        SP.ledger.postBatch(moves);
        if (v.refund > 0) recordPayment('payment', 'customer', x.customerId, v.refund, { saleId: x.id, method: 'cash', note: `Refund for ${x.ref}` });
        SP.store.update(['sales'], (st) => {
          const t = st.sales.find((y) => y.id === x.id);
          t.status = 'returned';
          t.history.push({ at: Date.now(), by: SP.auth.current()?.name || 'system', action: 'returned', note: v.reason });
        });
        SP.store.audit('sale.return', x.ref, v.reason);
        SP.ui.toast({ tone: 'ok', title: 'Return processed', body: 'Stock is back on the shelf.' });
        SP.router.refresh();
      },
    });
    return r;
  }

  /* ─────────────────────────────────────────────────────── documents */

  function invoiceHtml(x) {
    const s = SP.store.state;
    const rows = x.items.map((i) => {
      const p = s.products.find((y) => y.id === i.productId);
      return [p?.name || i.productId, i.qty, SP.fmt.money(i.price), i.discount ? `${i.discount}%` : '—', SP.fmt.money(i.qty * i.price * (1 - (i.discount || 0) / 100))];
    });
    return SP.impexp.tableHtml(['Item', 'Qty', 'Price', 'Disc', 'Amount'], rows)
      + `<table class="printdoc__table" style="margin-top:0"><tbody>
        <tr><td style="text-align:right"><strong>Subtotal</strong></td><td style="width:120px;text-align:right">${SP.fmt.money(x.subtotal)}</td></tr>
        <tr><td style="text-align:right">Discount</td><td style="text-align:right">− ${SP.fmt.money(x.discountTotal || 0)}</td></tr>
        <tr><td style="text-align:right"><strong>Total</strong></td><td style="text-align:right"><strong>${SP.fmt.money(x.total)}</strong></td></tr>
        <tr><td style="text-align:right">Paid</td><td style="text-align:right">${SP.fmt.money(x.paid || 0)}</td></tr>
        <tr><td style="text-align:right"><strong>Due</strong></td><td style="text-align:right"><strong>${SP.fmt.money(Math.max(0, x.total - (x.paid || 0)))}</strong></td></tr>
      </tbody></table>`;
  }

  function printInvoice(x) {
    SP.impexp.printDocument({
      title: `Invoice ${x.ref}`,
      subtitle: `${x.customerName} · ${SP.fmt.dateTime(x.ts)}`,
      bodyHtml: invoiceHtml(x),
      footer: SP.store.state.settings.company.invoiceFooter,
    });
  }

  /** WhatsApp share: opens wa.me with the invoice as text. No fake send. */
  function shareWhatsApp(x) {
    const s = SP.store.state;
    const cust = s.customers.find((c) => c.id === x.customerId);
    const lines = [
      `*${s.settings.company.name || 'Invoice'}*`,
      `Invoice ${x.ref} — ${SP.fmt.date(x.ts)}`,
      '',
      ...x.items.map((i) => {
        const p = s.products.find((y) => y.id === i.productId);
        return `• ${p?.name || i.productId} × ${i.qty} — ${SP.fmt.money(i.qty * i.price * (1 - (i.discount || 0) / 100))}`;
      }),
      '',
      `Total: ${SP.fmt.money(x.total)}`,
      `Paid: ${SP.fmt.money(x.paid || 0)} · Due: ${SP.fmt.money(Math.max(0, x.total - (x.paid || 0)))}`,
    ];
    const phone = (cust?.phone || '').replace(/\D/g, '');
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`
      : `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank', 'noopener');
    SP.store.audit('sale.whatsapp', x.ref, phone || 'no recipient number');
  }

  return MOD;
})();
