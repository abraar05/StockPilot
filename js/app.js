/**
 * app.js — bootstrap, chrome, auth gate, palette and lifecycle.
 */
window.SP = window.SP || {};

SP.app = (() => {
  let navOpen = false;
  let paletteIndex = 0;
  let paletteItems = [];
  let alertTimer = null;

  /** Lazy DOM lookups: the shell may not exist yet when this module evaluates. */
  const $ = (id) => document.getElementById(id);

  /* ═════════════════════════════════════════════════════════════ BOOT */

  async function start() {
    hint('Loading your workspace…');
    try { SP.store.load(); } catch (e) { console.warn('[boot] store', e); }

    // First run: hydrate the catalogue from the sheet snapshot.
    if (!SP.store.state.skus.length) {
      hint('Reading the inventory snapshot…');
      SP.store.hydrateFromSeed();
      SP.store.saveNow();
    }

    hint('Preparing accounts…');
    await SP.auth.ensureSeedUsers();

    hint('Restoring session…');
    const user = await SP.auth.restore();

    // Validate the bundle is consistent with the schema we expect.
    const shapeCheck = SP.store.state.skus.every((s) => s.colours && typeof s.colours === 'object');
    if (!shapeCheck) {
      console.warn('[boot] catalogue shape mismatch — rehydrating from seed');
      SP.store.hydrateFromSeed();
      SP.store.saveNow();
    }

    applyTheme();
    wireChrome();
    wireKeyboard();
    wireOnline();

    SP.sheets.init();

    if (user) enterApp(user);
    else showAuth();

    // Refresh the live view in the background without blocking first paint.
    if (SP.sheet.autoSyncMinutes > 0 && navigator.onLine) {
      setTimeout(() => { SP.sheets.refresh().then((r) => { if (r.ok) SP.router.refresh(); }); }, 1400);
    }

    setTimeout(() => document.getElementById('boot')?.classList.add('is-done'), 260);
  }

  function hint(text) {
    const n = document.getElementById('bootHint');
    if (n) n.textContent = text;
  }

  /* ═════════════════════════════════════════════════════════════ AUTH */

  function showAuth() {
    $("app").hidden = true;
    $("auth").hidden = false;
    document.documentElement.dataset.theme = currentTheme();
    const u = SP.auth.currentUser;
    document.getElementById('avatarInitials') && (document.getElementById('avatarInitials').textContent = SP.fmt.initials(u?.name || '··'));
  }

  async function enterApp(user) {
    $("auth").hidden = true;
    $("app").hidden = false;
    $("app").classList.add('is-booting');

    document.getElementById('avatarInitials').textContent = SP.fmt.initials(user.name);

    SP.router.registerAll(SP.modules);
    buildNav();
    SP.router.start(paintChrome);

    // Force a layout pass before the fade-in.
    requestAnimationFrame(() => {
      $("app").classList.remove('is-booting');
    });

    // First-run onboarding.
    if (!SP.store.state.onboarded) {
      setTimeout(() => openOnboarding(), 520);
    }

    // Alert poll.
    refreshAlerts();
    alertTimer = setInterval(refreshAlerts, 60000);

    SP.announce(`Signed in as ${user.name}`);
  }

  function signOut() {
    SP.auth.signOut();
    if (alertTimer) clearInterval(alertTimer);
    location.hash = '';
    showAuth();
    SP.ui.toast({ tone: 'info', title: 'Signed out', body: 'See you next time.' });
  }

  /* ═══════════════════════════════════════════════════ ONBOARDING */

  function openOnboarding() {
    let stepIndex = 0;
    const root = document.getElementById('onboard');
    const bodyHost = document.getElementById('obBody');
    const title = document.getElementById('obTitle');
    const sub = document.getElementById('obSub');
    const bar = root.querySelector('.onboard__progress i');
    const nextBtn = root.querySelector('[data-ob="next"]');
    const backBtn = root.querySelector('[data-ob="back"]');

    const draft = {
      role: SP.store.state.prefs.role,
      warehouse: SP.store.state.prefs.warehouse,
      alerts: SP.store.state.prefs.alerts,
    };

    document.getElementById('signinForm').hidden = true;
    document.getElementById('onboard').hidden = false;

    const steps = [
      {
        title: 'What brings you here?',
        sub: 'We tailor the dashboard to your role.',
        render: () => SP.el('div.role-picker', ...SP.ROLES.filter((r) => r.id !== 'admin').map((r) =>
          choice(r.icon === 'shield' ? 'shield' : r.id === 'manager' ? 'chart' : r.id === 'storekeeper' ? 'box' : 'eye',
            r.label, r.blurb, draft.role === r.id, () => {
              draft.role = r.id;
              draw();
            }))),
      },
      {
        title: 'Which site do you look after?',
        sub: 'Sets the warehouse your dashboards open on.',
        render: () => SP.el('div.role-picker', ...SP.store.state.warehouses.map((w) =>
          choice('home', w.label, `${SP.fmt.n(SP.sum(SP.store.state.skus, (s) => Number(s.byWh?.[w.id]) || 0))} units held`,
            draft.warehouse === w.id, () => { draft.warehouse = w.id; draw(); }))),
      },
      {
        title: 'How should we alert you?',
        sub: 'You can change this any time in Settings.',
        render: () => SP.el('div.stacklist',
          SP.el('label.switch',
            SP.el('input', {
              type: 'checkbox', checked: draft.alerts.enabled,
              onchange: (e) => { draft.alerts.enabled = e.target.checked; },
            }),
            SP.el('span.switch__track'),
            SP.el('span.switch__text', SP.el('strong', 'Enable alerts'), SP.el('small', 'Badges and the notification centre')),
          ),
          SP.el('label.switch',
            SP.el('input', {
              type: 'checkbox', checked: draft.alerts.onlyCritical,
              onchange: (e) => { draft.alerts.onlyCritical = e.target.checked; },
            }),
            SP.el('span.switch__track'),
            SP.el('span.switch__text', SP.el('strong', 'Only critical alerts'), SP.el('small', 'Just out-of-stock lines')),
          ),
        ),
      },
    ];

    function choice(icon, label, sub, active, onClick) {
      return SP.el('button.onboard__choice', {
        type: 'button', class: active ? 'is-active' : '', onclick: onClick,
      },
        SP.el('span.onboard__choice-ico', SP.icon(icon)),
        SP.el('div.grow', SP.el('strong', label), SP.el('small', sub)),
        active ? SP.el('span', { style: { color: 'var(--brand)' } }, SP.icon('check')) : null,
      );
    }

    function draw() {
      const s = steps[stepIndex];
      title.textContent = s.title;
      sub.textContent = s.sub;
      bar.style.width = `${((stepIndex + 1) / steps.length) * 100}%`;
      SP.clear(bodyHost);
      bodyHost.appendChild(s.render());
      backBtn.hidden = stepIndex === 0;
      nextBtn.textContent = stepIndex === steps.length - 1 ? 'Start using StockPilot' : 'Continue';
    }

    nextBtn.onclick = () => {
      if (stepIndex < steps.length - 1) { stepIndex += 1; draw(); return; }
      SP.store.update(['prefs', 'onboarded'], (st) => {
        st.prefs.role = draft.role;
        st.prefs.warehouse = draft.warehouse;
        st.prefs.alerts = { ...st.prefs.alerts, ...draft.alerts };
        st.onboarded = true;
      });
      document.getElementById('onboard').hidden = true;
      document.getElementById('signinForm').hidden = false;
      SP.router.refresh();
      SP.ui.toast({
        tone: 'ok', title: 'All set', duration: 4200,
        body: 'Tip: press Ctrl+K to search anything.',
        action: { label: 'Show me around', onClick: () => SP.router.go('help') },
      });
    };

    backBtn.onclick = () => { if (stepIndex > 0) { stepIndex -= 1; draw(); } };
    draw();
  }

  /* ═══════════════════════════════════════════════════════ NAV */

  function buildNav() {
    const navHost = document.getElementById('sidenavLinks');
    const tabHost = document.getElementById('tabbar');
    SP.clear(navHost);
    SP.clear(tabHost);

    for (const group of SP.NAV) {
      const visible = group.items.filter((i) => !i.perm || SP.auth.can(i.perm));
      if (!visible.length) continue;
      navHost.appendChild(SP.el('div.sidenav__group', group.group));
      for (const item of visible) {
        navHost.appendChild(SP.el('button.navlink', {
          type: 'button',
          dataset: { route: item.route },
          onclick: () => { SP.router.go(item.route); closeNav(); },
        },
          SP.icon(item.icon),
          SP.el('span.grow', item.label),
          SP.el('span.navlink__count', { dataset: { role: item.route } }, ''),
        ));
      }
    }

    // Bottom tabs
    for (const key of SP.TABS) {
      if (key === 'more') {
        tabHost.appendChild(SP.el('button.tab', {
          type: 'button', dataset: { tab: '__more' },
          onclick: openMoreSheet,
        }, SP.icon('menu'), SP.el('span', 'More')));
        continue;
      }
      const item = SP.NAV.flatMap((g) => g.items).find((i) => i.route === key && i.tab);
      if (!item) continue;
      if (item.perm && !SP.auth.can(item.perm)) continue;
      tabHost.appendChild(SP.el('button.tab', {
        type: 'button', dataset: { tab: key },
        onclick: () => { SP.router.go(key); },
      }, SP.icon(item.icon), SP.el('span', item.label)));
    }
  }

  function openMoreSheet() {
    const s = SP.store.state;
    const body = SP.el('div.stacklist');
    const shell = SP.sheet({ title: 'All modules', content: body });
    body.appendChild(SP.el('div.grid.grid--2', ...SP.NAV.flatMap((g) => g.items
      .filter((i) => !i.perm || SP.auth.can(i.perm))
      .map((i) => SP.el('button.card.card--pad', {
        type: 'button', style: { textAlign: 'left' },
        onclick: () => { shell.close(); SP.router.go(i.route); },
      },
        SP.el('span.lrow__ico', { style: { marginBottom: 'var(--sp-2)' } }, SP.icon(i.icon)),
        SP.el('strong', { style: { fontSize: 'var(--fs-md)', display: 'block' } }, i.label),
      )))));

    body.appendChild(SP.el('div', { style: { marginTop: 'var(--sp-3)' } },
      SP.el('div.conn', { dataset: { state: s.sheet.mode } },
        SP.el('span.conn__led'),
        SP.el('span.conn__text',
          s.sheet.mode === 'live' ? `Live · synced ${SP.fmt.ago(s.sheet.lastSync)}`
            : s.sheet.mode === 'error' ? 'Sync error — showing last good data'
              : 'Snapshot mode — connect the sheet to write'),
      )));
  }

  const toggleNav = () => { navOpen ? closeNav() : openNav(); };
  function openNav() {
    navOpen = true;
    $("app").classList.add('is-nav-open');
    document.getElementById('navScrim').hidden = false;
    document.querySelector('.appbar__icon--menu').setAttribute('aria-expanded', 'true');
  }
  function closeNav() {
    navOpen = false;
    $("app").classList.remove('is-nav-open');
    document.getElementById('navScrim').hidden = true;
    document.querySelector('.appbar__icon--menu').setAttribute('aria-expanded', 'false');
  }

  /* ═════════════════════════════════════════════════════════ CHROME */

  function paintChrome() {
    const route = SP.router.route;
    const mod = SP.router.get(route);
    const s = SP.store.state;

    // Titles
    const title = mod?.title || 'StockPilot';
    const subtitle = typeof mod?.subtitle === 'function' ? mod.subtitle() : (mod?.subtitle || '');
    document.getElementById('appbarTitle').textContent = title;
    document.getElementById('appbarSub').textContent = subtitle;
    document.title = `${title} · StockPilot`;

    // Nav + tab active states
    SP.$$('.navlink').forEach((n) => n.classList.toggle('is-active', n.dataset.route === route));
    SP.$$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === route));

    // Badge counts
    const sum = SP.engine.summary({ warehouse: s.prefs.warehouse });
    const alerts = s.prefs.alerts.onlyCritical ? sum.critical : sum.critical + sum.refill;
    const pendingPo = s.purchases.filter((p) => p.status === 'pending').length;

    SP.$$('.navlink__count').forEach((n) => {
      const r = n.dataset.role;
      const v = r === 'refill' ? sum.critical + sum.refill
        : r === 'purchase' ? pendingPo
          : r === 'sales' ? 0 : 0;
      n.textContent = v ? SP.fmt.n(v) : '';
      n.hidden = !v;
      n.classList.toggle('navlink__count--alert', r === 'refill' && sum.critical > 0);
    });

    SP.$$('.tab').forEach((t) => {
      const r = t.dataset.tab;
      t.querySelector('.tab__dot')?.remove();
      if (r === 'refill' && sum.critical > 0) {
        t.appendChild(SP.el('span.tab__dot'));
      }
    });

    paintConnection();
  }

  function paintConnection() {
    const st = SP.sheets.status();
    const pill = document.getElementById('connPill');
    if (!pill) return;
    const state = st.mode === 'live' ? 'live' : st.mode === 'error' ? 'error' : st.mode === 'syncing' ? 'syncing' : 'snapshot';
    pill.dataset.state = state;
    const pending = st.pending ? ` · ${st.pending} queued` : '';
    pill.querySelector('.conn__text').textContent = {
      live: `Live${pending}`,
      syncing: 'Syncing…',
      error: `Error${pending}`,
      snapshot: `Snapshot${pending}`,
    }[state];

    const bar = document.getElementById('syncBar');
    if (bar) bar.hidden = state !== 'syncing';
  }

  /** Alert badge + notification list. */
  function refreshAlerts() {
    const s = SP.store.state;
    const unread = s.notifications.filter((n) => !n.read).length;
    const badge = document.getElementById('alertBadge');
    if (badge) {
      badge.textContent = SP.fmt.n(unread);
      badge.hidden = unread === 0;
    }

    // Auto-generate alerts from stock state.
    const sum = SP.engine.summary({ warehouse: s.prefs.warehouse });
    const critical = sum.critical;
    if (critical && s.prefs.alerts.enabled) {
      const last = s.notifications.find((n) => n.id === `auto-critical-${critical}`);
      if (!last && Date.now() - (s.sheet.lastSync || 0) < 864e5 * 2) {
        SP.store.update(['notifications'], (st) => {
          st.notifications.unshift({
            id: `auto-critical-${critical}`,
            at: Date.now(), read: false, tone: 'danger',
            title: `${SP.fmt.pluralise(critical, 'SKU')} out of stock`,
            body: 'Open Refill Radar to see what to buy first.',
            route: 'refill',
          });
        });
      }
    }
  }

  function openAlerts() {
    const s = SP.store.state;
    const body = SP.el('div.stacklist');

    if (!s.notifications.length) {
      body.appendChild(SP.empty({ icon: 'bell', title: 'No notifications', body: 'Alerts about low stock and order approvals land here.' }));
    } else {
      s.notifications.forEach((n) => {
        body.appendChild(SP.el('button.lrow', {
          type: 'button',
          onclick: () => {
            shell.close();
            SP.store.update(['notifications'], (st) => {
              const t = st.notifications.find((x) => x.id === n.id);
              if (t) t.read = true;
            });
            if (n.route) SP.router.go(n.route);
          },
        },
          SP.el('span.lrow__ico', {
            style: {
              background: n.read ? 'var(--surface-3)' : `var(--${n.tone === 'danger' ? 'danger' : 'info'}-soft)`,
              color: n.read ? 'var(--text-mute)' : `var(--${n.tone === 'danger' ? 'danger' : 'info'})`,
            },
          }, SP.icon(n.tone === 'danger' ? 'alert' : 'info')),
          SP.el('div.lrow__main',
            SP.el('strong', n.title),
            SP.el('small', n.body),
          ),
          SP.el('div.lrow__end', SP.el('span.tiny.mute', SP.fmt.ago(n.at))),
        ));
      });

      body.appendChild(SP.el('button.btn.btn--ghost.btn--block', {
        type: 'button',
        onclick: () => {
          SP.store.update(['notifications'], (st) => { st.notifications.forEach((n) => { n.read = true; }); });
          refreshAlerts();
          SP.ui.toast({ tone: 'ok', title: 'All caught up' });
          shell.close();
        },
      }, 'Mark all as read'));
    }

    const shell = SP.sheet({ title: 'Notifications', content: body });
  }

  function openAccount() {
    const u = SP.auth.currentUser;
    const s = SP.store.state;
    const info = SP.auth.sessionInfo();

    const body = SP.el('div.stacklist',
      SP.el('div.row.gap-3',
        SP.avatar(u, 'xl'),
        SP.el('div.grow',
          SP.el('strong', { style: { fontSize: 'var(--fs-lg)' } }, u.name),
          SP.el('p.tiny.mute', u.email),
          SP.el('div.row.gap-1', { style: { marginTop: '6px' } },
            SP.el('span.tag.tag--brand', SP.auth.roleDef(u.role).label),
            SP.el('span.tag.tag--line', u.warehouse),
          ),
        ),
      ),
      SP.el('dl.kv', { style: { marginTop: 'var(--sp-3)' } },
        SP.el('dt', 'Signed in from'), SP.el('dd', info?.device || '—'),
        SP.el('dt', 'Session expires'), SP.el('dd', info ? SP.fmt.ago(info.expiresAt) : '—'),
        SP.el('dt', 'Security'), SP.el('dd', SP.crypto.isPBKDF2() ? 'PBKDF2-SHA256' : 'Fallback'),
        SP.el('dt', 'Sheets'), SP.el('dd', s.sheet.mode === 'live' ? 'Live' : 'Snapshot'),
      ),
    );

    const shell = SP.sheet({
      title: 'Account',
      content: body,
      actions: [
        SP.el('button.btn.btn--ghost', {
          type: 'button', onclick: () => { shell.close(); SP.router.go('settings'); },
        }, SP.icon('cog'), 'Settings'),
        SP.el('button.btn.btn--danger', {
          type: 'button', onclick: () => { shell.close(); signOut(); },
        }, SP.icon('logout'), 'Sign out'),
      ],
    });
  }

  /* ══════════════════════════════════════════════════════ THEME */

  const currentTheme = () => {
    const mode = localStorage.getItem('stockpilot.themeMode') || SP.store.state.prefs.theme || 'dark';
    if (mode !== 'auto') return mode;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  };

  function setThemeMode(mode) {
    localStorage.setItem('stockpilot.themeMode', mode);
    SP.store.update(['prefs'], (st) => { st.prefs.theme = mode; }, { silent: true });
    applyTheme();
  }

  function applyTheme() {
    const p = SP.store.state.prefs;
    document.documentElement.dataset.theme = currentTheme();
    document.documentElement.dataset.density = p.density || 'comfortable';
    if (p.accent) {
      const root = document.documentElement.style;
      root.setProperty('--accent', p.accent);
      root.setProperty('--accent-hi', p.accent);
      root.setProperty('--accent-soft', `${p.accent}24`);
    }
    const meta = document.querySelector('meta[name="theme-color"]:not([media])')
      || SP.el('meta', { name: 'theme-color' });
    if (!meta.isConnected) document.head.appendChild(meta);
    meta.content = currentTheme() === 'light' ? '#f6f7f9' : '#0b0e14';
  }

  /* ══════════════════════════════════════════════════ SEARCH / CMDS */

  function openPalette(initial = '') {
    const wrap = document.getElementById('palette');
    const input = document.getElementById('paletteInput');
    const results = document.getElementById('paletteResults');
    wrap.hidden = false;
    input.value = initial;
    paletteIndex = 0;
    renderPalette(initial);
    setTimeout(() => input.focus(), 40);
  }

  function closePalette() {
    document.getElementById('palette').hidden = true;
    paletteItems = [];
  }

  function renderPalette(query) {
    const results = document.getElementById('paletteResults');
    SP.clear(results);
    paletteItems = [];

    const q = query.trim();
    const groups = [];

    /* Pages */
    const pages = SP.NAV.flatMap((g) => g.items)
      .filter((i) => !i.perm || SP.auth.can(i.perm))
      .filter((i) => !q || SP.score(q, i.label) > 0)
      .map((i) => ({ label: i.label, sub: 'Module', icon: i.icon, run: () => SP.router.go(i.route) }));
    if (pages.length) groups.push({ name: 'Go to', items: pages });

    /* SKUs */
    if (q.length >= 1) {
      const skus = SP.store.state.skus
        .filter((s) => !s.archived)
        .map((s) => ({ s, score: Math.max(SP.score(q, s.sku), SP.score(q, s.specs) * 0.9, SP.score(q, s.brand) * 0.6) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 7)
        .map(({ s }) => ({
          label: `${s.sku} · ${s.specs}`,
          sub: `${SP.fmt.n(SP.engine.totalOf(s))} units on hand · ${s.brand} · ${s.id}`,
          icon: 'box',
          meta: SP.engine.urgency(SP.engine.totalOf(s)).short,
          run: () => SP.modules.inventory.openSkuSheet(s.id),
        }));
      if (skus.length) groups.push({ name: 'Products', items: skus });
    }

    /* Actions */
    const actions = [
      { label: 'Record a dispatch', icon: 'truck', run: () => SP.modules.sales.openForm() },
      { label: 'New transfer', icon: 'swap', run: () => SP.modules.transfers.openForm() },
      { label: 'New purchase order', icon: 'cart', run: () => SP.modules.purchase.createFromPlan(SP.engine.refillPlan({}).filter((r) => r.urgency.id !== 'adequate')) },
      { label: 'Add a SKU', icon: 'plus', run: () => SP.modules.inventory.editSku(null) },
      { label: 'Sync the Google Sheet', icon: 'refresh', run: async () => { const r = await SP.sheets.refresh(); SP.ui.toast(r.ok ? { tone: 'ok', title: 'Synced', body: `${r.count} SKUs` } : { tone: 'danger', title: 'Sync failed', body: r.error }); } },
      { label: 'Export stock as CSV', icon: 'download', run: () => SP.modules.inventory.exportCsv() },
      { label: 'Download a full backup', icon: 'save', run: () => SP.download(JSON.stringify(SP.store.exportBackup(), null, 2), `stockpilot-backup-${SP.fmt.date(Date.now())}.json`) },
      { label: `Switch to ${currentTheme() === 'dark' ? 'light' : 'dark'} theme`, icon: currentTheme() === 'dark' ? 'sun' : 'moon', run: () => setThemeMode(currentTheme() === 'dark' ? 'light' : 'dark') },
      { label: 'Sign out', icon: 'logout', run: () => signOut() },
    ]
      .filter((a) => !q || SP.score(q, a.label) > 0)
      .map((a) => ({ ...a, sub: 'Action' }));

    if (actions.length) groups.push({ name: 'Actions', items: actions });

    if (!groups.length) {
      results.appendChild(SP.el('div.palette__empty', `No results for “${query}”`));
      return;
    }

    for (const g of groups) {
      results.appendChild(SP.el('div.palette__group', g.name));
      for (const item of g.items) {
        paletteItems.push(item);
        const node = SP.el('button.pal-item', {
          type: 'button',
          onclick: () => { closePalette(); item.run(); },
        },
          SP.el('span.pal-item__ico', SP.icon(item.icon || 'arrowRight')),
          SP.el('div.pal-item__main', SP.el('strong', item.label), SP.el('small', item.sub)),
          item.meta ? SP.el('span.pal-item__meta', item.meta) : null,
        );
        results.appendChild(node);
      }
    }
    highlight(0);
  }

  function highlight(i) {
    const nodes = SP.$$('.pal-item', document.getElementById('paletteResults'));
    nodes.forEach((n, k) => n.classList.toggle('is-sel', k === i));
    if (nodes[i]) nodes[i].scrollIntoView({ block: 'nearest' });
    paletteIndex = Math.max(0, Math.min(i, nodes.length - 1));
  }

  /* ═══════════════════════════════════════════════════════ WIRING */

  function wireChrome() {
    // App bar
    SP.on('[data-action="toggle-nav"]', 'click', toggleNav);
    SP.on('#navScrim', 'click', closeNav);
    SP.on('[data-action="open-search"]', 'click', () => openPalette());
    SP.on('[data-action="open-alerts"]', 'click', openAlerts);
    SP.on('[data-action="open-account"]', 'click', openAccount);

    // Auth screen
    SP.on('[data-action="toggle-theme"]', 'click', () => setThemeMode(currentTheme() === 'dark' ? 'light' : 'dark'));
    SP.on('[data-action="recover"]', 'click', openRecover);
    SP.on('[data-action="sso"]', 'click', () => {
      const note = document.getElementById('ssoNote');
      note.textContent = SP.sheets.bridgeReady()
        ? 'Workspace directory not reachable. Ask an administrator for local credentials.'
        : 'Connect the Apps Script bridge and deploy it to an organisation account to enable SSO.';
    });
    SP.on('[data-action="open-request"]', 'click', () => {
      SP.ui.toast({
        tone: 'info', title: 'Ask an administrator',
        body: 'Accounts are created in Admin Console → Users by any admin.',
        action: { label: 'Open Admin', onClick: () => SP.router.go('admin') },
      });
    });
    SP.on('[data-action="open-help"]', 'click', () => {
      $("auth").hidden = true;
      $("app").hidden = false;
      SP.router.registerAll(SP.modules);
      buildNav();
      SP.router.go('help');
      SP.router.start(paintChrome);
    });

    // Password visibility
    SP.$$('[data-toggle-password]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.togglePassword);
        const on = input.type === 'password';
        input.type = on ? 'text' : 'password';
        btn.classList.toggle('is-on', on);
        SP.clear(btn);
        btn.appendChild(SP.icon(on ? 'eyeOff' : 'eye'));
        btn.setAttribute('aria-label', on ? 'Hide password' : 'Show password');
      });
    });

    // Auth tabs
    SP.$$('[data-authtab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        SP.$$('[data-authtab]').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', String(on));
        });
        SP.$$('[data-authtabpanel]').forEach((p) => { p.hidden = p.dataset.authtabpanel !== btn.dataset.authtab; });
        document.getElementById('signinSubmit').hidden = btn.dataset.authtab === 'pin';
      });
    });

    wireSignIn();
    wirePinPad();
    wirePalette();
  }

  function wireSignIn() {
    const form = document.getElementById('signinForm');
    const email = document.getElementById('siEmail');
    const pass = document.getElementById('siPassword');
    const submit = document.getElementById('signinSubmit');

    // Live strength meter on the sign-in field doubles as an awareness cue.
    const meter = document.getElementById('siStrength');
    pass.addEventListener('input', () => {
      if (!pass.value) { meter.hidden = true; return; }
      meter.hidden = false;
      const { score, label } = SP.crypto.strength(pass.value);
      SP.$$('#siStrength .meter__bar i').forEach((bar, i) => bar.classList.toggle('on', i < score));
      meter.querySelector('.meter__text').textContent = label;
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = (name, msg) => {
        const node = form.querySelector(`[data-error-for="${name}"]`);
        if (node) node.textContent = msg || '';
        const input = document.getElementById(name);
        if (input) input.classList.toggle('is-invalid', !!msg);
      };

      err('siEmail'); err('siPassword');

      submit.setAttribute('aria-busy', 'true');
      SP.clear(submit);
      submit.appendChild(SP.el('span.spinner'));
      submit.appendChild(SP.el('span.btn__label', 'Signing in…'));

      const res = await SP.auth.signIn(email.value, pass.value, {
        remember: document.getElementById('siRemember').checked,
      });

      submit.removeAttribute('aria-busy');
      SP.clear(submit);
      submit.appendChild(SP.el('span.btn__label', 'Sign in'));

      if (!res.ok) {
        err('siPassword', res.error);
        SP.buzz([12, 60, 12]);
        pass.focus();
        return;
      }

      SP.buzz(10);
      SP.ui.toast({ tone: 'ok', title: `Welcome back, ${res.user.name.split(' ')[0]}` });
      await enterApp(res.user);
    });
  }

  function wirePinPad() {
    const users = SP.store.state.users.filter((u) => u.active && u.pin);
    const host = document.getElementById('pinUsers');
    if (!users.length) {
      host.appendChild(SP.el('p.tiny.mute', 'No profiles with a PIN yet. Use your password instead.'));
      return;
    }

    let selected = null;
    let pin = '';

    const dots = document.getElementById('pinDots');
    const nameNode = document.getElementById('pinName');

    const drawDots = () => {
      SP.clear(dots);
      for (let i = 0; i < 4; i += 1) {
        dots.appendChild(SP.el('i', { class: i < pin.length ? 'on' : '' }));
      }
    };

    const select = (u) => {
      selected = u;
      pin = '';
      drawDots();
      nameNode.textContent = u.name;
      SP.$$('.pin-user', host).forEach((n) => n.classList.toggle('is-active', n.dataset.id === u.id));
    };

    for (const u of users) {
      const node = SP.el('button.pin-user', {
        type: 'button', dataset: { id: u.id }, onclick: () => select(u),
      }, SP.avatar(u), u.name.split(' ')[0]);
      host.appendChild(node);
    }
    if (users.length === 1) select(users[0]);

    const press = async (key) => {
      if (!selected) { SP.ui.toast({ tone: 'info', title: 'Pick a profile first' }); return; }
      if (key === 'clear') { pin = ''; drawDots(); return; }
      if (key === 'back') { pin = pin.slice(0, -1); drawDots(); return; }
      pin += key;
      if (pin.length > 4) pin = pin.slice(-4);
      drawDots();
      SP.buzz(8);
      if (pin.length === 4) {
        const res = await SP.auth.signInWithPin(selected.id, pin);
        if (!res.ok) {
          const d = document.getElementById('pinDots');
          d.classList.add('shake');
          setTimeout(() => d.classList.remove('shake'), 360);
          SP.ui.toast({ tone: 'danger', title: res.error });
          pin = ''; drawDots();
          return;
        }
        SP.ui.toast({ tone: 'ok', title: `Welcome, ${res.user.name.split(' ')[0]}` });
        await enterApp(res.user);
      }
    };

    SP.on('#pinGrid', 'click', (e) => {
      const key = e.target.closest('[data-pin]')?.dataset.pin;
      if (key) press(key);
    });
  }

  function wirePalette() {
    const wrap = document.getElementById('palette');
    const input = document.getElementById('paletteInput');

    input.addEventListener('input', SP.debounce((e) => renderPalette(e.target.value), 110));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(paletteIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(paletteIndex - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        SP.$$('.pal-item', document.getElementById('paletteResults'))[paletteIndex]?.click();
      } else if (e.key === 'Escape') { closePalette(); }
    });

    wrap.addEventListener('click', (e) => { if (e.target === wrap) closePalette(); });
  }

  function wireKeyboard() {
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $("app").hidden ? null : openPalette();
        return;
      }
      if (e.key === 'Escape' && !document.getElementById('palette').hidden) {
        closePalette();
        return;
      }
      if (typing) return;

      // Single-key navigation on desktop.
      if (!$("app").hidden && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const map = { d: 'dashboard', i: 'inventory', r: 'refill', w: 'warehouses', s: 'sales', t: 'transfers', p: 'purchase', n: 'insights' };
        const route = map[e.key.toLowerCase()];
        if (route && SP.router.get(route)) { SP.router.go(route); return; }
      }
    });

    // System theme changes.
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if ((localStorage.getItem('stockpilot.themeMode') || 'auto') === 'auto') applyTheme();
    });
  }

  function wireOnline() {
    addEventListener('offline', () => paintConnection());
    addEventListener('online', () => setTimeout(paintConnection, 800));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      refreshAlerts();
      if (SP.router.route) SP.router.refresh();
    });
  }

  /* ═══════════════════════════════════════════════════ RECOVERY */

  async function openRecover() {
    const res = await SP.modal({
      title: 'Reset your password',
      subtitle: 'Use the recovery answer you set on this device.',
      icon: 'key',
      fields: [
        { key: 'email', label: 'Work email', type: 'email', required: true },
        { key: 'answer', label: 'Recovery answer', required: true },
      ],
      okLabel: 'Reset password',
      onOk: async (v) => {
        const r = await SP.auth.recoverAccess(v.email, v.answer);
        if (!r.ok) throw new Error(r.error);
        SP.ui.toast({
          tone: 'ok', title: 'Password reset', duration: 12000,
          body: `Temporary password: ${r.tempPassword} — you will be asked to change it.`,
          action: { label: 'Copy', onClick: () => SP.copy(r.tempPassword, 'Temporary password copied') },
        });
      },
    });
    void res;
  }

  /* ══════════════════════════════════════════════════════════════ */

  return {
    start, signOut, applyTheme, setThemeMode, paintChrome, paintConnection,
    openPalette, refreshAlerts, currentTheme,
  };
})();

/* ═══════════════════════════════════════════════════ OFFLINE SUPPORT */

/** Register the service worker that makes the app usable with no network. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // A file:// origin and the Apps Script sandbox cannot host a worker.
  if (location.protocol === 'file:') return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => {
      console.info('[sw] offline support unavailable:', e.message);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  SP.app.start().catch((e) => {
    console.error('[boot] fatal', e);
    const hint = document.getElementById('bootHint');
    if (hint) {
      hint.textContent = `Failed to start: ${e.message}`;
      hint.style.color = 'var(--danger)';
    }
  });
  registerServiceWorker();
});