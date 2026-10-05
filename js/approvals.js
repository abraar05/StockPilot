/**
 * approvals.js — configurable approval workflows.
 *
 * Any module can wrap a sensitive action in `SP.approvals.guard(...)`.
 * When a configured rule matches and the actor cannot self-approve, the
 * action is parked as a pending approval instead of executing; approvers
 * are notified and the decision (with comment) is permanently recorded.
 */
window.SP = window.SP || {};

SP.approvals = (() => {
  const st = () => SP.store.state;

  /** First enabled rule matching this kind + context, or null. */
  function matchingRule(kind, ctx = {}) {
    for (const rule of st().settings.approvalRules) {
      if (!rule.enabled || rule.kind !== kind) continue;
      if (rule.thresholdQty != null && (ctx.qty || 0) <= rule.thresholdQty && rule.thresholdQty > 0) continue;
      if (rule.thresholdQty === 0 && kind === 'variance' && !(ctx.qty > 0)) continue;
      if (rule.thresholdQty === 0 && kind === 'write_off' && !(ctx.qty > 0)) continue;
      if (rule.thresholdPct != null && (ctx.discountPct || 0) <= rule.thresholdPct) continue;
      if (rule.thresholdValue != null && (ctx.value || 0) <= rule.thresholdValue) continue;
      return rule;
    }
    return null;
  }

  function pendingList() {
    return st().approvals.filter((a) => a.status === 'pending' || a.status === 'info_requested');
  }

  function byId(id) { return st().approvals.find((a) => a.id === id); }

  /**
   * Run `execute()` immediately, or park the action for approval.
   *
   * @param kind     SP.APPROVAL_KINDS id
   * @param ctx      { qty?, discountPct?, value? } tested against thresholds
   * @param payload  { title, detail, refType, refId?, resume }
   *                 `resume(decision, approval)` is invoked on approval.
   *                 NOTE: resume runs only while this browser session (or a
   *                 later one on this device) processes the decision.
   * @param execute  called with (approval|null) when the action may proceed.
   * @returns { status: 'executed'|'pending', approval?, result? }
   */
  function guard(kind, ctx, payload, execute) {
    const rule = matchingRule(kind, ctx);
    const canSelfApprove = SP.auth?.can('approvals:decide');

    if (!rule || canSelfApprove) {
      const result = execute(null);
      return { status: 'executed', result };
    }

    const approval = {
      id: SP.uid('apr'),
      kind,
      ruleId: rule.id,
      ruleLabel: rule.label,
      title: payload.title || `${SP.APPROVAL_KINDS.find((k) => k.id === kind)?.label || kind} requires approval`,
      detail: payload.detail || '',
      context: { ...ctx },
      refType: payload.refType || null,
      refId: payload.refId || null,
      status: 'pending',
      requestedBy: SP.auth?.current()?.name || 'system',
      requestedById: SP.auth?.current()?.id || null,
      requestedAt: Date.now(),
      decidedBy: null, decidedAt: null, comment: '',
      history: [{ at: Date.now(), by: SP.auth?.current()?.name || 'system', action: 'requested', comment: payload.detail || '' }],
    };

    // Serialise the action so it can be resumed after a reload.
    if (payload.resumeKey && payload.resumeData) {
      approval.resumeKey = payload.resumeKey;
      approval.resumeData = payload.resumeData;
    }

    SP.store.update(['approvals'], (s) => { s.approvals.unshift(approval); });
    SP.store.audit('approval.request', approval.title, approval.detail);
    SP.store.notify({
      tone: 'warn', kind: 'approval', priority: 'high', route: 'approvals',
      title: 'Approval required',
      body: `${approval.title} — requested by ${approval.requestedBy}.`,
    });
    return { status: 'pending', approval };
  }

  /** Resume handlers registered by modules: key → fn(data, approval) */
  const resumers = {};
  function registerResume(key, fn) { resumers[key] = fn; }

  function decide(id, decision, comment = '') {
    const a = byId(id);
    if (!a) throw new Error('Approval not found.');
    if (!SP.auth?.can('approvals:decide')) throw new Error('Your role cannot decide approvals.');
    if (a.status !== 'pending' && a.status !== 'info_requested') throw new Error('This approval has already been decided.');
    if (a.requestedById && a.requestedById === SP.auth.current()?.id) {
      throw new Error('You cannot approve your own request. Another approver must decide.');
    }

    const me = SP.auth.current()?.name || 'system';
    SP.store.update(['approvals'], (s) => {
      const t = s.approvals.find((x) => x.id === id);
      t.status = decision;
      t.decidedBy = me;
      t.decidedAt = Date.now();
      t.comment = comment;
      t.history.push({ at: Date.now(), by: me, action: decision, comment });
    });
    SP.store.audit(`approval.${decision}`, a.title, comment || a.detail);

    if (decision === 'approved' && a.resumeKey && resumers[a.resumeKey]) {
      try { resumers[a.resumeKey](a.resumeData, a); }
      catch (e) {
        console.error('[approvals] resume failed', e);
        SP.store.notify({ tone: 'danger', kind: 'system', title: 'Approved action failed', body: e.message });
      }
    }
    SP.store.notify({
      tone: decision === 'approved' ? 'ok' : 'danger', kind: 'approval',
      title: `Request ${decision}`,
      body: `${a.title} — ${decision} by ${me}.`,
    });
    return byId(id);
  }

  function requestInfo(id, comment) {
    const a = byId(id);
    if (!a) throw new Error('Approval not found.');
    const me = SP.auth.current()?.name || 'system';
    SP.store.update(['approvals'], (s) => {
      const t = s.approvals.find((x) => x.id === id);
      t.status = 'info_requested';
      t.history.push({ at: Date.now(), by: me, action: 'info_requested', comment });
    });
    SP.store.audit('approval.info', a.title, comment);
    return byId(id);
  }

  return { guard, decide, requestInfo, matchingRule, pendingList, byId, registerResume };
})();
