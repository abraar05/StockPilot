# StockPilot — Upgrade Roadmap

**75 proposed upgrades**, grouped by theme, with effort and priority.

Effort: `S` ≈ 1 day · `M` ≈ 3–5 days · `L` ≈ 1–2 weeks
Priority: **P0** do next · **P1** next quarter · **P2** later · **P3** when there's room

Each item names the real file or module it touches, so it can be picked up and started
without re-investigating the codebase.

---

## Known starting gaps

These drove the highest-priority items and are honest limitations of 1.0.0:

| Gap | Where |
|---|---|
| Unit costs are **estimated by formula**, not real data | `SP.costFor()` in `config.js` |
| Auth is client-side only — roles are enforced in the UI, not a security boundary | `auth.js` |
| Data is per-device `localStorage`; no shared multi-user state | `store.js` |
| No sales history shipped, so velocity/cover/forecast are all dormant | `engine.js` |
| Server-side password check uses HMAC, not PBKDF2 | `gas/Code.gs` |
| No unit tests anywhere | repo-wide |
| No barcode, serial/batch, or physical-count workflow | — |
| No supplier, price, or margin model at all | — |

---

## 1. Data correctness & the single source of truth

| # | Upgrade | Why | Effort | Pri |
|---|---|---|---|---|
| 1 | **Real cost master** — per-SKU cost, supplier, MOQ, pack size, lead time in a `ProductMaster` sheet tab, editable in-app | `costFor()` currently invents prices, so every capital figure is a guess | M | **P0** |
| 2 | **Selling price + margin** per SKU, with margin % shown on every recommendation | Turns "buy 100 units" into "buy 100 units, 18% margin, recovers in 9 days" | M | **P0** |
| 3 | **Versioned data schema** with migrations and a `SCHEMA_VERSION` guard on load | A future field rename must not corrupt anyone's local data | S | **P0** |
| 4 | **Auto-repair reconciliation** — one-click "recalculate warehouse totals from colours" | Today data health *reports* a mismatch; it should be able to *fix* one | S | **P0** |
| 5 | **Duplicate SKU merge wizard** — fuzzy-match on model + spec, preview the merge, choose the surviving ID | Data health finds duplicates but merging is manual | M | P1 |
| 6 | **Spec parser into structured fields** — RAM GB, storage GB, storage type (UFS/eMMC), screen size, network (4G/5G) | Specs are a free-text string today; real filtering needs structure | M | P1 |
| 7 | **Colour palette admin** — rename/merge/add colour variants across the whole catalogue | 13 colours are hardcoded in `config.js` | S | P1 |
| 8 | **Unit-of-measure support** — pieces, boxes, sets, and per-SKU conversion | 1 "unit" may be a box of 5 or a pair | M | P1 |
| 9 | **Barcode as a first-class key** (see also §4.1) alongside SKU | Barcodes are the natural unique identifier | L | P1 |
| 10 | **Import from CSV/XLSX** with a column-mapping wizard and dry-run diff | Only JSON restore exists; CSV in is manual | M | P1 |
| 11 | **History/audit of field changes** — who changed which quantity when | Audit currently records events, not before/after values | S | P1 |
| 12 | **Deletion safety net** — 30-day soft-delete with restore, instead of hard delete | A mis-tap on "Delete SKU" is unrecoverable today | S | P1 |

## 2. Security & access control

| # | Upgrade | Why | Effort | Pri |
|---|---|---|---|---|
| 13 | **Move authorisation server-side** — the bridge decides, the app obeys | This is the single biggest security gap: roles are UI-only today | L | **P0** |
| 14 | **Server-side PBKDF2** — real iteration-count hashing in `gas/Code.gs`, replacing the HMAC scheme | The bridge currently verifies with a weaker scheme than the client | S | **P0** |
| 15 | **Two-factor authentication** — TOTP app, enforced for admins | One password protects all four warehouses | M | P1 |
| 16 | **Per-device approval for destructive actions** — confirm stock deletion with a PIN | Guards against the most damaging mistakes | S | P1 |
| 17 | **Session management UI** — see all devices, revoke individually, "sign out everywhere" | Sessions are listed but not individually revocable | S | P1 |
| 18 | **Encrypted local storage** — WebCrypto-wrapped `localStorage` with a user passphrase | Data sits in plaintext on a shared counter phone | M | P1 |
| 19 | **Rate limiting in the bridge** — throttled reads/writes, not just client lockout | The bridge is publicly reachable by URL | S | P1 |
| 20 | **Real SSO** — OIDC against Google Workspace, replacing the stub panel | The SSO tab currently only explains it isn't connected | M | P2 |
| 21 | **Brute-force lockout by IP** in the bridge, not only by account | An attacker can spray many accounts | S | P2 |
| 22 | **Dependabot / dependency scanning** in CI | `package.json` has Capacitor deps to track | S | P2 |
| 23 | **CSP + Subresource Integrity** on `index.html` | No CSP currently; a compromised CDN asset would execute | S | P2 |

