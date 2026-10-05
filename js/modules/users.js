/**
 * modules/users.js — user administration, roles and the permission matrix.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.users = (() => {
  const MOD = { title: 'Users & Roles', subtitle: () => `${SP.fmt.pluralise(SP.store.state.users.length, 'account')}`, mount, perm: 'users:manage' };

  function mount() {
    const root = SP.el('div.stack.gap-4');
    root.appendChild(SP.ui2.pageHead({
      title: 'Users & Roles',
      sub: 'Warehouse-scoped access with a full permission matrix.',
      actions: [SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => editUser(null) }, SP.icon('plus'), 'New user')],
    }));

    /* users table */
    const table = SP.table.create({
      columns: [
        { key: 'name', label: 'User', value: (u) => u.name, render: (u) => SP.el('div.row.gap-2', { style: { alignItems: 'center' } }, SP.avatar(u), SP.el('div.stack', SP.el('strong', u.name), SP.el('small.mute', u.email))) },
        { key: 'role', label: 'Role', width: '150px', value: (u) => SP.auth.roleDef(u.role).label, render: (u) => SP.ui2.tag(SP.auth.roleDef(u.role).label, 'brand') },
        { key: 'scope', label: 'Warehouse scope', width: '160px', value: (u) => (u.warehouses || []).length, render: (u) => scopeLabel(u) },
        { key: 'lastLoginAt', label: 'Last sign-in', width: '120px', value: (u) => u.lastLoginAt || 0, render: (u) => SP.el('span.tiny', u.lastLoginAt ? SP.fmt.ago(u.lastLoginAt) : 'never') },
        { key: 'active', label: 'Status', width: '90px', value: (u) => u.active, render: (u) => SP.ui2.tag(u.active ? 'Active' : 'Disabled', u.active ? 'ok' : 'mute') },
      ],
      rows: () => [...SP.store.state.users],
      rowId: (u) => u.id,
      empty: { icon: 'users', title: 'No users' },
      onRowClick: (u) => userSheet(u),
    });
    root.appendChild(table.el);

    /* role cards */
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Roles'), SP.el('p', 'What each role can do'))),
      SP.el('div.grid.grid--2.gap-3', ...SP.ROLES.map((r) => {
        const count = SP.store.state.users.filter((u) => SP.auth.roleOf(u) === r.id).length;
        return SP.el('button.card.card--pad', { type: 'button', style: { textAlign: 'left' }, onclick: () => permissionMatrix(r) },
          SP.el('div.row', { style: { justifyContent: 'space-between', alignItems: 'center' } },
            SP.el('strong', r.label), SP.ui2.tag(`${count} user${count === 1 ? '' : 's'}`, 'mute')),
          SP.el('p.tiny.mute', r.blurb),
          SP.el('p.tiny', { style: { marginTop: '6px' } }, r.perms.includes('*') ? 'All permissions' : `${r.perms.length} permissions`));
      }))));
    return root;
  }

  function scopeLabel(u) {
    if ((u.warehouses || []).length) return `${u.warehouses.length} warehouse${u.warehouses.length === 1 ? '' : 's'}`;
    return SP.el('span.mute', 'All warehouses');
  }

  function permissionMatrix(role) {
    const modules = SP.groupBy(Object.entries(SP.PERMS), ([k]) => k.split(':')[0]);
    const body = SP.el('div.stack.gap-2', { style: { maxHeight: '55vh', overflow: 'auto' } });
    for (const [mod, perms] of Object.entries(modules)) {
      body.appendChild(SP.el('div',
        SP.el('strong.tiny', { style: { textTransform: 'capitalize' } }, mod),
        SP.el('div.stack.gap-1', { style: { marginTop: '4px' } }, ...perms.map(([key, label]) => {
          const has = role.perms.includes('*') || role.perms.includes(key);
          return SP.el('div.row', { style: { justifyContent: 'space-between' } },
            SP.el('span.tiny', label),
            SP.icon(has ? 'check' : 'x', has ? '' : 'mute'));
        }))));
    }
    SP.sheet({ title: `${role.label} — permissions`, content: body });
  }

  function userSheet(u) {
    const me = SP.auth.current();
    const shell = SP.sheet({
      title: u.name,
      subtitle: u.email,
      content: SP.el('div.stack.gap-3',
        SP.el('dl.kv',
          SP.el('dt', 'Role'), SP.el('dd', SP.auth.roleDef(u.role).label),
          SP.el('dt', 'Scope'), SP.el('dd', (u.warehouses || []).length ? u.warehouses.join(', ') : 'All warehouses'),
          SP.el('dt', 'PIN sign-in'), SP.el('dd', u.pin ? 'Enabled' : 'Not set'),
          SP.el('dt', 'Last sign-in'), SP.el('dd', u.lastLoginAt ? SP.fmt.dateTime(u.lastLoginAt) : 'Never'),
          SP.el('dt', 'Failed attempts'), SP.el('dd', SP.fmt.n(u.failedCount || 0)),
          SP.el('dt', 'Active sessions'), SP.el('dd', SP.fmt.n((u.sessions || []).filter((x) => x.expiresAt > Date.now()).length))),
      ),
      actions: [
        SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => { shell.close(); editUser(u); } }, SP.icon('edit'), 'Edit'),
        u.id !== me?.id ? SP.el('button.btn.btn--ghost', {
          type: 'button',
          onclick: async () => {
            SP.auth.revokeSessions(u.id);
            SP.ui.toast({ tone: 'ok', title: 'All sessions revoked' });
          },
        }, SP.icon('logout'), 'Log out everywhere') : null,
        u.id !== me?.id ? SP.el('button.btn', {
          type: 'button', class: u.active ? 'btn--danger' : 'btn--ok',
          onclick: async () => {
            try { SP.auth.toggleActive(u.id); SP.ui.toast({ tone: 'ok', title: u.active ? 'Account disabled' : 'Account enabled' }); shell.close(); SP.router.refresh(); }
            catch (e) { SP.ui.toast({ tone: 'danger', title: e.message }); }
          },
        }, u.active ? 'Disable' : 'Enable') : null,
        u.id !== me?.id ? SP.el('button.btn.btn--danger', {
          type: 'button',
          onclick: async () => {
            const ok = await SP.modal({ title: `Delete ${u.name}?`, body: 'Their audit history is preserved.', tone: 'danger', okLabel: 'Delete' });
            if (!ok) return;
            try { await SP.auth.deleteUser(u.id); shell.close(); SP.router.refresh(); } catch (e) { SP.ui.toast({ tone: 'danger', title: e.message }); }
          },
        }, SP.icon('trash'), 'Delete') : null,
      ],
    });
  }

  function editUser(u) {
    const isNew = !u;
    u = u || {};
    const whs = SP.store.state.warehouses;
    return SP.modal({
      title: isNew ? 'New user' : `Edit ${u.name}`, icon: 'users',
      okLabel: isNew ? 'Create account' : 'Save',
      fields: [
        { key: 'name', label: 'Full name', required: true, value: u.name },
        { key: 'email', label: 'Work email', type: 'email', required: true, value: u.email },
        { key: 'role', label: 'Role', type: 'select', required: true, value: u.role || 'viewer', options: SP.ROLES.map((r) => ({ value: r.id, label: `${r.label} — ${r.blurb}` })) },
        { key: 'warehouses', label: 'Warehouse scope', type: 'select', value: (u.warehouses || [])[0] || '', options: [{ value: '', label: 'All warehouses' }, ...whs.map((w) => ({ value: w.id, label: w.name }))], hint: 'Restrict operations to one warehouse' },
        isNew ? { key: 'password', label: 'Password', type: 'password', required: true, hint: 'Min 8 characters' } : null,
        { key: 'pin', label: 'Quick PIN (4 digits, optional)', inputmode: 'numeric', validate: (raw) => raw && !/^\d{4}$/.test(raw) ? 'Exactly 4 digits' : null },
      ].filter(Boolean),
      onOk: async (v) => {
        const data = { name: v.name, email: v.email, role: v.role, warehouses: v.warehouses ? [v.warehouses] : [] };
        if (isNew) {
          await SP.auth.createUser({ ...data, password: v.password, pin: v.pin || undefined });
          SP.ui.toast({ tone: 'ok', title: 'Account created' });
        } else {
          await SP.auth.updateUser(u.id, data);
          if (v.pin) await SP.auth.setPin(u.id, v.pin);
          SP.ui.toast({ tone: 'ok', title: 'Account saved' });
        }
        SP.router.refresh();
      },
    });
  }

  return MOD;
})();

