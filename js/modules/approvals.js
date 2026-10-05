/**
 * modules/approvals.js — the approval queue: decide with comments,
 * full history, and audit linkage.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.approvals = (() => {
  const state = { status: 'pending' };

  const MOD = { title: 'Approvals', subtitle: () => `${SP.fmt.pluralise(SP.approvals.pendingList().length, 'pending request')}`, mount, perm: 'approvals:view' };

  function mount() {
    const root = SP.el('div.stack.gap-3');
    const listHost = SP.el('div.stack.gap-2');

    const draw = () => {
      SP.clear(listHost);
      let list = [...SP.store.state.approvals].sort((a, b) => b.requestedAt - a.requestedAt);
      if (state.status !== 'all') list = list.filter((a) => a.status === state.status);
      if (!list.length) {
        listHost.appendChild(SP.empty({ icon: 'checkCircle', title: 'Nothing here', body: state.status === 'pending' ? 'No requests waiting for a decision.' : 'No requests with this status.' }));
        return;
      }
      for (const a of list) listHost.appendChild(card(a));
    };

    const chips = SP.chipRow(
      [{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }],
      state.status, (v) => { state.status = v; draw(); });

    root.append(
      SP.ui2.pageHead({ title: 'Approvals', sub: 'Every decision is recorded with who, when and why.' }),
      chips, listHost,
    );
    draw();
    return root;
  }

  function card(a) {
    const canDecide = SP.auth.can('approvals:decide') && a.status === 'pending' && a.requestedById !== SP.auth.current()?.id;
    const own = a.requestedById === SP.auth.current()?.id;
    return SP.el('div.card.card--pad.stack.gap-2',
      SP.el('div.row', { style: { alignItems: 'flex-start', gap: 'var(--sp-2)' } },
        SP.el('div.grow',
          SP.el('strong', a.title),
          SP.el('p.tiny.mute', `${SP.APPROVAL_KINDS.find((k) => k.id === a.kind)?.label || a.kind} · ${a.ruleLabel || ''}`),
          a.detail ? SP.el('p.tiny', { style: { marginTop: '4px' } }, a.detail) : null),
        SP.ui2.badge('approval', a.status)),
      SP.el('p.tiny.mute', `Requested by ${a.requestedBy} · ${SP.fmt.dateTime(a.requestedAt)}${own ? ' · your request' : ''}`),
      a.status !== 'pending' ? SP.el('p.tiny', `Decided by ${a.decidedBy || '—'} · ${a.decidedAt ? SP.fmt.dateTime(a.decidedAt) : ''}${a.comment ? ` — “${a.comment}”` : ''}`) : null,
      a.history?.length > 1 ? SP.el('details', SP.el('summary.tiny.mute', 'History'), SP.ui2.timeline(a.history.map((h) => ({ at: h.at, title: SP.fmt.titleCase(h.action.replace(/_/g, ' ')), body: h.comment, meta: h.by })))) : null,
      canDecide ? SP.el('div.row.gap-2',
        SP.el('button.btn.btn--ok.btn--sm', { type: 'button', onclick: () => decide(a, 'approved') }, SP.icon('check'), 'Approve'),
        SP.el('button.btn.btn--danger.btn--sm', { type: 'button', onclick: () => decide(a, 'rejected') }, SP.icon('x'), 'Reject'),
        SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => askInfo(a) }, SP.icon('help'), 'Request info'),
      ) : null,
    );
  }

  async function decide(a, decision) {
    const r = await SP.modal({
      title: `${decision === 'approved' ? 'Approve' : 'Reject'}: ${a.title}`,
      icon: decision === 'approved' ? 'check' : 'x',
      tone: decision === 'approved' ? 'ok' : 'danger',
      okLabel: decision === 'approved' ? 'Approve' : 'Reject',
      fields: [{ key: 'comment', label: 'Comment (recorded permanently)', type: 'textarea' }],
      onOk: async (v) => { SP.approvals.decide(a.id, decision, v.comment || ''); },
    });
    if (r) { SP.ui.toast({ tone: 'ok', title: `Request ${decision}` }); SP.router.refresh(); }
  }

  async function askInfo(a) {
    const r = await SP.modal({
      title: `Request information: ${a.title}`, icon: 'help', okLabel: 'Send',
      fields: [{ key: 'comment', label: 'What do you need to know?', required: true, type: 'textarea' }],
      onOk: async (v) => { SP.approvals.requestInfo(a.id, v.comment); },
    });
    if (r) SP.router.refresh();
  }

  return MOD;
})();

/* ══════════════════════════════════════════════════════════ ALERT CENTER */

