/**
 * modules/sales.js — dispatch / sales ledger.
 * Recording a dispatch decrements stock and feeds the velocity engine.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.sales = (() => {
  const state = { q: '', warehouse: '*', type: 'all', range: 30 };

  const MOD = {
    title: 'Dispatch Log',
    subtitle: () => {
      const n = SP.store.state.sales.length;
      return `${SP.fmt.pluralise(n, 'entry', 'entries')} recorded`;
    },
    mount,
  };

  async function mount(params) {
    if (params?.skuId) setTimeout(() => openForm(params), 140);

    const root = SP.el('div.stack.gap-4');
    const s = SP.store.state;

    /* ── Stats ────────────────────────────────────────────────────── */
    const cutoff = Date.now() - state.range * 864e5;
    const inRange = s.sales.filter((x) => Date.parse(x.at) >= cutoff);
    const out = inRange.filter((x) => x.type !== 'return').reduce((a, x) => a + (x.qty || 0), 0);
    const back = inRange.filter((x) => x.type === 'return').reduce((a, x) => a + (x.qty || 0), 0);
    const value = inRange.filter((x) => x.type !== 'return')
      .reduce((a, x) => a + (x.qty || 0) * (x.sellPrice ?? x.unitCost ?? 0), 0);

    root.appendChild(SP.el('div.hero',
      SP.el('div.hero__eyebrow', SP.icon('truck'), `Last ${state.range} days`),
      SP.el('div',
        SP.el('div.hero__value', SP.fmt.n(Math.max(0, out - back))),
        SP.el('p.hero__sub',
          `Net units dispatched · ${SP.fmt.pluralise(inRange.length, 'entry', 'entries')} · `,
          SP.el('strong', { style: { color: 'var(--ok)' } }, SP.fmt.money(value)), ' at recorded value.'),
      ),
      SP.el('div.hero__split',
        cell(SP.fmt.n(out), 'Dispatched', 'var(--info)'),
        cell(SP.fmt.n(back), 'Returned', 'var(--warn)'),
        cell(out ? SP.fmt.pct((back / Math.max(1, out)) * 100, 1) : '0%', 'Return rate', 'var(--violet)'),
      ),
    ));

    /* ── Range + create ───────────────────────────────────────────── */
    root.appendChild(SP.el('div.row.gap-2.row--wrap',
      SP.el('select.select', {
        style: { flex: '1 1 140px' }, 'aria-label': 'Period',
        onchange: (e) => { state.range = Number(e.target.value); SP.router.refresh(); },
      },
        ...[7, 14, 30, 90, 365].map((d) => SP.el('option', {
          value: d, selected: state.range === d,
        }, d === 365 ? 'Last year' : `Last ${d} days`)),
      ),
      SP.auth.can('create:sale') ? SP.el('button.btn.btn--primary.grow', {
        type: 'button', onclick: () => openForm(),
      }, SP.icon('plus'), 'Record dispatch') : null,
      SP.el('button.btn.btn--ghost', { type: 'button', onclick: exportCsv }, SP.icon('download')),
    ));

    /* ── Trend ────────────────────────────────────────────────────── */
    const trend = SP.engine.salesTrend(Math.min(state.range, 30));
    root.appendChild(SP.el('div.card',
      SP.el('div.card__head', SP.icon('chart'), SP.el('h2', 'Daily movement')),
      SP.el('div.card__body',
        SP.charts.lines({
          labels: trend.map((d) => d.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
          series: [{ label: 'Units', values: trend.map((d) => d.units), colour: SP.engine.colourHex('Blue') }],
          height: 150,
        }),
      ),
    ));

    /* ── Filters ──────────────────────────────────────────────────── */
    root.appendChild(SP.el('div.grid.grid--2',
      SP.el('div.searchbar',
        SP.icon('search'),
        SP.el('input.input', {
          type: 'search', placeholder: 'Search SKU or customer…', value: state.q,
          oninput: SP.debounce((e) => { state.q = e.target.value; renderList(); }, 200),
        }),
      ),
      SP.el('select.select', {
        'aria-label': 'Type',
        onchange: (e) => { state.type = e.target.value; renderList(); },
      },
        ...[['all', 'All movements'], ['dispatch', 'Dispatches'], ['return', 'Returns']]
          .map(([v, l]) => SP.el('option', { value: v, selected: state.type === v }, l)),
      ),
    ));

    const listHost = SP.el('div');
    root.appendChild(listHost);

    function renderList() {
      const q = state.q.trim().toLowerCase();
      const rows = [...s.sales]
        .filter((x) => (Date.parse(x.at) >= cutoff))
        .filter((x) => (state.type === 'all' ? true : x.type === state.type))
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .filter((x) => {
          if (!q) return true;
          const sku = s.skus.find((k) => k.id === x.skuId);
          return `${sku?.sku || ''} ${x.customer || ''} ${x.note || ''}`.toLowerCase().includes(q);
        });

      SP.clear(listHost);

      if (!rows.length) {
        listHost.appendChild(SP.el('div.card', SP.empty({
          icon: 'truck',
          title: 'No dispatches in this window',
          body: 'Recording dispatches is what unlocks sales velocity, cover forecasts and dead-stock detection.',
          action: SP.auth.can('create:sale') ? { label: 'Record a dispatch', onClick: () => openForm() } : null,
        })));
        return;
      }

      listHost.appendChild(SP.el('div.card',
        SP.el('div.card__head',
          SP.el('h2', `${SP.fmt.n(rows.length)} entries`),
          SP.el('span.sub', `${SP.fmt.n(SP.sum(rows, (r) => r.type === 'return' ? -(r.qty || 0) : (r.qty || 0)))} net units`),
        ),
        ...rows.slice(0, 60).map((x) => {
          const sku = s.skus.find((k) => k.id === x.skuId);
          const isReturn = x.type === 'return';
          return SP.el('div.lrow', { role: 'button', tabIndex: 0 },
            SP.el('span.lrow__ico', {
              style: {
                background: isReturn ? 'var(--warn-soft)' : 'var(--info-soft)',
                color: isReturn ? 'var(--warn)' : 'var(--info)',
              },
            }, SP.icon(isReturn ? 'refresh' : 'truck')),
            SP.el('div.lrow__main',
              SP.el('strong', `${isReturn ? '↩ ' : ''}${SP.fmt.n(x.qty)} × ${sku?.sku || 'Unknown'}`),
              SP.el('small', [
                sku?.specs,
                x.customer,
                x.note,
                x.warehouse ? `@ ${x.warehouse}` : null,
              ].filter(Boolean).join(' · ')),
            ),
            SP.el('div.lrow__end',
              SP.el('span.lrow__val', { style: { color: isReturn ? 'var(--warn)' : 'var(--text)' } },
                `${isReturn ? '−' : '−'}${SP.fmt.n(x.qty)}`),
              SP.el('span.tiny.mute', SP.fmt.ago(x.at)),
            ),
          );
        }),
        rows.length > 60 ? SP.el('div', { style: { padding: 'var(--sp-3)', textAlign: 'center' } },
          SP.el('p.tiny.mute', `Showing the first 60 of ${rows.length}. Export for the full history.`)) : null,
      ));
    }

    renderList();
    return root;

    function cell(v, label, colour) {
      return SP.el('div.hero__cell', SP.el('b', { style: { color: colour } }, v), SP.el('span', label));
    }
  }

  /* ───────────────────────────────────────────────────── create */

  function openForm(prefill = {}) {
    if (!SP.auth.can('create:sale')) {
      SP.ui.toast({ tone: 'warn', title: 'Not permitted', body: 'Your role cannot record dispatches.' });
      return;
    }
    const s = SP.store.state;

    const fields = [
      {
        key: 'skuId', label: 'SKU', type: 'select',
        value: prefill.skuId || s.skus.find((x) => !x.archived)?.id,
        options: s.skus.filter((x) => !x.archived).map((x) => ({
          value: x.id, label: SP.fmt.shortSku(x.sku, x.specs, 38),
        })),
      },
      { key: 'qty', label: 'Quantity', type: 'number', value: 1, min: 1, required: true },
      {
        key: 'colour', label: 'Colour variant', type: 'select',
        value: SP.engine.activeColours(prefill.skuId
          ? s.skus.find((x) => x.id === prefill.skuId)
          : s.skus.find((x) => x.id === prefill.skuId) || s.skus[0])[0]?.colour || SP.COLOURS[0],
        options: SP.COLOURS.map((c) => ({ value: c, label: c })),
        hint: 'Used to keep the per-colour breakdown accurate.',
      },
      {
        key: 'type', label: 'Movement', type: 'select', value: prefill.type || 'dispatch',
        options: [{ value: 'dispatch', label: 'Dispatch (stock out)' }, { value: 'return', label: 'Return (stock in)' }],
      },
      {
        key: 'warehouse', label: 'From warehouse', type: 'select',
        value: prefill.warehouse || SP.auth.scopeOf()[0] || s.prefs.warehouse,
        options: s.warehouses.map((w) => ({ value: w.id, label: w.label })),
      },
      { key: 'customer', label: 'Customer / channel', placeholder: 'Optional' },
      { key: 'note', label: 'Note', type: 'textarea', placeholder: 'Optional' },
    ];

    SP.modal({
      title: 'Record a dispatch',
      subtitle: 'Stock is deducted immediately and velocity updates straight away.',
      icon: 'truck',
      fields,
      okLabel: 'Record dispatch',
      onOk: (v) => {
        const sku = SP.store.state.skus.find((x) => x.id === v.skuId);
        if (!sku) throw new Error('Select a SKU.');

        const available = Number(sku.byWh?.[v.warehouse]) || 0;
        if (v.type === 'dispatch' && v.qty > available) {
          throw new Error(`Only ${SP.fmt.n(available)} units at ${v.warehouse}. Reduce the quantity or pick another site.`);
        }

        const record = {
          id: SP.uid('sal'),
          at: Date.now(),
          type: v.type,
          skuId: v.skuId,
          qty: v.qty,
          colour: v.colour,
          warehouse: v.warehouse,
          customer: (v.customer || '').trim(),
          note: (v.note || '').trim(),
          unitCost: sku.cost || SP.costFor(sku),
          by: SP.auth.currentUser?.name || '',
        };

        SP.store.update(['sales', 'skus'], (st) => {
          st.sales.unshift(record);
          const t = st.skus.find((x) => x.id === v.skuId);
          if (!t) return;
          const cur = Number(t.byWh?.[v.warehouse]) || 0;
          t.byWh[v.warehouse] = Math.max(0, v.type === 'return' ? cur + v.qty : cur - v.qty);
          // Keep the colour breakdown in step with the site totals, otherwise
          // every dispatch would break the reconciliation check.
          t.colours = SP.engine.adjustColours(t, v.type === 'return' ? v.qty : -v.qty, {
            colour: v.colour,
          });
          t.updatedAt = Date.now();
        });

        SP.store.audit('sale.record', sku.sku, `${v.type} ${v.qty} @ ${v.warehouse}`);
        SP.sheets.push({ type: 'sale.record', ...record });
        SP.ui.toast({
          tone: 'ok', title: 'Dispatch recorded',
          body: `${SP.fmt.n(v.qty)} × ${sku.sku}`,
        });
        SP.router.refresh();
      },
    });
  }

  function exportCsv() {
    const s = SP.store.state;
    const rows = s.sales.map((x) => {
      const sku = s.skus.find((k) => k.id === x.skuId);
      return {
        Date: SP.fmt.dateTime(x.at),
        Type: x.type,
        SKU: sku?.sku || x.skuId,
        Specs: sku?.specs || '',
        Qty: x.qty,
        Warehouse: x.warehouse,
        Customer: x.customer || '',
        Note: x.note || '',
        RecordedBy: x.by || '',
      };
    });
    SP.download(SP.toCSV(rows, ['Date', 'Type', 'SKU', 'Specs', 'Qty', 'Warehouse', 'Customer', 'Note', 'RecordedBy']),
      `stockpilot-dispatch-${SP.fmt.date(Date.now())}.csv`, 'text/csv');
    SP.ui.toast({ tone: 'ok', title: 'Export ready' });
  }

  return { ...MOD, openForm };
})();