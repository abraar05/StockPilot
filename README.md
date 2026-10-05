# StockPilot

**Multi-warehouse inventory intelligence, refill decisions and purchase planning** — built as a
mobile-first web app, bundled as an installable PWA, and ready to wrap as an Android APK.

- Source sheet: [Web-App_Inventory Data](https://docs.google.com/spreadsheets/d/1yFF3xhseJdsJQFRnyQYP9P3qakIhoDECITxTJclE39Y/edit?usp=sharing)
- Snapshot baked in at build time: **38 SKUs · 4,433 units · 4 warehouses**
- No build step, no framework, no npm runtime dependencies.

---

## Quick start

```bash
# any static server works
python -m http.server 8848        # then open http://127.0.0.1:8848
npx --yes http-server -p 8848 -c-1
```

Then sign in with a seeded account:

| Email | Password | PIN | Role | Scope |
|---|---|---|---|---|
| `admin@stockpilot.app` | `Admin@1234` | — | Admin | all sites |
| `manager@stockpilot.app` | `Manager@123` | `2468` | Manager | all sites |
| `alpana@stockpilot.app` | `Store@1234` | `1357` | Storekeeper | ALPANA |
| `nazrul@stockpilot.app` | `Store@1234` | `9753` | Storekeeper | NAZRUL |
| `viewer@stockpilot.app` | `Viewer@123` | `0000` | Viewer | ADMIN |

> **Delete these before going live.** Admin Console → Users → ▾ → Delete.

Opening `index.html` directly from disk also works. Icons are inlined for exactly that reason.
One caveat: browsers block service workers and strong crypto outside `https://` or `localhost`,
so password hashing falls back to a clearly-labelled weak digest and offline caching is disabled.
Serve it over HTTPS for production.

---

## What's in it

Eleven dedicated modules, each a self-contained file in `js/modules/`:

| Module | Route | What it does |
|---|---|---|
| **Dashboard** | `#/dashboard` | Hero stock total, decision bands, site health, colour mix, dispatch trend, AI recommendations |
| **Refill Radar** | `#/refill` | Ranks every line by urgency, sizes order quantities, splits transfer-vs-buy, applies a capital budget |
| **Inventory** | `#/inventory` | Search, filter, sort, colour-level editing, SKU lifecycle, CSV export |
| **Warehouses** | `#/warehouses` | Network view, brand distribution, per-site tables, rebalance suggestions |
| **Transfers** | `#/transfers` | Inter-site moves with a requested → approved → in-transit → received workflow |
| **Dispatch Log** | `#/sales` | Sales/returns ledger that feeds velocity and dead-stock detection |
| **Purchase Orders** | `#/purchase` | draft → pending → approved → ordered → received, with receipt allocation |
| **Insights** | `#/insights` | Capital concentration (A/B/C), sales velocity, days of cover, dead stock, data health, audit log |
| **Admin Console** | `#/admin` | Users, roles, permission matrix, decision rules, sites, outbox, backup, danger zone |
| **Settings** | `#/settings` | Profile, appearance, alerts, sheet connection, backup |
| **Help & Tips** | `#/help` | How the rule works, daily workflow, shortcuts, FAQ, setup guide |

Plus: sign-in gate with password / 4-digit PIN / SSO panels, lockout after 5 failed attempts,
per-user warehouse scoping, first-run onboarding, progressive in-context tips, a command palette
(<kbd>Ctrl</kbd>+<kbd>K</kbd>), keyboard navigation, an audit trail, and a full light/dark theme.

### The decision rule

Inherited from the source workbook and configurable in Admin → Rules:

| Stock on hand | Band | Meaning |
|---|---|---|
| `0` | 🔴 Restock Priority | Nothing on the shelf — every sale is lost until stock arrives |
| `1 … refillMax` (default 50) | 🟡 Refill | Below the reorder line — plan a top-up |
| `> refillMax` | 🟢 Adequate | Healthy cover — do not spend capital here |

**Suggested order quantity** targets a configurable number of weeks of cover, subtracts units
already on order or in transit, rounds up to a practical pack multiple, and offsets against
surplus held at other sites before proposing any purchase.

**Priority score (0–100)** combines urgency, sales velocity, how much value is at risk, and
whether a free internal transfer can solve it. With no dispatch history, ties break toward lines
held at another site — those are cheap and obvious wins.

---

## Connect the Google Sheet

StockPilot boots on an embedded snapshot, so it is useful immediately and keeps working with no
network. Connecting the sheet enables **live read and authenticated write-back**.

> A web page cannot write to a Google Sheet — it has no way to authenticate as you. That is why
> `gas/Code.gs` exists. It is the small server-side piece that holds the credentials.

### 1. Deploy the bridge

1. Open the inventory sheet → **Extensions → Apps Script**
2. Delete the placeholder code, paste all of `gas/Code.gs`, save
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (or restrict to your Workspace domain)
4. Copy the `…/exec` URL

### 2. Point StockPilot at it

**Settings → Google Sheet → Apps Script bridge URL → Save & test.**
The status pill turns green in the sidebar once connected.

### 3. Optional hardening (Script Properties)

| Property | Purpose |
|---|---|
| `SHEET_ID` | Override the spreadsheet id |
| `SHEET_TAB` | Tab holding the inventory block |
| `SHARED_SECRET` | Require a matching `token` on every call |
| `ALLOWED_DOMAINS` | Restrict server-side sign-in to these domains |

### How sync behaves

- **Read** — `readInventory` returns the whole catalogue; local user-authored fields
  (cost, reorder floor, notes, archived flag) are preserved across refreshes.
- **Write** — every change is queued in `state.pendingOps` and flushed in order.
- **Offline** — the outbox holds changes until the bridge answers, then flushes automatically.
  Nothing is silently dropped, and every operation is mirrored into a `StockPilot_Log` tab.
- **Without a bridge** — direct CSV reads are attempted opportunistically; Google sends no CORS
  headers so this only succeeds from a Google origin. Otherwise the app stays on the snapshot and
  queues writes, which is why the outbox is visible in Admin → Data.

---

## Publish it

Any static host works — there is nothing to compile.

| Option | How |
|---|---|
| **GitHub Pages** | Push, then Settings → Pages → deploy from branch, root |
| **Netlify / Vercel** | Drag the folder, or connect the repo. No build command, publish dir `.` |
| **Cloudflare Pages** | Same — no framework preset, output `.` |
| **Google Apps Script** | Host `index.html` + `assets/` in the script project so it shares the bridge's origin (no CORS at all) |
| **LAN / local** | `python -m http.server 8080 --bind 0.0.0.0` |

Bump the `?v=` query on every `<link>`/`<script>` in `index.html` when you ship a change — it is
the cache-buster, and `sw.js` uses the same string as its cache version.

Service workers require **HTTPS or localhost**. On plain-HTTP LAN addresses the app still works
fully, just without the offline cache.

---

## Android APK

See **[tools/build-android.md](tools/build-android.md)** for the full walkthrough. In short:

```bash
npm install
npx cap add android
npx cap sync android
npm run android:apk          # android/app/build/outputs/apk/release/app-release.apk
```

Or build a signed APK in the cloud with **no local Android Studio** — push the repo and run the
included GitHub Actions workflow:

```
.github/workflows/android-apk.yml
```

Set three repository secrets (`ANDROID_KEYSTORE_B64`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`), trigger the workflow, and download `stockpilot-apk` from the run summary.

The APK installs the whole web app, so it works fully offline out of the box on the bundled
snapshot; paste the Apps Script bridge URL in Settings on first run to enable write-back.

---

## Project layout

```
index.html                 app shell + inlined SVG sprite
capacitor.config.js        Android packaging
package.json               scripts + Capacitor deps
sw.js                      offline shell (service worker)
manifest                   PWA metadata (assets/manifest.webmanifest)

css/
  tokens.css               design tokens: colour, type, spacing, motion, both themes
  base.css                 reset, auth gate, app chrome, overlays
  components.css           buttons, fields, cards, tables, toasts, sheets, menus
  modules.css              module-specific presentation (heatmaps, kanban, bands)

js/
  config.js                sheet linkage, roles, permissions, nav, business rules
  util.js                  formatting, DOM helper (SP.el), CSV, fuzzy search
  crypto.js                PBKDF2-SHA256, tokens, strength, PIN derivation
  seed.js                  GENERATED snapshot from the sheet
  store.js                 reactive state, persistence, audit trail, outbox
  engine.js                the decision layer — every number comes from here
  charts.js                dependency-free SVG charts
  ui.js                    sheets, modals, toasts, menus, shared widgets
  auth.js                  users, roles, sessions, lockout, recovery
  sheets.js                bridge transport, CSV parsing, sync, exports
  router.js                hash routing with per-module lifecycle
  app.js                   bootstrap, chrome, onboarding, command palette
  modules/                 one file per module

gas/Code.gs                Apps Script bridge (read + write + audit log)
tools/
  build-seed.mjs           regenerates js/seed.js from the live sheet
  build-android.md         APK walkthrough
  responsive.html          side-by-side 360/390/430 preview harness
```

---

## Refreshing the snapshot

When the spreadsheet changes, regenerate the embedded snapshot:

```bash
node tools/build-seed.mjs
```

It parses the workbook (13 colour columns, `TOTAL / IN / OUT / In-Hand`, per-warehouse blocks),
normalises specification drift — `8 | 256 GB` and `8 | 256GB` merge into one line — and rewrites
`js/seed.js`. It prints a reconciliation table so you can check the totals before committing.

---

## Security notes, plainly

This is a static web app, so be clear-eyed about what it is:

- **Passwords never leave the device** unless you connect the Apps Script bridge, in which case
  verification happens server-side. Stored verifiers are PBKDF2-SHA256 at 120k iterations.
- **Client-side auth is not a security boundary.** Someone with devtools and localStorage access
  can inspect state. For real protection, connect the bridge and enforce server-side auth, or put
  the whole thing behind your identity provider.
- **Data is per-device.** `localStorage` is not shared. Export a backup from Admin → Data before
  switching phones or clearing your browser.
- **Roles are enforced in the UI**, so they prevent accidents rather than determined tampering.
- The sheet itself is the source of truth — every write is mirrored to `StockPilot_Log`.

---

## Verifying a build

```bash
npm run check    # syntax-check every core module
npm run seed     # regenerate the snapshot and print reconciliation totals
```

The app was verified in-browser across 360 / 390 / 430 / 1000px viewports: all eleven modules
mount without console errors, no horizontal overflow at any width, and every warehouse total
reconciles to 4,433 units.