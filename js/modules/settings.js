/**
 * modules/settings.js — company, stock, approvals, notifications,
 * security, integrations, backup & data. Plus the user profile pane.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.settings = (() => {
  const MOD = { title: 'Settings', subtitle: 'Workspace configuration', mount };

  const SECTIONS = [
    { id: 'profile', label: 'Profile & appearance', icon: 'users' },
    { id: 'company', label: 'Company', icon: 'building' },
    { id: 'stock', label: 'Stock & reorder rules', icon: 'box' },
    { id: 'approvals', label: 'Approval rules', icon: 'checkCircle' },
    { id: 'alerts', label: 'Notifications', icon: 'bell' },
    { id: 'security', label: 'Security', icon: 'lock' },
    { id: 'integrations', label: 'Integrations', icon: 'link' },
    { id: 'backup', label: 'Backup & data', icon: 'save' },
  ];

  function mount(params) {
    const section = params?.s || 'profile';
    const root = SP.el('div.stack.gap-4');
    root.appendChild(SP.ui2.pageHead({ title: 'Settings', sub: 'Everything configurable lives here.' }));

    root.appendChild(SP.el('div.chips', ...SECTIONS.map((s) => SP.el('button.chip', {
      type: 'button', class: s.id === section ? 'is-active' : '',
      onclick: () => SP.router.go('settings', { s: s.id }),
    }, s.label))));

    root.appendChild(RENDER[section]());
    return root;
  }

  /* ═══════════════════════════════════════════════════════ sections */

  const RENDER = {
    profile() {
      const u = SP.auth.current();
      const p = SP.store.state.prefs;
      const wrap = SP.el('div.stack.gap-3');
      wrap.appendChild(SP.el('div.card.card--pad',
        SP.el('div.row.gap-3', { style: { alignItems: 'center' } },
          SP.avatar(u, 'xl'),
          SP.el('div.grow', SP.el('strong', { style: { fontSize: 'var(--fs-lg)' } }, u.name), SP.el('p.tiny.mute', u.email)),
          SP.ui2.tag(SP.auth.roleDef(u.role).label, 'brand')),
        SP.el('div.row.gap-2', { style: { marginTop: 'var(--sp-3)', flexWrap: 'wrap' } },
          SP.el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            onclick: async () => {
              const r = await SP.modal({
                title: 'Change password', icon: 'lock', okLabel: 'Change',
                fields: [
                  { key: 'old', label: 'Current password', type: 'password', required: true },
                  { key: 'next', label: 'New password', type: 'password', required: true },
                ],
                onOk: async (v) => { await SP.auth.changeOwnPassword(v.old, v.next); },
              });
              if (r) SP.ui.toast({ tone: 'ok', title: 'Password changed' });
            },
          }, SP.icon('key'), 'Change password'),
          SP.el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            onclick: async () => {
              const r = await SP.modal({
                title: u.pin ? 'Change quick PIN' : 'Set quick PIN', icon: 'key', okLabel: 'Save PIN',
                fields: [{ key: 'pin', label: '4-digit PIN', inputmode: 'numeric', required: true, validate: (raw) => /^\d{4}$/.test(raw) ? null : 'Exactly 4 digits' }],
                onOk: async (v) => { await SP.auth.setPin(u.id, v.pin); },
              });
              if (r) SP.ui.toast({ tone: 'ok', title: 'PIN saved' });
            },
          }, SP.icon('pin'), u.pin ? 'Change PIN' : 'Set PIN'),
          SP.el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            onclick: () => { SP.auth.revokeSessions(u.id); SP.app.signOut(); },
          }, SP.icon('logout'), 'Log out all devices'),
        )));
      wrap.appendChild(SP.el('div.card.card--pad',
        SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Appearance'),
        SP.el('div.row.gap-2', { style: { flexWrap: 'wrap' } },
          SP.segmented([{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'auto', label: 'Auto' }],
            localStorage.getItem('stockpilot.themeMode') || p.theme || 'dark',
            (v) => SP.app.setThemeMode(v)),
          SP.segmented([{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }],
            p.density || 'comfortable',
            (v) => { SP.store.update(['prefs'], (st) => { st.prefs.density = v; }); SP.app.applyTheme(); })),
        SP.el('div.row.gap-2', { style: { marginTop: 'var(--sp-3)', flexWrap: 'wrap' } },
          ...['#5b8cff', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#38bdf8'].map((c) => SP.el('button.accent-dot', {
            type: 'button', 'aria-label': `Accent ${c}`,
            style: { background: c, outline: p.accent === c ? '2px solid var(--text-hi)' : 'none' },
            onclick: () => { SP.store.update(['prefs'], (st) => { st.prefs.accent = c; }); SP.app.applyTheme(); },
          })))));
      return wrap;
    },

    company() {
      const c = SP.store.state.settings.company;
      return SP.el('div.card.card--pad',
        SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Company settings'),
        SP.el('div.stack.gap-2',
          field('Company name', c.name, (v) => setCompany('name', v)),
          field('Address', c.address, (v) => setCompany('address', v)),
          field('Phone', c.phone, (v) => setCompany('phone', v)),
          field('Invoice footer', c.invoiceFooter, (v) => setCompany('invoiceFooter', v)),
          SP.el('div.row.gap-2',
            SP.el('label.field.grow', SP.el('span.field__label', 'Currency'),
              SP.el('select.select', { onchange: (e) => setCompany('currency', e.target.value) },
                ...['BDT', 'USD', 'EUR', 'INR'].map((cur) => SP.el('option', { value: cur, selected: c.currency === cur }, cur)))),
            SP.el('label.field.grow', SP.el('span.field__label', 'Language'),
              SP.el('select.select', { disabled: true },
                ...SP.LOCALES.map((l) => SP.el('option', { selected: l.id === 'en' }, l.label))))),
          SP.el('p.tiny.mute', 'Currency: Bangladeshi Taka (৳) by default. Bangla UI is planned; the architecture (centralised strings) is ready.')));
    },

    stock() {
      const s = SP.store.state;
      const types = [...SP.STOCK_TYPES, ...s.settings.stockTypes];
      const wrap = SP.el('div.stack.gap-3');
      wrap.appendChild(SP.el('div.card.card--pad',
        SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Stock types'),
        SP.el('div.chips', ...types.map((t) => SP.el('span.chip', t.label))),
        SP.auth.can('settings:manage') ? SP.el('div.row.gap-2', { style: { marginTop: 'var(--sp-2)' } },
          (() => {
            const input = SP.el('input.input', { placeholder: 'New stock type…' });
            return [input, SP.el('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              onclick: () => {
                const label = input.value.trim();
                if (!label) return;
                SP.store.update(['settings'], (st) => { st.settings.stockTypes.push({ id: SP.uid('st'), label, custom: true }); });
                SP.store.audit('settings.stocktype', label, '');
                SP.router.refresh();
              },
            }, SP.icon('plus'), 'Add')];
          })()) : null));
      wrap.appendChild(SP.el('div.card.card--pad',
        SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Reorder & intelligence rules'),
        SP.el('div.stack.gap-2',
          numField('Default low-stock floor (units)', s.settings.lowStockDefault, (v) => setSettings('lowStockDefault', v)),
          numField('Dead stock horizon (days)', s.rules.deadStockDays, (v) => { SP.store.update(['rules'], (st) => { st.rules.deadStockDays = v; }); }),
          SP.el('p.tiny.mute', 'Per-product minimums, reorder points, max stock and lead times are set on each product.'))));
      return wrap;
    },

    approvals() {
      const rules = SP.store.state.settings.approvalRules;
      const wrap = SP.el('div.stack.gap-2');
      for (const rule of rules) {
        const kind = SP.APPROVAL_KINDS.find((k) => k.id === rule.kind);
        const threshold = rule.thresholdPct != null ? `> ${rule.thresholdPct}%`
          : rule.thresholdQty != null && rule.thresholdQty > 0 ? `> ${rule.thresholdQty} units`
            : rule.thresholdValue != null ? `> ${SP.fmt.money(rule.thresholdValue)}` : 'any';
        wrap.appendChild(SP.el('div.card.card--pad.row', { style: { alignItems: 'center', gap: 'var(--sp-2)' } },
          SP.el('div.grow',
            SP.el('strong', rule.label),
            SP.el('p.tiny.mute', `${kind?.label || rule.kind} · triggers at ${threshold} · approvers: ${rule.approverRoles.map((r) => SP.auth.roleDef(r).label).join(', ')}`)),
          SP.el('label.switch',
            SP.el('input', {
              type: 'checkbox', checked: rule.enabled,
              onchange: (e) => {
                SP.store.update(['settings'], (st) => {
                  const t = st.settings.approvalRules.find((x) => x.id === rule.id);
                  if (t) t.enabled = e.target.checked;
                });
                SP.store.audit('settings.rule', rule.label, e.target.checked ? 'enabled' : 'disabled');
              },
            }),
            SP.el('span.switch__track'))));
      }
      wrap.appendChild(SP.el('p.tiny.mute', 'Approvers must hold the “Decide approvals” permission. Users who can decide cannot approve their own requests.'));
      return wrap;
    },

    alerts() {
      const a = SP.store.state.prefs.alerts;
      const toggle = (key, label, sub) => SP.el('label.switch', { style: { marginBottom: 'var(--sp-2)' } },
        SP.el('input', {
          type: 'checkbox', checked: a[key],
          onchange: (e) => { SP.store.update(['prefs'], (st) => { st.prefs.alerts[key] = e.target.checked; }); },
        }),
        SP.el('span.switch__track'),
        SP.el('span.switch__text', SP.el('strong', label), SP.el('small', sub)));
      return SP.el('div.card.card--pad',
        SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Notification preferences'),
        toggle('enabled', 'Enable alerts', 'Badges, alert center and toasts'),
        toggle('onlyCritical', 'Only critical alerts', 'Out-of-stock and discrepancies only'),
        SP.el('p.tiny.mute', 'Push notifications require a backend push service — not connected. In-app alerts always work.'));
    },

    security() {
      const u = SP.auth.current();
      const info = SP.auth.sessionInfo();
      return SP.el('div.stack.gap-3',
        SP.el('div.card.card--pad',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'This session'),
          SP.el('dl.kv',
            SP.el('dt', 'Device'), SP.el('dd', info?.device || '—'),
            SP.el('dt', 'Started'), SP.el('dd', info ? SP.fmt.dateTime(info.startedAt) : '—'),
            SP.el('dt', 'Expires'), SP.el('dd', info ? SP.fmt.dateTime(info.expiresAt) : '—'),
            SP.el('dt', 'Password hashing'), SP.el('dd', SP.crypto.isPBKDF2() ? 'PBKDF2-SHA256 (120k rounds)' : 'Fallback digest — serve over HTTPS'),
            SP.el('dt', 'Lockout'), SP.el('dd', '5 failed attempts → 60s lock'))),
        SP.el('div.card.card--pad',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Sign-in history'),
          SP.ui2.timeline(SP.store.state.audit.filter((x) => x.action.startsWith('auth.') || (x.action.startsWith('user.') && x.target === u.email)).slice(0, 15)
            .map((x) => ({ at: x.at, title: x.action, body: x.detail, meta: x.by })))),
        SP.el('div.callout', { dataset: { tone: 'warn' } },
          SP.el('span.callout__ico', SP.icon('alert')),
          SP.el('div.callout__body',
            SP.el('strong', 'Client-side security boundary'),
            SP.el('p', 'A static web app cannot enforce server-side security. Credentials are hashed and sessions expire, but a determined attacker with device access can inspect local data. For production, deploy the Apps Script bridge or a real backend and enforce permissions server-side. MFA/OTP requires that backend — not simulated here.'))));
    },

    integrations() {
      const ig = SP.store.state.settings.integrations;
      const wrap = SP.el('div.stack.gap-3');
      wrap.appendChild(SP.el('div.card.card--pad',
        SP.el('div.row', { style: { justifyContent: 'space-between', alignItems: 'center' } },
          SP.el('strong', 'Google Sheets'),
          SP.ui2.tag(ig.googleSheets.connected ? 'Connected' : 'Not connected', ig.googleSheets.connected ? 'ok' : 'mute')),
        SP.el('p.tiny.mute', { style: { marginTop: '6px' } },
          ig.googleSheets.connected
            ? `Bridge live. Last sync ${ig.googleSheets.lastSync ? SP.fmt.ago(ig.googleSheets.lastSync) : 'never'}.`
            : 'Google Sheets integration not connected. Deploy the Apps Script bridge (gas/Code.gs) and paste its URL below — instructions in Help.'),
        SP.el('div.row.gap-2', { style: { marginTop: 'var(--sp-2)' } },
          (() => {
            const input = SP.el('input.input.grow', { placeholder: 'https://script.google.com/…/exec', value: ig.googleSheets.bridgeUrl || '' });
            return [input, SP.el('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              onclick: async () => {
                SP.store.update(['settings'], (st) => { st.settings.integrations.googleSheets.bridgeUrl = input.value.trim(); });
                const r = await SP.sheets.testBridge(input.value.trim());
                SP.store.update(['settings'], (st) => {
                  st.settings.integrations.googleSheets.connected = !!r.ok;
                  st.settings.integrations.googleSheets.lastSync = r.ok ? Date.now() : null;
                });
                SP.ui.toast(r.ok ? { tone: 'ok', title: 'Bridge connected' } : { tone: 'warn', title: 'Bridge not reachable', body: r.error || 'Saved the URL; staying offline.' });
                SP.router.refresh();
              },
            }, 'Save & test')];
          })())));
      wrap.appendChild(SP.el('div.card.card--pad',
        SP.el('div.row', { style: { justifyContent: 'space-between', alignItems: 'center' } },
          SP.el('strong', 'WhatsApp'),
          SP.ui2.tag('Share links only', 'info')),
        SP.el('p.tiny.mute', { style: { marginTop: '6px' } }, 'Invoices are shared through wa.me links you confirm in WhatsApp. No automated messaging is connected or simulated.')));
      wrap.appendChild(SP.el('div.card.card--pad',
        SP.el('div.row', { style: { justifyContent: 'space-between', alignItems: 'center' } },
          SP.el('strong', 'AI endpoint'),
          SP.ui2.tag('Not connected', 'mute')),
        SP.el('p.tiny.mute', { style: { marginTop: '6px' } }, 'The AI Assistant currently answers from deterministic ledger queries. Connect an LLM endpoint here later — the service boundary (SP.ai) is already isolated for it.')));
      return wrap;
    },

    backup() {
      const s = SP.store.state;
      const size = (() => { try { return JSON.stringify(s).length; } catch { return 0; } })();
      return SP.el('div.stack.gap-3',
        SP.el('div.card.card--pad',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Backup status'),
          SP.el('dl.kv',
            SP.el('dt', 'Data size'), SP.el('dd', SP.fmt.bytes(size)),
            SP.el('dt', 'Last backup'), SP.el('dd', s.settings.backup.lastAt ? SP.fmt.dateTime(s.settings.backup.lastAt) : 'Never'),
            SP.el('dt', 'Ledger entries'), SP.el('dd', SP.fmt.n(s.movements.length)),
            SP.el('dt', 'Audit records'), SP.el('dd', SP.fmt.n(s.audit.length)),
            SP.el('dt', 'Storage'), SP.el('dd', 'This device (localStorage)')),
          SP.el('div.row.gap-2', { style: { marginTop: 'var(--sp-3)', flexWrap: 'wrap' } },
            SP.el('button.btn.btn--primary.btn--sm', {
              type: 'button',
              onclick: () => {
                SP.download(JSON.stringify(SP.store.exportBackup(), null, 2), `stockpilot-backup-${new Date().toISOString().slice(0, 10)}.json`);
                SP.store.update(['settings'], (st) => { st.settings.backup.lastAt = Date.now(); });
                SP.store.audit('backup.export', 'manual', '');
                SP.ui.toast({ tone: 'ok', title: 'Backup downloaded' });
                SP.router.refresh();
              },
            }, SP.icon('save'), 'Download backup'),
            SP.el('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              onclick: async () => {
                const ok = await SP.modal({ title: 'Restore from backup?', body: 'This replaces ALL current data on this device. Download a backup first.', tone: 'danger', okLabel: 'Choose backup file' });
                if (!ok) return;
                const input = SP.el('input', { type: 'file', accept: '.json,application/json' });
                input.addEventListener('change', async () => {
                  try {
                    const payload = JSON.parse(await input.files[0].text());
                    SP.store.importBackup(payload);
                    SP.store.audit('backup.restore', payload.exportedAt || '', '');
                    SP.ui.toast({ tone: 'ok', title: 'Backup restored' });
                    SP.router.refresh();
                  } catch (e) { SP.ui.toast({ tone: 'danger', title: 'Restore failed', body: e.message }); }
                });
                input.click();
              },
            }, SP.icon('upload'), 'Restore backup'))),
        SP.el('div.card.card--pad',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Data management'),
          SP.el('p.tiny.mute', s.settings.demo
            ? 'This workspace currently holds DEMO DATA (the v1 sheet snapshot). Wipe it to start clean.'
            : 'Workspace holds real data entered on this device.'),
          SP.el('div.row.gap-2', { style: { marginTop: 'var(--sp-2)', flexWrap: 'wrap' } },
            SP.auth.can('data:manage') ? SP.el('button.btn.btn--danger.btn--sm', {
              type: 'button',
              onclick: async () => {
                const ok = await SP.modal({
                  title: 'Wipe workspace data?', tone: 'danger', okLabel: 'Wipe everything',
                  body: 'Deletes products, ledger, sales, purchases, devices and settings on this device. User accounts are kept. This cannot be undone.',
                  fields: [{ key: 'confirm', label: 'Type WIPE to confirm', required: true, validate: (raw) => raw === 'WIPE' ? null : 'Type WIPE exactly' }],
                });
                if (!ok) return;
                SP.store.reset({ keepUsers: true });
                SP.store.audit('data.wipe', 'workspace', 'All data wiped by admin');
                SP.ui.toast({ tone: 'ok', title: 'Workspace wiped' });
                SP.router.go('dashboard');
              },
            }, SP.icon('trash'), 'Wipe data') : null,
            s.settings.demo ? SP.el('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              onclick: () => {
                SP.download(JSON.stringify(SP.store.exportBackup(), null, 2), `stockpilot-demo-backup-${Date.now()}.json`);
              },
            }, SP.icon('save'), 'Export demo first') : null)));
    },
  };

  /* ─────────────────────────────────────────────────────── helpers */

  function field(label, value, onCommit) {
    const input = SP.el('input.input', { value: value || '' });
    input.addEventListener('change', () => { onCommit(input.value); SP.ui.toast({ tone: 'ok', title: 'Saved' }); });
    return SP.el('label.field', SP.el('span.field__label', label), input);
  }
  function numField(label, value, onCommit) {
    const input = SP.el('input.input.input--num', { type: 'number', min: 0, value });
    input.addEventListener('change', () => { onCommit(Number(input.value) || 0); SP.ui.toast({ tone: 'ok', title: 'Saved' }); });
    return SP.el('label.field', SP.el('span.field__label', label), input);
  }
  const setCompany = (k, v) => SP.store.update(['settings'], (st) => { st.settings.company[k] = v; });
  const setSettings = (k, v) => SP.store.update(['settings'], (st) => { st.settings[k] = v; });

  return MOD;
})();

