/**
 * modules/analytics.js — stock intelligence: ageing, ABC capital
 * concentration, velocity, anomalies.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.analytics = (() => {
  const MOD = { title: 'Analytics', subtitle: 'Stock intelligence from the ledger', mount };

  function mount() {
    const s = SP.store.state;
    const root = SP.el('div.stack.gap-4');
    root.appendChild(SP.ui2.pageHead({ title: 'Analytics', sub: 'Ageing, capital concentration, velocity and anomalies.' }));

    /* ageing buckets */
    const { buckets } = SP.ledger.ageing();
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Stock ageing (FIFO)'), SP.el('p', 'How long units have been sitting'))),
      SP.el('div.card.card--pad',
        SP.ui2.stackedParts([
          { label: '0–30d', value: buckets.d30, color: '#34d399' },
          { label: '31–60d', value: buckets.d60, color: '#a3e635' },
          { label: '61–90d', value: buckets.d90, color: '#fbbf24' },
          { label: '91–180d', value: buckets.d180, color: '#fb923c' },
          { label: '180d+', value: buckets.d180p, color: '#f87171' },
        ]),
        SP.el('div.legend',
          SP.el('span.legend__item', SP.el('i', { style: { background: '#34d399' } }), `0–30d ${SP.fmt.n(buckets.d30)}`),
          SP.el('span.legend__item', SP.el('i', { style: { background: '#a3e635' } }), `31–60d ${SP.fmt.n(buckets.d60)}`),
          SP.el('span.legend__item', SP.el('i', { style: { background: '#fbbf24' } }), `61–90d ${SP.fmt.n(buckets.d90)}`),
          SP.el('span.legend__item', SP.el('i', { style: { background: '#fb923c' } }), `91–180d ${SP.fmt.n(buckets.d180)}`),
          SP.el('span.legend__item', SP.el('i', { style: { background: '#f87171' } }), `180d+ ${SP.fmt.n(buckets.d180p)}`)))));

    /* ABC capital concentration */
    const val = SP.ledger.valuation();
    const sorted = [...val.rows].sort((a, b) => b.value - a.value);
    const totalValue = val.value || 1;
    let cum = 0;
    const abc = sorted.map((r) => { cum += r.value; return { ...r, cumPct: cum / totalValue * 100 }; });
    const aItems = abc.filter((r) => r.cumPct <= 80);
    const bItems = abc.filter((r) => r.cumPct > 80 && r.cumPct <= 95);
    const cItems = abc.filter((r) => r.cumPct > 95);
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Capital concentration (ABC)'), SP.el('p', 'Where the money sits'))),
      SP.el('div.grid.grid--3.gap-3',
        abcCard('A — top 80% of value', aItems, '#f87171'),
        abcCard('B — next 15%', bItems, '#fbbf24'),
        abcCard('C — tail', cItems, '#34d399'))));

    /* velocity */
    const since = Date.now() - 30 * 864e5;
    const sold = SP.groupBy(s.movements.filter((m) => m.type === 'sale' && m.ts > since), (m) => m.productId);
    const vel = Object.entries(sold).map(([pid, list]) => ({
      p: s.products.find((x) => x.id === pid),
      qty: SP.sum(list, (m) => m.qty),
    })).filter((r) => r.p).sort((a, b) => b.qty - a.qty).slice(0, 10);
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Sales velocity'), SP.el('p', 'Units sold per product, last 30 days'))),
      SP.el('div.card.card--pad', vel.length
        ? SP.ui2.hbars(vel.map((r) => ({ label: r.p.name, value: r.qty, color: '#5b8cff' })))
        : SP.el('p.tiny.mute', 'No sales recorded in the last 30 days.'))));

    /* anomalies */
    const findings = SP.ai.detectAnomalies();
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Anomaly review'), SP.el('p', 'Deterministic checks — findings are for humans to review'))),
      SP.el('div.stack.gap-2', findings.length ? findings.map((f) => SP.el('div.callout', { dataset: { tone: f.severity === 'high' ? 'danger' : 'warn' } },
        SP.el('span.callout__ico', SP.icon('alert')),
        SP.el('div.callout__body', SP.el('strong', f.title), SP.el('p', f.body)),
        f.route ? SP.el('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => SP.router.go(f.route, f.params || {}) }, 'Review') : null))
        : [SP.el('div.card.card--pad', SP.el('p.tiny.mute', 'No anomalies detected by the current checks.'))])));

    return root;
  }

  function abcCard(title, items, color) {
    return SP.el('div.card.card--pad',
      SP.el('div.row', { style: { alignItems: 'center', gap: '8px', marginBottom: 'var(--sp-2)' } },
        SP.el('i', { style: { width: '10px', height: '10px', borderRadius: '3px', background: color, display: 'inline-block' } }),
        SP.el('strong', title)),
      SP.el('p.tiny.mute', `${items.length} products · ${SP.fmt.moneyCompact(SP.sum(items, (r) => r.value))}`),
      SP.el('div.stack.gap-1', { style: { marginTop: 'var(--sp-2)' } },
        ...items.slice(0, 5).map((r) => SP.el('button.lrow', { type: 'button', onclick: () => SP.router.go('products', { id: r.product.id }) },
          SP.el('div.lrow__main', SP.el('strong', r.product.name)),
          SP.el('span.tiny.mute', `${r.qty} × ${SP.fmt.moneyCompact(r.cost)}`)))));
  }

  return MOD;
})();

