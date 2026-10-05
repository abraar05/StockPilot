/**
 * modules/dashboard.js — the operational command center.
 * KPIs, trends, warehouse comparison, pending work, alerts and activity.
 * Widget order/visibility is configurable and persisted per device.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.dashboard = (() => {
  const state = { wh: null }; // null → follow prefs

  const MOD = {
    title: 'Dashboard',
    subtitle: () => {
      const s = SP.store.state;
      return `${SP.fmt.pluralise(SP.ledger.summary().gross, 'unit')} on hand · ${s.settings.demo ? 'DEMO DATA' : 'Live data'}`;
    },
    mount,
  };

  const WIDGETS = [
    { id: 'kpis', label: 'Key figures' },
    { id: 'trend', label: 'Movement & sales trend' },
    { id: 'warehouses', label: 'Warehouse comparison' },
    { id: 'work', label: 'Pending work' },
    { id: 'top', label: 'Top sellers & slow movers' },
    { id: 'alerts', label: 'Critical alerts' },
    { id: 'activity', label: 'Recent activity' },
  ];

  function layout() {
    const saved = SP.store.state.prefs.dashboardLayout;
    if (saved && Array.isArray(saved.order) && saved.order.length) return saved;
    return { order: WIDGETS.map((w) => w.id), hidden: [] };
  }

  function saveLayout(l) {
    SP.store.update(['prefs'], (st) => { st.prefs.dashboardLayout = l; }, { silent: true });
  }

  function mount(params) {
    const s = SP.store.state;
    const wh = params?.wh || state.wh || s.prefs.warehouse || '*';
    state.wh = wh;
    const root = SP.el('div.stack.gap-4');

    /* ── toolbar: warehouse scope + customise ─────────────────────── */
    const host = SP.el('div.stack.gap-4');
    const toolbar = SP.el('div.row.gap-2', { style: { alignItems: 'center', flexWrap: 'wrap' } },
      SP.ui2.warehouseSelect({ value: wh, onChange: (v) => { state.wh = v; draw(); } }),
      s.settings.demo ? SP.ui2.tag('DEMO DATA', 'warn') : null,
      SP.el('span.grow'),
      SP.el('button.btn.btn--ghost.btn--sm', {
        type: 'button', onclick: (e) => customise(e.currentTarget),
      }, SP.icon('sliders'), 'Customise'),
    );
    root.append(toolbar, host);

    function customise(anchor) {
      const l = layout();
      SP.menu(anchor, [
        { group: 'Widgets — tap to show/hide' },
        ...WIDGETS.map((w) => ({
          label: `${l.hidden.includes(w.id) ? '○' : '●'} ${w.label}`,
          onClick: () => {
            const next = layout();
            next.hidden = next.hidden.includes(w.id) ? next.hidden.filter((x) => x !== w.id) : [...next.hidden, w.id];
            saveLayout(next); draw();
          },
        })),
        '-',
        {
          label: 'Reset layout', icon: 'refresh',
          onClick: () => { saveLayout({ order: WIDGETS.map((w) => w.id), hidden: [] }); draw(); },
        },
      ], { align: 'right' });
    }

    function draw() {
      SP.clear(host);
      const l = layout();
      for (const id of l.order) {
        if (l.hidden.includes(id)) continue;
        const w = WIDGET_RENDER[id];
        if (w) host.appendChild(w(state.wh));
      }
    }
    draw();
    return root;
  }

  /* ═══════════════════════════════════════════════ widget renderers */

  const WIDGET_RENDER = {

    kpis(wh) {
      const s = SP.store.state;
      const sum = SP.ledger.summary({ warehouse: wh });
      const canCost = SP.auth.can('cost:view');
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const todaySales = s.sales.filter((x) => !x.legacy && x.ts >= dayStart.getTime() && x.status !== 'cancelled');
      const todayPurch = s.purchases.filter((x) => !x.legacy && (x.createdAt || 0) >= dayStart.getTime() && x.status !== 'cancelled');
      const pendTransfers = s.transfers.filter((t) => ['requested', 'approved', 'picking', 'dispatched', 'in_transit'].includes(t.status));
      const receivables = SP.sum(s.sales.filter((x) => !x.legacy && x.status !== 'cancelled'), (x) => Math.max(0, (x.total || 0) - (x.paid || 0)));

      const grid = SP.el('div.kpi-grid',
        SP.ui2.kpi({ label: 'Total stock', value: SP.fmt.n(sum.gross), sub: 'units on hand', icon: 'box', onClick: () => SP.router.go('inventory', { wh }) }),
        canCost ? SP.ui2.kpi({ label: 'Stock value', value: SP.fmt.moneyCompact(sum.value), sub: SP.fmt.money(sum.value), icon: 'database' }) : null,
        SP.ui2.kpi({ label: 'Available', value: SP.fmt.n(sum.gross - sum.reserved), sub: `${SP.fmt.n(sum.reserved)} reserved`, icon: 'check' }),
        SP.ui2.kpi({ label: 'In transit', value: SP.fmt.n(sum.inTransit), sub: 'between warehouses', icon: 'swap', onClick: () => SP.router.go('transfers', { status: 'in_transit' }) }),
        SP.ui2.kpi({ label: "Today's sales", value: canCost ? SP.fmt.moneyCompact(SP.sum(todaySales, (x) => x.total)) : SP.fmt.n(todaySales.length), sub: `${todaySales.length} invoice${todaySales.length === 1 ? '' : 's'}`, icon: 'truck', tone: todaySales.length ? 'ok' : null, onClick: () => SP.router.go('sales') }),
        SP.ui2.kpi({ label: "Today's purchases", value: SP.fmt.n(todayPurch.length), sub: 'orders created', icon: 'cart', onClick: () => SP.router.go('purchases') }),
        SP.ui2.kpi({ label: 'Pending transfers', value: SP.fmt.n(pendTransfers.length), sub: 'need action', icon: 'swap', tone: pendTransfers.length ? 'warn' : null, onClick: () => SP.router.go('transfers') }),
        SP.ui2.kpi({ label: 'Low stock', value: SP.fmt.n(sum.critical + sum.refill), sub: `${sum.critical} out of stock`, icon: 'alert', tone: sum.critical ? 'danger' : sum.refill ? 'warn' : null, onClick: () => SP.router.go('refill') }),
        canCost ? SP.ui2.kpi({ label: 'Receivables', value: SP.fmt.moneyCompact(receivables), sub: 'customer dues', icon: 'users', tone: receivables > 0 ? 'warn' : null, onClick: () => SP.router.go('customers') }) : null,
      );
      return SP.el('section.section', SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Key figures'))), grid);
    },

    trend(wh) {
      const s = SP.store.state;
      const days = 14;
      const labels = []; const inS = []; const outS = []; const saleS = [];
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
        const next = d.getTime() + 864e5;
        labels.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
        const moves = s.movements.filter((m) => m.ts >= d.getTime() && m.ts < next && (!wh || wh === '*' || m.warehouseId === wh));
        inS.push(SP.sum(moves.filter((m) => m.direction > 0), (m) => m.qty));
        outS.push(SP.sum(moves.filter((m) => m.direction < 0), (m) => m.qty));
        saleS.push(SP.sum(s.sales.filter((x) => !x.legacy && x.ts >= d.getTime() && x.ts < next && x.status !== 'cancelled'), (x) => x.total) / 1000);
      }
      return SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Movement & sales trend'), SP.el('p', `Last ${days} days`))),
        SP.el('div.card.card--pad',
          SP.charts.lines({
            labels,
            series: [
              { label: 'Units in', values: inS, colour: '#34d399' },
              { label: 'Units out', values: outS, colour: '#f87171' },
            ],
            height: 170,
          }),
          SP.el('div.legend',
            SP.el('span.legend__item', SP.el('i', { style: { background: '#34d399' } }), 'Units in'),
            SP.el('span.legend__item', SP.el('i', { style: { background: '#f87171' } }), 'Units out'),
            SP.el('span.legend__item', SP.el('i', { style: { background: '#5b8cff' } }), `Sales ${SP.fmt.compact(SP.sum(saleS, (x) => x * 1000))} total`),
          ),
        ),
      );
    },

    warehouses(wh) {
      const s = SP.store.state;
      const rows = s.warehouses.filter((w) => w.active).map((w) => {
        const sum = SP.ledger.summary({ warehouse: w.id });
        return { w, sum };
      });
      return SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Warehouse comparison'), SP.el('p', 'Units and value per site')),
          SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => SP.router.go('warehouses') }, 'Manage')),
        SP.el('div.card.card--pad',
          SP.ui2.hbars(rows.map((r) => ({
            label: r.w.name,
            value: r.sum.gross,
            color: r.w.color || '#5b8cff',
          }))),
          SP.el('div.stack.gap-1', { style: { marginTop: 'var(--sp-3)' } },
            ...rows.map((r) => SP.el('button.lrow', { type: 'button', onclick: () => SP.router.go('inventory', { wh: r.w.id }) },
              SP.el('span.lrow__ico', { style: { background: `${(r.w.color || '#5b8cff')}22`, color: r.w.color || '#5b8cff' } }, SP.icon('home')),
              SP.el('div.lrow__main', SP.el('strong', r.w.name), SP.el('small', `${SP.fmt.n(r.sum.scopedSkuCount)} SKUs · ${r.sum.critical} out · ${r.sum.refill} low`)),
              SP.el('div.lrow__end', SP.el('span.lrow__val', SP.fmt.n(r.sum.gross)), SP.el('small.mute', 'units')),
            ))),
        ),
      );
    },

    work() {
      const s = SP.store.state;
      const approvals = s.approvals.filter((a) => a.status === 'pending').slice(0, 5);
      const transfers = s.transfers.filter((t) => ['requested', 'approved', 'picking', 'dispatched', 'in_transit'].includes(t.status)).slice(0, 5);
      const wrap = SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Pending work'), SP.el('p', 'Approvals and open transfers'))),
        SP.el('div.grid.grid--2.gap-3',
          SP.el('div.card.card--pad',
            SP.el('div.row', { style: { justifyContent: 'space-between', marginBottom: 'var(--sp-2)' } },
              SP.el('strong', 'Approvals'),
              SP.el('button.btn.btn--quiet.btn--sm', { type: 'button', onclick: () => SP.router.go('approvals') }, 'View all')),
            approvals.length
              ? SP.el('div.stack.gap-1', ...approvals.map((a) => SP.el('button.lrow', { type: 'button', onclick: () => SP.router.go('approvals') },
                SP.el('span.lrow__ico', SP.icon('checkCircle')),
                SP.el('div.lrow__main', SP.el('strong', a.title), SP.el('small', `${a.requestedBy} · ${SP.fmt.ago(a.requestedAt)}`)),
                SP.ui2.badge('approval', a.status, { sm: true }))))
              : SP.el('p.tiny.mute', 'Nothing waiting for a decision.')),
          SP.el('div.card.card--pad',
            SP.el('div.row', { style: { justifyContent: 'space-between', marginBottom: 'var(--sp-2)' } },
              SP.el('strong', 'Open transfers'),
              SP.el('button.btn.btn--quiet.btn--sm', { type: 'button', onclick: () => SP.router.go('transfers') }, 'View all')),
            transfers.length
              ? SP.el('div.stack.gap-1', ...transfers.map((t) => {
                const from = s.warehouses.find((w) => w.id === t.from)?.name || t.from;
                const to = s.warehouses.find((w) => w.id === t.to)?.name || t.to;
                return SP.el('button.lrow', { type: 'button', onclick: () => SP.router.go('transfers', { id: t.id }) },
                  SP.el('span.lrow__ico', SP.icon('swap')),
                  SP.el('div.lrow__main', SP.el('strong', `${t.ref} · ${from} → ${to}`), SP.el('small', `${SP.sum(t.items, (i) => i.qty)} units · ${SP.fmt.ago(t.createdAt)}`)),
                  SP.ui2.badge('transfer', t.status, { sm: true }));
              }))
              : SP.el('p.tiny.mute', 'No open transfers.')),
        ),
      );
      return wrap;
    },

    top() {
      const s = SP.store.state;
      const since = Date.now() - 30 * 864e5;
      const sold = SP.groupBy(s.movements.filter((m) => m.type === 'sale' && m.ts > since), (m) => m.productId);
      const ranked = Object.entries(sold)
        .map(([pid, list]) => ({ p: s.products.find((x) => x.id === pid), qty: SP.sum(list, (m) => m.qty) }))
        .filter((r) => r.p && !r.p.archived)
        .sort((a, b) => b.qty - a.qty);
      const top = ranked.slice(0, 5);
      const cutoff = Date.now() - (s.rules.deadStockDays || 60) * 864e5;
      const slow = s.products.filter((p) => !p.archived)
        .map((p) => ({ p, qty: SP.ledger.stockOf(p.id), last: SP.ledger.lastActivityAt(p.id) }))
        .filter((r) => r.qty > 0 && (!r.last || r.last < cutoff))
        .slice(0, 5);

      return SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Top sellers & slow movers'), SP.el('p', 'Last 30 days'))),
        SP.el('div.grid.grid--2.gap-3',
          SP.el('div.card.card--pad',
            SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Fastest moving'),
            top.length ? SP.ui2.hbars(top.map((r) => ({ label: r.p.name, value: r.qty, color: '#34d399' }))) : SP.el('p.tiny.mute', 'No sales recorded yet.')),
          SP.el('div.card.card--pad',
            SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, `Idle ${s.rules.deadStockDays}+ days`),
            slow.length
              ? SP.el('div.stack.gap-1', ...slow.map((r) => SP.el('button.lrow', { type: 'button', onclick: () => SP.router.go('products', { id: r.p.id }) },
                SP.el('span.lrow__ico', SP.icon('clock')),
                SP.el('div.lrow__main', SP.el('strong', r.p.name), SP.el('small', `last move ${r.last ? SP.fmt.ago(r.last) : 'never'}`)),
                SP.el('div.lrow__end', SP.el('span.lrow__val', SP.fmt.n(r.qty))))))
              : SP.el('p.tiny.mute', 'Nothing sitting idle.')),
        ),
      );
    },

    alerts() {
      const s = SP.store.state;
      const notes = s.notifications.filter((n) => !n.archived && !n.resolvedAt).slice(0, 6);
      return SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Critical alerts')),
          SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => SP.router.go('alerts') }, 'Alert center')),
        SP.el('div.card.card--pad', notes.length
          ? SP.el('div.stack.gap-1', ...notes.map((n) => SP.el('button.lrow', {
            type: 'button',
            onclick: () => { SP.modules.alerts?.markRead(n.id); if (n.route) SP.router.go(n.route, n.routeParams || {}); },
          },
            SP.el('span.lrow__ico', { style: { background: `var(--${n.tone === 'danger' ? 'danger' : 'warn'}-soft)`, color: `var(--${n.tone === 'danger' ? 'danger' : 'warn'})` } }, SP.icon('alert')),
            SP.el('div.lrow__main', SP.el('strong', n.title), SP.el('small', n.body)),
            SP.el('span.tiny.mute', SP.fmt.ago(n.at)))))
          : SP.el('p.tiny.mute', 'All clear — no active alerts.')));
    },

    activity() {
      const s = SP.store.state;
      const items = s.movements.slice(-8).reverse().map((m) => {
        const p = s.products.find((x) => x.id === m.productId);
        const w = s.warehouses.find((x) => x.id === m.warehouseId);
        return {
          at: m.ts,
          title: `${SP.movementType(m.type).label} · ${p?.name || '?'}`,
          body: `${m.direction > 0 ? '+' : m.direction < 0 ? '−' : ''}${m.qty} units at ${w?.name || m.warehouseId} · ${m.before} → ${m.after}`,
          meta: `${m.by} · ${m.ref}`,
          tone: SP.movementType(m.type).tone,
        };
      });
      return SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Recent activity')),
          SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => SP.router.go('movements') }, 'Full ledger')),
        SP.el('div.card.card--pad', SP.ui2.timeline(items)));
    },
  };

  return MOD;
})();