/* ═══════════════════════════════════════════════════════════ AUDIT LOG */

SP.modules.audit = (() => {
  const state = { q: '', action: 'all' };
  const MOD = { title: 'Audit Log', subtitle: () => `${SP.fmt.pluralise(SP.store.state.audit.length, 'records')}`, mount, perm: 'audit:view' };

  function mount(params) {
    if (params?.q) state.q = params.q.toLowerCase();
    const root = SP.el('div.stack.gap-3');

    const rows = () => {
      let list = [...SP.store.state.audit];
      if (state.action !== 'all') list = list.filter((a) => a.action.startsWith(state.action));
      if (state.q) list = list.filter((a) => `${a.action} ${a.by} ${a.target} ${a.detail}`.toLowerCase().includes(state.q));
      return list;
    };

    const table = SP.table.create({
      columns: [
        { key: 'at', label: 'When', width: '140px', value: (a) => a.at, render: (a) => SP.el('span.tiny', SP.fmt.dateTime(a.at)) },
        { key: 'by', label: 'Who', width: '130px', value: (a) => a.by },
        { key: 'action', label: 'Action', width: '170px', value: (a) => a.action, render: (a) => SP.el('code.tiny', a.action) },
        { key: 'target', label: 'Target', width: '150px', value: (a) => a.target },
        { key: 'detail', label: 'Detail', value: (a) => a.detail, render: (a) => SP.el('span.tiny', a.detail || '—') },
      ],
      rows,
      rowId: (a) => a.id,
      defaultSort: 'at', defaultDir: 'desc',
      pageSize: 50,
      empty: { icon: 'database', title: 'No audit records' },
    });

    const actions = SP.unique(SP.store.state.audit.map((a) => a.action.split('.')[0])).sort();
    const filters = SP.ui2.filterBar({ placeholder: 'Search who, what, target…', onChange: (f) => { state.q = f.q; table.refresh(); } });
    const scopeRow = SP.el('div.row.gap-2', { style: { flexWrap: 'wrap', alignItems: 'center' } },
      SP.el('select.select', { onchange: (e) => { state.action = e.target.value; table.refresh(); } },
        SP.el('option', { value: 'all' }, 'All action groups'),
        ...actions.map((a) => SP.el('option', { value: a, selected: state.action === a }, a))),
      SP.el('span.grow'),
      SP.auth.can('audit:export') ? SP.el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        onclick: () => {
          SP.impexp.downloadCSV(rows().map((a) => ({ at: new Date(a.at).toISOString(), by: a.by, action: a.action, target: a.target, detail: a.detail })),
            ['at', 'by', 'action', 'target', 'detail'], `stockpilot-audit-${Date.now()}.csv`);
          SP.store.audit('audit.export', `${rows().length} rows`, '');
        },
      }, SP.icon('download'), 'Export') : null,
    );

    root.append(
      SP.ui2.pageHead({ title: 'Audit Log', sub: 'Immutable. Records are never edited or deleted through the app.' }),
      filters.el, scopeRow, table.el,
    );
    return root;
  }

  return MOD;
})();
