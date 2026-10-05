/**
 * build-seed.mjs
 * ---------------------------------------------------------------------------
 * Extracts the authoritative inventory snapshot from the linked Google Sheet
 * and emits `js/seed.js`.
 *
 * The sheet is a multi-warehouse, colour-variant inventory ledger. Its layout
 * (0-indexed CSV columns):
 *
 *   r[0]   legacy global row index (MAIN blocks only)
 *   r[1]   per-block row index  |  "<SERIES>_Series" marker  |  "REGULAR STOCK"
 *   r[2]   SKU name  |  "REGULAR STOCK" marker
 *   r[3]   Specification  |  warehouse id (on REGULAR STOCK rows)
 *   r[4..16]  13 colour columns
 *   r[17]  TOTAL,  r[18]  IN,  r[19]  OUT,  r[20]  In-Hand
 *
 * Run:  node tools/build-seed.mjs
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOC_ID =
  process.env.SHEET_ID || '1yFF3xhseJdsJQFRnyQYP9P3qakIhoDECITxTJclE39Y';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const COLOURS = [
  'Gold', 'Silver', 'Black', 'White', 'Orange', 'Red', 'Green',
  'Blue', 'Brown', 'T.Gray', 'Grey', 'Purple', 'Others',
];

/* ---------------------------------------------------------------- helpers */

const csvRows = (text) =>
  text
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => {
      const out = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quoted) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i += 1; } else { quoted = false; }
          } else cur += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    });