SP.modules.alerts = (() => {
  const state = { filter: 'active' };

  const MOD = { title: 'Alert Center', subtitle: () => `${SP.fmt.pluralise(SP.alerts.unreadCount(), 'unread alert')}`, mount, markRead };

  function markRead(id) {
    SP.store.update(['notifications'], (s) => {
      const t = s.notifications.find((x) => x.id === id);
      if (t) t.read = true;
    }, { silent: true });
    SP.app.refreshAlerts();
  }

  function mount() {
    const root = SP.el('div.stack.gap-3');
    const host = SP.el('div.stack.gap-1');

    const draw = () => {
      SP.clear(host);
      let list = [...SP.store.state.notifications].sort((a, b) => b.at - a.at);
      if (state.filter === 'active') list = list.filter((n) => !n.archived && !n.resolvedAt);
      else if (state.filter === 'unread') list = list.filter((n) => !n.read && !n.archived);
      else if (state.filter === 'archived') list = list.filter((n) => n.archived);
      if (!list.length) { host.appendChild(SP.empty({ icon: 'bell', title: 'No alerts', body: 'Low stock, discrepancies, approvals and security events land here.' })); return; }
      for (const n of list) {
        host.appendChild(SP.el('div.lrow', { class: n.read ? 'is-read' : '' },
          SP.el('span.lrow__ico', {
            style: {
              background: n.read ? 'var(--surface-3)' : `var(--${n.tone === 'danger' ? 'danger' : n.tone === 'warn' ? 'warn' : 'info'}-soft)`,
              color: n.read ? 'var(--text-mute)' : `var(--${n.tone === 'danger' ? 'danger' : n.tone === 'warn' ? 'warn' : 'info'})`,
            },
          }, SP.icon(n.tone === 'danger' ? 'alert' : n.tone === 'warn' ? 'alert' : 'info')),
          SP.el('div.lrow__main',
            SP.el('strong', n.title),
            SP.el('small', n.body),
            SP.el('small.mute', `${n.kind} · ${SP.fmt.ago(n.at)}${n.resolvedAt ? ' · resolved' : ''}`)),
          SP.el('div.row.gap-1',
            n.route ? SP.el('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => { markRead(n.id); SP.router.go(n.route, n.routeParams || {}); } }, 'Open') : null,
            SP.el('button.btn.btn--icon.btn--sm.btn--quiet', {
              type: 'button', 'aria-label': n.read ? 'Mark unread' : 'Mark read',
              onclick: () => {
                SP.store.update(['notifications'], (s) => { const t = s.notifications.find((x) => x.id === n.id); if (t) t.read = !t.read; }, { silent: true });
                SP.app.refreshAlerts(); draw();
              },
            }, SP.icon(n.read ? 'bell' : 'check')),
            SP.el('button.btn.btn--icon.btn--sm.btn--quiet', {
              type: 'button', 'aria-label': n.archived ? 'Unarchive' : 'Archive',
              onclick: () => {
                SP.store.update(['notifications'], (s) => { const t = s.notifications.find((x) => x.id === n.id); if (t) t.archived = !t.archived; }, { silent: true });
                draw();
              },
            }, SP.icon(n.archived ? 'refresh' : 'trash')),
          )));
      }
    };

    const chips = SP.chipRow(
      [{ value: 'active', label: 'Active' }, { value: 'unread', label: 'Unread' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }],
      state.filter, (v) => { state.filter = v; draw(); });

    root.append(
      SP.ui2.pageHead({
        title: 'Alert Center', sub: 'Everything that needs attention, in one place.',
        actions: [SP.el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onclick: () => { SP.store.update(['notifications'], (s) => s.notifications.forEach((n) => { n.read = true; })); SP.app.refreshAlerts(); draw(); },
        }, SP.icon('check'), 'Mark all read')],
      }),
      chips, host,
    );
    draw();
    return root;
  }

  return MOD;
})();
