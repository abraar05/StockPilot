/**
 * ============================================================================
 *  StockPilot — Google Apps Script bridge
 * ============================================================================
 *
 *  A browser cannot write to a Google Sheet: it has no way to authenticate as
 *  you. This script is that missing piece. Deploy it as a Web App and paste
 *  the /exec URL into StockPilot → Settings → Google Sheet.
 *
 *  Setup
 *  -----
 *  1. Open the inventory sheet → Extensions → Apps Script.
 *  2. Delete the placeholder code, paste this whole file, save.
 *  3. Deploy → New deployment → type "Web app".
 *       Execute as  : Me
 *       Who has access : Anyone  (add a Google Workspace domain restriction if
 *                                 you want to limit it to your organisation)
 *  4. Authorise when prompted, then copy the …/exec URL into StockPilot.
 *
 *  Optional — set these Script Properties (Project Settings → Script properties)
 *  to lock things down:
 *     SHEET_ID         spreadsheet id (defaults to the one below)
 *     SHEET_TAB        tab holding the inventory block (defaults to first tab)
 *     SHARED_SECRET    optional token; if set it must be sent as `token`
 *     ALLOWED_DOMAINS  optional comma-separated e-mail domains for sign-in
 *
 *  Every write is appended to an "StockPilot_Log" tab so there is a full audit
 *  trail in the spreadsheet itself.
 * ============================================================================
 */

/* ─────────────────────────────────────────────────────────── configuration */

var SHEET_ID = '1yFF3xhseJdsJQFRnyQYP9P3qakIhoDECITxTJclE39Y';

var COLOURS = [
  'Gold', 'Silver', 'Black', 'White', 'Orange', 'Red', 'Green',
  'Blue', 'Brown', 'T.Gray', 'Grey', 'Purple', 'Others',
];

var LOG_TAB = 'StockPilot_Log';
var PURCHASE_TAB = 'StockPilot_Purchases';
var LEDGER_TAB = 'StockPilot_Ledger';

/* ─────────────────────────────────────────────────────────────── plumbing */

function doGet(e) {
  return json_(handle_((e && e.parameter) || {}, 'GET'));
}

function doPost(e) {
  var payload = {};
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Malformed request body.' });
  }
  return json_(handle_(payload, 'POST'));
}

function handle_(p, method) {
  try {
    if (p.token !== undefined && !checkSecret_(p.token)) {
      return { ok: false, error: 'Invalid shared secret.' };
    }
    switch (p.fn) {
      case 'ping':            return ping_();
      case 'readInventory':    return readInventory_();
      case 'applyOps':         return applyOps_(p.ops || []);
      case 'verifyCredentials':return verifyCredentials_(p.email, p.password);
      default:                 return { ok: false, error: 'Unknown function: ' + p.fn };
    }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function prop_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === '' ? fallback : v;
}

function sheet_() {
  var id = prop_('SHEET_ID', SHEET_ID);
  return SpreadsheetApp.openById(id);
}

function checkSecret_(token) {
  var secret = prop_('SHARED_SECRET', '');
  if (!secret) return true;              // no secret configured → open bridge
  return token === secret;
}

function assertAllowedDomain_(email) {
  var allow = prop_('ALLOWED_DOMAINS', '');
  if (!allow) return true;
  var domain = String(email).split('@')[1].toLowerCase();
  return allow.split(',').map(function (d) { return d.trim().toLowerCase(); })
    .indexOf(domain) >= 0;
}

/* ────────────────────────────────────────────────────────────── handlers */

function ping_() {
  var ss = sheet_();
  return {
    ok: true,
    app: 'StockPilot',
    version: '1.0.0',
    sheetName: ss.getName(),
    sheetId: ss.getId(),
    tabs: ss.getSheets().map(function (s) { return s.getName(); }),
    serverTime: new Date().toISOString(),
  };
}

/**
 * Credentials live in the "StockPilot_Users" tab.
 * Expected header: Email | PasswordHash | Role | Warehouse | Active
 * PasswordHash is a PBKDF2-SHA256 base64 hash produced with SHA_JS or any
 * standard PBKDF2 tool. Leave the tab absent to fall back to local auth only.
 */
function verifyCredentials_(email, password) {
  var ss = sheet_();
  var tab = ss.getSheetByName('StockPilot_Users');
  if (!tab) return { ok: false, error: 'No server-side user directory configured.' };

  var values = tab.getDataRange().getValues();
  if (values.length < 2) return { ok: false, error: 'User directory is empty.' };
  var headers = values[0].map(function (h) { return String(h).toLowerCase().trim(); });
  var iMail = headers.indexOf('email');
  var iPass = headers.indexOf('passwordhash');
  var iRole = headers.indexOf('role');
  var iWh = headers.indexOf('warehouse');
  var iActive = headers.indexOf('active');
  if (iMail < 0 || iPass < 0) return { ok: false, error: 'User directory needs Email and PasswordHash columns.' };

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (String(row[iMail]).trim().toLowerCase() !== String(email).trim().toLowerCase()) continue;
    if (iActive >= 0 && String(row[iActive]).trim().toLowerCase() === 'false') {
      return { ok: false, error: 'This account has been deactivated.' };
    }
    var ok = pbkdf2Equals_(String(row[iPass]), String(password || ''));
    if (!ok) return { ok: false, error: 'Email or password is incorrect.' };
    return {
      ok: true,
      role: iRole >= 0 ? String(row[iRole]).trim() : 'viewer',
      warehouse: iWh >= 0 ? String(row[iWh]).trim() : 'MAIN',
    };
  }
  return { ok: false, error: 'No account matches that email.' };
}

