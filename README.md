# StockPilot 2.0

**Inventory Intelligence & Warehouse Operations Platform** — ledger-backed stock, IMEI-level device tracking, accountable transfers, configurable approvals, and full audit. Mobile-first web app, installable PWA, packaged as an Android APK. No build step, no framework, no runtime dependencies.

## Live

**Web app:** https://abraar05.github.io/StockPilot/

**Android APK:** https://github.com/abraar05/StockPilot/releases

Sign in with `admin@stockpilot.app` / `Admin@1234` (demo account — delete before going live).

> The workspace boots with the v1 sheet snapshot labelled **DEMO DATA** so every screen is explorable. Wipe it in Settings → Backup & data to start clean.

---

## The product principle

StockPilot is a **system of record**. For every important inventory fact it can answer: what happened, who did it, when, where, why, what the value was before, what it is now, who approved it, and which document supports it.

**No quantity is ever typed into a product.** Stock is derived from the movement ledger:

```
opening + received + transfer in + returns in + approved adjustments in
− sales − transfer out − damage − returns out − approved adjustments out
= current stock
```

Every product page shows the complete running-balance calculation ("why is this SKU 37?").

## Modules

| Group | Modules |
|---|---|
| Operations | Dashboard · Inventory · Stock Movements · Transfers · Warehouses · Locations · Stock Verification |
| Catalogue | Products / SKUs (360° page) · Devices / IMEI |
| Commerce | Sales (quotation→invoice→payment) · Purchases (PO→receiving→payment) · Customers · Suppliers |
| Intelligence | Reports (16) · Analytics (ageing, ABC, velocity, anomalies) · Reorder Radar · AI Assistant · Alert Center |
| Administration | Approvals · Users & Roles (RBAC + warehouse scope) · Audit Log · Settings · System Info |

Plus: Ctrl+K command palette (SKUs, IMEIs, documents, actions), CSV import wizard (map → validate → confirm → reconcile), CSV/print export everywhere, physical cycle counting with blind mode, drafts auto-save, offline PWA, light/dark theme.

## Transfers, precisely

`REQUESTED → APPROVED → PICKING → DISPATCHED → IN TRANSIT → RECEIVED → COMPLETED`

Units leave the source at **dispatch** (`transfer_out` movement) and arrive at the destination at **receive** (`transfer_in`). In between they show as *in transit* — never double-counted. Short/excess receiving flags a discrepancy and alerts managers.

## Approvals

Configurable rules (Settings → Approval rules): discount %, adjustment size, transfer size, purchase value, any write-off, verification variances. Parked requests carry resumable actions; approvers decide with a permanent comment. You cannot approve your own request.

## Roles

Viewer · Auditor · Salesperson · Warehouse Staff · Sales Manager · Purchasing · Finance · Warehouse Manager · Administrator — with module/action permissions (`view create edit delete approve export import`) and warehouse scoping.

## Honesty contract

- **Google Sheets** — shows *not connected* until the Apps Script bridge (`gas/Code.gs`) answers a real ping. Nothing simulates a connection.
- **AI Assistant** — no external AI is connected. Answers are computed deterministically from the live ledger; a real endpoint can be attached in Settings → Integrations.
- **WhatsApp** — invoices share via `wa.me` links you confirm. No automated messaging.
- **MFA/push notifications** — require a backend; labelled as planned, never faked.
- **Demo data** — always labelled; production starts empty unless data is imported.

## Acceptance test

The full §54 scenario (create → receive 100 → transfer 20 → sell 2 → count → variance → approval → report) runs against the real core modules:

```
npm test          # node tools/acceptance.mjs  → 31 checks
npm run check     # syntax-check every core module
```

## Security notes, plainly

- Passwords/PINs are stored only as PBKDF2-SHA256 verifiers (120k rounds). Lockout after 5 failures; sessions expire and are revocable per device.
- **Client-side auth is not a security boundary.** Anyone with devtools can inspect local storage. For real protection, put a backend behind the app's service layer — the code is architected for that (all mutations flow through `SP.ledger` / `SP.approvals`).
- Data is per-device (`localStorage`). Export backups from Settings → Backup & data.

## Project layout

```
index.html                 app shell + inlined SVG sprite
sw.js                      offline shell (service worker)
css/                       tokens, base, components, modules, v2 additions
js/
  config.js                domain constants, roles, nav, approval rules
  store.js                 v3 schema, persistence, audit, migration from v1
  ledger.js                THE ledger: posting, stock derivation, ageing, valuation
  approvals.js             configurable approval workflows
  alerts.js                alert generation + IMEI validation
  impexp.js                CSV import pipeline & export/print
  ai.js                    data-grounded assistant + anomaly detection
  table.js                 reusable data table + form drafts
  auth.js  ui.js  util.js  crypto.js  charts.js  sheets.js  seed.js  seed2.js
  modules/                 one file per route (24 modules)
tools/
  acceptance.mjs           end-to-end scenario test (31 checks)
  build-seed.mjs           regenerate the v1 snapshot
  build-web.mjs            assemble www/ for the Android shell
gas/Code.gs                optional Apps Script bridge
```

## Publishing

Push to `main`; GitHub Pages serves the repo root. Bump `?v=` query strings in `index.html` and the version in `sw.js` together (they are the cache-busters).
