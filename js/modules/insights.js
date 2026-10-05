/**
 * modules/insights.js — capital, velocity, ABC, dead stock and data quality.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.insights = (() => {
  const state = { tab: 'capital' };

  const MOD = {
    title: 'Insights',
    subtitle: () => `${SP.engine.insights().length} active recommendations`,
    mount,
  };

  const TABS = [
    { value: 'capital', label: 'Capital' },
    { value: 'velocity', label: 'Velocity' },
    { value: 'quality', label: 'Data health' },
    { value: 'audit', label: 'Audit' },
  ];

  async function mount(params) {
    if (params?.tab) state.tab = params.tab;
    const root = SP.el('div.stack.gap-4');
    const cap = SP.engine.capitalSummary();

    /* ── Headline ─────────────────────────────────────────────────── */
    root.appendChild(SP.el('div.hero',
      SP.el('div.hero__eyebrow', SP.icon('sparkles'), 'Business health'),
      SP.el('div',
        SP.el('div.hero__value', SP.fmt.moneyCompact(cap.onHandValue)),
        SP.el('p.hero__sub',
          `Working capital tied up in stock. Restoring the flagged lines would need ${SP.fmt.money(cap.needed)}, `,
          `of which ${SP.fmt.money(cap.committed)} is already committed.`),
      ),
      SP.el('div.hero__split',
        cell(SP.fmt.moneyCompact(cap.committed), 'Committed', 'var(--info)'),
        cell(SP.fmt.moneyCompact(cap.free), 'Still to raise', 'var(--warn)'),
        cell(SP.fmt.n(cap.lines), 'Lines to buy', 'var(--brand)'),
      ),
    ));

    /* ── Recommendations ──────────────────────────────────────────── */
    const ins = SP.engine.insights();
    if (ins.length) {
      root.appendChild(SP.el('div.stacklist', ...ins.map((i) => SP.el('div.insight', { dataset: { tone: i.tone } },
        SP.el('span.insight__ico', SP.icon(i.icon || 'sparkles')),
        SP.el('div.insight__body',
          SP.el('strong', i.title),
          SP.el('p', i.body),
          SP.el('div.insight__act',
            i.cta ? SP.el('button.btn.btn--sm.btn--ghost', {
              type: 'button', onclick: () => SP.router.go(i.action.route, i.action.params),
            }, i.cta, SP.icon('arrowRight')) : null,
            SP.el('span.insight__conf', `${Math.round(i.confidence * 100)}% confidence`),
          ),
        ),
      ))));
    }

    /* ── Tabs ─────────────────────────────────────────────────────── */
    root.appendChild(SP.segmented(TABS, state.tab, (v) => { state.tab = v; SP.router.refresh(); }));

    const panel = SP.el('div');
    root.appendChild(panel);
    ({
      capital: capitalTab, velocity: velocityTab, quality: qualityTab, audit: auditTab,
    }[state.tab])(panel);

    return root;
  }

  function cell(v, l, c) {
    return SP.el('div.hero__cell', SP.el('b', { style: { color: c } }, v), SP.el('span', l));
  }

  /* ─────────────────────────────────────────────────────── capital */

  function capitalTab(host) {
    const abc = SP.engine.abcClassification();
    const cap = SP.engine.capitalSummary();
    const dead = SP.engine.deadStock();

    /* ABC curve */
    const maxShare = Math.max(1, ...abc.map((a) => a.ownShare));
    host.appendChild(SP.section('Value concentration', 'Where the money is — the classic A/B/C split',
      SP.el('div.card',
        SP.el('div.card__head', SP.icon('chart'), SP.el('h2', 'ABC classification'),
          SP.el('span.sub', `A = top 70% of value`)),
        SP.el('div.card__body.stack.gap-3',
          ...['A', 'B', 'C'].map((cls) => {
            const items = abc.filter((a) => a.class === cls);
            const value = SP.sum(items, (i) => i.value);
            return SP.el('div.meterrow',
              SP.el('div.meterrow__head',
                SP.el('span.badge', { class: cls === 'A' ? 'badge--danger' : cls === 'B' ? 'badge--warn' : 'badge--ok' }, cls),
                SP.el('span', `${SP.fmt.pluralise(items.length, 'SKU')} make up ${SP.fmt.pct(cap.onHandValue ? (value / cap.onHandValue) * 100 : 0, 0)} of value`),
                SP.el('b', SP.fmt.moneyCompact(value)),
              ),
              SP.el('div.bar.bar--thick',
                SP.el('i', {
                  style: {
                    width: `${Math.max(2, (value / maxShare / (abc.length || 1)) * 100)}%`,
                    background: cls === 'A' ? 'var(--danger)' : cls === 'B' ? 'var(--warn)' : 'var(--ok)',
                  },
                })),
            );
          }),
          SP.el('div.callout', { dataset: { tone: 'info' } },
            SP.el('span.callout__ico', SP.icon('info')),
            SP.el('div.callout__body',
              SP.el('strong', 'How to use this'),
              SP.el('p', 'Class A lines deserve weekly attention and tighter reorder points. Class C lines are candidates for consolidation or a supplier return — their carrying cost often outweighs the margin.'),
            ),
          ),
        ),
      ),
    ));

    /* Top concentration */
    host.appendChild(SP.section('Largest exposures', 'Single SKUs by capital value',
      SP.el('div.card',
        SP.el('div.card__body',
          SP.charts.hbars({
            data: abc.slice(0, 10).map((a) => ({
              label: SP.fmt.shortSku(a.sku.sku, a.sku.specs, 22),
              value: a.value,
              colour: a.class === 'A' ? 'var(--danger)' : a.class === 'B' ? 'var(--warn)' : 'var(--ok)',
            })),
            format: (v) => SP.fmt.moneyCompact(v),
          }),
        ),
      ),
    ));

    /* Dead stock */
    host.appendChild(SP.section('Tied-up capital', `No movement in ${SP.store.state.rules.deadStockDays} days`,
      SP.el('div.card',
        SP.el('div.card__head', SP.icon('clock'), SP.el('h2', 'Slow movers'),
          SP.el('span.sub', `${SP.fmt.moneyCompact(SP.sum(dead, (d) => d.value))} tied up`)),
        dead.length ? SP.el('div.card__body.card__body--flush',
          ...dead.slice(0, 12).map((d) => SP.el('button.lrow', {
            type: 'button', onclick: () => SP.modules.inventory.openSkuSheet(d.sku.id),
          },
            SP.el('span.lrow__ico', { style: { background: 'var(--warn-soft)', color: 'var(--warn)' } }, SP.icon('clock')),
            SP.el('div.lrow__main',
              SP.el('strong', d.sku.sku),
              SP.el('small', `${d.sku.specs} · ${SP.fmt.n(d.qty)} units held`),
            ),
            SP.el('div.lrow__end',
              SP.el('span.lrow__val', SP.fmt.moneyCompact(d.value)),
              SP.el('span.tiny.mute', 'capital'),
            ),
            SP.icon('chevron', 'lrow__chev'),
          )),
          dead.length > 12 ? SP.el('div', { style: { padding: 'var(--sp-3)' } },
            SP.el('p.tiny.mute.center', `+ ${dead.length - 12} more slow movers`)) : null,
        ) : SP.empty({
          icon: 'checkCircle',
          title: 'Everything is moving',
          body: 'No SKU has gone longer than your dead-stock window without a dispatch.',
        }),
      ),
    ));
  }

  /* ────────────────────────────────────────────────────── velocity */

  function velocityTab(host) {
    const s = SP.store.state;
    const rows = s.skus
      .filter((x) => !x.archived)
      .map((sku) => {
        const v = SP.engine.velocity(sku, 4);
        const total = SP.engine.totalOf(sku);
        return {
          sku, perWeek: v, total,
          cover: SP.engine.daysOfCover(total, v),
          monthly: v * 4.345,
        };
      })
      .sort((a, b) => b.perWeek - a.perWeek);

    const movers = rows.filter((r) => r.perWeek > 0);

    host.appendChild(SP.section(
      'Sales velocity',
      movers.length
        ? `Units moving per week over the last 4 weeks · ${SP.fmt.n(SP.sum(movers, (r) => r.perWeek))} units/week total`
        : 'Record dispatches to unlock velocity forecasting',
    ));

    if (!movers.length) {
      host.appendChild(SP.el('div.card', SP.empty({
        icon: 'chart',
        title: 'No sales history yet',
        body: 'Velocity drives cover forecasts, dead-stock detection and smarter order quantities. Log a few dispatches and this fills in automatically.',
        action: SP.auth.can('create:sale')
          ? { label: 'Record a dispatch', onClick: () => SP.modules.sales.openForm() } : null,
      })));
      return;
    }

    /* Velocity vs cover scatter-ish table */
    host.appendChild(SP.el('div.card',
      SP.el('div.card__head', SP.icon('flame'), SP.el('h2', 'Fastest movers'),
        SP.el('span.sub', 'units / week')),
      SP.el('div.card__body',
        SP.charts.hbars({
          data: movers.slice(0, 10).map((r) => ({
            label: SP.fmt.shortSku(r.sku.sku, r.sku.specs, 22),
            value: r.perWeek,
            colour: 'var(--flame, #fb923c)',
          })),
          format: (v) => `${SP.fmt.n(v)}/wk`,
        }),
      ),
    ));

    host.appendChild(SP.el('div.card',
      SP.el('div.card__head', SP.icon('clock'), SP.el('h2', 'Days of cover'),
        SP.el('span.sub', 'At the current rate')),
      SP.el('div.tablewrap',
        SP.el('table.table',
          SP.el('thead', SP.el('tr',
            SP.el('th', 'Model'), SP.el('th', 'Spec'),
            SP.el('th.num', 'On hand'), SP.el('th.num', '/week'),
            SP.el('th.num', 'Cover'), SP.el('th', 'Risk'),
          )),
          SP.el('tbody', ...rows.slice(0, 25).map((r) => {
            const coverTxt = r.cover === Infinity ? '∞' : SP.fmt.days(r.cover);
            const risk = r.cover === Infinity ? { tone: 'mute', label: 'No demand' }
              : r.cover < 7 ? { tone: 'danger', label: 'Critical' }
                : r.cover < 21 ? { tone: 'warn', label: 'Watch' }
                  : { tone: 'ok', label: 'Safe' };
            return SP.el('tr', { onclick: () => SP.modules.inventory.openSkuSheet(r.sku.id) },
              SP.el('td', SP.el('div.cell-main', SP.el('strong', r.sku.sku), SP.el('small', r.sku.brand))),
              SP.el('td', r.sku.specs),
              SP.el('td.num', SP.fmt.n(r.total)),
              SP.el('td.num', r.perWeek ? SP.fmt.n(r.perWeek) : '—'),
              SP.el('td.num', coverTxt),
              SP.el('td', SP.el('span.tag', { class: `tag--${risk.tone}` }, risk.label)),
            );
          })),
        ),
      ),
    ));
  }

  /* ─────────────────────────────────────────────────────── quality */

  function qualityTab(host) {
    const dq = SP.engine.dataQuality();
    const s = SP.store.state;

    const counts = {
      high: dq.issues.filter((i) => i.sev === 'high').length,
      med: dq.issues.filter((i) => i.sev === 'med').length,
      low: dq.issues.filter((i) => i.sev === 'low').length,
    };

    host.appendChild(SP.el('div.card.card--pad',
      SP.el('div.row.gap-3',
        SP.el('div.grow',
          SP.el('strong', { style: { fontSize: 'var(--fs-lg)' } },
            counts.high + counts.med + counts.low === 0 ? 'Everything reconciles' : dq.summary),
          SP.el('p.tiny.mute', { style: { marginTop: '4px' } },
            'Colour-level quantities and per-warehouse totals are cross-checked on every load.'),
        ),
        SP.el('div.gauge', SP.charts.gauge({
          value: SP.store.state.skus.length
            ? Math.max(0, 100 - (counts.high * 12 + counts.med * 4 + counts.low * 1))
            : 0,
          label: 'quality score',
          colour: counts.high ? 'var(--warn)' : 'var(--ok)',
        })),
      ),
    ));

    if (!dq.issues.length) {
      host.appendChild(SP.el('div.card', SP.empty({
        icon: 'checkCircle',
        title: 'Your data is clean',
        body: 'Every SKU reconciles between its colour breakdown and its warehouse totals.',
      })));
    } else {
      host.appendChild(SP.section('Detected issues', 'Fixing these keeps every decision honest',
        SP.el('div.stacklist', ...dq.issues.slice(0, 30).map((i) => SP.el('div.dq-item',
          SP.el('span.dq-item__sev', { class: `dq-item__sev--${i.sev === 'high' ? 'high' : i.sev === 'med' ? 'med' : 'low'}` }),
          SP.el('div.dq-item__body',
            SP.el('strong', i.title),
            SP.el('p', i.body),
          ),
          i.skuId ? SP.el('button.btn.btn--sm.btn--ghost', {
            type: 'button', onclick: () => SP.modules.inventory.openSkuSheet(i.skuId),
          }, 'Inspect') : null,
        ))),
      ));
    }

    /* Reconciliation summary */
    host.appendChild(SP.section('Reconciliation', 'Totals as currently held',
      SP.el('div.card',
        SP.el('div.card__body.stack.gap-3',
          ...SP.store.state.warehouses.map((w) => {
            const units = SP.sum(s.skus, (x) => Number(x.byWh?.[w.id]) || 0);
            return SP.el('div.row.gap-3',
              SP.el('i', { style: { width: '9px', height: '9px', borderRadius: '50%', background: w.color } }),
              SP.el('span.grow', w.label),
              SP.el('b.num', SP.fmt.n(units)),
            );
          }),
          SP.el('hr'),
          SP.el('div.row.gap-3',
            SP.el('span.grow', { style: { fontWeight: '700' } }, 'Grand total'),
            SP.el('b.num', { style: { fontSize: 'var(--fs-lg)' } },
              SP.fmt.n(SP.engine.summary().gross)),
          ),
          SP.el('p.tiny.mute', SP.SEED?.notice || ''),
        ),
      ),
    ));
  }

  /* ───────────────────────────────────────────────────────── audit */

  function auditTab(host) {
    const s = SP.store.state;
    const logs = s.audit;

    host.appendChild(SP.el('div.card',
      SP.el('div.card__head', SP.icon('history'), SP.el('h2', 'Activity log'),
        SP.el('button.btn.btn--sm.btn--ghost', {
          type: 'button',
          onclick: () => {
            SP.download(JSON.stringify(logs, null, 2), `stockpilot-audit-${SP.fmt.date(Date.now())}.json`);
          },
        }, SP.icon('download'), 'Export'),
      ),
      logs.length ? SP.el('div.card__body.card__body--flush',
        ...logs.slice(0, 80).map((a) => SP.el('div.feed__item',
          SP.el('span.feed__ico', { dataset: { tone: toneFor(a.action) } }, SP.icon(iconFor(a.action))),
          SP.el('div.feed__main',
            SP.el('strong', `${SP.fmt.titleCase(a.action.replace(/[._]/g, ' '))}${a.target ? ` · ${a.target}` : ''}`),
            SP.el('p', `${a.by}${a.detail ? ` — ${a.detail}` : ''}`),
          ),
          SP.el('span.feed__time', SP.fmt.ago(a.at)),
        )),
      ) : SP.empty({ icon: 'history', title: 'No activity yet', body: 'Actions you take are recorded here.' }),
    ));
  }

  const toneFor = (action) => {
    if (/delete|cancel|lockout|reject/.test(action)) return 'danger';
    if (/create|receive|received/.test(action)) return 'ok';
    if (/status|approve|sync|push/.test(action)) return 'info';
    if (/signin|signout/.test(action)) return 'brand';
    return '';
  };
  const iconFor = (action) => {
    if (/sheet/.test(action)) return 'refresh';
    if (/po|purchase/.test(action)) return 'cart';
    if (/transfer/.test(action)) return 'swap';
    if (/sale|stock/.test(action)) return 'box';
    if (/user|auth/.test(action)) return 'users';
    if (/sku|data/.test(action)) return 'database';
    return 'check';
  };

  return { ...MOD };
})();