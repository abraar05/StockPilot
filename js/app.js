/**
 * app.js — bootstrap, chrome, auth gate, palette and lifecycle.
 */
window.SP = window.SP || {};

SP.app = (() => {
  let navOpen = false;
  let paletteIndex = 0;
  let paletteItems = [];
  let alertTimer = null;

  const $ = (id) => document.getElementById(id);

  /* ═════════════════════════════════════════════════════════════ BOOT */

  async function start() {
    hint('Loading your workspace…');
    try { SP.store.load(); } catch (e) { console.warn('[boot] store', e); }

    // First run: convert the bundled snapshot into v3 demo data.
    if (!SP.store.state.products.length && SP.SEED) {
      hint('Preparing the demo catalogue…');
      SP.seed2.hydrate();
      SP.store.saveNow();
    }

    hint('Preparing accounts…');
    await SP.auth.ensureSeedUsers();

    hint('Restoring session…');
    const user = await SP.auth.restore();

    applyTheme();
    wireChrome();
    wireKeyboard();
    wireOnline();

    SP.sheets.init();

    if (user) enterApp(user);
    else showAuth();

    setTimeout(() => document.getElementById('boot')?.classList.add('is-done'), 260);
  }

  function hint(text) {
    const n = document.getElementById('bootHint');
    if (n) n.textContent = text;
  }

  /* ═════════════════════════════════════════════════════════════ AUTH */

  function showAuth() {
    $('app').hidden = true;
    $('auth').hidden = false;
    document.documentElement.dataset.theme = currentTheme();
  }

  async function enterApp(user) {
    $('auth').hidden = true;
    $('app').hidden = false;
    $('app').classList.add('is-booting');

    document.getElementById('avatarInitials').textContent = SP.fmt.initials(user.name);

    SP.router.registerAll(SP.modules);
    buildNav();
    SP.router.start(paintChrome);

    requestAnimationFrame(() => { $('app').classList.remove('is-booting'); });

    if (!SP.store.state.onboarded) setTimeout(() => openOnboarding(), 520);

    refreshAlerts();
    SP.alerts.generate();
    alertTimer = setInterval(() => { SP.alerts.generate(); refreshAlerts(); }, 60000);

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
      role: SP.auth.current()?.role || 'viewer',
      warehouse: SP.store.state.prefs.warehouse,
      alerts: SP.store.state.prefs.alerts,
    };

    document.getElementById('signinForm').hidden = true;
    document.getElementById('onboard').hidden = false;

    const steps = [
      {
        title: 'What brings you here?',
        sub: 'We tailor the dashboard to your role.',
        render: () => SP.el('div.role-picker', ...SP.ROLES.filter((r) => !['admin'].includes(r.id)).slice(0, 5).map((r) =>
          choice(r.id === 'warehouse_manager' ? 'chart' : r.id === 'warehouse_staff' ? 'box' : r.id === 'salesperson' ? 'truck' : 'eye',
            r.label, r.blurb, draft.role === r.id, () => { draft.role = r.id; draw(); }))),
      },
      {
        title: 'Which warehouse do you look after?',
        sub: 'Sets the warehouse your dashboards open on.',
        render: () => SP.el('div.role-picker',
          choice('grid', 'All warehouses', 'See the whole network', draft.warehouse === '*', () => { draft.warehouse = '*'; draw(); }),
          ...SP.store.state.warehouses.map((w) =>
            choice('home', w.name, `${SP.fmt.n(SP.ledger.summary({ warehouse: w.id }).gross)} units held`,
              draft.warehouse === w.id, () => { draft.warehouse = w.id; draw(); }))),
      },
      {
        title: 'How should we alert you?',
        sub: 'You can change this any time in Settings.',
        render: () => SP.el('div.stacklist',
          SP.el('label.switch',
            SP.el('input', { type: 'checkbox', checked: draft.alerts.enabled, onchange: (e) => { draft.alerts.enabled = e.target.checked; } }),
            SP.el('span.switch__track'),
            SP.el('span.switch__text', SP.el('strong', 'Enable alerts'), SP.el('small', 'Badges and the alert center'))),
          SP.el('label.switch',
            SP.el('input', { type: 'checkbox', checked: draft.alerts.onlyCritical, onchange: (e) => { draft.alerts.onlyCritical = e.target.checked; } }),
            SP.el('span.switch__track'),
            SP.el('span.switch__text', SP.el('strong', 'Only critical alerts'), SP.el('small', 'Out-of-stock and discrepancies')))),
      },
    ];

    function choice(icon, label, subText, active, onClick) {
      return SP.el('button.onboard__choice', { type: 'button', class: active ? 'is-active' : '', onclick: onClick },
        SP.el('span.onboard__choice-ico', SP.icon(icon)),
        SP.el('div.grow', SP.el('strong', label), SP.el('small', subText)),
        active ? SP.el('span', { style: { color: 'var(--brand)' } }, SP.icon('check')) : null);
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
        st.prefs.warehouse = draft.warehouse;
        st.prefs.alerts = { ...st.prefs.alerts, ...draft.alerts };
        st.onboarded = true;
      });
      document.getElementById('onboard').hidden = true;
      document.getElementById('signinForm').hidden = false;
      SP.router.refresh();
      SP.ui.toast({ tone: 'ok', title: 'All set', duration: 4200, body: 'Tip: press Ctrl+K to search anything.' });
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
          type: 'button', dataset: { route: item.route },
          onclick: () => { SP.router.go(item.route); closeNav(); },
        },
          SP.icon(item.icon),
          SP.el('span.grow', item.label),
          SP.el('span.navlink__count', { dataset: { role: item.route }, hidden: true }, ''),
        ));
      }
    }

    // Bottom tabs
    for (const key of SP.TABS) {
      if (key === 'more') {
        tabHost.appendChild(SP.el('button.tab', { type: 'button', dataset: { tab: '__more' }, onclick: openMoreSheet }, SP.icon('menu'), SP.el('span', 'More')));
        continue;
      }
      if (key === 'actions') {
        tabHost.appendChild(SP.el('button.tab.tab--action', { type: 'button', dataset: { tab: '__actions' }, onclick: openActionSheet }, SP.icon('plus'), SP.el('span', 'Actions')));
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

  /** Mobile primary actions: scan / receive / transfer / pick / verify / sell. */
  function openActionSheet() {
    const body = SP.el('div.grid.grid--3.gap-2', ...SP.MOBILE_ACTIONS
      .filter((a) => SP.auth.can(a.perm))
      .map((a) => SP.el('button.card.card--pad', {
        type: 'button', style: { textAlign: 'center' },
        onclick: () => {
          shell.close();
          if (a.id === 'scan') { SP.modules.devices.registerForm ? scanFlow() : null; }
          else SP.router.go(a.route, a.params || {});
        },
      },
        SP.el('span.lrow__ico', { style: { margin: '0 auto var(--sp-2)' } }, SP.icon(a.icon)),
        SP.el('strong', { style: { fontSize: 'var(--fs-sm)', display: 'block' } }, a.label))));
    const shell = SP.sheet({ title: 'Warehouse actions', content: body });
  }

  async function scanFlow() {
    const input = SP.el('input.input', { placeholder: 'Type or scan IMEI / serial…', inputmode: 'numeric' });
    const shell = SP.sheet({
      title: 'Scan / find device',
      content: SP.el('div.stack.gap-2', input,
        SP.el('button.btn.btn--primary.btn--block', { type: 'button', onclick: () => { shell.close(); SP.modules.devices.quickFind(input.value); } }, 'Find device')),
    });
    SP.ui2.scanInto(input, (value) => { shell.close(); SP.modules.devices.quickFind(value); });
  }

  function openMoreSheet() {
    const s = SP.store.state;
    const body = SP.el('div.stacklist');
    const shell = SP.sheet({ title: 'All modules', content: body });
    for (const group of SP.NAV) {
      const visible = group.items.filter((i) => !i.perm || SP.auth.can(i.perm));
      if (!visible.length) continue;
      body.appendChild(SP.el('div.sidenav__group', { style: { padding: '8px 4px 2px' } }, group.group));
      body.appendChild(SP.el('div.grid.grid--3.gap-2', ...visible.map((i) => SP.el('button.card.card--pad', {
        type: 'button', style: { textAlign: 'center' },
        onclick: () => { shell.close(); SP.router.go(i.route); },
      },
        SP.el('span.lrow__ico', { style: { margin: '0 auto var(--sp-2)' } }, SP.icon(i.icon)),
        SP.el('strong', { style: { fontSize: 'var(--fs-sm)', display: 'block' } }, i.label)))));
    }
    body.appendChild(SP.el('div', { style: { marginTop: 'var(--sp-3)' } },
      SP.el('div.conn', { dataset: { state: connState() } },
        SP.el('span.conn__led'),
        SP.el('span.conn__text', connText()))));
  }

  const toggleNav = () => { navOpen ? closeNav() : openNav(); };
  function openNav() {
    navOpen = true;
    $('app').classList.add('is-nav-open');
    document.getElementById('navScrim').hidden = false;
    document.querySelector('.appbar__icon--menu').setAttribute('aria-expanded', 'true');
  }
  function closeNav() {
    navOpen = false;
    $('app').classList.remove('is-nav-open');
    document.getElementById('navScrim').hidden = true;
    document.querySelector('.appbar__icon--menu')?.setAttribute('aria-expanded', 'false');
  }

  /* ═════════════════════════════════════════════════════════ CHROME */

  function connState() {
    if (!navigator.onLine) return 'offline';
    const st = SP.sheets.status();
    return st.mode === 'live' ? 'live' : st.mode === 'error' ? 'error' : st.mode === 'syncing' ? 'syncing' : 'snapshot';
  }
  function connText() {
    const st = SP.sheets.status();
    const pending = st.pending ? ` · ${st.pending} queued` : '';
    if (!navigator.onLine) return `Offline — changes saved on this device${pending}`;
    return { live: `Live${pending}`, syncing: 'Syncing…', error: `Error${pending}`, snapshot: `Local data${pending}` }[connState()];
  }

  function paintChrome() {
    const route = SP.router.route;
    const mod = SP.router.get(route);
    const s = SP.store.state;

    const title = mod?.title || 'StockPilot';
    const subtitle = typeof mod?.subtitle === 'function' ? mod.subtitle() : (mod?.subtitle || '');
    document.getElementById('appbarTitle').textContent = title;
    document.getElementById('appbarSub').textContent = subtitle;
    document.title = `${title} · StockPilot`;

    SP.$$('.navlink').forEach((n) => n.classList.toggle('is-active', n.dataset.route === route));
    SP.$$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === route));

    // Badges
    const pendTransfers = s.transfers.filter((t) => ['requested', 'approved', 'picking', 'dispatched', 'in_transit'].includes(t.status)).length;
    const pendApprovals = s.approvals.filter((a) => a.status === 'pending').length;
    const unread = SP.alerts.unreadCount();
    const counts = { transfers: pendTransfers, approvals: pendApprovals, alerts: unread };
    SP.$$('.navlink__count').forEach((n) => {
      const v = counts[n.dataset.role] || 0;
      n.textContent = v ? SP.fmt.n(v) : '';
      n.hidden = !v;
      n.classList.toggle('navlink__count--alert', (n.dataset.role === 'approvals' || n.dataset.role === 'alerts') && v > 0);
    });
    SP.$$('.tab').forEach((t) => {
      t.querySelector('.tab__dot')?.remove();
      if (t.dataset.tab === 'transfers' && pendTransfers > 0) t.appendChild(SP.el('span.tab__dot'));
    });

    paintConnection();
  }

  function paintConnection() {
    const pill = document.getElementById('connPill');
    if (!pill) return;
    const state = connState();
    pill.dataset.state = state;
    pill.querySelector('.conn__text').textContent = connText();
    const bar = document.getElementById('syncBar');
    if (bar) bar.hidden = state !== 'syncing';
  }

  /** Alert badge. */
  function refreshAlerts() {
    const unread = SP.alerts.unreadCount();
    const badge = document.getElementById('alertBadge');
    if (badge) {
      badge.textContent = SP.fmt.n(unread);
      badge.hidden = unread === 0;
    }
  }

  function openAlerts() { SP.router.go('alerts'); }

  function openAccount() {
    const u = SP.auth.currentUser;
    const info = SP.auth.sessionInfo();

    const body = SP.el('div.stacklist',
      SP.el('div.row.gap-3',
        SP.avatar(u, 'xl'),
        SP.el('div.grow',
          SP.el('strong', { style: { fontSize: 'var(--fs-lg)' } }, u.name),
          SP.el('p.tiny.mute', u.email),
          SP.el('div.row.gap-1', { style: { marginTop: '6px' } },
            SP.el('span.tag.tag--brand', SP.auth.roleDef(u.role).label),
            SP.el('span.tag.tag--line', (u.warehouses || []).length ? u.warehouses.join(', ') : 'All warehouses')))),
      SP.el('dl.kv', { style: { marginTop: 'var(--sp-3)' } },
        SP.el('dt', 'Signed in from'), SP.el('dd', info?.device || '—'),
        SP.el('dt', 'Session expires'), SP.el('dd', info ? SP.fmt.dateTime(info.expiresAt) : '—'),
        SP.el('dt', 'Security'), SP.el('dd', SP.crypto.isPBKDF2() ? 'PBKDF2-SHA256' : 'Fallback digest'),
        SP.el('dt', 'Version'), SP.el('dd', `v${SP.VERSION}`)),
    );

    const shell = SP.sheet({
      title: 'Account',
      content: body,
      actions: [
        SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => { shell.close(); SP.router.go('settings'); } }, SP.icon('cog'), 'Settings'),
        SP.el('button.btn.btn--danger', { type: 'button', onclick: () => { shell.close(); signOut(); } }, SP.icon('logout'), 'Sign out'),
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
    const ql = q.toLowerCase();
    const s = SP.store.state;
    const groups = [];

    /* Pages */
    const pages = SP.NAV.flatMap((g) => g.items)
      .filter((i) => !i.perm || SP.auth.can(i.perm))
      .filter((i) => !q || SP.score(q, i.label) > 0)
      .map((i) => ({ label: i.label, sub: 'Module', icon: i.icon, run: () => SP.router.go(i.route) }));
    if (pages.length) groups.push({ name: 'Go to', items: pages.slice(0, 8) });

    if (q.length >= 1) {
      /* IMEI / serial */
      const imeiClean = SP.imei.clean(q);
      if (imeiClean.length >= 5) {
        const devices = s.devices.filter((d) => d.imei1?.includes(imeiClean) || d.imei2?.includes(imeiClean) || d.serial?.includes(q)).slice(0, 5);
        if (devices.length) {
          groups.push({
            name: 'Devices / IMEI',
            items: devices.map((d) => {
              const p = s.products.find((x) => x.id === d.productId);
              return { label: d.imei1 || d.serial, sub: `${p?.name || ''} · ${SP.deviceStatus(d.status).label}`, icon: 'layers', run: () => SP.modules.devices.openDevice(d.id) };
            }),
          });
        }
      }

      /* Products */
      const products = s.products
        .filter((p) => !p.archived)
        .map((p) => ({ p, score: Math.max(SP.score(q, p.sku), SP.score(q, p.name) * 0.95, SP.score(q, p.brand) * 0.6, SP.score(q, p.color) * 0.5, SP.score(q, p.barcode) * 0.9) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map(({ p }) => ({
          label: p.name,
          sub: `${SP.fmt.n(SP.ledger.stockOf(p.id))} units · ${p.brand} · ${p.sku}`,
          icon: 'box',
          run: () => SP.router.go('products', { id: p.id }),
        }));
      if (products.length) groups.push({ name: 'Products', items: products });

      /* Documents */
      const docs = [];
      for (const t of s.transfers.filter((x) => x.ref.toLowerCase().includes(ql)).slice(0, 3)) docs.push({ label: `Transfer ${t.ref}`, sub: `${t.from} → ${t.to} · ${SP.statusOf('transfer', t.status).label}`, icon: 'swap', run: () => SP.router.go('transfers', { id: t.id }) });
      for (const x of s.sales.filter((y) => !y.legacy && (y.ref.toLowerCase().includes(ql) || (y.customerName || '').toLowerCase().includes(ql))).slice(0, 3)) docs.push({ label: `Invoice ${x.ref}`, sub: `${x.customerName} · ${SP.fmt.money(x.total)}`, icon: 'truck', run: () => SP.router.go('sales', { id: x.id }) });
      for (const x of s.purchases.filter((y) => !y.legacy && y.ref.toLowerCase().includes(ql)).slice(0, 3)) docs.push({ label: `PO ${x.ref}`, sub: `${x.supplierName} · ${SP.statusOf('po', x.status).label}`, icon: 'cart', run: () => SP.router.go('purchases', { id: x.id }) });
      for (const c of s.customers.filter((y) => (y.name || '').toLowerCase().includes(ql)).slice(0, 3)) docs.push({ label: c.name, sub: `Customer · due ${SP.fmt.money(SP.sum(s.sales.filter((z) => z.customerId === c.id), (z) => Math.max(0, z.total - (z.paid || 0))))}`, icon: 'users', run: () => SP.router.go('customers') });
      for (const w of s.warehouses.filter((y) => y.name.toLowerCase().includes(ql)).slice(0, 3)) docs.push({ label: w.name, sub: 'Warehouse', icon: 'home', run: () => SP.router.go('warehouses', { id: w.id }) });
      if (docs.length) groups.push({ name: 'Documents & parties', items: docs.slice(0, 8) });
    }

    /* Actions */
    const actions = [
      { label: 'Add stock (receive)', icon: 'download', perm: 'movements:create', run: () => SP.modules.movements.receiveForm() },
      { label: 'Create transfer', icon: 'swap', perm: 'transfers:create', run: () => SP.modules.transfers.openForm() },
      { label: 'New sale / invoice', icon: 'truck', perm: 'sales:create', run: () => SP.modules.sales.openForm() },
      { label: 'New purchase order', icon: 'cart', perm: 'purchases:create', run: () => SP.modules.purchases.openForm() },
      { label: 'Find IMEI', icon: 'layers', run: () => openPalette(prompt0()) },
      { label: 'Register device', icon: 'plus', perm: 'devices:create', run: () => SP.modules.devices.registerForm() },
      { label: 'New product', icon: 'tag', perm: 'products:create', run: () => SP.modules.products.editProduct(null) },
      { label: 'Start stock verification', icon: 'scale', perm: 'verify:perform', run: () => SP.router.go('verify') },
      { label: 'Show low stock', icon: 'alert', run: () => SP.router.go('refill') },
      { label: 'Show dead stock', icon: 'clock', run: () => SP.router.go('reports', { rpt: 'dead_stock' }) },
      { label: 'Open pending approvals', icon: 'checkCircle', perm: 'approvals:view', run: () => SP.router.go('approvals') },
      { label: "Generate today's report", icon: 'file', run: () => SP.router.go('reports', { rpt: 'daily_stock' }) },
      { label: 'Export inventory CSV', icon: 'download', run: () => SP.router.go('inventory') },
      { label: 'Download a full backup', icon: 'save', run: () => SP.download(JSON.stringify(SP.store.exportBackup(), null, 2), `stockpilot-backup-${Date.now()}.json`) },
      { label: `Switch to ${currentTheme() === 'dark' ? 'light' : 'dark'} theme`, icon: currentTheme() === 'dark' ? 'sun' : 'moon', run: () => setThemeMode(currentTheme() === 'dark' ? 'light' : 'dark') },
      { label: 'Sign out', icon: 'logout', run: () => signOut() },
    ]
      .filter((a) => !a.perm || SP.auth.can(a.perm))
      .filter((a) => !q || SP.score(q, a.label) > 0)
      .map((a) => ({ ...a, sub: 'Action' }));
    if (actions.length) groups.push({ name: 'Actions', items: actions.slice(0, 8) });

    if (!groups.length) {
      results.appendChild(SP.el('div.palette__empty', `No results for “${query}”`));
      return;
    }

    for (const g of groups) {
      results.appendChild(SP.el('div.palette__group', g.name));
      for (const item of g.items) {
        paletteItems.push(item);
        results.appendChild(SP.el('button.pal-item', {
          type: 'button',
          onclick: () => { closePalette(); item.run(); },
        },
          SP.el('span.pal-item__ico', SP.icon(item.icon || 'arrowRight')),
          SP.el('div.pal-item__main', SP.el('strong', item.label), SP.el('small', item.sub)),
          item.meta ? SP.el('span.pal-item__meta', item.meta) : null));
      }
    }
    highlight(0);
  }

  function prompt0() {
    setTimeout(() => {
      const input = document.getElementById('paletteInput');
      input.value = '';
      input.placeholder = 'Type an IMEI or serial number…';
    }, 30);
    return '';
  }

  function highlight(i) {
    const nodes = SP.$$('.pal-item', document.getElementById('paletteResults'));
    nodes.forEach((n, k) => n.classList.toggle('is-sel', k === i));
    if (nodes[i]) nodes[i].scrollIntoView({ block: 'nearest' });
    paletteIndex = Math.max(0, Math.min(i, nodes.length - 1));
  }

  /* ═══════════════════════════════════════════════════════ WIRING */

  function wireChrome() {
    SP.on('[data-action="toggle-nav"]', 'click', toggleNav);
    SP.on('#navScrim', 'click', closeNav);
    SP.on('[data-action="open-search"]', 'click', () => openPalette());
    SP.on('[data-action="open-alerts"]', 'click', openAlerts);
    SP.on('[data-action="open-account"]', 'click', openAccount);

    SP.on('[data-action="toggle-theme"]', 'click', () => setThemeMode(currentTheme() === 'dark' ? 'light' : 'dark'));
    SP.on('[data-action="recover"]', 'click', openRecover);
    SP.on('[data-action="sso"]', 'click', () => {
      const note = document.getElementById('ssoNote');
      note.textContent = SP.store.state.settings.integrations.googleSheets.connected
        ? 'Directory sign-in is not available in this deployment. Use local credentials.'
        : 'Workspace SSO is not connected. Sign in with a local account.';
    });
    SP.on('[data-action="open-request"]', 'click', () => {
      SP.ui.toast({ tone: 'info', title: 'Ask an administrator', body: 'Accounts are created in Users & Roles by any admin.' });
    });
    SP.on('[data-action="open-help"]', 'click', () => {
      $('auth').hidden = true;
      $('app').hidden = false;
      SP.router.registerAll(SP.modules);
      buildNav();
      SP.router.go('help');
      SP.router.start(paintChrome);
    });

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
    SP.clear(host);
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
      for (let i = 0; i < 4; i += 1) dots.appendChild(SP.el('i', { class: i < pin.length ? 'on' : '' }));
    };

    const select = (u) => {
      selected = u;
      pin = '';
      drawDots();
      nameNode.textContent = u.name;
      SP.$$('.pin-user', host).forEach((n) => n.classList.toggle('is-active', n.dataset.id === u.id));
    };

    for (const u of users) {
      host.appendChild(SP.el('button.pin-user', { type: 'button', dataset: { id: u.id }, onclick: () => select(u) }, SP.avatar(u), u.name.split(' ')[0]));
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
        if (!$('app').hidden) openPalette();
        return;
      }
      if (e.key === 'Escape' && !document.getElementById('palette').hidden) { closePalette(); return; }
      if (typing) return;

      if (!$('app').hidden && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const map = { d: 'dashboard', i: 'inventory', t: 'transfers', m: 'movements', s: 'sales', w: 'warehouses', p: 'products' };
        const route = map[e.key.toLowerCase()];
        const navItem = SP.NAV.flatMap((g) => g.items).find((i) => i.route === route);
        if (route && SP.router.get(route) && (!navItem?.perm || SP.auth.can(navItem.perm))) {
          SP.router.go(route);
        }
      }
    });

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
      paintConnection();
    });
  }

  /* ═══════════════════════════════════════════════════ RECOVERY */

  async function openRecover() {
    await SP.modal({
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
  }

  /* ══════════════════════════════════════════════════════════════ */

  return {
    start, signOut, applyTheme, setThemeMode, paintChrome, paintConnection,
    openPalette, refreshAlerts, currentTheme,
  };
})();

/* ═══════════════════════════════════════════════════ OFFLINE SUPPORT */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
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