/* ════════════════════════════════════════════════ REORDER RADAR (v2) */

SP.modules.refill = (() => {
  const MOD = { title: 'Reorder Radar', subtitle: 'What to buy, what to transfer first', mount };

  function mount() {
    const s = SP.store.state;
    const root = SP.el('div.stack.gap-4');
    root.appendChild(SP.ui2.pageHead({
      title: 'Reorder Radar',
      sub: 'Reorder points vs on-hand. Internal transfers are proposed before any purchase.',
      actions: [SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => SP.router.go('reports', { rpt: 'daily_stock' }) }, SP.icon('file'), 'Stock report')],
    }));

    /* transfer suggestions first */
    const transfers = SP.ai.suggestTransfers();
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Transfer before you buy'), SP.el('p', 'Free internal moves that solve gaps'))),
      transfers.length
        ? SP.el('div.stack.gap-1', ...transfers.slice(0, 8).map((t) => SP.el('div.lrow',
          SP.el('span.lrow__ico', SP.icon('swap')),
          SP.el('div.lrow__main',
            SP.el('strong', t.product.name),
            SP.el('small', `${t.from.name} (${t.fromQty} on hand) → ${t.to.name} (${t.toQty} on hand)`)),
          SP.auth.can('transfers:create') ? SP.el('button.btn.btn--sm.btn--primary', {
            type: 'button',
            onclick: () => SP.modules.transfers.openForm({ from: t.from.id, items: [{ productId: t.product.id, qty: t.qty }] }),
          }, `Transfer ${t.qty}`) : null)))
        : SP.el('div.card.card--pad', SP.el('p.tiny.mute', 'No beneficial transfers found.'))));

    /* reorder list */
    const rows = s.products.filter((p) => !p.archived).map((p) => {
      const qty = SP.ledger.stockOf(p.id);
      const floor = p.reorderPoint || p.minStock || 0;
      const target = Math.max(floor * 2, p.maxStock || 0);
      return { p, qty, floor, need: Math.max(0, (target || floor) - qty), status: qty <= 0 ? 'OUT' : qty <= floor ? 'LOW' : qty >= (p.maxStock || Infinity) ? 'OVER' : 'OK' };
    }).filter((r) => r.status !== 'OK' || r.floor > 0)
      .sort((a, b) => (a.status === 'OUT' ? 0 : a.status === 'LOW' ? 1 : 2) - (b.status === 'OUT' ? 0 : b.status === 'LOW' ? 1 : 2) || b.need - a.need);

    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Reorder list'), SP.el('p', `${rows.filter((r) => r.status !== 'OK').length} products need attention`))),
      rows.length
        ? SP.el('div.stack.gap-1', ...rows.map((r) => SP.el('div.lrow',
          SP.el('span.lrow__ico', { style: { background: r.status === 'OUT' ? 'var(--danger-soft)' : r.status === 'LOW' ? 'var(--warn-soft)' : 'var(--ok-soft)', color: r.status === 'OUT' ? 'var(--danger)' : r.status === 'LOW' ? 'var(--warn)' : 'var(--ok)' } }, SP.icon('alert')),
          SP.el('div.lrow__main',
            SP.el('strong', r.p.name),
            SP.el('small', `${SP.fmt.n(r.qty)} on hand · reorder at ${r.floor}${r.p.maxStock ? ` · max ${r.p.maxStock}` : ''}${r.p.leadTimeDays ? ` · ${r.p.leadTimeDays}d lead` : ''}`)),
          SP.el('div.lrow__end',
            SP.ui2.tag(r.status, r.status === 'OUT' ? 'danger' : r.status === 'LOW' ? 'warn' : 'ok'),
            r.need > 0 && SP.auth.can('purchases:create') ? SP.el('button.btn.btn--sm.btn--ghost', {
              type: 'button',
              onclick: () => SP.modules.purchases.openForm({ items: [{ productId: r.p.id, qty: r.need, cost: r.p.cost || 0 }] }),
            }, `Order ${SP.fmt.n(r.need)}`) : null))))
        : SP.el('div.card.card--pad', SP.el('p.tiny.mute', 'All stocked products are above their reorder point. Set reorder points on products to tune this view.'))));
    return root;
  }

  return MOD;
})();

