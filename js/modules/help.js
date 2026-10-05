/**
 * modules/help.js — how StockPilot 2.0 works: the ledger, workflows,
 * keyboard shortcuts, the Google Sheets bridge and FAQ.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.help = (() => {
  const MOD = { title: 'Help & Tips', subtitle: 'How StockPilot works', mount };

  const SECTIONS = [
    {
      title: 'The golden rule: stock is never typed in',
      body: `Every quantity in StockPilot 2.0 is derived from the movement ledger:
opening + received + transferred-in + returns + approved adjustments
− sales − transfers-out − damage − approved adjustments-out = current stock.

To understand any number, open the product → Movements tab and read the
complete calculation with running balances. If the ledger says 37, the
answer to "why 37?" is always one scroll away.`,
    },
    {
      title: 'Daily workflow (warehouse)',
      body: `1. RECEIVE goods — Purchases → receive against a PO, or Inventory → Receive.
2. REGISTER devices for IMEI-tracked products (scan or type).
3. TRANSFER between warehouses: request → approve → pick → dispatch → receive.
4. SELL from Sales → New sale; stock leaves the shelf when the invoice issues.
5. VERIFY weekly: Stock Verification → count → submit → approve variances.`,
    },
    {
      title: 'Transfers, precisely',
      body: `Units leave the source warehouse when you DISPATCH (transfer_out movement).
They arrive at the destination when you RECEIVE (transfer_in movement).
Between the two, they show as "in transit" — never double-counted.
Receiving fewer units than dispatched flags a discrepancy and alerts managers.`,
    },
    {
      title: 'Approvals',
      body: `Sensitive actions (big discounts, large adjustments, big transfers,
write-offs, verification variances) park as approval requests instead of
executing. Approvers decide with a comment; the decision, the requester,
and the resulting ledger entries are permanently linked in the audit log.
You can never approve your own request.`,
    },
    {
      title: 'Keyboard shortcuts',
      body: `Ctrl/Cmd + K — command palette (search SKUs, IMEIs, pages, actions)
d / i / t / m — Dashboard / Inventory / Transfers / Movements
Esc — close dialogs
Enter on a device picker with a full IMEI typed — select it instantly`,
    },
    {
      title: 'Importing spreadsheets (CSV)',
      body: `Products/Devices → Import accepts CSV files (Excel: Save As → CSV).
The wizard: detects columns → lets you map them → validates every row
(showing errors, duplicates and unknown warehouses) → imports only the
rows you confirm → prints a reconciliation. Unmapped columns are kept as
custom attributes. Nothing is silently discarded or overwritten.`,
    },
    {
      title: 'Google Sheets bridge (optional)',
      body: `StockPilot runs fully offline on device storage. To also mirror data
into Google Sheets: open your sheet → Extensions → Apps Script → paste
gas/Code.gs → Deploy as web app → paste the /exec URL into
Settings → Integrations → Google Sheets → Save & test.
Until the bridge reports connected, the app honestly shows
"not connected" and keeps everything local.`,
    },
    {
      title: 'Backup & safety',
      body: `Data lives on this device. Settings → Backup & data → Download backup
produces a complete JSON snapshot (products, ledger, devices, sales,
purchases, users). Restore it on any device. Long forms auto-save drafts
and the app warns before losing them.`,
    },
  ];

  function mount() {
    const root = SP.el('div.stack.gap-3',
      SP.ui2.pageHead({ title: 'Help & Tips', sub: `StockPilot ${SP.VERSION} — system of record for inventory.` }),
      ...SECTIONS.map((s) => SP.el('div.card.card--pad',
        SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, s.title),
        ...s.body.split('\n\n').map((p) => SP.el('p.tiny', { style: { whiteSpace: 'pre-line', marginBottom: '6px' } }, p)))),
      SP.el('div.card.card--pad',
        SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Demo accounts (delete before going live)'),
        SP.el('p.tiny', { style: { whiteSpace: 'pre-line' } }, [
          'admin@stockpilot.app / Admin@1234 — Administrator',
          'manager@stockpilot.app / Manager@123 — Warehouse Manager (PIN 2468)',
          'staff@stockpilot.app / Store@1234 — Warehouse Staff (PIN 1357)',
          'sales@stockpilot.app / Sales@1234 — Salesperson (PIN 1122)',
          'viewer@stockpilot.app / Viewer@123 — Viewer (PIN 0000)',
        ].join('\n'))),
    );
    return root;
  }

  return MOD;
})();
