/**
 * modules/verify.js — physical stock verification / cycle counting.
 *
 * Select warehouse → generate expected sheet → count → compare →
 * recount if needed → submit variances → approval → ledger adjustment.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.verify = (() => {
  const MOD = { title: 'Stock Verification', subtitle: () => `${SP.fmt.pluralise(SP.store.state.counts.length, 'count session')}`, mount };

  function mount(params) {
    if (params?.id) return countDetail(params.id);
    const root = SP.el('div.stack.gap-3');

    root.appendChild(SP.ui2.pageHead({
      title: 'Stock Verification',
      sub: 'Keep the ledger honest: count, compare, approve, adjust.',
      actions: SP.auth.can('verify:perform') ? [SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: startWizard }, SP.icon('plus'), 'New count')] : [],
    }));

    const counts = [...SP.store.state.counts].sort((a, b) => b.createdAt - a.createdAt);
    if (!counts.length) {
      root.appendChild(SP.empty({
        icon: 'scale', title: 'No counts yet',
        body: 'Start a cycle count to compare the ledger against what is physically on the shelf.',
        action: SP.auth.can('verify:perform') ? { label: 'Start a count', onClick: startWizard } : null,
      }));
      return root;
    }
    root.appendChild(SP.el('div.stack.gap-1', ...counts.map((c) => {
      const w = SP.store.state.warehouses.find((x) => x.id === c.warehouseId);
      const variances = c.lines.filter((l) => (l.physical ?? l.expected) !== l.expected).length;
      return SP.el('button.lrow', { type: 'button', onclick: () => SP.router.go('verify', { id: c.id }) },
        SP.el('span.lrow__ico', SP.icon('scale')),
        SP.el('div.lrow__main',
          SP.el('strong', `${c.ref} · ${w?.name || c.warehouseId}`),
          SP.el('small', `${c.lines.length} lines · ${variances} variance${variances === 1 ? '' : 's'} · ${SP.fmt.date(c.createdAt)}`)),
        SP.ui2.badge('count', c.status, { sm: true }));
    })));
    return root;
  }

  /* ─────────────────────────────────────────────────────────── wizard */

  async function startWizard() {
    const s = SP.store.state;
    const res = await SP.modal({
      title: 'New stock count', icon: 'scale', okLabel: 'Generate count sheet',
      fields: [
        { key: 'warehouseId', label: 'Warehouse', type: 'select', required: true, options: s.warehouses.filter((w) => w.active && SP.auth.inScope(w.id)).map((w) => ({ value: w.id, label: w.name })) },
        { key: 'mode', label: 'Count type', type: 'select', options: [{ value: 'full', label: 'Full warehouse count' }, { value: 'cycle', label: 'Cycle count (top movers first)' }], value: 'full' },
        { key: 'blind', label: 'Blind count', type: 'checkbox', checkboxLabel: 'Hide expected quantities from counters', value: false },
      ],
      onOk: async (v) => {
        const map = SP.ledger.stockMap(v.warehouseId);
        let lines = [...map.entries()].map(([pid, qty]) => {
          const p = s.products.find((x) => x.id === pid);
          return { productId: pid, name: p?.name || pid, sku: p?.sku || '', expected: qty, physical: null, recount: false, remarks: '' };
        }).filter((l) => l.expected > 0);
        if (v.mode === 'cycle') {
          const sold = SP.groupBy(s.movements.filter((m) => m.type === 'sale' && m.ts > Date.now() - 30 * 864e5), (m) => m.productId);
          lines = lines.sort((a, b) => SP.sum(sold[b.productId] || [], (m) => m.qty) - SP.sum(sold[a.productId] || [], (m) => m.qty)).slice(0, 20);
        }
        if (!lines.length) throw new Error('No stock at this warehouse to count.');
        const count = {
          id: SP.uid('cnt'), ref: SP.store.nextRef('count'),
          warehouseId: v.warehouseId, mode: v.mode, blind: !!v.blind,
          lines, status: 'open',
          createdBy: SP.auth.current()?.name || 'system',
          createdAt: Date.now(), submittedAt: null, decidedBy: null, decidedAt: null,
        };
        SP.store.update(['counts'], (st) => { st.counts.unshift(count); });
        SP.store.audit('count.create', count.ref, `${lines.length} lines at ${v.warehouseId}`);
        SP.router.go('verify', { id: count.id });
      },
    });
    return res;
  }

  /* ────────────────────────────────────────────────────────── detail */

  function countDetail(id) {
    const c = SP.store.state.counts.find((x) => x.id === id);
    if (!c) return SP.empty({ icon: 'scale', title: 'Count not found', action: { label: 'All counts', onClick: () => SP.router.go('verify') } });
    const w = SP.store.state.warehouses.find((x) => x.id === c.warehouseId);
    const root = SP.el('div.stack.gap-3');
    const editable = c.status === 'open' && SP.auth.can('verify:perform');

    root.appendChild(SP.ui2.pageHead({
      title: `Count ${c.ref} · ${w?.name || c.warehouseId}`,
      sub: `${c.mode === 'cycle' ? 'Cycle count' : 'Full count'} · ${c.blind ? 'blind' : 'open'} · started ${SP.fmt.dateTime(c.createdAt)} by ${c.createdBy}`,
      actions: [
        SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => printSheet(c) }, SP.icon('print'), 'Print sheet'),
        editable ? SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => submit(c) }, SP.icon('check'), 'Submit for approval') : null,
      ],
    }));

    const listHost = SP.el('div.stack.gap-1');
    const draw = () => {
      SP.clear(listHost);
      const done = c.lines.filter((l) => l.physical !== null).length;
      const variance = c.lines.filter((l) => l.physical !== null && l.physical !== l.expected).length;
      root.querySelector('.phead__sub').textContent =
        `${done}/${c.lines.length} counted · ${variance} variance${variance === 1 ? '' : 's'} · ${SP.statusOf('count', c.status).label}`;

      for (const line of c.lines) {
        const diff = line.physical === null ? null : line.physical - line.expected;
        listHost.appendChild(SP.el('div.countline',
          SP.el('div.grow',
            SP.el('strong', line.name),
            SP.el('small.mute', c.blind && editable ? 'expected hidden (blind count)' : `expected ${SP.fmt.n(line.expected)}`),
            line.remarks ? SP.el('small', { style: { display: 'block' } }, `“${line.remarks}”`) : null),
          editable
            ? SP.el('div.row.gap-1', { style: { alignItems: 'center' } },
              SP.el('input.input.input--num', {
                type: 'number', min: 0, value: line.physical ?? '', placeholder: 'count', style: { width: '90px' },
                onchange: (e) => { line.physical = e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0); save(c); draw(); },
              }),
              SP.el('button.btn.btn--icon.btn--sm.btn--quiet', {
                type: 'button', 'aria-label': 'Remark', onclick: async () => {
                  const r = await SP.modal({ title: `Remark — ${line.name}`, fields: [{ key: 'remarks', label: 'Remark', value: line.remarks }], okLabel: 'Save' });
                  if (r) { line.remarks = r.remarks; save(c); draw(); }
                },
              }, SP.icon('edit')))
            : SP.el('div.lrow__end',
              line.physical === null ? SP.el('span.mute', '—')
                : SP.el('span.lrow__val', { style: { color: diff === 0 ? 'var(--ok)' : 'var(--danger)' } },
                  `${SP.fmt.n(line.physical)} (${diff >= 0 ? '+' : ''}${SP.fmt.n(diff)})`)),
        ));
      }
    };
    root.appendChild(listHost);
    draw();

    if (c.status === 'submitted' && SP.auth.can('verify:approve')) {
      const variance = c.lines.filter((l) => (l.physical ?? l.expected) !== l.expected);
      root.appendChild(SP.el('div.card.card--pad.stack.gap-2',
        SP.el('strong', `${variance.length} variance${variance.length === 1 ? '' : 's'} awaiting decision`),
        SP.el('p.tiny.mute', 'Approving posts adjustment movements for every variance into the ledger, referencing this count.'),
        SP.el('div.row.gap-2',
          SP.el('button.btn.btn--ok', { type: 'button', onclick: () => decide(c, true) }, SP.icon('check'), 'Approve & post adjustments'),
          SP.el('button.btn.btn--danger', { type: 'button', onclick: () => decide(c, false) }, SP.icon('x'), 'Reject')),
      ));
    }
    return root;
  }

  const save = (c) => SP.store.update(['counts'], (s) => {
    const t = s.counts.find((x) => x.id === c.id);
    if (t) t.lines = c.lines;
  }, { silent: true });

  function submit(c) {
    const uncounted = c.lines.filter((l) => l.physical === null);
    if (uncounted.length) {
      SP.ui.toast({ tone: 'warn', title: `${uncounted.length} lines not counted`, body: 'Count every line before submitting.' });
      return;
    }
    const variance = c.lines.filter((l) => l.physical !== l.expected);
    SP.store.update(['counts'], (s) => {
      const t = s.counts.find((x) => x.id === c.id);
      t.status = 'submitted'; t.submittedAt = Date.now();
    });
    SP.store.audit('count.submit', c.ref, `${variance.length} variances`);
    if (!variance.length) {
      SP.ui.toast({ tone: 'ok', title: 'Perfect count', body: 'No variances — nothing to approve.' });
      SP.store.update(['counts'], (s) => { const t = s.counts.find((x) => x.id === c.id); t.status = 'approved'; });
    } else {
      SP.store.notify({ tone: 'warn', kind: 'approval', priority: 'high', route: 'verify', title: `Count ${c.ref} needs approval`, body: `${variance.length} variance${variance.length === 1 ? '' : 's'} to review.` });
    }
    SP.router.refresh();
  }

  function decide(c, approve) {
    if (!approve) {
      SP.store.update(['counts'], (s) => { const t = s.counts.find((x) => x.id === c.id); t.status = 'rejected'; });
      SP.store.audit('count.reject', c.ref, '');
      SP.router.refresh();
      return;
    }
    const moves = [];
    for (const l of c.lines) {
      const diff = (l.physical ?? l.expected) - l.expected;
      if (diff === 0) continue;
      moves.push({
        type: diff > 0 ? 'adjust_in' : 'adjust_out',
        productId: l.productId, qty: Math.abs(diff),
        warehouseId: c.warehouseId,
        refType: 'count', refId: c.id,
        reason: `Physical verification ${c.ref}${l.remarks ? ` — ${l.remarks}` : ''}`,
      });
    }
    try {
      SP.ledger.postBatch(moves);
    } catch (e) {
      SP.ui.toast({ tone: 'danger', title: 'Adjustment failed', body: e.message });
      return;
    }
    SP.store.update(['counts'], (s) => {
      const t = s.counts.find((x) => x.id === c.id);
      t.status = 'approved'; t.decidedBy = SP.auth.current()?.name; t.decidedAt = Date.now();
    });
    SP.store.audit('count.approve', c.ref, `${moves.length} adjustments posted`);
    SP.ui.toast({ tone: 'ok', title: 'Variances posted', body: `${moves.length} adjustments in the ledger.` });
    SP.router.refresh();
  }

  function printSheet(c) {
    const blind = c.blind;
    SP.impexp.printDocument({
      title: `Stock Count Sheet ${c.ref}`,
      subtitle: `${SP.store.state.warehouses.find((w) => w.id === c.warehouseId)?.name || ''} · ${SP.fmt.date(c.createdAt)}`,
      bodyHtml: SP.impexp.tableHtml(
        ['SKU', 'Product', blind ? 'Expected (hidden)' : 'Expected', 'Physical', 'Diff', 'Remarks'],
        c.lines.map((l) => [l.sku, l.name, blind ? '—' : l.expected, l.physical ?? '', l.physical === null ? '' : l.physical - l.expected, l.remarks || ''])),
    });
  }

  return MOD;
})();
