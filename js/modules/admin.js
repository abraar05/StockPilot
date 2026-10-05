/**
 * modules/admin.js — the control surface.
 * Users & roles, decision rules, appearance, catalogue, sheet connection.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.admin = (() => {
  const state = { tab: 'users' };

  const MOD = {
    title: 'Admin Console',
    perm: 'manage:users',
    subtitle: () => `${SP.fmt.pluralise(SP.store.state.users.length, 'user')} · ${SP.store.state.warehouses.length} sites`,
    mount,
  };

  const TABS = [
    { value: 'users', label: 'Users' },
    { value: 'roles', label: 'Roles' },
    { value: 'rules', label: 'Rules' },
    { value: 'sites', label: 'Sites' },
    { value: 'data', label: 'Data' },
  ];

  async function mount(params) {
    if (params?.tab) state.tab = params.tab;
    const root = SP.el('div.stack.gap-4');

    /* ── Admin header ─────────────────────────────────────────────── */
    const s = SP.store.state;
    const admins = s.users.filter((u) => u.role === 'admin' && u.active).length;
    const pending = s.pendingOps.length;

    root.appendChild(SP.el('div.card.card--pad',
      SP.el('div.row.gap-3.row--wrap',
        SP.el('div.grow',
          SP.el('strong', { style: { fontSize: 'var(--fs-lg)' } }, 'Workspace control'),
          SP.el('p.tiny.mute', { style: { marginTop: '2px' } },
            'Changes apply immediately for everyone and are written to the audit log.'),
        ),
        SP.el('div.row.gap-2',
          SP.el('span.badge', { class: admins > 1 ? 'badge--ok' : 'badge--warn' }, `${admins} admin${admins === 1 ? '' : 's'}`),
          pending ? SP.el('span.badge.badge--warn', `${pending} queued`) : null,
        ),
      ),
    ));

    root.appendChild(SP.segmented(TABS, state.tab, (v) => { state.tab = v; SP.router.refresh(); }));

    const host = SP.el('div');
    root.appendChild(host);
    ({ users: usersTab, roles: rolesTab, rules: rulesTab, sites: sitesTab, data: dataTab }[state.tab])(host);

    return root;
  }

  /* ───────────────────────────────────────────────────────── users */

  function usersTab(host) {
    const s = SP.store.state;

    host.appendChild(SP.el('div.row.gap-2',
      SP.el('button.btn.btn--primary.btn--block', {
        type: 'button', onclick: () => openUserForm(null),
      }, SP.icon('plus'), 'Add user'),
    ));

    const table = SP.el('div.card',
      SP.el('div.card__head', SP.icon('users'), SP.el('h2', 'Team'),
        SP.el('span.sub', `${SP.fmt.pluralise(s.users.length, 'account')}`)),
      SP.el('div.tablewrap',
        SP.el('table.table',
          SP.el('thead', SP.el('tr',
            SP.el('th', 'User'), SP.el('th', 'Role'), SP.el('th', 'Site'),
            SP.el('th', 'Status'), SP.el('th', 'Last seen'), SP.el('th', ''),
          )),
          SP.el('tbody', ...s.users.map((u) => {
            const locked = u.lockedUntil && u.lockedUntil > Date.now();
            return SP.el('tr',
              SP.el('td', SP.el('div.usertable__user',
                SP.avatar(u, 'sm'),
                SP.el('div.cell-main',
                  SP.el('strong', u.name),
                  SP.el('small', u.email),
                ),
              )),
              SP.el('td', SP.el('span.tag', {
                class: u.role === 'admin' ? 'tag--brand' : u.role === 'manager' ? 'tag--violet' : u.role === 'storekeeper' ? 'tag--info' : 'tag--mute',
              }, SP.auth.roleDef(u.role).label)),
              SP.el('td', u.warehouse || '—'),
              SP.el('td', locked
                ? SP.el('span.tag.tag--danger', 'Locked')
                : u.active
                  ? SP.el('span.tag.tag--u-green', 'Active')
                  : SP.el('span.tag.tag--mute', 'Disabled')),
              SP.el('td', u.lastLoginAt ? SP.fmt.ago(u.lastLoginAt) : 'Never'),
              SP.el('td', SP.el('button.btn.btn--icon.btn--sm.btn--quiet', {
                type: 'button', 'aria-label': `Manage ${u.name}`,
                onclick: (e) => openUserMenu(e.currentTarget, u),
              }, SP.icon('chevronDown'))),
            );
          })),
        ),
      ),
    );
    host.appendChild(table);

    host.appendChild(SP.section('Sessions', 'Devices currently signed in',
      SP.el('div.card',
        ...s.users.flatMap((u) => (u.sessions || [])
          .filter((x) => x.expiresAt > Date.now())
          .map((x) => SP.el('div.lrow',
            SP.avatar(u, 'sm'),
            SP.el('div.lrow__main',
              SP.el('strong', u.name),
              SP.el('small', `${x.device} · started ${SP.fmt.ago(x.startedAt)}`),
            ),
            SP.el('div.lrow__end',
              SP.el('span.tiny.mute', `expires ${SP.fmt.ago(x.expiresAt)}`),
              u.id === SP.auth.currentUser?.id
                ? SP.el('span.tag.tag--brand', 'this device')
                : SP.el('button.btn.btn--sm.btn--quiet', {
                  type: 'button',
                  onclick: () => { SP.auth.revokeSessions(u.id); SP.ui.toast({ tone: 'ok', title: 'Sessions revoked' }); SP.router.refresh(); },
                }, 'Revoke'),
            ),
          ))),
        ...(s.users.reduce((a, u) => a + (u.sessions || []).filter((x) => x.expiresAt > Date.now()).length, 0) === 0
          ? [SP.empty({ icon: 'lock', title: 'No active sessions', body: 'Sessions appear here when people sign in.' })] : []),
      ),
    ));
  }

  function openUserMenu(anchor, user) {
    const isSelf = user.id === SP.auth.currentUser?.id;
    SP.menu(anchor, [
      { group: user.name },
      { label: 'Edit details', icon: 'edit', onClick: () => openUserForm(user) },
      { label: 'Reset password', icon: 'key', onClick: () => resetPassword(user) },
      { label: user.pin ? 'Change PIN' : 'Set PIN', icon: 'lock', onClick: () => setPin(user) },
      '-',
      { label: 'Revoke sessions', icon: 'logout', onClick: () => { SP.auth.revokeSessions(user.id); SP.router.refresh(); } },
      {
        label: user.active ? 'Deactivate' : 'Reactivate',
        icon: user.active ? 'lock' : 'unlock',
        danger: user.active,
        disabled: isSelf,
        onClick: () => {
          try { SP.auth.toggleActive(user.id); SP.router.refresh(); }
          catch (e) { SP.ui.toast({ tone: 'danger', title: 'Not allowed', body: e.message }); }
        },
      },
      {
        label: 'Delete account', icon: 'trash', danger: true, disabled: isSelf,
        onClick: async () => {
          const ok = await SP.modal({
            title: `Delete ${user.name}?`, icon: 'trash', tone: 'danger',
            subtitle: 'This cannot be undone.',
            okLabel: 'Delete permanently',
          });
          if (!ok) return;
          try { await SP.auth.deleteUser(user.id); SP.ui.toast({ tone: 'ok', title: 'Account deleted' }); SP.router.refresh(); }
          catch (e) { SP.ui.toast({ tone: 'danger', title: 'Not allowed', body: e.message }); }
        },
      },
    ]);
  }

  async function openUserForm(user) {
    const isNew = !user;
    const warehouseOpts = SP.store.state.warehouses.map((w) => ({ value: w.id, label: w.label }));
    const roleOpts = SP.ROLES.map((r) => ({ value: r.id, label: r.label }));

    const fields = [
      { key: 'name', label: 'Full name', value: user?.name || '', required: true },
      { key: 'email', label: 'Work email', type: 'email', value: user?.email || '', required: true },
      { key: 'role', label: 'Role', type: 'select', value: user?.role || 'storekeeper', options: roleOpts },
      { key: 'warehouse', label: 'Default warehouse', type: 'select', value: user?.warehouse || 'MAIN', options: warehouseOpts },
    ];
    if (isNew) {
      fields.push({ key: 'password', label: 'Temporary password', type: 'password', required: true, hint: 'At least 8 characters. They can change it after signing in.' });
      fields.push({ key: 'pin', label: 'Quick PIN (optional)', placeholder: '4 digits' });
      fields.push({ key: 'mustChangePassword', label: 'Require a password change at next sign-in', type: 'checkbox', value: true, checkboxLabel: 'Force a change' });
    }

    await SP.modal({
      title: isNew ? 'Add a team member' : `Edit ${user.name}`,
      subtitle: isNew ? 'They will be able to sign in immediately.' : user.email,
      icon: 'users',
      fields,
      okLabel: isNew ? 'Create account' : 'Save changes',
      onOk: async (v) => {
        if (isNew) {
          await SP.auth.createUser(v);
          SP.ui.toast({ tone: 'ok', title: 'Account created', body: `${v.name} can sign in now.` });
        } else {
          await SP.auth.updateUser(user.id, v);
          SP.ui.toast({ tone: 'ok', title: 'Account updated' });
        }
        SP.router.refresh();
      },
    });
  }

  async function resetPassword(user) {
    const res = await SP.modal({
      title: `Reset password for ${user.name}`,
      subtitle: 'They will be asked to set a new one at next sign-in.',
      icon: 'key',
      fields: [{ key: 'password', label: 'New temporary password', type: 'password', required: true }],
      okLabel: 'Reset password',
      onOk: async (v) => {
        await SP.auth.resetPassword(user.id, v.password);
        SP.auth.revokeSessions(user.id);
        SP.ui.toast({ tone: 'ok', title: 'Password reset', body: 'Existing sessions were signed out.' });
        SP.router.refresh();
      },
    });
    void res;
  }

  async function setPin(user) {
    const res = await SP.modal({
      title: `Quick PIN for ${user.name}`,
      subtitle: 'Four digits, for shared-counter devices.',
      icon: 'lock',
      fields: [{ key: 'pin', label: 'PIN', placeholder: '0000', required: true }],
      okLabel: 'Save PIN',
      onOk: async (v) => {
        await SP.auth.setPin(user.id, v.pin);
        SP.ui.toast({ tone: 'ok', title: 'PIN saved' });
        SP.router.refresh();
      },
    });
    void res;
  }

  /* ───────────────────────────────────────────────────────── roles */

  function rolesTab(host) {
    host.appendChild(SP.el('div.card',
      SP.el('div.card__head', SP.icon('shield'), SP.el('h2', 'Role capabilities'),
        SP.el('span.sub', 'Built-in, cannot be removed')),
      SP.el('div.card__body.stack.gap-3',
        ...SP.ROLES.map((r) => SP.el('div.card.card--flat.card--pad',
          SP.el('div.row.gap-2',
            SP.el('span.badge', { class: r.id === 'admin' ? 'badge--brand' : '' }, SP.fmt.pluralise(
              SP.store.state.users.filter((u) => u.role === r.id).length, 'user',
            )),
            SP.el('strong', { style: { fontSize: 'var(--fs-md)' } }, r.label),
          ),
          SP.el('p.tiny.mute', { style: { marginTop: '4px' } }, r.blurb),
          SP.el('div.pill-list', { style: { marginTop: 'var(--sp-2)' } },
            ...(r.perms.includes('*')
              ? [SP.el('span.tag.tag--brand', 'Full control')]
              : r.perms.map((p) => SP.el('span.tag.tag--line', SP.PERMS[p] || p))),
          ),
        )),
      ),
    ));

    /* Permission matrix */
    const allPerms = Object.keys(SP.PERMS);
    host.appendChild(SP.section('Permission matrix', 'Who can do what',
      SP.el('div.card',
        SP.el('div.tablewrap',
          SP.el('table.table',
            SP.el('thead', SP.el('tr',
              SP.el('th', 'Capability'),
              ...SP.ROLES.map((r) => SP.el('th.center', r.label)),
            )),
            SP.el('tbody', ...allPerms.map((perm) => SP.el('tr',
              SP.el('td', SP.el('div.cell-main',
                SP.el('strong', SP.PERMS[perm]),
                SP.el('small', perm),
              )),
              ...SP.ROLES.map((r) => SP.el('td.center',
                r.perms.includes('*') || r.perms.includes(perm)
                  ? SP.el('span', { style: { color: 'var(--ok)' } }, '✓')
                  : SP.el('span.mute', '—')),
              )),
            )),
          ),
        ),
      ),
    ));

    /* Demo credentials reminder */
    if (SP.store.state.users.filter((u) => u.email.endsWith('@stockpilot.app')).length >= 4) {
      host.appendChild(SP.el('div.callout', { dataset: { tone: 'warn' } },
        SP.el('span.callout__ico', SP.icon('alert')),
        SP.el('div.callout__body',
          SP.el('strong', 'Demo accounts are still present'),
          SP.el('p', 'The seeded admin@stockpilot.app, manager@, alpana@, nazrul@ and viewer@ accounts exist for evaluation. Delete them and replace with real accounts before going live.'),
          SP.el('div.insight__act',
            SP.el('button.btn.btn--sm.btn--ghost', {
              type: 'button',
              onclick: () => {
                state.tab = 'users';
                SP.router.refresh();
                SP.ui.toast({ tone: 'info', title: 'Review the team list', body: 'Use the ▾ menu on each demo row to delete it.' });
              },
            }, 'Review accounts'),
          ),
        ),
      ));
    }
  }

  /* ───────────────────────────────────────────────────────── rules */

  function rulesTab(host) {
    const s = SP.store.state;

    const numField = (key, label, hint, attrs = {}) => {
      const input = SP.el('input.input.input--num', {
        type: 'number', value: s.rules[key], ...attrs,
        oninput: SP.debounce((e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          SP.store.update(['rules'], (st) => { st.rules[key] = v; });
          SP.store.audit('rules.update', key, String(v));
          SP.router.refresh();
        }, 700),
      });
      return SP.el('div.field', SP.el('label.field__label', label), input, SP.el('p.field__hint', hint));
    };

    host.appendChild(SP.section('Decision rules', 'These drive every recommendation in the app',
      SP.el('div.card',
        SP.el('div.card__body.grid-form',
          numField('refillMax', 'Reorder line (units)', 'At or below this, a line is flagged for refill. Currently 0 = restock priority.', { min: 1, max: 999 }),
          numField('targetCoverWeeks', 'Target cover (weeks)', 'How many weeks of demand a replenishment should cover.', { min: 1, max: 52 }),
          numField('deadStockDays', 'Dead-stock window (days)', 'No dispatch in this window marks a line as slow-moving.', { min: 7, max: 365 }),
          numField('minOrderValue', 'Minimum order value', 'Warn when an order falls below this.', { min: 0, step: 500 }),
        ),
      ),
    ));

    /* Live preview */
    const preview = SP.engine.refillPlan({}).filter((r) => r.urgency.id !== 'adequate');
    host.appendChild(SP.section('Effect of these settings', null,
      SP.el('div.grid.grid--3',
        SP.el('div.stat', { dataset: { tone: 'danger' } },
          SP.el('div.stat__label', SP.icon('alert'), 'Restock priority'),
          SP.el('div.stat__value', SP.fmt.n(SP.engine.summary().critical)),
          SP.el('div.stat__foot', 'zero units')),
        SP.el('div.stat', { dataset: { tone: 'warn' } },
          SP.el('div.stat__label', SP.icon('clock'), 'Refill'),
          SP.el('div.stat__value', SP.fmt.n(SP.engine.summary().refill)),
          SP.el('div.stat__foot', `1–${s.rules.refillMax} units`)),
        SP.el('div.stat', { dataset: { tone: 'ok' } },
          SP.el('div.stat__label', SP.icon('checkCircle'), 'Adequate'),
          SP.el('div.stat__value', SP.fmt.n(SP.engine.summary().adequate)),
          SP.el('div.stat__foot', `above ${s.rules.refillMax}`)),
      ),
    ));

    host.appendChild(SP.section('Currency', null,
      SP.el('div.card',
        SP.el('div.card__body',
          SP.el('select.select', {
            onchange: (e) => {
              SP.store.update(['rules'], (st) => { st.rules.currency = e.target.value; });
              SP.router.refresh();
            },
          },
            ...['BDT', 'USD', 'EUR', 'GBP', 'INR', 'PKR', 'AED', 'SAR'].map((c) => SP.el('option', {
              value: c, selected: s.rules.currency === c,
            }, c)),
          ),
          SP.el('p.field__hint', { style: { marginTop: '6px' } }, 'Used for all cost and capital figures.'),
        ),
      ),
    ));

    /* Appearance */
    host.appendChild(SP.section('Appearance', 'Applies to everyone on this device',
      SP.el('div.card',
        SP.el('div.card__body.stack.gap-3',
          SP.el('div.setting-row', { style: { padding: 0 } },
            SP.el('div.setting-row__text',
              SP.el('strong', 'Accent colour'),
              SP.el('small', 'Used for highlights, charts and primary actions')),
            SP.el('div.accent-picker', ...['#5b8cff', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#64748b'].map((c) =>
              SP.el('button.accent-dot', {
                type: 'button', 'aria-label': `Accent ${c}`,
                class: s.prefs.accent === c ? 'is-active' : '',
                style: { background: c },
                onclick: () => {
                  SP.store.update(['prefs'], (st) => { st.prefs.accent = c; });
                  SP.app.applyTheme();
                  SP.router.refresh();
                },
              }))),
          ),
          SP.el('div.setting-row', { style: { padding: 0 } },
            SP.el('div.setting-row__text',
              SP.el('strong', 'Density'),
              SP.el('small', 'Compact fits more rows on a phone')),
            SP.el('select.select', {
              onchange: (e) => {
                SP.store.update(['prefs'], (st) => { st.prefs.density = e.target.value; });
                SP.app.applyTheme();
              },
            },
              ...['comfortable', 'compact'].map((d) => SP.el('option', {
                value: d, selected: s.prefs.density === d,
              }, d === 'comfortable' ? 'Comfortable' : 'Compact')),
            ),
          ),
        ),
      ),
    ));
  }

  /* ────────────────────────────────────────────────────────── sites */

  function sitesTab(host) {
    const s = SP.store.state;

    host.appendChild(SP.el('div.card',
      SP.el('div.card__head', SP.icon('home'), SP.el('h2', 'Warehouses'),
        SP.el('span.sub', `${s.warehouses.length} configured`)),
      SP.el('div.card__body.card__body--flush',
        ...s.warehouses.map((w) => {
          const units = SP.sum(s.skus, (x) => Number(x.byWh?.[w.id]) || 0);
          return SP.el('div.setting-row',
            SP.el('i', { style: { width: '10px', height: '10px', borderRadius: '50%', background: w.color } }),
            SP.el('div.setting-row__text',
              SP.el('strong', w.label),
              SP.el('small', `${SP.fmt.n(units)} units · custodian: ${w.custodian || 'unassigned'}`),
            ),
            SP.el('div.setting-row__ctl',
              SP.el('button.btn.btn--sm.btn--quiet', {
                type: 'button',
                onclick: () => editSite(w.id),
              }, 'Edit'),
            ),
          );
        }),
      ),
    ));

    host.appendChild(SP.el('div.row.gap-2',
      SP.el('button.btn.btn--ghost.btn--block', {
        type: 'button',
        onclick: async () => {
          const res = await SP.modal({
            title: 'Add a warehouse',
            icon: 'home',
            fields: [
              { key: 'id', label: 'Short code', required: true, hint: 'Used as the column header in the sheet, e.g. "KHAN".', placeholder: 'KHAN' },
              { key: 'label', label: 'Display name', required: true, placeholder: 'Khan Warehouse' },
              { key: 'custodian', label: 'Custodian', placeholder: 'Who is responsible' },
            ],
            okLabel: 'Add site',
            onOk: (v) => {
              const id = String(v.id).toUpperCase().replace(/[^A-Z0-9]/g, '');
              if (!id) throw new Error('Provide a short code.');
              if (s.warehouses.some((w) => w.id === id)) throw new Error('That code is already in use.');
              SP.store.update(['warehouses'], (st) => {
                st.warehouses.push({
                  id, label: v.label, short: id, custodian: v.custodian || '',
                  color: SP.auth.randomColour(), active: true,
                });
              });
              SP.store.audit('warehouse.create', id, v.label);
              SP.ui.toast({ tone: 'ok', title: 'Site added', body: v.label });
              SP.router.refresh();
            },
          });
          void res;
        },
      }, SP.icon('plus'), 'Add warehouse'),
    ));
  }

  async function editSite(id) {
    const w = SP.store.state.warehouses.find((x) => x.id === id);
    if (!w) return;
    await SP.modal({
      title: w.label,
      subtitle: `Code ${w.id}`,
      icon: 'home',
      fields: [
        { key: 'label', label: 'Display name', value: w.label, required: true },
        { key: 'short', label: 'Short label', value: w.short || w.id },
        { key: 'custodian', label: 'Custodian', value: w.custodian || '' },
        { key: 'color', label: 'Colour', type: 'color', value: w.color },
      ],
      okLabel: 'Save',
      onOk: (v) => {
        SP.store.update(['warehouses'], (st) => {
          const t = st.warehouses.find((x) => x.id === id);
          if (t) Object.assign(t, { label: v.label, short: v.short, custodian: v.custodian, color: v.color });
        });
        SP.store.audit('warehouse.update', id, v.label);
        SP.router.refresh();
      },
    });
  }

  /* ────────────────────────────────────────────────────────── data */

  function dataTab(host) {
    const s = SP.store.state;
    const sheetStatus = SP.sheets.status();

    host.appendChild(SP.section('Google Sheet', 'The live source of truth',
      SP.el('div.card',
        SP.el('div.card__body.stack.gap-3',
          SP.el('div.row.gap-3',
            SP.el('div.grow',
              SP.el('strong', { style: { fontSize: 'var(--fs-md)' } }, 'Inventory source'),
              SP.el('p.tiny.mute', `${SP.store.state.skus.filter((x) => !x.archived).length} SKUs · last sync ${s.sheet.lastSync ? SP.fmt.ago(s.sheet.lastSync) : 'never'}`),
            ),
            SP.el('span.tag', {
              class: sheetStatus.mode === 'live' ? 'tag--u-green' : sheetStatus.mode === 'error' ? 'tag--danger' : 'tag--mute',
            }, sheetStatus.mode),
          ),
          SP.el('div.row.gap-2',
            SP.el('button.btn.btn--sm.btn--ghost', {
              type: 'button',
              onclick: async (e) => {
                const b = e.currentTarget;
                b.setAttribute('aria-busy', 'true');
                const res = await SP.sheets.refresh();
                b.removeAttribute('aria-busy');
                SP.ui.toast(res.ok
                  ? { tone: 'ok', title: 'Synced', body: `${res.count} SKUs read from the sheet.` }
                  : { tone: 'danger', title: 'Sync failed', body: res.error });
              },
            }, SP.icon('refresh'), 'Sync now'),
            SP.el('button.btn.btn--sm.btn--ghost', {
              type: 'button', onclick: () => SP.router.go('settings'),
            }, SP.icon('link'), 'Connection settings'),
          ),
          s.sheet.error ? SP.el('div.callout', { dataset: { tone: 'danger' } },
            SP.el('span.callout__ico', SP.icon('alert')),
            SP.el('div.callout__body', SP.el('strong', 'Last error'), SP.el('p', s.sheet.error)),
          ) : null,
        ),
      ),
    ));

    /* Queued writes */
    host.appendChild(SP.section('Outbox', `${s.pendingOps.length} change${s.pendingOps.length === 1 ? '' : 's'} waiting to be written`,
      SP.el('div.card',
        s.pendingOps.length
          ? SP.el('div.card__body.card__body--flush', ...s.pendingOps.slice(-20).reverse().map((op) => SP.el('div.lrow',
            SP.el('span.lrow__ico', SP.icon('upload')),
            SP.el('div.lrow__main',
              SP.el('strong', `${op.type} · ${op.sku || op.ref || op.id}`),
              SP.el('small', `queued ${SP.fmt.ago(op.at)}${op.tries ? ` · ${op.tries} failed attempt(s)` : ''}`),
            ),
          )))
          : SP.empty({ icon: 'checkCircle', title: 'Outbox is empty', body: 'Every change has been written through.' }),
        s.pendingOps.length && SP.sheets.bridgeReady()
          ? SP.el('div.card__foot',
            SP.el('button.btn.btn--primary.btn--block', {
              type: 'button',
              onclick: async (e) => {
                const b = e.currentTarget;
                b.setAttribute('aria-busy', 'true');
                const res = await SP.sheets.flush();
                b.removeAttribute('aria-busy');
                SP.ui.toast(res.ok ? { tone: 'ok', title: 'Outbox flushed' } : { tone: 'danger', title: 'Flush failed', body: res.error });
                SP.router.refresh();
              },
            }, SP.icon('upload'), 'Write pending changes now'))
          : null,
      ),
    ));

    /* Export / import */
    host.appendChild(SP.section('Backup', 'Everything lives in this browser — export regularly',
      SP.el('div.grid.grid--2',
        SP.el('button.btn.btn--ghost.btn--lg', {
          type: 'button',
          onclick: () => {
            SP.download(JSON.stringify(SP.sheets.exportPayload(), null, 2), `stockpilot-export-${SP.fmt.date(Date.now())}.json`);
            SP.ui.toast({ tone: 'ok', title: 'Export downloaded' });
          },
        }, SP.icon('download'), 'Full export'),
        SP.el('button.btn.btn--ghost.btn--lg', {
          type: 'button', onclick: importBackup,
        }, SP.icon('upload'), 'Import backup'),
      ),
    ));

    /* Danger zone */
    host.appendChild(SP.section('Danger zone', 'These cannot be undone',
      SP.el('div.card.card--pad.stack.gap-3',
        SP.el('div.row.gap-3.row--wrap',
          SP.el('div.grow',
            SP.el('strong', 'Reset to the bundled snapshot'),
            SP.el('p.tiny.mute', 'Replaces all stock, ledger and orders with the data captured at build time.'),
          ),
          SP.el('button.btn.btn--danger', {
            type: 'button',
            onclick: async () => {
              const ok = await SP.modal({
                title: 'Reset everything?', icon: 'alert', tone: 'danger',
                subtitle: 'All local changes will be lost.',
                okLabel: 'Reset now',
                body: SP.el('p', 'Accounts are kept so people can still sign in. Stock, sales, transfers and orders return to the bundled snapshot.'),
              });
              if (!ok) return;
              SP.store.reset({ keepUsers: true });
              SP.ui.toast({ tone: 'ok', title: 'Reset complete' });
              SP.router.refresh();
            },
          }, 'Reset data'),
        ),
        SP.el('hr'),
        SP.el('div.row.gap-3.row--wrap',
          SP.el('div.grow',
            SP.el('strong', 'Clear all local data'),
            SP.el('p.tiny.mute', 'Removes accounts and everything else from this device. Everyone must sign up again.'),
          ),
          SP.el('button.btn.btn--danger.btn--ghost', {
            type: 'button',
            onclick: async () => {
              const ok = await SP.modal({
                title: 'Erase this device?', icon: 'alert', tone: 'danger',
                okLabel: 'Erase everything',
                body: SP.el('p', 'This signs you out and removes every account and record stored in this browser.'),
              });
              if (!ok) return;
              SP.store.reset({ keepUsers: false });
              SP.auth.signOut({ all: true });
              location.reload();
            },
          }, 'Erase device'),
        ),
      ),
    ));

    /* Storage footprint */
    const bytes = new Blob([JSON.stringify(s)]).size;
    host.appendChild(SP.el('p.tiny.mute.center', `Local storage footprint: ${SP.fmt.bytes(bytes)} of ~5 MB available`));
  }

  function importBackup() {
    const input = SP.el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        // Accept both shapes: sheets.exportPayload() and store.exportBackup().
        if (payload.inventory) {
          const n = SP.sheets.importPayload(payload);
          SP.ui.toast({ tone: 'ok', title: 'Imported', body: `${n} SKUs merged.` });
        } else {
          SP.store.importBackup(payload, { merge: true });
          SP.ui.toast({ tone: 'ok', title: 'Imported', body: 'Backup merged.' });
        }
        SP.router.refresh();
      } catch (e) {
        SP.ui.toast({ tone: 'danger', title: 'Import failed', body: e.message });
      }
    });
    input.click();
  }

  return { ...MOD };
})();