## 3. Multi-user, sync & collaboration

| # | Upgrade | Why | Effort | Pri |
|---|---|---|---|---|
| 24 | **Shared state via the bridge** — read/write a server-side JSON store instead of `localStorage` | Today each device has a private copy; two people cannot see the same truth | L | **P0** |
| 25 | **Optimistic concurrency** — revision checks so a second editor gets a conflict prompt, not silent overwrite | Essential the moment #24 lands | M | P1 |
| 26 | **Real-time updates** — Apps Script cannot hold sockets; poll every N seconds with a visible "live" indicator | Removes the "is this stale?" question | M | P1 |
| 27 | **Per-user warehouse scoping enforced in the engine** — `scopeOf()` currently trusts the UI | A storekeeper should never *see* another site's numbers | M | P1 |
| 28 | **Approval delegation** — assign an approver when someone is on leave | Single point of failure on approvals | S | P2 |
| 29 | **Presence indicators** — "Alpana is editing REDMI 15C" | Prevents two people fighting over one line | M | P2 |
| 30 | **Offline queue prioritisation** — replay dispatches before stock corrections | Order of replay matters when several ops touch the same SKU | S | P2 |

## 4. Inventory operations

| # | Upgrade | Why | Effort | Pri |
|---|---|---|---|---|
| 31 | **Barcode / QR scanning** via camera, with a hardware-scanner keyboard-wedge fallback | Counting stock by hand is the slowest part of the job | L | **P0** |
| 32 | **Physical stock-take / cycle counting** — count sheet, blind counts, variance report, approve adjustments | The source sheet's own note says reconciliation is still pending | L | **P0** |
| 33 | **Serial / IMEI-level tracking** — one row per device rather than a quantity | Same pattern as your IMEI Control Center work; needed for warranty-grade accuracy | L | P1 |
| 34 | **Batch / lot and expiry tracking** | Inevitable once you carry spares and refurb units | L | P1 |
| 35 | **Serial-number label printing** — generate and print QR labels for received stock | Follows directly from #33 | M | P1 |
| 36 | **Shrinkage, damage and write-off log** with reason codes | Loss currently vanishes silently into the totals | M | P1 |
| 37 | **Goods-in workflow** — receive against a PO or transfer, scan, confirm | Receiving is currently a numbers-only form | M | P1 |
| 38 | **Reservation / backorder handling** — stock promised to a customer but not yet shipped | Prevents overselling from the same physical unit | M | P2 |
| 39 | **Consignment / loan stock** to another site, with expected return date | Sibling shops routinely borrow each other | M | P2 |
| 40 | **Location/bin tracking** within a warehouse | "Where is it" is a separate question from "how many" | L | P3 |

## 5. Purchasing & suppliers

| # | Upgrade | Why | Effort | Pri |
|---|---|---|---|---|
| 41 | **Supplier management** — contacts, terms, lead times, price breaks per supplier | Suppliers are free-text on a PO | M | **P0** |
| 42 | **Supplier price history and comparison** across suppliers per SKU | Real purchasing power needs visible price variance | M | P1 |
| 43 | **Purchase requisitions** → approval → PO, so requests are tracked before they become orders | Requests currently jump straight to a draft PO | M | P1 |
| 44 | **PO PDF export** with proper branding and terms | Release notes mention a print plan, but no PO document exists | S | P1 |
| 45 | **Email the PO** directly from the app | Cuts a copy/paste step and gives a timestamped record | M | P1 |
| 46 | **Goods-received notes (GRN)** matched against the PO with discrepancy flags | Closes the loop on partial deliveries | M | P1 |
| 47 | **Lead-time-aware reorder points** — reorder line derived from supplier lead time, not a flat 50 | A flat threshold ignores that a 14-day supplier needs a different trigger | M | P2 |
| 48 | **Auto-requisition on reorder crossing** — generate a draft when a line goes critical | Removes the human noticing step | M | P2 |
| 49 | **Payment tracking and outstanding-balance view** | Finance has no visibility into what's paid | M | P2 |
| 50 | **Vendor scorecards** — on-time %, defect rate, price variance | Turns reordering from habit into judgement | L | P3 |