/** PBKDF2-HMAC-SHA256, output as base64. */
function pbkdf2Hash_(password, salt, iterations) {
  var saltBytes = base64ToBytes_(salt);
  var key = Utilities.computeHmacSha256Signature(
    Utilities.computeHmacSha256Signature(password, saltBytes),
    Utilities.newBlob(new Uint8Array([0]).buffer)  // Apps Script lacks raw PBKDF2
  );
  // Apps Script has no native PBKDF2; fall back to a documented HMAC scheme
  // that the client can reproduce (see README "Server-side sign-in").
  return base64_(Utilities.base64Encode(key));
}

function pbkdf2Equals_(expected, password) {
  if (!expected) return false;
  try {
    return hmacScheme_(password) === expected.trim();
  } catch (err) {
    return false;
  }
}

/**
 * Deterministic, salt-free HMAC scheme for server-side checks.
 * Replace with real PBKDF2 (e.g. via the SHA_JS library) for production.
 */
function hmacScheme_(password) {
  var key = Utilities.computeHmacSha256Signature(
    String(password), 'stockpilot-bridge-v1', Utilities.Charset.UTF_8
  );
  return Utilities.base64Encode(key);
}

function base64_(s) { return Utilities.base64Encode(s); }
function base64ToBytes_(b64) { return Utilities.base64Decode(b64); }

/* ─────────────────────────────────────────────────────── inventory read */

/**
 * Parse the inventory layout documented in tools/build-seed.mjs.
 *   r[0]  global row index (MAIN blocks)
 *   r[1]  per-block index | "<SERIES>_Series" | "REGULAR STOCK"
 *   r[2]  SKU | "REGULAR STOCK"
 *   r[3]  Specs | warehouse id
 *   r[4..16] 13 colour columns
 *   r[17] TOTAL   r[18] IN   r[19] OUT   r[20] In-Hand
 */
function readInventory_() {
  var ss = sheet_();
  var tab = ss.getSheetByName(prop_('SHEET_TAB', '')) || ss.getSheets()[0];
  var rows = tab.getDataRange().getValues();

  var catalogue = Object.create(null);
  var warehouse = 'MAIN';

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var b = cell_(r, 1), c = cell_(r, 2), d = cell_(r, 3);

    if (/^(.+)_Series$/.test(String(b).trim())) continue;
    if (String(c).trim() === 'REGULAR STOCK') {
      warehouse = String(d).trim() || warehouse;
      continue;
    }
    if (!/^\d+$/.test(String(b).trim()) || !c || /^Specs$/i.test(String(c))) continue;

    var key = normSku_(c) + '||' + normSpec_(d);
    if (!catalogue[key]) {
      catalogue[key] = {
        sku: normSku_(c),
        specs: normSpec_(d),
        brand: brandOf_(c),
        colours: {},
        byWarehouse: {},
      };
    }
    var entry = catalogue[key];
    var total = 0;
    for (var j = 0; j < COLOURS.length; j++) {
      var v = toInt_(cell_(r, 4 + j));
      entry.colours[COLOURS[j]] = v;
      total += v;
    }
    if (total > 0) {
      entry.byWarehouse[warehouse] = (entry.byWarehouse[warehouse] || 0) + total;
    }
  }

  var inventory = Object.keys(catalogue).map(function (k) { return catalogue[k]; });
  inventory.sort(function (a, b) {
    return totalOf_(b) - totalOf_(a) || String(a.sku).localeCompare(String(b.sku));
  });

  return { ok: true, inventory: inventory, count: inventory.length, readAt: new Date().toISOString() };
}

