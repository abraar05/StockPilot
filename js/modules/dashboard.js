/**
 * modules/dashboard.js — the executive view.
 * Hero KPI, decision bands, warehouse health, colour mix, AI insights, activity.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.dashboard = (() => {
  const MOD = {
    title: 'Dashboard',
    mount,
    subtitle: () => {
      const s = SP.store.state;
      const last = s.sheet.lastSync ? `Synced ${SP.fmt.ago(s.sheet.lastSync)}` : 'Snapshot data';
      return `${SP.fmt.pluralise(SP.engine.summary().gross, 'unit')} on hand · ${last}`;
    },
  };

  function mount(params) {
    const root = SP.el('div.stack.gap-5');
    const s = SP.store.state;
    const wh = params.wh || s.prefs.warehouse || 'MAIN';
    const scopeAll = wh === '*';

    const sum = SP.engine.summary({ warehouse: wh });
    const capital = SP.engine.capitalSummary();

    /* ── 1. Hero ───────────────────────────────────────────────────── */
    root.appendChild(SP.el('div.hero',
      SP.el('div.hero__eyebrow',
        SP.icon('box'),
        scopeAll ? 'All warehouses' : SP.store.state.warehouses.find((w) => w.id === wh)?.label || wh,
        SP.el('span.tag.tag--mute', { style: { marginLeft: 'auto' } },
          s.sheet.mode === 'live' ? 'Live' : 'Snapshot'),
      ),
      SP.el('div',
        SP.el('div.hero__value', SP.fmt.n(sum.gross)),
        SP.el('p.hero__sub',
          `Units available across ${SP.fmt.pluralise(sum.scopedSkuCount, 'active SKU')}. `,
          SP.el('strong', { style: { color: sum.critical ? 'var(--danger)' : 'var(--ok)' } },
            `${sum.critical} need restocking`),
          ` and ${sum.refill} are due a top-up.`),
      ),
      SP.el('div.hero__split',
        SP.el('div.hero__cell',
          SP.el('b', { style: { color: 'var(--ok)' } }, SP.fmt.pct(sum.coverage, 0)),
          SP.el('span', 'Healthy cover'),
        ),
        SP.el('div.hero__cell',
          SP.el('b', { style: { color: 'var(--warn)' } }, SP.fmt.moneyCompact(capital.needed)),
          SP.el('span', 'To restock'),
        ),
        SP.el('div.hero__cell',
          SP.el('b', SP.fmt.pluralise(sum.outUnits, 'out')),
          SP.el('span', 'Dispatched'),
        ),
      ),
    ));

    /* ── 2. Warehouse scope switcher ───────────────────────────────── */
    root.appendChild(SP.chipRow(
      [{ value: '*', label: 'All sites' }, ...SP.store.state.warehouses.map((w) => ({
        value: w.id, label: w.short || w.label,
        count: SP.engine.summary({ warehouse: w.id }).gross,
      }))],
      wh,
      (v) => SP.router.refresh() || SP.router.go('dashboard', { wh: v }),
    ));

    /* ── 3. KPI cards ──────────────────────────────────────────────── */
    const trend = SP.engine.salesTrend(14);
    root.appendChild(SP.el('div.grid.grid--4.stats-row',
      statCard({
        label: 'Total in hand', icon: 'box', tone: 'brand',
        value: SP.fmt.n(sum.gross), foot: `${sum.scopedSkuCount} SKUs listed`,
        spark: trend.map((d) => d.units),
      }),
      statCard({
        label: 'Restock priority', icon: 'alert', tone: 'danger',
        value: SP.fmt.n(sum.critical), foot: 'Zero units — buy now',
        onClick: () => SP.router.go('refill', { band: 'critical', wh }),
      }),
      statCard({
        label: 'Needs a top-up', icon: 'clock', tone: 'warn',
        value: SP.fmt.n(sum.refill), foot: `1–${s.rules.refillMax} units`,
        onClick: () => SP.router.go('refill', { band: 'refill', wh }),
      }),
      statCard({
        label: 'Adequate', icon: 'checkCircle', tone: 'ok',
        value: SP.fmt.n(sum.adequate), foot: 'Do not spend',
        onClick: () => SP.router.go('inventory', { band: 'adequate' }),
      }),
    ));

    /* ── 4. Decision bands ─────────────────────────────────────────── */
    const plan = SP.engine.refillPlan({ warehouse: wh });
    root.appendChild(SP.section('Refill decision', `The rule: 0 = restock · 1–${s.rules.refillMax} = refill · above = adequate`,
      SP.el('div.bands',
        band('red', sum.critical, 'Restock', 'Buy immediately', 'critical'),
        band('amber', sum.refill, 'Refill', 'Plan a top-up', 'refill'),
        band('green', sum.adequate, 'Adequate', 'Leave alone', 'adequate'),
      ),
    ));

    /* ── 5. Insights ───────────────────────────────────────────────── */
    const list = SP.engine.insights();
    if (list.length) {
      root.appendChild(SP.section(
        'Smart recommendations',
        'Derived from your stock, dispatch history and site distribution',
        SP.el('div.stacklist', ...list.slice(0, 4).map(insightCard)),
      ));
    }

    /* ── 6. Top actions ─────────────────────────────────────────────── */
    const urgent = plan.filter((r) => r.urgency.id !== 'adequate').slice(0, 5);
    if (urgent.length) {
      root.appendChild(SP.section(
        'Buy this first',
        `Highest expected impact — ${SP.fmt.money(urgent.reduce((a, r) => a + r.value, 0))} total`,
        SP.el('div.card',
          ...urgent.map((r) => SP.el('button.lrow', {
            type: 'button',
            onclick: () => SP.modules.refill.openSkuSheet(r.skuId),
          },
            SP.el('span.lrow__ico', {
              style: {
                background: `color-mix(in srgb, ${r.urgency.colour} 16%, transparent)`,
                color: r.urgency.colour,
              },
            }, SP.icon(r.urgency.id === 'critical' ? 'alert' : 'clock')),
            SP.el('div.lrow__main',
              SP.el('strong', r.sku.sku),
              SP.el('small', `${r.sku.specs} · ${r.reason}`),
            ),
            SP.el('div.lrow__end',
              SP.el('span.lrow__val', SP.fmt.n(r.suggestedQty)),
              SP.el('span.tiny.mute', SP.fmt.moneyCompact(r.value)),
            ),
            SP.icon('chevron', 'lrow__chev'),
          )),
          SP.el('div', { style: { padding: 'var(--sp-3)' } },
            SP.el('button.btn.btn--primary.btn--block', {
              type: 'button',
              onclick: () => SP.modules.purchase.createFromPlan(plan),
            }, SP.icon('cart'), 'Draft purchase order'),
          ),
        ),
      ));
    }

    /* ── 7. Warehouse health + colour mix ──────────────────────────── */
    const byWh = SP.engine.warehouseBreakdown();
    const colours = SP.engine.colourBreakdown().filter((c) => c.units > 0);

    root.appendChild(SP.el('div.grid.grid--2l',
      SP.el('div.card',
        SP.el('div.card__head', SP.icon('home'), SP.el('h2', 'Warehouse health'),
          SP.el('button.link', { onclick: () => SP.router.go('warehouses') }, 'View all')),
        SP.el('div.card__body.stack.gap-3',
          ...byWh.map((w) => SP.el('div.meterrow',
            SP.el('div.meterrow__head',
              SP.el('button.link', {
                onclick: () => SP.router.go('warehouses', { id: w.id }),
              }, w.label),
              SP.el('span', `${SP.fmt.n(w.units)} units · ${SP.fmt.pct(w.share)}`),
            ),
            SP.el('div.bar',
              SP.el('i', { style: { width: `${Math.max(2, w.share)}%`, background: w.color } }),
            ),
            SP.el('div.row.gap-2', { style: { fontSize: 'var(--fs-2xs)' } },
              w.critical ? SP.el('span.tag.tag--u-red', `${w.critical} out`) : null,
              w.refill ? SP.el('span.tag.tag--u-amber', `${w.refill} refill`) : null,
              !w.critical && !w.refill && w.units ? SP.el('span.tag.tag--u-green', 'All healthy') : null,
              !w.units ? SP.el('span.tag.tag--mute', 'Empty') : null,
            ),
          )),
        ),
      ),

      SP.el('div.card',
        SP.el('div.card__head', SP.icon('palette'), SP.el('h2', 'Colour mix'),
          SP.el('span.sub', `${colours.length} variants in use`)),
        SP.el('div.card__body',
          colours.length
            ? SP.charts.donut({
              data: colours.slice(0, 7).map((c) => ({ label: c.name, value: c.units, colour: c.hex })),
              centerValue: SP.fmt.compact(SP.sum(colours, (c) => c.units)),
              centerLabel: 'units',
            })
            : SP.empty({ title: 'No colour data', body: 'Add colour-level quantities in Inventory.' }),
          colours.length > 7
            ? SP.el('p.tiny.mute', { style: { marginTop: 'var(--sp-3)' } },
              `Plus ${colours.length - 7} smaller variants (${SP.fmt.n(SP.sum(colours.slice(7), (c) => c.units))} units).`)
            : null,
        ),
      ),
    ));

    /* ── 8. Dispatch trend ──────────────────────────────────────────── */
    root.appendChild(SP.section('Dispatch activity', 'Units leaving the warehouse over the last 14 days',
      SP.el('div.card',
        SP.el('div.card__body',
          trend.some((d) => d.units > 0)
            ? SP.charts.lines({
              labels: trend.map((d) => d.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
              series: [{
                label: 'Units dispatched',
                values: trend.map((d) => d.units),
                colour: SP.engine.colourHex('Blue'),
              }],
              height: 160,
            })
            : SP.empty({
              icon: 'truck',
              title: 'No dispatches recorded yet',
              body: 'Log a dispatch from the Dispatch Log to unlock sales velocity and forecasting.',
              action: { label: 'Record a dispatch', onClick: () => SP.router.go('sales') },
            }),
        ),
      ),
    ));

    /* ── 9. Recent activity ─────────────────────────────────────────── */
    const feed = buildFeed();
    if (feed.length) {
      root.appendChild(SP.section('Recent activity', null,
        SP.el('div.card', SP.el('div.feed', ...feed)),
      ));
    }

    /* ── 10. Tips ───────────────────────────────────────────────────── */
    for (const t of SP.TIPS.filter((x) => x.where === 'dashboard')) {
      const node = SP.tip(t);
      if (node) root.appendChild(node);
    }

    const notice = SP.SEED?.notice;
    if (notice) {
      root.appendChild(SP.el('div.callout', { dataset: { tone: 'warn' } },
        SP.el('span.callout__ico', SP.icon('alert')),
        SP.el('div.callout__body',
          SP.el('strong', 'Reconciliation pending'),
          SP.el('p', notice),
          SP.el('div.tiny.mute', { style: { marginTop: '6px' } },
            `Referenced by ${(SP.SEED.referencedBy || []).join(', ')}.`,
            SP.el('button.link', { onclick: () => SP.copy(notice, 'Notice copied') }, 'Copy notice')),
        ),
      ));
    }

    return root;
  }

  /* ────────────────────────────────────────────────────── components */

  function statCard(o) {
    const node = SP.el('button.stat', {
      type: 'button', dataset: { tone: o.tone }, onclick: o.onClick || null,
    },
      SP.el('div.stat__label', SP.icon(o.icon), o.label),
      SP.el('div.stat__value', o.value),
      SP.el('div.stat__foot', o.foot),
      o.spark && o.spark.length > 1
        ? SP.el('div.stat__spark', SP.charts.sparkline(o.spark, { height: 34, width: 200, fill: true }))
        : null,
    );
    if (!o.onClick) { node.style.cursor = 'default'; }
    return node;
  }

  function band(kind, n, title, desc, bandId) {
    return SP.el('button.band', {
      type: 'button', class: `band--${kind}`,
      onclick: () => SP.router.go('refill', { band: bandId, wh }),
    },
      SP.el('span.band__n', SP.fmt.n(n)),
      SP.el('span.band__t', title),
      SP.el('span.band__d', desc),
    );
  }

  function insightCard(ins) {
    return SP.el('div.insight', { dataset: { tone: ins.tone } },
      SP.el('span.insight__ico', SP.icon(ins.icon || 'sparkles')),
      SP.el('div.insight__body',
        SP.el('strong', ins.title),
        SP.el('p', ins.body),
        ins.cta ? SP.el('div.insight__act',
          SP.el('button.btn.btn--sm.btn--ghost', {
            type: 'button',
            onclick: () => SP.router.go(ins.action.route, ins.action.params),
          }, ins.cta, SP.icon('arrowRight')),
          SP.el('span.insight__conf', `${Math.round(ins.confidence * 100)}% confidence`),
        ) : null,
      ),
    );
  }

  function buildFeed() {
    const items = [];
    const s = SP.store.state;

    for (const sale of [...s.sales].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 4)) {
      const sku = s.skus.find((x) => x.id === sale.skuId);
      items.push({
        at: sale.at,
        tone: sale.type === 'return' ? 'ok' : 'info',
        icon: sale.type === 'return' ? 'refresh' : 'truck',
        title: `${sale.type === 'return' ? 'Returned' : 'Dispatched'} ${SP.fmt.n(sale.qty)} × ${sku ? sku.sku : 'SKU'}`,
        body: sale.note || sale.customer || 'Recorded in the dispatch log',
      });
    }
    for (const po of [...s.purchases].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 2)) {
      items.push({
        at: po.at, tone: 'brand', icon: 'cart',
        title: `Purchase order ${po.ref}`,
        body: `${SP.fmt.money(po.total)} · ${SP.fmt.pluralise(po.lines?.length || 0, 'line')}`,
      });
    }
    for (const t of [...s.transfers].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 2)) {
      items.push({
        at: t.at, tone: 'warn', icon: 'swap',
        title: `Transfer ${t.ref} · ${t.from} → ${t.to}`,
        body: `${SP.fmt.pluralise(t.lines?.length || 0, 'line')} · ${t.status}`,
      });
    }

    return items.sort((a, b) => b.at - a.at).slice(0, 6).map((i) => SP.el('div.feed__item',
      SP.el('span.feed__ico', { dataset: { tone: i.tone } }, SP.icon(i.icon)),
      SP.el('div.feed__main', SP.el('strong', i.title), SP.el('p', i.body)),
      SP.el('span.feed__time', SP.fmt.ago(i.at)),
    ));
  }

  return MOD;
})();