/**
 * modules/purchase.js — purchase order lifecycle.
 * draft → pending → approved → ordered → received, with approval gating.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.purchase = (() => {
  const state = { status: 'all' };

  const MOD = {
    title: 'Purchase Orders',
    subtitle: () => {
      const open = SP.store.state.purchases.filter((p) => !['received', 'cancelled'].includes(p.status));
      return `${SP.fmt.pluralise(open.length, 'order')} open · ${SP.fmt.money(SP.sum(open, (p) => p.total))}`;
    },
    mount,
  };

  const STATUSES = SP.STATUS.po;

  /** Sentinel meaning "keep the existing colour mix" on a purchase line. */
  const SKIP_COLOUR = '__mixed__';

  async function mount(params) {
    if (params?.status) state.status = params.status;
    if (params?.new) setTimeout(() => createFromPlan(SP.engine.refillPlan({}).filter((r) => r.urgency.id !== 'adequate')), 140);

    const root = SP.el('div.stack.gap-4');
    const all = [...SP.store.state.purchases].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const open = all.filter((p) => !['received', 'cancelled'].includes(p.status));

    /* ── Header ───────────────────────────────────────────────────── */
    root.appendChild(SP.el('div.hero',
      SP.el('div.hero__eyebrow', SP.icon('cart'), 'Committed capital'),
      SP.el('div',
        SP.el('div.hero__value', SP.fmt.money(SP.sum(open, (p) => p.total))),
        SP.el('p.hero__sub',
          `${SP.fmt.pluralise(open.length, 'order')} awaiting delivery. `,
          `${SP.fmt.n(SP.sum(open, (p) => SP.sum(p.lines || [], (l) => l.qty)))} units on order.`),
      ),
      SP.el('div.hero__split',
        cell(SP.fmt.moneyCompact(SP.engine.capitalSummary().onHandValue), 'Stock value', 'var(--brand)'),
        cell(SP.fmt.moneyCompact(SP.engine.capitalSummary().needed), 'Plan requires', 'var(--warn)'),
        cell(SP.fmt.n(all.filter((p) => p.status === 'pending').length), 'Awaiting approval', 'var(--info)'),
      ),
    ));

    if (SP.auth.can('create:po')) {
      root.appendChild(SP.el('button.btn.btn--primary.btn--lg.btn--block', {
        type: 'button',
        onclick: () => createFromPlan(
          SP.engine.refillPlan({}).filter((r) => r.urgency.id !== 'adequate' && r.suggestedQty > 0),
        ),
      }, SP.icon('plus'), 'New purchase order from Refill Radar'));
    }

    /* ── Filters ──────────────────────────────────────────────────── */
    root.appendChild(SP.chipRow(
      [{ value: 'all', label: 'All', count: all.length },
        ...STATUSES.map((s) => ({ value: s.id, label: s.label, count: all.filter((p) => p.status === s.id).length }))]
        .filter((c) => c.count > 0 || c.value === 'all' || c.value === state.status),
      state.status,
      (v) => { state.status = v; SP.router.refresh(); },
    ));

    const rows = state.status === 'all' ? all : all.filter((p) => p.status === state.status);

    if (!rows.length) {
      root.appendChild(SP.el('div.card', SP.empty({
        icon: 'cart',
        title: 'No purchase orders yet',
        body: 'Build one from the Refill Radar queue and the suggested quantities carry across automatically.',
        action: SP.auth.can('create:po')
          ? { label: 'Build from Refill Radar', onClick: () => createFromPlan(SP.engine.refillPlan({}).filter((r) => r.urgency.id !== 'adequate')) }
          : null,
      })));
      return root;
    }

    root.appendChild(SP.el('div.stacklist', ...rows.map((p) => orderCard(p))));

    return root;

    function cell(v, label, colour) {
      return SP.el('div.hero__cell', SP.el('b', { style: { color: colour } }, v), SP.el('span', label));
    }
  }

  function orderCard(p) {
    const def = STATUSES.find((s) => s.id === p.status);
    const units = SP.sum(p.lines || [], (l) => l.qty);
    return SP.el('button.card.card--pad', {
      type: 'button', style: { textAlign: 'left', width: '100%' },
      onclick: () => openDetail(p.id),
    },
      SP.el('div.row.gap-3',
        SP.el('div.grow',
          SP.el('div.row.gap-2',
            SP.el('strong', { style: { fontSize: 'var(--fs-lg)' } }, p.ref),
            SP.el('span.tag', { class: `tag--${def.tone}` }, def.label),
          ),
          SP.el('p.tiny.mute', { style: { marginTop: '3px' } },
            `${SP.fmt.pluralise(p.lines?.length || 0, 'line')} · ${SP.fmt.n(units)} units · raised ${SP.fmt.ago(p.at)}`,
            p.supplier ? ` · ${p.supplier}` : ''),
        ),
        SP.el('div.right',
          SP.el('div', { style: { fontFamily: 'var(--font-num)', fontSize: 'var(--fs-lg)', fontWeight: '750' } }, SP.fmt.money(p.total)),
          SP.el('span.tiny.mute', p.by || ''),
        ),
      ),
    );
  }

  /* ────────────────────────────────────────── build from plan rows */

  /**
   * Open the order builder seeded from Refill Radar output.
   * @param {object[]} planRows  engine.suggest() records
   */
  function createFromPlan(planRows) {
    if (!SP.auth.can('create:po')) {
      SP.ui.toast({ tone: 'warn', title: 'Not permitted', body: 'Your role cannot create purchase orders.' });
      return;
    }

    const rows = (planRows || [])
      .filter((r) => r && r.suggestedQty > 0)
      .map((r) => ({
        skuId: r.skuId,
        qty: r.buyQty || r.suggestedQty,
        unitCost: r.unitCost,
        colour: SKIP_COLOUR,
        included: r.buyQty === 0 ? false : true,   // transfer-only lines start unchecked
        reason: r.reason,
      }));

    if (!rows.length) {
      SP.ui.toast({
        tone: 'ok', title: 'Nothing to buy',
        body: 'Every shortfall can be covered by transferring existing stock.',
      });
      return;
    }

    const body = SP.el('div.stack.gap-4');
    const state2 = { rows, supplier: '', note: '' };
    const listHost = SP.el('div.stack.gap-2');
    const totalHost = SP.el('div');

    const supplierInput = SP.el('input.input', {
      placeholder: 'Supplier name (optional)', value: '',
      oninput: (e) => { state2.supplier = e.target.value; },
    });
    const noteInput = SP.el('textarea.textarea', {
      placeholder: 'Delivery instructions, PO reference, terms…',
      oninput: (e) => { state2.note = e.target.value; },
    });

    function render() {
      SP.clear(listHost);
      const selected = state2.rows.filter((r) => r.included);
      const total = SP.sum(selected, (r) => r.qty * r.unitCost);

      SP.clear(totalHost);
      totalHost.appendChild(SP.el('div.callout', { dataset: { tone: total > 0 ? 'brand' : 'warn' } },
        SP.el('span.callout__ico', SP.icon(total > 0 ? 'cart' : 'info')),
        SP.el('div.callout__body',
          SP.el('strong', total > 0
            ? `${SP.fmt.pluralise(selected.length, 'line')} · ${SP.fmt.n(SP.sum(selected, (r) => r.qty))} units · ${SP.fmt.money(total)}`
            : 'No lines selected'),
          SP.el('p', state2.rules?.minOrderValue && total < SP.store.state.rules.minOrderValue
            ? `Below the ${SP.fmt.money(SP.store.state.rules.minOrderValue)} minimum order value — suppliers often add a delivery fee below this.`
            : 'Quantities were sized by the Refill Radar to cover the target horizon.'),
        ),
      ));

      if (!state2.rows.length) {
        listHost.appendChild(SP.el('p.mute', { style: { textAlign: 'center', padding: 'var(--sp-4)' } }, 'No lines.'));
        return;
      }

      state2.rows.forEach((r, i) => {
        const sku = SP.store.state.skus.find((x) => x.id === r.skuId);
        if (!sku) return;
        const qtyInput = SP.el('input.input.input--num', {
          type: 'number', min: 0, value: r.qty, 'aria-label': `Quantity for ${sku.sku}`,
          oninput: (e) => { r.qty = SP.clamp(e.target.value, 0, 999999); render(); },
        });
        const colourSel = SP.el('select.select', {
          'aria-label': `Colour for ${sku.sku}`,
          style: { minHeight: '34px', fontSize: 'var(--fs-xs)', padding: '0 26px 0 10px' },
          onchange: (e) => { r.colour = e.target.value; },
        },
          ...SP.COLOURS.map((c) => SP.el('option', {
            value: c, selected: (r.colour || SKIP_COLOUR) === c,
          }, c)),
          SP.el('option', { value: SKIP_COLOUR, selected: (r.colour || SKIP_COLOUR) === SKIP_COLOUR }, 'Mixed'),
        );
        const checkbox = SP.el('input', {
          type: 'checkbox', checked: r.included,
          onchange: (e) => { r.included = e.target.checked; render(); },
        });

        listHost.appendChild(SP.el('div.card.card--flat.card--tight',
          SP.el('div.row.gap-3',
            SP.el('label.check', checkbox, SP.el('span.check__box')),
            SP.el('div.grow',
              SP.el('strong', { style: { fontSize: 'var(--fs-md)' } }, sku.sku),
              SP.el('p.tiny.mute', `${sku.specs} · ${r.reason || ''}`),
            ),
            SP.el('div', { style: { width: '104px' } }, qtyInput),
            SP.el('div', { style: { width: '104px' } }, colourSel),
            SP.el('div.right', { style: { minWidth: '76px' } },
              SP.el('b.num', { style: { fontSize: 'var(--fs-md)' } }, SP.fmt.money(r.qty * r.unitCost)),
              SP.el('p.tiny.mute', `${SP.fmt.money(r.unitCost)} ea`),
            ),
            SP.el('button.btn.btn--icon.btn--sm.btn--quiet', {
              type: 'button', 'aria-label': 'Remove line',
              onclick: () => { state2.rows.splice(i, 1); render(); },
            }, SP.icon('trash')),
          ),
        ));
      });
    }

    body.appendChild(SP.el('div.grid-form',
      SP.el('div.field', SP.el('label.field__label', 'Supplier'), supplierInput),
      SP.el('div.field', SP.el('label.field__label', 'Internal note'), noteInput),
    ));
    body.appendChild(SP.el('div', SP.el('div.divider-label', { style: { marginBottom: 'var(--sp-2)' } }, 'Lines'), listHost));
    body.appendChild(totalHost);

    render();

    SP.modal({
      title: 'New purchase order',
      subtitle: `${state2.rows.length} suggested line${state2.rows.length === 1 ? '' : 's'}`,
      icon: 'cart',
      body,
      okLabel: 'Save as draft',
      onOk: () => {
        const selected = state2.rows.filter((r) => r.included && r.qty > 0);
        if (!selected.length) throw new Error('Select at least one line.');

        const lines = selected.map((r) => ({
          skuId: r.skuId,
          qty: r.qty,
          unitCost: r.unitCost,
          total: r.qty * r.unitCost,
        }));
        const total = SP.sum(lines, (l) => l.total);

        const ref = SP.ref('PR', SP.store.state.purchases.length + 1);
        const record = {
          id: SP.uid('po'),
          ref,
          at: Date.now(),
          supplier: state2.supplier.trim(),
          note: state2.note.trim(),
          status: 'draft',
          lines,
          total,
          by: SP.auth.currentUser?.name || '',
        };

        SP.store.update(['purchases'], (st) => { st.purchases.unshift(record); });
        SP.store.audit('po.create', ref, `${lines.length} lines · ${SP.fmt.money(total)}`);
        SP.sheets.push({ type: 'po.create', ...record });
        SP.store.notify({
          tone: 'ok', title: 'Draft created', body: `${ref} · ${SP.fmt.money(total)}`,
        });
        SP.ui.toast({ tone: 'ok', title: 'Draft saved', body: `${ref} · ${SP.fmt.money(total)}` });
        SP.router.go('purchase');
      },
    });
  }

  /* ───────────────────────────────────────────────────── detail */

  function openDetail(id) {
    const p = SP.store.state.purchases.find((x) => x.id === id);
    if (!p) return;
    const def = STATUSES.find((s) => s.id === p.status);

    const body = SP.el('div.stack.gap-4',
      SP.el('div.row.gap-3',
        SP.el('div.grow',
          SP.el('div', { style: { fontFamily: 'var(--font-num)', fontSize: 'var(--fs-2xl)', fontWeight: '750' } }, SP.fmt.money(p.total)),
          SP.el('div.tiny.mute', `${SP.fmt.pluralise(p.lines?.length || 0, 'line')} · ${SP.fmt.n(SP.sum(p.lines || [], (l) => l.qty))} units`),
        ),
        SP.el('span.tag', { class: `tag--${def.tone}` }, def.label),
      ),
      p.note ? SP.el('div.callout', { dataset: { tone: 'info' } },
        SP.el('span.callout__ico', SP.icon('info')), SP.el('div.callout__body', SP.el('p', p.note))) : null,
      SP.el('div.tablewrap',
        SP.el('table.table.table--compact',
          SP.el('thead', SP.el('tr',
            SP.el('th', 'Model'), SP.el('th.num', 'Qty'), SP.el('th.num', 'Unit'), SP.el('th.num', 'Total'),
          )),
          SP.el('tbody', ...(p.lines || []).map((l) => {
            const sku = SP.store.state.skus.find((x) => x.id === l.skuId);
            return SP.el('tr',
              SP.el('td', SP.el('div.cell-main',
                SP.el('strong', sku?.sku || l.skuId), SP.el('small', sku?.specs || ''))),
              SP.el('td.num', SP.fmt.n(l.qty)),
              SP.el('td.num', SP.fmt.money(l.unitCost)),
              SP.el('td.num', SP.fmt.money(l.total)),
            );
          })),
          SP.el('tfoot', SP.el('tr',
            SP.el('td', { colspan: 3 }, 'Total'),
            SP.el('td.num', SP.fmt.money(p.total)),
          )),
        ),
      ),
      SP.el('dl.kv',
        SP.el('dt', 'Reference'), SP.el('dd', SP.el('code', p.ref)),
        SP.el('dt', 'Supplier'), SP.el('dd', p.supplier || '—'),
        SP.el('dt', 'Raised by'), SP.el('dd', p.by || '—'),
        SP.el('dt', 'Raised at'), SP.el('dd', SP.fmt.dateTime(p.at)),
      ),
    );

    const actions = [SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => ctl.close() }, 'Close')];

    const flow = {
      draft: 'pending', pending: 'approved', approved: 'ordered', ordered: 'received',
    };
    const next = flow[p.status];
    if (next) {
      const needsApprove = p.status === 'pending' && !SP.auth.can('approve:po');
      const label = {
        pending: 'Submit for approval', approved: 'Approve', ordered: 'Mark ordered', received: 'Receive stock',
      }[next];
      const btn = SP.el('button.btn.btn--primary', { type: 'button' }, label);
      btn.addEventListener('click', async () => {
        if (needsApprove) {
          const ok = await SP.modal({
            title: 'Approval required',
            subtitle: 'Only a manager or admin can approve purchase orders.',
            icon: 'lock', tone: 'warn', okLabel: 'Request approval',
          });
          if (ok) advance(p.id, 'pending');
          return;
        }
        if (next === 'received') { const ok = await confirmReceive(p); if (ok) advance(p.id, next); return; }
        advance(p.id, next);
      });
      actions.push(btn);
    }
    if (!['cancelled', 'received'].includes(p.status) && SP.auth.can('approve:po')) {
      const cancel = SP.el('button.btn.btn--ghost', { type: 'button' }, 'Cancel');
      cancel.addEventListener('click', () => advance(p.id, 'cancelled'));
      actions.splice(actions.length - 1, 0, cancel);
    }

    const ctl = SP.sheet({ title: `Order ${p.ref}`, subtitle: def.label, content: body, actions });
  }

  async function confirmReceive(p) {
    const fields = (p.lines || []).map((l) => {
      const sku = SP.store.state.skus.find((x) => x.id === l.skuId);
      return { key: `recv_${l.skuId}`, label: sku?.sku || l.skuId, type: 'number', value: l.qty, min: 0, suffix: 'units' };
    });
    const res = await SP.modal({
      title: 'Receive stock',
      subtitle: 'Confirm what physically arrived. Quantities are added to your default warehouse.',
      icon: 'download',
      fields,
      okLabel: 'Confirm receipt',
      onOk: (v) => {
        const targetWh = SP.store.state.prefs.warehouse || 'MAIN';
        let added = 0;
        SP.store.update(['skus'], (st) => {
          for (const l of p.lines || []) {
            const qty = Number(v[`recv_${l.skuId}`]) || 0;
            if (qty <= 0) continue;
            added += qty;
            const sku = st.skus.find((x) => x.id === l.skuId);
            if (!sku) continue;
            sku.byWh[targetWh] = (Number(sku.byWh?.[targetWh]) || 0) + qty;
            sku.colours = SP.engine.adjustColours(sku, qty, {
              colour: l.colour === SKIP_COLOUR ? undefined : l.colour,
            });
            sku.updatedAt = Date.now();
          }
        });
        SP.store.audit('po.receive', p.ref, `${added} units into ${targetWh}`);
        SP.sheets.push({ type: 'po.receive', ref: p.ref, warehouse: targetWh });
        SP.ui.toast({ tone: 'ok', title: 'Stock received', body: `${SP.fmt.n(added)} units added to ${targetWh}.` });
      },
    });
    return !!res;
  }

  function advance(id, status) {
    const p = SP.store.state.purchases.find((x) => x.id === id);
    if (!p) return;
    SP.store.update(['purchases'], (st) => {
      const x = st.purchases.find((v) => v.id === id);
      if (!x) return;
      x.status = status;
      x.updatedAt = Date.now();
      x.history = [...(x.history || []), { status, at: Date.now(), by: SP.auth.currentUser?.name || '' }];
    });
    SP.store.audit('po.status', p.ref, status);
    SP.sheets.push({ type: 'po.status', ref: p.ref, status });
    SP.ui.toast({ tone: 'ok', title: `Order ${status}`, body: p.ref });
    SP.router.refresh();
  }

  return { ...MOD, createFromPlan, openDetail };
})();