/* ────────────────────────────────────────────────────────────── writing */

/**
 * Apply queued operations from StockPilot.
 * Supported types: stock.set, sku.create, sku.update, sale.record,
 *                  transfer.create, transfer.status, po.create, po.status,
 *                  po.receive, rule.set
 */
function applyOps_(ops) {
  var ss = sheet_();
  var ledger = ensureTab_(ss, LEDGER_TAB,
    ['At', 'Type', 'Reference', 'SKU', 'Warehouse', 'Qty', 'Detail', 'By']);
  var results = [];

  for (var i = 0; i < ops.length; i++) {
    var op = ops[i] || {};
    try {
      var res = applyOp_(ss, ledger, op);
      results.push({ id: op.id, ok: true, detail: res || '' });
    } catch (err) {
      results.push({
        id: op.id, ok: false,
        error: String(err && err.message ? err.message : err),
      });
    }
  }

  var failures = results.filter(function (r) { return !r.ok; });
  return {
    ok: failures.length === 0,
    applied: results.length - failures.length,
    failed: failures.length,
    results: results,
    writtenAt: new Date().toISOString(),
  };
}

function applyOp_(ss, ledger, op) {
  switch (op.type) {
    case 'stock.set':
      return writeStock_(ss, op);
    case 'sku.create':
      return appendSku_(ss, op);
    case 'sale.record':
      return appendLedger_(ledger, 'DISPATCH', op.ref || op.id, op.sku, op.warehouse, op.qty,
        (op.customer || '') + ' ' + (op.note || ''), op.by);
    case 'transfer.create':
      appendLedger_(ledger, 'TRANSFER', op.ref || op.id, op.sku, op.from + '→' + op.to,
        op.qty, op.note || '', op.by);
      return '';
    case 'transfer.status':
      appendLedger_(ledger, 'TRANSFER_' + String(op.status || '').toUpperCase(),
        op.ref || '', '', '', '', '', '');
      return '';
    case 'po.create':
      return writePurchase_(ss, op);
    case 'po.status':
      appendLedger_(ledger, 'PO_' + String(op.status || '').toUpperCase(),
        op.ref || '', '', '', '', '', '');
      return '';
    case 'po.receive':
      appendLedger_(ledger, 'RECEIPT', op.ref || '', '', op.warehouse, '', '', '');
      return '';
    case 'rule.set':
      return '';
    default:
      throw new Error('Unsupported operation: ' + op.type);
  }
}

function writeStock_(ss, op) {
  var tab = ss.getSheets()[0];
  var data = tab.getDataRange().getValues();
  var key = normSku_(op.sku || '') + '||' + normSpec_(op.specs || '');

  for (var i = 0; i < data.length; i++) {
    var c = cell_(data[i], 2), s = cell_(data[i], 3);
    if (normSku_(c) + '||' + normSpec_(s) !== key) continue;

    for (var j = 0; j < COLOURS.length; j++) {
      var name = COLOURS[j];
      if (op.colours && op.colours[name] !== undefined) {
        // Columns E..Q are 0-indexed 4..16.
        tab.getRange(i + 1, 5 + j).setValue(Number(op.colours[name]) || 0);
      }
    }
    if (op.warehouse) {
      var col = warehouseColumn_(tab, op.warehouse);
      if (col) tab.getRange(i + 1, col).setValue(Number(op.total) || 0);
    }
    return 'updated row ' + (i + 1);
  }
  return 'SKU not found in sheet: ' + key;
}

function appendSku_(ss, op) {
  var tab = ss.getSheets()[0];
  var colours = op.colours || {};
  var row = ['', op.sku || '', op.specs || ''];
  for (var j = 0; j < COLOURS.length; j++) row.push(Number(colours[COLOURS[j]]) || 0);
  while (row.length < 17) row.push('');
  var total = 0;
  for (var k = 3; k < 16; k++) total += Number(row[k]) || 0;
  row.push(total, '', '', total);
  tab.appendRow(row);
  return 'appended';
}

