/**
 * modules/suppliers.js — supplier profiles, payables, performance.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.suppliers = (() => {
  const state = { q: '' };
  const MOD = { title: 'Suppliers', subtitle: () => `${SP.fmt.pluralise(SP.store.state.suppliers.length, 'supplier')}`, mount, editSupplier, openSupplier };

  function dueOf(sp) {
    return SP.sum(SP.store.state.purchases.filter((x) => !x.legacy && x.supplierId === sp.id && x.status !== 'cancelled'),
      (x) => Math.max(0, (x.total || 0) - (x.paid || 0)));
  }

  function mount() {
    const root = SP.el('div.stack.gap-3');
    const rows = () => SP.store.state.suppliers
      .filter((c) => !state.q || `${c.name} ${c.company} ${c.phone}`.toLowerCase().includes(state.q))
      .sort((a, b) => a.name.localeCompare(b.name));

    const table = SP.table.create({
      columns: [
        { key: 'name', label: 'Supplier', value: (c) => c.name, render: (c) => SP.el('div.stack', SP.el('strong', c.name), SP.el('small.mute', c.company || c.phone || '')) },
        { key: 'phone', label: 'Phone', width: '130px', value: (c) => c.phone || '' },
        { key: 'orders', label: 'POs', width: '70px', align: 'right', value: (c) => SP.store.state.purchases.filter((x) => x.supplierId === c.id).length },
        { key: 'payable', label: 'Payable', width: '110px', align: 'right', value: dueOf, render: (c) => { const d = dueOf(c); return d > 0 ? SP.el('strong', { style: { color: 'var(--danger)' } }, SP.fmt.money(d)) : SP.el('span.mute', '—'); } },
      ],
      rows,
      rowId: (c) => c.id,
      empty: { icon: 'building', title: 'No suppliers', body: 'Add suppliers to run purchase orders.' },
      onRowClick: (c) => openSupplier(c.id),
    });

    const filters = SP.ui2.filterBar({ placeholder: 'Search name, company, phone…', onChange: (f) => { state.q = f.q; table.refresh(); } });
    const actions = SP.auth.can('suppliers:manage')
      ? [SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => editSupplier(null) }, SP.icon('plus'), 'New supplier')] : [];

    root.append(
      SP.ui2.pageHead({ title: 'Suppliers', sub: 'Profiles, payables and purchase history.', actions }),
      filters.el, table.el,
    );
    return root;
  }

  function editSupplier(c) {
    const isNew = !c;
    c = c || {};
    return SP.modal({
      title: isNew ? 'New supplier' : `Edit ${c.name}`, icon: 'building',
      okLabel: isNew ? 'Create' : 'Save',
      fields: [
        { key: 'name', label: 'Name', required: true, value: c.name },
        { key: 'company', label: 'Company', value: c.company },
        { key: 'phone', label: 'Phone', value: c.phone, inputmode: 'tel' },
        { key: 'email', label: 'Email', type: 'email', value: c.email },
        { key: 'address', label: 'Address', type: 'textarea', value: c.address },
        { key: 'notes', label: 'Notes', type: 'textarea', value: c.notes },
      ],
      onOk: async (v) => {
        if (isNew) {
          SP.store.update(['suppliers'], (s) => { s.suppliers.push({ id: SP.uid('sup'), ...v, createdAt: Date.now(), updatedAt: Date.now() }); });
          SP.store.audit('supplier.create', v.name, '');
        } else {
          SP.store.update(['suppliers'], (s) => { const t = s.suppliers.find((x) => x.id === c.id); if (t) Object.assign(t, v, { updatedAt: Date.now() }); });
          SP.store.audit('supplier.update', v.name, '');
        }
        SP.ui.toast({ tone: 'ok', title: isNew ? 'Supplier created' : 'Supplier saved' });
        SP.router.refresh();
      },
    });
  }

  function openSupplier(id) {
    const c = SP.store.state.suppliers.find((x) => x.id === id);
    if (!c) return;
    const s = SP.store.state;
    const pos = s.purchases.filter((x) => x.supplierId === id && !x.legacy).sort((a, b) => b.createdAt - a.createdAt);
    const payments = s.payments.filter((p) => p.partyType === 'supplier' && p.partyId === id).sort((a, b) => b.ts - a.ts);
    const received = pos.filter((x) => ['received', 'partial'].includes(x.status));
    const onTime = received.filter((x) => !x.expectedAt || x.updatedAt <= x.expectedAt + 2 * 864e5).length;

    SP.sheet({
      title: c.name,
      subtitle: [c.company, c.phone].filter(Boolean).join(' · '),
      content: SP.el('div.stack.gap-3',
        SP.el('div.kpi-grid',
          SP.ui2.kpi({ label: 'Payable', value: SP.fmt.money(dueOf(c)), tone: dueOf(c) > 0 ? 'warn' : null }),
          SP.ui2.kpi({ label: 'Purchase orders', value: SP.fmt.n(pos.length) }),
          SP.ui2.kpi({ label: 'On-time receipts', value: received.length ? SP.fmt.pct(onTime / received.length * 100) : '—' }),
        ),
        SP.el('dl.kv',
          SP.el('dt', 'Phone'), SP.el('dd', c.phone || '—'),
          SP.el('dt', 'Email'), SP.el('dd', c.email || '—'),
          SP.el('dt', 'Address'), SP.el('dd', c.address || '—'),
          c.notes ? [SP.el('dt', 'Notes'), SP.el('dd', c.notes)] : null),
        SP.el('div',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'History'),
          SP.ui2.timeline([
            ...pos.map((x) => ({ at: x.createdAt, title: `PO ${x.ref} · ${SP.fmt.money(x.total)}`, meta: SP.statusOf('po', x.status).label, tone: 'brand' })),
            ...payments.map((p) => ({ at: p.ts, title: `Paid · ${SP.fmt.money(p.amount)}`, meta: `${p.method} · ${p.by}`, tone: 'ok' })),
          ].sort((a, b) => b.at - a.at).slice(0, 30))),
      ),
      actions: [
        SP.auth.can('suppliers:manage') ? SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => editSupplier(c) }, SP.icon('edit'), 'Edit') : null,
        SP.auth.can('purchases:create') ? SP.el('button.btn.btn--primary', { type: 'button', onclick: () => SP.modules.purchases.openForm() }, SP.icon('cart'), 'New PO') : null,
      ],
    });
  }

  return MOD;
})();