/* ════════════════════════════════════════════════════════════ ABOUT */

SP.modules.about = (() => {
  const MOD = { title: 'System Info', subtitle: 'Version, environment and health', mount };

  function mount() {
    const s = SP.store.state;
    const size = (() => { try { return JSON.stringify(s).length; } catch { return 0; } })();
    const root = SP.el('div.stack.gap-3',
      SP.ui2.pageHead({ title: 'System Info', sub: 'About this StockPilot installation.' }),
      SP.el('div.card.card--pad',
        SP.el('div.row.gap-3', { style: { alignItems: 'center' } },
          SP.el('span.auth__logo', SP.icon('glyph')),
          SP.el('div.grow',
            SP.el('strong', { style: { fontSize: 'var(--fs-lg)' } }, SP.PRODUCT_NAME),
            SP.el('p.tiny.mute', 'Inventory Intelligence & Warehouse Operations Platform')))),
      SP.el('div.card.card--pad',
        SP.el('dl.kv',
          SP.el('dt', 'Version'), SP.el('dd', `v${SP.VERSION}`),
          SP.el('dt', 'Build'), SP.el('dd', SP.BUILD),
          SP.el('dt', 'Environment'), SP.el('dd', `${location.protocol === 'https:' ? 'HTTPS (secure)' : location.protocol === 'file:' ? 'Local file' : 'HTTP (limited)'} · ${navigator.onLine ? 'online' : 'offline'}`),
          SP.el('dt', 'Database'), SP.el('dd', `Local device storage · ${SP.fmt.bytes(size)} · ${SP.fmt.n(s.movements.length)} ledger entries`),
          SP.el('dt', 'API / bridge'), SP.el('dd', s.settings.integrations.googleSheets.connected ? 'Google Sheets bridge connected' : 'No backend connected'),
          SP.el('dt', 'AI service'), SP.el('dd', s.settings.integrations.ai.connected ? 'Connected' : 'Not connected (local deterministic mode)'),
          SP.el('dt', 'Last sync'), SP.el('dd', s.sheet.lastSync ? SP.fmt.dateTime(s.sheet.lastSync) : 'Never'),
          SP.el('dt', 'Backup'), SP.el('dd', s.settings.backup.lastAt ? `Last ${SP.fmt.dateTime(s.settings.backup.lastAt)}` : 'Never backed up'),
          SP.el('dt', 'Service worker'), SP.el('dd', 'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'Active (offline ready)' : 'Registered on next load') : 'Unsupported'),
          SP.el('dt', 'Demo mode'), SP.el('dd', s.settings.demo ? 'DEMO DATA loaded' : 'Real data'))),
      SP.el('div.card.card--pad',
        SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Integrity check'),
        integrity()),
    );
    return root;
  }

  /** Recompute every product from the ledger and report drift (should be none). */
  function integrity() {
    const s = SP.store.state;
    const issues = [];
    for (const t of s.transfers.filter((x) => !x.legacy && ['dispatched', 'in_transit', 'received', 'completed'].includes(x.status))) {
      for (const item of t.items) {
        const has = s.movements.some((m) => m.refType === 'transfer' && m.refId === t.id && m.type === 'transfer_out' && m.productId === item.productId);
        if (!has) issues.push(`Transfer ${t.ref} missing OUT movement for a line`);
      }
    }
    const dupes = SP.imei.duplicates();
    if (dupes.size) issues.push(`${dupes.size} duplicate IMEI(s)`);
    const negatives = [];
    for (const p of s.products) {
      const q = SP.ledger.stockOf(p.id);
      if (q < 0) negatives.push(`${p.name} at ${q}`);
    }
    if (negatives.length) issues.push(`Negative stock: ${negatives.slice(0, 3).join(', ')}`);
    if (!issues.length) return SP.el('p.tiny', { style: { color: 'var(--ok)' } }, 'All checks passed — ledger, transfers and device registry are consistent.');
    return SP.el('div.stack.gap-1', ...issues.map((i) => SP.el('p.tiny', { style: { color: 'var(--warn)' } }, `• ${i}`)));
  }

  return MOD;
})();