## 6. Analytics & forecasting

| # | Upgrade | Why | Effort | Pri |
|---|---|---|---|---|
| 51 | **Demand forecasting** — weighted moving average + seasonality, replacing flat 4-week velocity | Velocity is naive; it cannot see a weekend spike | M | **P0** |
| 52 | **Safety stock & service-level targets** per SKU class (ABC) | Lets you hold less on C items without risking A items | M | P1 |
| 53 | **Multi-currency** with per-warehouse cost currency and a recorded FX rate | Any cross-border buying makes a single currency wrong | M | P1 |
| 54 | **Tax and duty tracking** per PO line | Needed for real landed cost | M | P2 |
| 55 | **Sales margin report** — margin by SKU, brand, site and month | You cannot run a business on units alone | M | P1 |
| 56 | **Return/defect rate analytics** | Rising returns are an early warning nothing else catches | M | P2 |
| 57 | **Stock-turnover and days-inventory metrics** per brand and site | The two numbers a wholesaler is judged on | S | P1 |
| 58 | **Custom dashboard widgets** — pin the numbers each role cares about | One dashboard cannot serve four roles well | M | P2 |
| 59 | **Saved views and filters** | Every user rebuilds the same filter set daily | S | P2 |
| 60 | **Scheduled report email** — daily stock position, weekly refill plan | Currently someone has to remember to open the app | M | P2 |
| 61 | **Anomaly detection** — sudden stock drops, unusual order sizes, negative adjustments | Catches data-entry errors and shrinkage | M | P2 |
| 62 | **What-if simulator** — change the reorder line or target cover and preview the capital impact | Makes the rules tangible before committing | M | P3 |

## 7. Mobile, offline & performance

| # | Upgrade | Why | Effort | Pri |
|---|---|---|---|---|
| 63 | **Background Sync** — flush the outbox automatically even when the tab is closed | Queueing currently waits until the app is reopened | M | **P0** |
| 64 | **Camera photo capture on dispatch** — proof of handover, attached to the ledger | Paper notes are being lost | M | P1 |
| 65 | **Virtual scrolling** for large inventories (2,000+ SKUs) | Full re-render per route will not scale | M | P1 |
| 66 | **Incremental rendering** on route change instead of clearing the view | Visible flicker on slower phones | S | P1 |
| 67 | **Haptics on dispatch submit** | Confirms the tap without looking | S | P2 |
| 68 | **Landscape and tablet layouts** for the warehouse counter | Tablets are the natural device for counting | M | P2 |
| 69 | **Widget shortcuts** for zero-stock and refill counts | Answer the morning question without opening the app | L | P3 |
| 70 | **Biometric unlock** (fingerprint/face) for quick re-entry | PIN entry on every pickup is friction | M | P3 |

## 8. UX, accessibility & language

| # | Upgrade | Why | Effort | Pri |
|---|---|---|---|---|
| 71 | **Bangla localisation** — the source sheet's UI is Bangla, the app is English-only | The team reads Bangla; this is a real adoption barrier | M | **P0** |
| 72 | **Undo for stock edits** — a snackbar "Undo" on the last change | Prevents the most common support request | S | P1 |
| 73 | **Bulk actions** — select many SKUs, adjust, archive, export | Currently one row at a time | M | P1 |
| 74 | **Keyboard shortcuts on desktop** for everything currently pointer-only | Speed on a desktop counter | S | P2 |
| 75 | **Screen-reader pass** — live regions for quantity changes, proper table semantics | Only partly handled today | M | P2 |
| 76 | **Font-size preference** beyond density | Small text on a bright counter screen | S | P2 |
| 77 | **Print-optimised report layouts** — stock take sheets, refill plans, PO | Print CSS exists for one report only | S | P2 |

## 9. Quality engineering

