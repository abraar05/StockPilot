/**
 * modules/transfers.js — inter-warehouse movements with a status workflow.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.transfers = (() => {
  const state = { status: 'all' };

  const MOD = {
    title: 'Transfers',
    subtitle: () => {
      const open = SP.store.state.transfers.filter((t) => !['received', 'rejected'].includes(t.status)).length;
      return `${SP.fmt.pluralise(open, 'transfer')} in flight`;
    },
    mount,
  };

  const STATUSES = SP.STATUS.transfer;

  async function mount(params) {
    if (params?.status) state.status = params.status;
    if (params?.skuId) setTimeout(() => openForm(params), 140);

    const root = SP.el('div.stack.gap-4');
    const all = [...SP.store.state.transfers].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    /* ── Pipeline summary ─────────────────────────────────────────── */
    const open = all.filter((t) => !['received', 'rejected'].includes(t.status));
    const unitsInFlight = SP.sum(open, (t) => SP.sum(t.lines || [], (l) => l.qty));

    root.appendChild(SP.el('div.hero',
      SP.el('div.hero__eyebrow', SP.icon('swap'), 'In flight'),
      SP.el('div',
        SP.el('div.hero__value', SP.fmt.n(unitsInFlight)),
        SP.el('p.hero__sub',
          `${SP.fmt.pluralise(open.length, 'transfer')} moving stock between sites. `,
          'Every unit transferred here is a unit you do not have to buy.'),
      ),
      SP.el('div.hero__split',
        ...['requested', 'approved', 'in_transit'].map((id) => {
          const def = STATUSES.find((s) => s.id === id);
          const n = all.filter((t) => t.status === id).length;
          return SP.el('div.hero__cell', SP.el('b', SP.fmt.n(n)), SP.el('span', def.label));
        }),
      ),
    ));

    /* ── New transfer ─────────────────────────────────────────────── */
    if (SP.auth.can('create:transfer')) {
      root.appendChild(SP.el('button.btn.btn--primary.btn--lg.btn--block', {
        type: 'button', onclick: () => openForm(),
      }, SP.icon('plus'), 'New transfer'));
    }

    /* ── Filters ──────────────────────────────────────────────────── */
    root.appendChild(SP.chipRow(
      [{ value: 'all', label: 'All', count: all.length },
        ...STATUSES.map((s) => ({ value: s.id, label: s.label, count: all.filter((t) => t.status === s.id).length }))]
        .filter((c) => c.count > 0 || c.value === 'all' || c.value === state.status),
      state.status,
      (v) => { state.status = v; SP.router.refresh(); },
    ));

    /* ── Board ────────────────────────────────────────────────────── */
    const rows = state.status === 'all' ? all : all.filter((t) => t.status === state.status);

    if (!rows.length) {
      root.appendChild(SP.el('div.card', SP.empty({
        icon: 'swap',
        title: 'No transfers yet',
        body: 'Moving stock between sites is the cheapest way to fix a shortfall. Create one when a site runs low.',
        action: SP.auth.can('create:transfer')
          ? { label: 'New transfer', onClick: () => openForm() } : null,
      })));
      return root;
    }

    const cols = ['requested', 'approved', 'in_transit', 'received'];
    root.appendChild(SP.el('div.kanban', ...cols.map((cid) => {
      const def = STATUSES.find((s) => s.id === cid);
      const items = rows.filter((t) => t.status === cid);
      return SP.el('div.kcol',
        SP.el('div.kcol__head',
          SP.el('span.tag', { class: `tag--${def.tone}` }, def.label),
          SP.el('h3', String(items.length)),
        ),
        SP.el('div.kcol__body', ...(items.length
          ? items.map((t) => transferCard(t))
          : [SP.el('p.tiny.mute', { style: { padding: 'var(--sp-3)', textAlign: 'center' } }, 'Nothing here')])),
      );
    })));

    return root;
  }

  function transferCard(t) {
    const from = SP.store.state.warehouses.find((w) => w.id === t.from);
    const to = SP.store.state.warehouses.find((w) => w.id === t.to);
    const units = SP.sum(t.lines || [], (l) => l.qty);
    const first = (t.lines || [])[0];
    const sku = first ? SP.store.state.skus.find((s) => s.id === first.skuId) : null;
    const def = STATUSES.find((s) => s.id === t.status);

    return SP.el('button.kcard', { type: 'button', onclick: () => openDetail(t.id) },
      SP.el('div.kcard__top',
        SP.el('span.kcard__id', t.ref),
        SP.el('span.tag', { class: `tag--${def.tone}` }, def.label),
      ),
      SP.el('div.kcard__title', sku ? `${SP.fmt.shortSku(sku.sku, sku.specs, 30)}` : `${t.lines?.length || 0} lines`),
      SP.el('div.kcard__meta',
        SP.el('span', `${from?.short || t.from} → ${to?.short || t.to}`),
        SP.el('span.badge', { style: { marginLeft: 'auto' } }, SP.fmt.n(units)),
      ),
      (t.lines?.length || 0) > 1 ? SP.el('p.tiny.mute', `+${t.lines.length - 1} more line${t.lines.length > 2 ? 's' : ''}`) : null,
      SP.el('div.kcard__foot',
        SP.el('span.tiny.mute', SP.fmt.ago(t.at)),
        SP.el('span.tiny.mute', { style: { marginLeft: 'auto' } }, t.by || ''),
      ),
    );
  }

  /* ────────────────────────────────────────────────── create form */

  function openForm(prefill = {}) {
    if (!SP.auth.can('create:transfer')) {
      SP.ui.toast({ tone: 'warn', title: 'Not permitted', body: 'Your role cannot create transfers.' });
      return;
    }

    const s = SP.store.state;
    const body = SP.el('div.stack.gap-4');
    let lines = [];

    // Seed from prefill (e.g. arriving from a rebalance suggestion).
    if (prefill.skuId) {
      lines = [{ skuId: prefill.skuId, qty: prefill.qty || 1 }];
    }

    const fromSel = SP.el('select.select', { id: 'tfFrom' },
      ...s.warehouses.map((w) => SP.el('option', {
        value: w.id, selected: prefill.from ? w.id === prefill.from : w.id === (SP.auth.scopeOf()[0] || 'MAIN'),
      }, w.label)),
    );
    const toSel = SP.el('select.select', { id: 'tfTo' },
      ...s.warehouses.map((w) => SP.el('option', {
        value: w.id, selected: w.id === (prefill.to || (s.prefs.warehouse === 'MAIN' ? 'ADMIN' : 'MAIN')),
      }, w.label)),
    );
    const noteInput = SP.el('textarea.textarea', { id: 'tfNote', placeholder: 'Reason, vehicle, contact…' });

    const linesHost = SP.el('div.stack.gap-2');

    function renderLines() {
      SP.clear(linesHost);
      linesHost.appendChild(SP.el('div.row.gap-2',
        SP.el('div.grow.tiny.mute', { style: { fontWeight: '650' } }, 'Items'),
        SP.el('span.tiny.mute', `${SP.fmt.pluralise(lines.length, 'line')} · ${SP.fmt.n(SP.sum(lines, (l) => l.qty))} units`),
      ));

      if (!lines.length) {
        linesHost.appendChild(SP.el('p.tiny.mute', { style: { padding: 'var(--sp-3) 0' } }, 'No items added yet.'));
      }

      lines.forEach((line, i) => {
        const sku = s.skus.find((x) => x.id === line.skuId);
        const avail = Number(sku?.byWh?.[fromSel.value]) || 0;
        const qtyInput = SP.el('input.input.input--num', {
          type: 'number', min: 1, max: avail || 9999, value: line.qty,
          'aria-label': 'Quantity',
          oninput: (e) => { line.qty = SP.clamp(e.target.value, 1, 99999); renderLines(); },
        });
        linesHost.appendChild(SP.el('div.card.card--flat.card--tight.row.gap-2',
          SP.el('div.grow',
            SP.el('strong', { style: { fontSize: 'var(--fs-md)' } }, sku?.sku || 'Unknown SKU'),
            SP.el('p.tiny.mute', `${sku?.specs || ''} · ${SP.fmt.n(avail)} available at ${fromSel.value}`),
          ),
          SP.el('div', { style: { width: '96px' } }, qtyInput),
          SP.el('button.btn.btn--icon.btn--sm.btn--quiet', {
            type: 'button', 'aria-label': 'Remove line',
            onclick: () => { lines.splice(i, 1); renderLines(); },
          }, SP.icon('trash')),
        ));
      });

      linesHost.appendChild(SP.el('button.btn.btn--ghost.btn--sm.btn--block', {
        type: 'button', onclick: addLine,
      }, SP.icon('plus'), 'Add item'));
    }

    async function addLine() {
      const res = await SP.modal({
        title: 'Add item',
        subtitle: `Stock currently held at ${fromSel.value}`,
        icon: 'box',
        fields: [{
          key: 'skuId', label: 'SKU', type: 'select',
          value: lines[0]?.skuId || s.skus[0]?.id,
          options: s.skus.filter((x) => !x.archived).map((x) => ({
            value: x.id,
            label: `${SP.fmt.shortSku(x.sku, x.specs, 34)} · ${SP.fmt.n(Number(x.byWh?.[fromSel.value]) || 0)} at ${fromSel.value}`,
          })),
        }],
        okLabel: 'Add',
      });
      if (res && res.skuId) {
        const existing = lines.find((l) => l.skuId === res.skuId);
        if (existing) existing.qty += 1;
        else lines.push({ skuId: res.skuId, qty: 1 });
        renderLines();
      }
    }

    body.appendChild(SP.el('div.grid-form',
      SP.el('div.field', SP.el('label.field__label', 'From'), fromSel),
      SP.el('div.field', SP.el('label.field__label', 'To'), toSel),
    ));
    body.appendChild(SP.el('div.field', SP.el('label.field__label', 'Items'), linesHost));
    body.appendChild(SP.el('div.field', SP.el('label.field__label', 'Note'), noteInput));

    renderLines();

    SP.modal({
      title: 'New transfer',
      subtitle: 'Moving stock is cheaper than buying it',
      icon: 'swap',
      body,
      okLabel: 'Submit request',
      onOk: () => {
        if (fromSel.value === toSel.value) throw new Error('Choose two different sites.');
        if (!lines.length) throw new Error('Add at least one item.');

        for (const l of lines) {
          const sku = s.skus.find((x) => x.id === l.skuId);
          const avail = Number(sku?.byWh?.[fromSel.value]) || 0;
          if (l.qty > avail) {
            throw new Error(`${sku?.sku || 'Item'}: only ${SP.fmt.n(avail)} available at ${fromSel.value}.`);
          }
        }

        const ref = SP.ref('TR', SP.store.state.transfers.length + 1);
        const record = {
          id: SP.uid('tr'),
          ref,
          at: Date.now(),
          from: fromSel.value,
          to: toSel.value,
          note: noteInput.value.trim(),
          status: 'requested',
          by: SP.auth.currentUser?.name || '',
          lines: lines.map((l) => ({ ...l })),
        };
        SP.store.update(['transfers'], (st) => { st.transfers.unshift(record); });
        SP.store.audit('transfer.create', ref, `${fromSel.value} → ${toSel.value}`);
        SP.sheets.push({ type: 'transfer.create', ...record });
        SP.store.notify({
          tone: 'info', title: 'Transfer requested',
          body: `${ref} · ${fromSel.value} → ${toSel.value}`,
        });
        SP.ui.toast({ tone: 'ok', title: 'Transfer created', body: ref });
        SP.router.refresh();
      },
    });
  }

  /* ────────────────────────────────────────────────── detail sheet */

  function openDetail(id) {
    const t = SP.store.state.transfers.find((x) => x.id === id);
    if (!t) return;
    const from = SP.store.state.warehouses.find((w) => w.id === t.from);
    const to = SP.store.state.warehouses.find((w) => w.id === t.to);
    const def = STATUSES.find((s) => s.id === t.status);

    const body = SP.el('div.stack.gap-4',
      SP.el('div.row.gap-3',
        SP.el('div.grow',
          SP.el('div', { style: { fontFamily: 'var(--font-num)', fontSize: 'var(--fs-2xl)', fontWeight: '750' } }, SP.fmt.n(SP.sum(t.lines || [], (l) => l.qty))),
          SP.el('div.tiny.mute', `units · ${from?.label} → ${to?.label}`),
        ),
        SP.el('span.tag', { class: `tag--${def.tone}` }, def.label),
      ),
      t.note ? SP.el('div.callout', { dataset: { tone: 'info' } },
        SP.el('span.callout__ico', SP.icon('info')),
        SP.el('div.callout__body', SP.el('p', t.note)),
      ) : null,
      SP.el('div.stacklist', ...(t.lines || []).map((l) => {
        const sku = SP.store.state.skus.find((x) => x.id === l.skuId);
        return SP.el('div.card.card--flat.card--tight.row.gap-3',
          SP.el('div.grow',
            SP.el('strong', sku?.sku || 'SKU'),
            SP.el('p.tiny.mute', sku?.specs || ''),
          ),
          SP.el('b.num', SP.fmt.n(l.qty)),
        );
      })),
      SP.el('dl.kv',
        SP.el('dt', 'Reference'), SP.el('dd', SP.el('code', t.ref)),
        SP.el('dt', 'Raised by'), SP.el('dd', t.by || '—'),
        SP.el('dt', 'Raised at'), SP.el('dd', SP.fmt.dateTime(t.at)),
      ),
    );

    const actions = [SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => ctl.close() }, 'Close')];

    const next = { requested: 'approved', approved: 'in_transit', in_transit: 'received' }[t.status];
    if (next && SP.auth.can('approve:po')) {
      const label = { approved: 'Approve', in_transit: 'Mark in transit', received: 'Confirm receipt' }[next];
      const btn = SP.el('button.btn.btn--primary', { type: 'button' }, label);
      btn.addEventListener('click', () => advance(t.id, next));
      actions.push(btn);
    }
    if (t.status === 'requested' && SP.auth.can('approve:po')) {
      const rej = SP.el('button.btn.btn--ghost', { type: 'button' }, 'Reject');
      rej.addEventListener('click', () => advance(t.id, 'rejected'));
      actions.splice(1, 0, rej);
    }

    const ctl = SP.sheet({ title: `Transfer ${t.ref}`, content: body, actions });
  }

  async function advance(id, status) {
    const t = SP.store.state.transfers.find((x) => x.id === id);
    if (!t) return;

    if (status === 'rejected') {
      const ok = await SP.modal({
        title: 'Reject transfer?', subtitle: t.ref, icon: 'alert', tone: 'danger',
        okLabel: 'Reject transfer',
        body: SP.el('p', 'The request will be closed. Stock levels are unchanged.'),
      });
      if (!ok) return;
    }

    SP.store.update(['transfers'], (st) => {
      const x = st.transfers.find((v) => v.id === id);
      if (!x) return;
      x.status = status;
      x.updatedAt = Date.now();

      // Receiving a transfer moves units between sites. The per-colour
      // breakdown is a network-wide view of the same total, so it is
      // deliberately left untouched.
      if (status === 'received') {
        for (const l of x.lines || []) {
          const sku = st.skus.find((s) => s.id === l.skuId);
          if (!sku) continue;
          const available = Number(sku.byWh?.[x.from]) || 0;
          const move = Math.min(l.qty, available);
          if (move <= 0) continue;
          sku.byWh[x.from] = available - move;
          sku.byWh[x.to] = (Number(sku.byWh?.[x.to]) || 0) + move;
          sku.updatedAt = Date.now();
        }
      }
    });

    SP.store.audit('transfer.status', t.ref, status);
    SP.sheets.push({ type: 'transfer.status', ref: t.ref, status });
    SP.ui.toast({
      tone: 'ok', title: `Transfer ${status.replace('_', ' ')}`,
      body: status === 'received' ? 'Stock levels updated at both sites.' : t.ref,
    });
    SP.router.refresh();
  }

  return { ...MOD, openForm, openDetail };
})();