# StockPilot — Upgrade Roadmap

**Second edition, rewritten against the 2.0 codebase.**

The first draft of this document was written against 1.0 and is superseded — by the time it
was finished, a substantially larger 2.0 had landed on `main`. Roughly a third of the
original list already existed there. This version is written against what 2.0 actually
does, so nothing here asks you to build something you already have.

---

## What 2.0 already does — do not rebuild these

Verified present in the current `main`:

| Area | Shipped |
|---|---|
| **Ledger** | Append-only movement ledger (receive / transfer / sale / adjustment / damage / write-off / reserve / release / repair / opening) with running-balance `explain()`, FIFO ageing and valuation |
| **Devices** | Per-unit IMEI registry, Luhn validation, duplicate detection, barcode scanning, bulk import, per-device movement history |
| **Transfers** | Full lifecycle: requested → approved → picking → dispatched → in transit → received → completed, with partial receiving and discrepancy alerts |
| **Approvals** | Configurable rule engine (discount %, adjustment/transfer size, purchase value, write-offs, variances), recorded decisions, no self-approval |
| **Commerce** | Sales with invoice/payment/return/WhatsApp share, purchases with PO/receiving, customers and suppliers with ledgers |
| **Verification** | Full, cycle and blind physical counts, variance approval posting ledger adjustments |
| **RBAC** | Role-based access with module × action permissions and warehouse scoping |
| **Reports** | 17 reports: daily stock/sales, purchase, transfer, warehouse, product, IMEI, ageing, dead stock, valuation, margin, customer due, supplier due, adjustment, audit, verification |
| **Analytics** | Ageing, ABC, velocity, anomaly detection, lead-time awareness |
| **Data ops** | Import wizard (map → validate → confirm → reconcile), export everywhere, backup/restore, immutable audit log, draft auto-save |
| **UX** | Ctrl+K palette over SKUs/IMEIs/documents/actions, i18n scaffolding, service worker for offline |

Also on `main`: CI that builds `www/` before `cap sync`, PKCS12 keystore support, signing
secrets wired into the Gradle environment, and a release gate for unsigned builds.

---

## Verified gaps — these are definitely absent

Checked directly against the current sources.