| # | Upgrade | Why | Effort | Pri |
|---|---|---|---|---|
| 78 | **Unit tests for `engine.js`** — urgency boundaries, order sizing, cover maths | The decision logic is the product; it has no tests | M | **P0** |
| 79 | **Tests for the CSV parser and SKU normaliser** | Spec drift and malformed quoting are real risks | M | **P0** |
| 80 | **Snapshot test on the sheet parser** — replay the live CSV, assert totals | A silent layout change upstream would corrupt everything | M | P1 |
| 81 | **CI for the web build** — lint, tests, seed-regeneration drift check | Only the APK has CI today | M | P1 |
| 82 | **Seed-drift detection in CI** — fail if the sheet changed and `seed.js` wasn't regenerated | Otherwise the live app and the shipped app silently diverge | S | P1 |
| 83 | **Error boundary** — catch render failures, keep the app usable, offer a reset | One bad SKU currently breaks the whole view | S | P1 |
| 84 | **Structured error reporting** to a configurable endpoint | Errors are only visible in the local console | M | P2 |
| 85 | **Bundle size budget** enforced in CI | No framework means the budget must be manual | S | P2 |
| 86 | **Cross-browser test pass** — Firefox, Safari, older Android WebView | Only Chrome-class engines verified | M | P2 |

## 10. Compliance & governance

| # | Upgrade | Why | Effort | Pri |
|---|---|---|---|---|
| 87 | **Data retention & consent policy**, with an exportable record | Staff phone data and personal data | M | P2 |
| 88 | **Read-access audit** — log who viewed what, not just who changed it | Insider access to pricing is a real concern | M | P2 |
| 89 | **Tamper-evident audit** — hash-chain the log so entries can't be quietly edited | The audit trail is only as strong as the device holding it | M | P3 |
| 90 | **Separate admin duty from stock duty** — no single account can both edit stock and approve spend | Segregation of duties for a purchasing system | S | P1 |

---

## Recommended order

### Immediately — these change decisions, not just screens
1. **#1 Real cost master** — every capital number is a guess until this exists
2. **#41 Supplier management** — you cannot compare prices without suppliers
3. **#32 Stock-take / cycle counting** — the source sheet says reconciliation is still pending
4. **#31 Barcode scanning** — the single biggest speed-up for daily counting
5. **#51 Demand forecasting** — order sizing is only as good as its demand estimate
6. **#13 + #14 Server-side authorisation and PBKDF2** — close the security gap honestly
7. **#24 Shared state via the bridge** — until this lands, "multiple users" means multiple private copies
8. **#71 Bangla localisation** — the largest adoption barrier for the actual team
9. **#78 + #79 Tests for the engine and parser** — before refactoring anything above
10. **#2 Selling price and margin** — turns units into profit

### Then, in order
- **#44 PO PDF · #45 Email PO · #46 GRN** — complete the purchasing loop
- **#33 Serial/IMEI tracking** — consistent with your other projects; big accuracy win
- **#43 Purchase requisitions · #48 Auto-requisition** — remove the manual noticing step
- **#63 Background Sync · #72 Undo · #73 Bulk actions** — daily-use friction
- **#21–#26 hardening and concurrency** — required before more than a handful of users

### Watch-outs when picking these up
- **#24 (shared state) changes the architecture.** Every module currently reads from
  `SP.store` synchronously. Doing shared state first avoids rewriting all 11 modules twice.
  Do #1, #2, #41, #32 and #51 first — they're additive and safe.
- **#13 (server-side authz)** should land with **#24**, not before. Without shared state
  there's nothing for the server to authorise.
- **#33 (serials)** is the biggest single data-model change. Do it before **#38
  reservations** and **#40 locations**, both of which assume a unit can be identified.

## Also worth doing, unranked

- **#4 auto-repair, #5 merge wizard, #29 presence, #35 label printing, #41–#50 purchasing
  suite, #59 saved views, #60 scheduled email** — all small, all noticeable.
- **#63 Background Sync** is the highest-value P1: without it, anything logged offline
  waits until someone reopens the app.

## Deliberately out of scope

Not proposed, because they solve problems this operation does not have:
multi-currency FX hedging, manufacturing/BOM, warehouse robotics integration,
predictive maintenance, and a public storefront. If any of these become real
requirements, they are separate applications rather than upgrades to this one.