/**
 * modules/customers.js — customer profiles, dues and ledgers.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.customers = (() => {
  const state = { q: '' };
  const MOD = { title: 'Customers', subtitle: () => `${SP.fmt.pluralise(SP.store.state.customers.length, 'customer')}`, mount, editCustomer, openCustomer };

  function dueOf(c) {
    return SP.sum(SP.store.state.sales.filter((x) => !x.legacy && x.customerId === c.id && x.status !== 'cancelled'),
      (x) => Math.max(0, (x.total || 0) - (x.paid || 0)));
  }

  function mount() {
    const root = SP.el('div.stack.gap-3');
    const rows = () => SP.store.state.customers
      .filter((c) => !state.q || `${c.name} ${c.company} ${c.phone}`.toLowerCase().includes(state.q))
      .sort((a, b) => dueOf(b) - dueOf(a));

    const table = SP.table.create({
      columns: [
        { key: 'name', label: 'Customer', value: (c) => c.name, render: (c) => SP.el('div.stack', SP.el('strong', c.name), SP.el('small.mute', c.company || c.phone || '')) },
        { key: 'phone', label: 'Phone', width: '130px', value: (c) => c.phone || '' },
        { key: 'purchases', label: 'Invoices', width: '80px', align: 'right', value: (c) => SP.store.state.sales.filter((x) => x.customerId === c.id).length },
        { key: 'due', label: 'Due', width: '110px', align: 'right', value: dueOf, render: (c) => { const d = dueOf(c); return d > 0 ? SP.el('strong', { style: { color: 'var(--danger)' } }, SP.fmt.money(d)) : SP.el('span.mute', '—'); } },
        { key: 'creditLimit', label: 'Credit limit', width: '110px', align: 'right', value: (c) => c.creditLimit || 0, render: (c) => c.creditLimit ? SP.fmt.money(c.creditLimit) : SP.el('span.mute', '—') },
      ],
      rows,
      rowId: (c) => c.id,
      empty: { icon: 'users', title: 'No customers', body: 'Add customers to track dues and history.' },
      onRowClick: (c) => openCustomer(c.id),
    });

    const filters = SP.ui2.filterBar({ placeholder: 'Search name, company, phone…', onChange: (f) => { state.q = f.q; table.refresh(); } });
    const actions = SP.auth.can('customers:manage')
      ? [SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => editCustomer(null) }, SP.icon('plus'), 'New customer')] : [];

    root.append(
      SP.ui2.pageHead({ title: 'Customers', sub: 'Profiles, credit limits, dues and ledgers.', actions }),
      filters.el, table.el,
    );
    return root;
  }

  function editCustomer(c) {
    const isNew = !c;
    c = c || {};
    return SP.modal({
      title: isNew ? 'New customer' : `Edit ${c.name}`, icon: 'users',
      okLabel: isNew ? 'Create' : 'Save',
      fields: [
        { key: 'name', label: 'Name', required: true, value: c.name },
        { key: 'company', label: 'Company', value: c.company },
        { key: 'phone', label: 'Phone', value: c.phone, inputmode: 'tel', placeholder: '01XXXXXXXXX' },
        { key: 'email', label: 'Email', type: 'email', value: c.email },
        { key: 'address', label: 'Address', type: 'textarea', value: c.address },
        { key: 'creditLimit', label: 'Credit limit (৳)', type: 'number', min: 0, value: c.creditLimit },
        { key: 'notes', label: 'Notes', type: 'textarea', value: c.notes },
      ],
      onOk: async (v) => {
        if (isNew) {
          const rec = { id: SP.uid('cus'), ...v, creditLimit: v.creditLimit || 0, createdAt: Date.now(), updatedAt: Date.now() };
          SP.store.update(['customers'], (s) => { s.customers.push(rec); });
          SP.store.audit('customer.create', v.name, '');
        } else {
          SP.store.update(['customers'], (s) => { const t = s.customers.find((x) => x.id === c.id); if (t) Object.assign(t, v, { updatedAt: Date.now() }); });
          SP.store.audit('customer.update', v.name, '');
        }
        SP.ui.toast({ tone: 'ok', title: isNew ? 'Customer created' : 'Customer saved' });
        SP.router.refresh();
      },
    });
  }

  function openCustomer(id) {
    const c = SP.store.state.customers.find((x) => x.id === id);
    if (!c) return;
    const s = SP.store.state;
    const sales = s.sales.filter((x) => x.customerId === id && !x.legacy).sort((a, b) => b.ts - a.ts);
    const payments = s.payments.filter((p) => p.partyType === 'customer' && p.partyId === id).sort((a, b) => b.ts - a.ts);
    const due = dueOf(c);
    const overLimit = c.creditLimit > 0 && due > c.creditLimit;

    const shell = SP.sheet({
      title: c.name,
      subtitle: [c.company, c.phone].filter(Boolean).join(' · '),
      content: SP.el('div.stack.gap-3',
        SP.el('div.kpi-grid',
          SP.ui2.kpi({ label: 'Current due', value: SP.fmt.money(due), tone: due > 0 ? 'warn' : null }),
          SP.ui2.kpi({ label: 'Invoices', value: SP.fmt.n(sales.length) }),
          SP.ui2.kpi({ label: 'Lifetime value', value: SP.fmt.moneyCompact(SP.sum(sales, (x) => x.total)) }),
        ),
        overLimit ? SP.el('div.callout', { dataset: { tone: 'danger' } },
          SP.el('span.callout__ico', SP.icon('alert')),
          SP.el('div.callout__body', SP.el('strong', 'Over credit limit'), SP.el('p', `Due ${SP.fmt.money(due)} exceeds the ${SP.fmt.money(c.creditLimit)} limit.`))) : null,
        SP.el('dl.kv',
          SP.el('dt', 'Phone'), SP.el('dd', c.phone || '—'),
          SP.el('dt', 'Email'), SP.el('dd', c.email || '—'),
          SP.el('dt', 'Address'), SP.el('dd', c.address || '—'),
          c.notes ? [SP.el('dt', 'Notes'), SP.el('dd', c.notes)] : null),
        SP.el('div',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Ledger'),
          SP.ui2.timeline([
            ...sales.map((x) => ({ at: x.ts, title: `Invoice ${x.ref} · ${SP.fmt.money(x.total)}`, meta: x.status, tone: 'brand' })),
            ...payments.map((p) => ({ at: p.ts, title: `${p.kind === 'receipt' ? 'Payment received' : 'Refund'} · ${SP.fmt.money(p.amount)}`, meta: `${p.method} · ${p.by}`, tone: 'ok' })),
          ].sort((a, b) => b.at - a.at).slice(0, 30))),
      ),
      actions: [
        SP.auth.can('customers:manage') ? SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => { shell.close(); editCustomer(c); } }, SP.icon('edit'), 'Edit') : null,
        SP.auth.can('sales:create') ? SP.el('button.btn.btn--primary', { type: 'button', onclick: () => { shell.close(); SP.modules.sales.openForm({ customerId: id }); } }, SP.icon('truck'), 'New sale') : null,
      ],
    });
  }

  return MOD;
})();