| # | Upgrade | Why it matters | Effort | Pri |
|---|---|---|---|---|
| 1 | **Demand forecasting** — replace historical velocity with a forecast (weighted moving average + seasonality) | Velocity tells you what sold, not what will sell. Order sizing is only as good as this estimate | M | **P0** |
| 2 | **Seasonality and calendar effects** — festival uplift, month-end spikes, weekday patterns | A flat average will under-order every Ramadan and over-order every March | M | **P0** |
| 3 | **Days of cover / cover weeks** as a first-class metric on every SKU | Ageing and ABC exist; "how long until this runs out" does not | S | **P0** |
| 4 | **Stock turnover and days-inventory** by brand, site and month | The two numbers a wholesaler is judged on; neither is currently reported | S | **P0** |
| 5 | **Supplier price history and comparison** — cost per supplier per SKU over time | Without it you cannot tell whether a price changed or your memory did | M | **P0** |
| 6 | **Multi-currency with recorded FX rate** — per-SKU cost currency, per-PO FX | Any cross-border purchase makes a single-currency assumption wrong | M | **P1** |
| 7 | **Tax, duty and landed cost** on PO lines | Real landed cost is not `qty × unit price` | M | P1 |
| 8 | **Reversal entries instead of ledger edits** — credit notes and dated corrections | An append-only ledger that can only be edited is not append-only | M | **P0** |
| 9 | **Two-factor authentication** — TOTP, mandatory for approvers | One password currently authorises purchasing and adjustments | M | **P0** |
| 10 | **OIDC / Workspace SSO** to replace the local password store | Removes the largest reason the app cannot be deployed widely | M | P1 |
| 11 | **Background Sync** — flush the offline outbox with the app closed | Anything logged offline waits until someone reopens it | M | **P0** |
| 12 | **Virtual scrolling** for large catalogues | 2.0 re-renders per route; this will not scale past a few thousand SKUs or IMEIs | M | P1 |
| 13 | **Unit tests for `ledger.js` and the analytics engine** | The ledger is the system of record and has no tests | M | **P0** |
| 14 | **Ledger replay test** — replay a known movement set, assert the running balance | A rounding or ordering bug here silently corrupts all stock | M | **P0** |
| 15 | **Sheet/seed drift detection in CI** — fail if the source sheet changed and `seed*.js` was not regenerated | Otherwise the live app and the shipped app diverge invisibly | S | **P0** |
| 16 | **Encrypted local storage** — WebCrypto-wrapped with a user passphrase | The full ledger, customer and IMEI data sits in plaintext on shared devices | M | **P0** |
| 17 | **Encrypted backup/restore** with a passphrase | Backups are plain JSON and travel over email/USB | S | P1 |
| 18 | **Server-side authorisation** — the bridge decides, the app obeys | RBAC is enforced in the UI; it prevents accidents, not determined tampering | L | P1 |
| 19 | **Location / bin tracking** within a warehouse | "How many" and "where is it" are separate questions | L | P2 |
| 20 | **Consignment and loan stock** between sites, with expected return date | Sibling shops borrow from each other informally today | M | P2 |
| 21 | **Unit of measure and pack conversion** — pieces / boxes / sets | One "unit" may be a box of five | M | P1 |
| 22 | **Kit and bundle selling** — a bundle as a stockable parent with components | Common in accessory retail and unrepresentable today | L | P2 |
| 23 | **Partial payment and payment reconciliation** — split settlements, over/under payment | Real sales rarely settle in one clean transaction | M | P1 |
| 24 | **Customer credit limit and holds** — block dispatch when a customer is over limit | Credit is currently unmanaged | M | P2 |
| 25 | **Recurring replenishment schedule** — auto-raise a requisition on a cycle | Every order is raised manually today | M | P2 |
| 26 | **Supplier scorecards** — on-time %, defect rate, price variance, fill rate | Turns reordering from habit into judgement | M | P2 |
| 27 | **Price agreement and contract expiry tracking** with alerting | Losing a contract silently is expensive | M | P2 |
| 28 | **Barcode symbology breadth** — GS1-128, Code 128, ITF-14, DataMatrix | Scanners vary; one symbology locks you to one label format | M | P1 |
| 29 | **Bulk label printing with templates** and printer profiles | Printing exists; doing 200 labels at once does not | M | P1 |
| 30 | **Thermal printer integration** — direct ZPL/ESC-POS output | Removes the manual print-then-scan step | M | P2 |
| 31 | **Photo evidence** attached to dispatch, receive and variance | Disputes are currently settled from memory | M | P1 |
| 32 | **Push notifications** via FCM, not only the in-app alert centre | A warehouse alert that waits for someone to open the app is not an alert | L | P1 |
| 33 | **Scheduled report delivery** — daily stock position, weekly reorder plan | Someone currently has to remember to look | M | P1 |
| 34 | **Saved views and pinned filters** | Every user rebuilds the same filter set daily | S | P1 |
| 35 | **Undo for the last ledger entry** with a snackbar | The single most common support request in any inventory system | S | P1 |
| 36 | **Read-access audit** — log who viewed customer, IMEI and pricing data | The audit trail records changes but not access to sensitive reads | M | P2 |
| 37 | **Data retention, consent and subject-erasure tooling** | Customer and staff personal data is held on shared phones | M | P2 |
| 38 | **Backup scheduler with off-device copy** — daily encrypted snapshot to Drive | Backups exist but depend on someone triggering them | M | P1 |
| 39 | **Approval delegation and out-of-office cover** | Single approver is a single point of failure | S | P1 |
| 40 | **Role × warehouse matrix UI** — grant a role scope per site, not globally | Warehouse scoping is all-or-nothing per user today | M | P1 |
| 41 | **Training / sandbox mode** — a separate demo dataset with guided tours | New staff currently learn on live stock | M | P2 |
| 42 | **Schema migration test harness** — migrate 2.0 state forward under test | No test asserts that an old backup still opens | M | P1 |
| 43 | **Structured error reporting** to a configurable endpoint | Failures are visible only in a local console | M | P2 |
| 44 | **Error boundary per module** — one bad record must not blank a screen | One malformed row currently risks the whole view | S | P1 |
| 45 | **Print layouts for all 17 reports** | Print CSS exists for a single report | S | P2 |
| 46 | **Screen-reader pass** — live regions on quantity change, proper table semantics | Partly handled; needs a full audit | M | P2 |
| 47 | **Font-size and contrast preferences** beyond density | Small text on a bright counter screen | S | P2 |
| 48 | **Banla localisation completeness** — verify every 2.0 screen is translated | i18n exists; completeness across the new modules is unverified | M | **P0** |
| 49 | **Bulk and mass-edit at scale** — 5,000-row select and adjust | Bulk actions exist; their ceiling is unknown | M | P2 |
| 50 | **Chart performance for long series** — 12-month daily views | 17 reports with charts will get slow on a mid-range phone | M | P2 |