const toInt = (v) => {
  const n = parseInt(String(v ?? '').replace(/,/g, '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

const cleanSku = (s) => s.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
const skuKey = (s) => cleanSku(s).toUpperCase();

/**
 * Specifications arrive with cosmetic drift ("4 | 128 GB", "4|128GB",
 * "4 | 128gb"). Canonicalising to "RAM | Storage" merges those variants so a
 * single product never splits into two catalogue rows.
 */
function parseSpecs(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { key: '', label: '' };

  const parts = text.split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { key: text.toUpperCase(), label: text };

  // Non-numeric specs (e.g. "CPO") are kept verbatim, only case-normalised.
  if (parts.every((p) => !/\d/.test(p))) {
    const label = parts.join(' | ').toUpperCase();
    return { key: label, label };
  }

  const [ram, storage] = parts;
  const normRam = ram ? String(parseFloat(ram)).replace(/\.0$/, '') : '';
  const normStore = storage
    ? storage.toUpperCase().replace(/\s+/g, '').replace(/(\d)([A-Z]+)/, '$1$2')
    : '';
  const label = [normRam, normStore].filter(Boolean).join(' | ');
  return { key: label.replace(/\s+/g, '').toUpperCase(), label };
}

const specKey = (s) => parseSpecs(s).key;
const specLabel = (s) => parseSpecs(s).label;

/** Brand / series inference, ordered most-specific first. */
const BRAND_RULES = [
  [/PAD|TAB/i, 'Pad'],
  [/^XIAOMI/i, 'Xiaomi'],
  [/^REDMI/i, 'REDMI'],
  [/^ONEPLUS/i, 'OnePlus'],
  [/^REALME/i, 'Realme'],
  [/^SAMSUNG/i, 'Samsung'],
  [/^VIVO/i, 'Vivo'],
  [/^OPPO/i, 'OPPO'],
  [/^NOVA|HUAWEI/i, 'Huawei'],
  [/^IPHONE/i, 'iPhone'],
  [/^HONOR/i, 'HONOR'],
];
const brandOf = (sku) =>
  (BRAND_RULES.find(([re]) => re.test(cleanSku(sku))) || [null, 'Other'])[1];

/** Mobile-friendly hex swatches used by the colour chips. */
const COLOUR_HEX = {
  Gold: '#E8B931', Silver: '#C8CED6', Black: '#1B1F27', White: '#F2F4F7',
  Orange: '#F2762E', Red: '#E5484D', Green: '#2FA84F', Blue: '#2D7FF9',
  Brown: '#8A5A3B', 'T.Gray': '#7A8699', Grey: '#5A6675', Purple: '#8B5CF6',
  Others: '#94A3B8',
};

/* ------------------------------------------------------------------- main */

const res = await fetch(
  `https://docs.google.com/spreadsheets/d/${DOC_ID}/export?format=csv`,
);
if (!res.ok) {
  console.error(`Failed to fetch sheet: HTTP ${res.status}`);
  process.exit(1);
}
const rows = csvRows(await res.text());

/** series label carried by the MAIN block, used where a warehouse omits it. */
const seriesHint = new Map();
let warehouse = 'MAIN';
let currentSeries = null;

for (const r of rows) {
  const b = (r[1] ?? '').trim();
  const c = (r[2] ?? '').trim();
  const d = (r[3] ?? '').trim();

  const seriesMatch = b.match(/^(.+)_Series$/);
  if (seriesMatch) {
    currentSeries = seriesMatch[1].trim();
    seriesHint.set(warehouse, currentSeries);
    continue;
  }
  if (c === 'REGULAR STOCK') {
    warehouse = d || warehouse;
    continue;
  }
  if (!seriesHint.has(warehouse)) seriesHint.set(warehouse, currentSeries);
}

const catalogue = new Map();
const warehouseTotals = new Map();

warehouse = 'MAIN';
currentSeries = null;

for (const r of rows) {
  const b = (r[1] ?? '').trim();
  const c = (r[2] ?? '').trim();
  const d = (r[3] ?? '').trim();

  const seriesMatch = b.match(/^(.+)_Series$/);
  if (seriesMatch) { currentSeries = seriesMatch[1].trim(); continue; }
  if (c === 'REGULAR STOCK') { warehouse = d || warehouse; continue; }
  if (!/^\d+$/.test(b) || !c || /^Specs$/i.test(c) || /^SKU$/i.test(b)) continue;

  const key = `${skuKey(c)}||${specKey(d)}`;
  if (!catalogue.has(key)) {
    catalogue.set(key, {
      sku: cleanSku(c),
      specs: specLabel(d),
      brand: brandOf(c),
      colours: Object.fromEntries(COLOURS.map((x) => [x, 0])),
      byWarehouse: {},
      seriesHint: currentSeries,
      mergeNotes: [],
    });
  }
  const entry = catalogue.get(key);
  const sheetSku = cleanSku(c);
  const sheetSpecs = d.trim();
  if (sheetSku !== entry.sku) entry.mergeNotes.push(`"${sheetSku}" spelling variant`);
  if (specKey(sheetSpecs) !== specKey(entry.specs)) {
    entry.mergeNotes.push(`spec written as "${sheetSpecs}"`);
  }

  let qty = 0;
  COLOURS.forEach((colour, i) => {
    const v = toInt(r[4 + i]);
    entry.colours[colour] += v;
    qty += v;
  });
  if (qty > 0) {
    entry.byWarehouse[warehouse] = (entry.byWarehouse[warehouse] ?? 0) + qty;
    warehouseTotals.set(warehouse, (warehouseTotals.get(warehouse) ?? 0) + qty);
  }
}

/** Ordered, de-duplicated SKU list. */
const skus = [...catalogue.values()]
  .map((e, i) => ({
    id: `SKU${String(i + 1).padStart(3, '0')}`,
    sku: e.sku,
    specs: e.specs,
    brand: e.brand,
    colours: e.colours,
    byWarehouse: e.byWarehouse,
    mergeNotes: e.mergeNotes,
  }))
  .sort((a, b) => {
    const ta = COLOURS.reduce((s, c) => s + a.colours[c], 0);
    const tb = COLOURS.reduce((s, c) => s + b.colours[c], 0);
    if (tb !== ta) return tb - ta;
    return a.sku.localeCompare(b.sku);
  })
  .map((s, i) => ({ ...s, id: `SKU${String(i + 1).padStart(3, '0')}` }));

const warehouseOrder = ['MAIN', 'ADMIN', 'ALPANA', 'NAZRUL'];
const warehouses = warehouseOrder
  .filter((w) => warehouseTotals.has(w))
  .map((w) => ({
    id: w,
    label: w === 'MAIN' ? 'Main Warehouse' : `${w.charAt(0)}${w.slice(1).toLowerCase()}`,
    units: warehouseTotals.get(w) ?? 0,
  }));

const gross = COLOURS.reduce((s, c) => s + skus.reduce((t, x) => t + x.colours[c], 0), 0);

const payload = {
  docId: DOC_ID,
  exportedAt: new Date().toISOString(),
  sourceDate: '01 September 2026',
  colours: COLOURS.map((name) => ({ name, hex: COLOUR_HEX[name] })),
  warehouses,
  skus,
};

const js = `/**
 * seed.js — GENERATED FILE. Do not hand-edit.
 * Produced by tools/build-seed.mjs from Google Sheet ${DOC_ID}.
 * Regenerate with:  node tools/build-seed.mjs
 *
 * This is the offline snapshot the app boots with, so the dashboard is useful
 * immediately and remains functional with no network. When the Apps Script
 * bridge is connected, live sheet data supersedes this snapshot.
 */
window.SP = window.SP || {};
window.SP.SEED = ${JSON.stringify(payload, null, 2)};

/** Display units for the reconciliation note carried in the source sheet. */
window.SP.SEED.notice =
  'Physical verification and reconciliation of each house/location is pending. ' +
  'The respective house/location custodian or responsible authority should verify ' +
  'the actual physical stock and report any discrepancy for correction.';

window.SP.SEED.referencedBy = ['Abraar Ahmed', 'Ahad Shad', 'Mr. Ahad', 'Mr. Rashed'];
`;

writeFileSync(resolve(ROOT, 'js', 'seed.js'), js, 'utf8');

/* ------------------------------------------------------------- reporting */

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n  Wrote js/seed.js`);
console.log(`  doc            ${DOC_ID}`);
console.log(`  SKUs           ${skus.length}`);
console.log(`  gross units    ${gross.toLocaleString('en-US')}`);
console.log(`  warehouses     ${warehouses.map((w) => `${w.id}=${w.units}`).join('  ')}`);

const totals = skus.map((s) => COLOURS.reduce((a, c) => a + s.colours[c], 0));
const zero = totals.filter((t) => t === 0).length;
const refill = totals.filter((t) => t > 0 && t <= 50).length;
const adequate = totals.filter((t) => t > 50).length;
console.log(`  red  (0)       ${zero}`);
console.log(`  amber (1-50)   ${refill}`);
console.log(`  green (>50)    ${adequate}`);
console.log(`\n  ${pad('SKU', 30)}${pad('SPECS', 14)}${'UNITS'}`);
for (let i = 0; i < Math.min(12, skus.length); i += 1) {
  console.log(
    `  ${pad(skus[i].sku.slice(0, 29), 30)}${pad(skus[i].specs.slice(0, 13), 14)}${totals[i]}`,
  );
}
console.log('');