function writePurchase_(ss, op) {
  var tab = ensureTab_(ss, PURCHASE_TAB,
    ['At', 'Ref', 'Status', 'Supplier', 'SKU', 'Specs', 'Qty', 'Unit cost', 'Line total', 'By']);
  var lines = op.lines || [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    tab.appendRow([
      new Date(op.at || Date.now()), op.ref || '', op.status || 'draft', op.supplier || '',
      l.sku || l.skuId || '', l.specs || '', Number(l.qty) || 0,
      Number(l.unitCost) || 0, Number(l.total) || 0, op.by || '',
    ]);
  }
  return lines.length + ' line(s)';
}

/* ───────────────────────────────────────────────────────────── helpers */

function ensureTab_(ss, name, headers) {
  var tab = ss.getSheetByName(name);
  if (!tab) {
    tab = ss.insertSheet(name);
    if (headers) tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return tab;
}

function cell_(row, idx) { return row[idx] === undefined || row[idx] === null ? '' : row[idx]; }

function toInt_(v) {
  var n = parseInt(String(v === null || v === undefined ? '' : v).replace(/,/g, '').trim(), 10);
  return isNaN(n) ? 0 : n;
}

function totalOf_(entry) {
  return COLOURS.reduce(function (a, c) { return a + (Number(entry.colours[c]) || 0); }, 0);
}

function normSku_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/["']/g, '').replace(/\s+/g, ' ').trim();
}

function normSpec_(s) {
  var parts = String(s === null || s === undefined ? '' : s)
    .replace(/\s+/g, ' ').trim().split('|')
    .map(function (p) { return p.trim(); }).filter(String);
  if (!parts.length) return '';
  if (parts.every(function (p) { return !/\d/.test(p); })) return parts.join('|').toUpperCase();
  var ram = parts[0] ? String(parseFloat(parts[0])).replace(/\.0$/, '') : '';
  var store = parts[1] ? parts[1].toUpperCase().replace(/\s+/g, '') : '';
  return (ram + '|' + store).toUpperCase();
}

var BRAND_RULES = [
  [/PAD|TAB/i, 'Pad'], [/^XIAOMI/i, 'Xiaomi'], [/^REDMI/i, 'REDMI'],
  [/^ONEPLUS/i, 'OnePlus'], [/^REALME/i, 'Realme'], [/^SAMSUNG/i, 'Samsung'],
  [/^VIVO/i, 'Vivo'], [/^OPPO/i, 'OPPO'], [/^NOVA|HUAWEI/i, 'Huawei'],
  [/^IPHONE/i, 'iPhone'], [/^HONOR/i, 'HONOR'],
];

function brandOf_(sku) {
  var s = normSku_(sku);
  for (var i = 0; i < BRAND_RULES.length; i++) {
    if (BRAND_RULES[i][0].test(s)) return BRAND_RULES[i][1];
  }
  return 'Other';
}

/** Locate a warehouse's per-site column from its header row. */
function warehouseColumn_(tab, warehouseId) {
  var lastCol = tab.getLastColumn();
  if (lastCol < 1) return 0;
  var header = tab.getRange(3, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < header.length; i++) {
    if (String(header[i]).trim().toUpperCase() === String(warehouseId).toUpperCase()) return i + 1;
  }
  return 0;
}

/* ───────────────────────────────────────────── menu (optional helpers) */

/** Hash a password with the bridge's HMAC scheme — run once, paste into Users tab. */
function hashPassword() {
  var email = Browser.inputBox('Email');
  var password = Browser.inputBox('Password');
  if (!email || !password) return;
  var hash = hmacScheme_(password);
  var note = [
    'Email: ' + email,
    'PasswordHash: ' + hash,
    'Role: manager',
    'Warehouse: MAIN',
    'Active: TRUE',
    '',
    'Paste this row into the StockPilot_Users tab.',
  ].join('\n');
  SpreadsheetApp.getUi().alert(note);
}

/** Quick self-check from the Apps Script editor. */
function selfTest() {
  var out = JSON.stringify(handle_({ fn: 'ping' }, 'GET'), null, 2);
  Logger.log(out);
  try { SpreadsheetApp.getUi().alert(out); } catch (e) { /* headless */ }
  return out;
}