/* ═══════════════════════════════════════════════════ AI ASSISTANT (v2) */

SP.modules.ai = (() => {
  const MOD = { title: 'AI Assistant', subtitle: 'Answers grounded in your live ledger', mount, perm: 'ai:use' };

  const SUGGESTIONS = [
    'Which products are below reorder level?',
    'Which products have not moved for 90 days?',
    "Show today's unusual stock adjustments",
    'Find duplicate IMEIs',
    'What should we transfer between warehouses?',
    'Prepare today\'s stock report',
    'Which warehouse has excess stock?',
  ];

  function mount() {
    const root = SP.el('div.stack.gap-3');
    const s = SP.store.state;

    if (!s.settings.integrations.ai.connected) {
      root.appendChild(SP.el('div.callout', { dataset: { tone: 'brand' } },
        SP.el('span.callout__ico', SP.icon('sparkles')),
        SP.el('div.callout__body',
          SP.el('strong', 'StockPilot Intelligence — local mode'),
          SP.el('p', 'No external AI service is connected, so nothing is simulated. Every answer below is computed directly from your ledger. Connect an AI endpoint in Settings → Integrations to enable free-form questions.'))));
    }

    const log = SP.el('div.ailog');
    const form = SP.el('form.row.gap-2',
      SP.el('input.input.grow', { type: 'text', placeholder: 'Ask about your inventory…', 'aria-label': 'Ask the assistant' }),
      SP.el('button.btn.btn--primary', { type: 'submit' }, SP.icon('arrowRight'), 'Ask'));

    const push = (who, html) => {
      log.appendChild(SP.el('div.aimsg', { class: who === 'me' ? 'aimsg--me' : '' },
        SP.el('div.aimsg__who', who === 'me' ? 'You' : 'StockPilot Intelligence'),
        html));
      log.scrollTop = log.scrollHeight;
    };

    const answer = (q) => {
      const res = SP.ai.ask(q);
      const html = SP.el('div.stack.gap-2',
        SP.el('p', res.answer),
        res.rows?.length ? SP.el('div.stack.gap-1', ...res.rows.map((r) => SP.el('button.lrow', {
          type: 'button',
          onclick: () => r.route && SP.router.go(r.route, r.params || {}),
        }, SP.el('span.lrow__ico', SP.icon('arrowRight')), SP.el('div.lrow__main', SP.el('span', r.text))))) : null,
        res.footer ? SP.el('p.tiny.mute', res.footer) : null);
      push('ai', html);
      SP.store.audit('ai.ask', q.slice(0, 80), res.intent || '');
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const q = input.value.trim();
      if (!q) return;
      push('me', SP.el('p', q));
      input.value = '';
      setTimeout(() => answer(q), 120);
    });

    root.append(
      SP.ui2.pageHead({ title: 'AI Assistant', sub: 'Deterministic answers from live data — never invented.' }),
      SP.el('div.chips', ...SUGGESTIONS.map((s) => SP.el('button.chip', { type: 'button', onclick: () => { push('me', SP.el('p', s)); answer(s); } }, s))),
      log, form,
    );

    push('ai', SP.el('p', 'Ask me about stock levels, dead stock, adjustments, IMEIs, transfers or reports. I only answer from your actual data.'));
    return root;
  }

  return MOD;
})();