## Structural and governance

| # | Upgrade | Why | Effort | Pri |
|---|---|---|---|---|
| 51 | **Document archiving** — attach invoices, warranty cards, delivery notes to any record | Evidence currently lives outside the app | M | P1 |
| 52 | **Versioned releases in-app** — "what's new" plus a migration notifier | 2.0 was a large silent change; users need to know | S | P1 |
| 53 | **Changelog generated from commits** into the admin console | Keeps release notes honest | S | P2 |
| 54 | **Data-quality rule engine** — user-defined reconciliation checks beyond the built-ins | Different eras of data need different rules | M | P2 |
| 55 | **Bulk IMEI state transitions** with reason codes and approval gates | Bulk IMEI work is already possible; auditing it is not | M | P1 |
| 56 | **Immutable audit export to signed PDF** | A log you cannot hand to an auditor is only a log | M | P2 |
| 57 | **Cost-basis method choice** — weighted average vs FIFO vs specific | Valuation exists; the method is implicit | M | P2 |
| 58 | **Inter-company / inter-warehouse transfer valuation** | A transfer between own sites is not a sale and must not book profit | M | P2 |
| 59 | **Shrinkage target and variance tracking** against a budget | Loss is recorded but not measured against an expectation | M | P2 |
| 60 | **Cold-chain / hazardous handling flags** where relevant | Some stock carries handling constraints | L | P3 |

## Integration & scale

| # | Upgrade | Why | Effort | Pri |
|---|---|---|---|---|
| 61 | **WhatsApp Business API** for order and delivery notifications | Manual link-sharing works, but is not trackable or templated | L | P2 |
| 62 | **Accounting integration** (Tally / Zoho Books) — journal export of ledger entries | Re-keying the ledger into accounting is the biggest recurring manual task in a business this size | L | P1 |
| 63 | **Barcode scanner SDK integration** for continuous scan without re-tapping | Per-scan confirm slows high-volume receiving | L | P2 |
| 64 | **Offline-first conflict resolution** — field-level merge instead of whole-state overwrite | Essential once several sites edit concurrently | L | P1 |
| 65 | **Read-replica / cached dashboard for high-traffic sites** | Not needed yet; needed if the catalogue grows an order of magnitude | L | P3 |
| 66 | **Warehouse picker hardware support** — rugged scanners, ring scanners, cart-mount tablets | The counter is the point of use and the hardware is chosen for it | M | P2 |
| 67 | **Offline map of bin locations** for guided picking | Follows bin tracking | L | P3 |

---

## Suggested sequence

### Next — unblocks correct decisions
1. **#8 Ledger reversals** — an append-only ledger that can be edited is not a system of record
2. **#13 + #14 Ledger tests and replay test** — before any further ledger work
3. **#1 + #2 Forecasting and seasonality** — the single largest accuracy gain in replenishment
4. **#3 + #4 Cover and turnover metrics** — cheap, and every buying decision needs them
5. **#5 Supplier price history** — the input that makes #26 scorecards possible
6. **#48 Bangla completeness** — the adoption barrier for the actual team
7. **#16 + #17 Encrypted storage and backups** — the ledger now holds customer and IMEI data
8. **#9 2FA for approvers** — purchasing authority behind one password
9. **#11 Background Sync** — offline work should not wait for the app to reopen

### Then
- **#62 Accounting integration** — the largest recurring manual task
- **#18 Server-side authorisation** — pair with real SSO, not before
- **#23 Payments · #25 Replenishment schedule · #26 Supplier scorecards**
- **#28–#31 Scanning, label printing, photo evidence, push notifications**
- **#41 + #42 Sandbox and migration harness** — required before broad rollout

### Two things to check before planning further
- **Currency handling** — money is tracked per record, but there is no FX or
  multi-currency model. If you buy in USD or AED, this is a correctness issue, not a nicety.
- **Bangla coverage in the 2.0 modules** — the i18n layer exists, but the 20 new
  module files were added later and may not be fully translated.

---

## Deliberately out of scope

Not proposed, because they are different applications rather than upgrades:

manufacturing and BOM, demand planning across depots, routing optimisation,
retail POS integration beyond invoice sharing, and a customer-facing storefront.

If any of these become real requirements, they deserve their own build.