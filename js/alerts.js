/**
 * alerts.js — central alert generation & IMEI validation helpers.
 *
 * Alerts are derived from real data on a schedule, deduplicated by `key`,
 * and surfaced in the Alert Center. Nothing here fakes an event: an alert
 * exists only while the underlying condition exists.
 */
window.SP = window.SP || {};

/* ════════════════════════════════════════════════════════════════ IMEI */

SP.imei = (() => {
  /** Luhn check for 15-digit IMEIs. */
  function valid(imei) {
    const s = String(imei || '').replace(/\D/g, '');
    if (s.length !== 15) return false;
    let sum = 0;
    for (let i = 0; i < 15; i += 1) {
      let d = Number(s[i]);
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    return sum % 10 === 0;
  }

  const clean = (v) => String(v || '').replace(/\D/g, '');

  /** Find devices holding this IMEI in either slot. */
  function find(imei) {
    const c = clean(imei);
    if (!c) return [];
    return SP.store.state.devices.filter((d) => clean(d.imei1) === c || clean(d.imei2) === c);
  }

  /** All duplicated IMEIs across the fleet: imei → devices[]. */
  function duplicates() {
    const seen = new Map();
    for (const d of SP.store.state.devices) {
      for (const slot of ['imei1', 'imei2']) {
        const c = clean(d[slot]);
        if (!c) continue;
        if (!seen.has(c)) seen.set(c, []);
        seen.get(c).push(d);
      }
    }
    const out = new Map();
    for (const [k, v] of seen) if (v.length > 1) out.set(k, v);
    return out;
  }

  return { valid, clean, find, duplicates };
})();

/* ══════════════════════════════════════════════════════════════ ALERTS */

SP.alerts = (() => {
  const st = () => SP.store.state;

  /** Upsert a notification keyed by `key`; resolve it when condition clears. */
  function syncAlert(key, active, payload) {
    SP.store.update(['notifications'], (s) => {
      const existing = s.notifications.find((n) => n.key === key);
      if (active && !existing) {
        s.notifications.unshift({
          id: SP.uid('ntf'), key, at: Date.now(), read: false, archived: false,
          priority: payload.priority || 'normal', tone: payload.tone || 'info',
          kind: payload.kind || 'system', title: payload.title, body: payload.body || '',
          route: payload.route || null,
        });
      } else if (active && existing && existing.resolvedAt) {
        existing.resolvedAt = null;
        existing.at = Date.now();
        existing.read = false;
      } else if (!active && existing && !existing.resolvedAt) {
        existing.resolvedAt = Date.now();
        existing.read = true;
      }
    }, { silent: true });
  }

  /** Recompute every derived alert. Cheap enough to run each minute. */
  function generate() {
    const s = st();
    const map = SP.ledger.stockMap();

    // 1. Low stock / out of stock (per product with a reorder floor or default)
    let low = 0; let out = 0;
    for (const p of s.products) {
      if (p.archived) continue;
      const qty = map.get(p.id) || 0;
      const floor = p.reorderPoint || p.minStock || s.settings.lowStockDefault || 0;
      if (qty <= 0 && (floor > 0 || (SP.ledger.lastActivityAt(p.id)))) out += 1;
      else if (floor > 0 && qty <= floor) low += 1;
    }
    syncAlert('low-stock', low > 0, {
      kind: 'low_stock', tone: 'warn', priority: 'high', route: 'refill',
      title: `${SP.fmt.pluralise(low, 'product')} below reorder level`,
      body: 'Open the Reorder Radar to plan top-ups.',
    });
    syncAlert('out-of-stock', out > 0, {
      kind: 'low_stock', tone: 'danger', priority: 'high', route: 'refill',
      title: `${SP.fmt.pluralise(out, 'product')} out of stock`,
      body: 'Lines with sales history and zero units on hand.',
    });

    // 2. Duplicate IMEIs
    const dupes = SP.imei.duplicates();
    syncAlert('dup-imei', dupes.size > 0, {
      kind: 'duplicate_imei', tone: 'danger', priority: 'high', route: 'devices',
      title: `${SP.fmt.pluralise(dupes.size, 'duplicate IMEI')} detected`,
      body: 'Two or more devices share the same IMEI. Review in Devices.',
    });

    // 3. Pending transfers
    const pendingTransfers = s.transfers.filter((t) => ['requested', 'approved', 'picking', 'dispatched', 'in_transit'].includes(t.status));
    syncAlert('transfers-open', pendingTransfers.length > 0, {
      kind: 'transfer', tone: 'info', route: 'transfers',
      title: `${SP.fmt.pluralise(pendingTransfers.length, 'open transfer')}`,
      body: 'Transfers awaiting approval, dispatch or receiving.',
    });

    // 4. Transfer discrepancies
    const discrepant = s.transfers.filter((t) => t.status === 'received' && t.items.some((i) => (i.receivedQty ?? i.qty) !== i.qty));
    syncAlert('transfer-discrepancy', discrepant.length > 0, {
      kind: 'transfer', tone: 'warn', priority: 'high', route: 'transfers',
      title: `${SP.fmt.pluralise(discrepant.length, 'transfer')} with quantity discrepancies`,
      body: 'Received quantities differ from dispatched quantities.',
    });

    // 5. Pending approvals
    const pend = s.approvals.filter((a) => a.status === 'pending').length;
    syncAlert('approvals-pending', pend > 0, {
      kind: 'approval', tone: 'warn', priority: 'high', route: 'approvals',
      title: `${SP.fmt.pluralise(pend, 'approval')} waiting for a decision`,
      body: 'Discounts, adjustments and transfers need review.',
    });

    // 6. Overdue customer dues
    const overdue = s.sales.filter((x) => !x.legacy && x.status !== 'cancelled'
      && (x.total - (x.paid || 0)) > 0 && x.dueAt && x.dueAt < Date.now());
    syncAlert('dues-overdue', overdue.length > 0, {
      kind: 'payment', tone: 'danger', priority: 'high', route: 'customers',
      title: `${SP.fmt.pluralise(overdue.length, 'invoice')} past due`,
      body: `${SP.fmt.money(SP.sum(overdue, (x) => x.total - (x.paid || 0)))} outstanding past the due date.`,
    });

    // 7. Ageing stock (units older than dead-stock horizon)
    const horizonDays = s.rules.deadStockDays || 60;
    let aged = 0;
    const { perProduct } = SP.ledger.ageing();
    for (const pb of Object.values(perProduct)) aged += pb.d180p;
    syncAlert('ageing-stock', aged > 0, {
      kind: 'ageing', tone: 'warn', route: 'analytics',
      title: `${SP.fmt.pluralise(aged, 'unit')} aged over 180 days`,
      body: `Dead-stock horizon is ${horizonDays} days; review Analytics → Ageing.`,
    });

    // 8. Google Sheets connection honesty
    const gs = s.settings.integrations.googleSheets;
    if (gs.bridgeUrl && !gs.connected) {
      syncAlert('sheets-down', true, {
        kind: 'integration', tone: 'warn', route: 'settings',
        title: 'Google Sheets bridge unreachable',
        body: 'The bridge URL is configured but not responding. Working offline.',
      });
    } else syncAlert('sheets-down', false, {});
  }

  function unreadCount() {
    return st().notifications.filter((n) => !n.read && !n.archived && !n.resolvedAt).length;
  }

  return { generate, unreadCount, syncAlert };
})();
