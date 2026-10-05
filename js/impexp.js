/**
 * impexp.js — professional import pipeline and export helpers.
 *
 * Import contract (never silently discards or overwrites):
 *   parse → detect columns → map to fields → validate every row
 *   → report errors/duplicates/unknowns → confirm → apply → reconciliation.
 *
 * Export: CSV (always), printable documents via window.print (PDF through
 * the browser's print-to-PDF). XLSX is not bundled; CSV opens in Excel.
 */
window.SP = window.SP || {};

SP.impexp = (() => {

  /* ════════════════════════════════════════════════════════════ PARSE */

  /** RFC-4180-ish CSV parser → array of string arrays. */
  function parseCSV(text) {
    const rows = [];
    let row = []; let cell = ''; let inQ = false;
    const src = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (inQ) {
        if (ch === '"') {
          if (src[i + 1] === '"') { cell += '"'; i += 1; }
          else inQ = false;
        } else cell += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i += 1;
        row.push(cell); cell = '';
        if (row.some((c) => c !== '')) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some((c) => c !== '')) rows.push(row);
    return rows;
  }

  /* ══════════════════════════════════════════════════════════ DETECT */

  /**
   * Field dictionaries: for each target field, header aliases we recognise.
   * The detector scores every column against every field and proposes the
   * best mapping — the user confirms or changes it before anything imports.
   */
  const FIELD_SETS = {
    products: [
      { key: 'sku', label: 'SKU', aliases: ['sku', 'model', 'model name', 'product', 'item', 'item code', 'code'], required: true },
      { key: 'name', label: 'Product name', aliases: ['name', 'product name', 'title', 'description', 'item name'] },
      { key: 'brand', label: 'Brand', aliases: ['brand', 'make', 'manufacturer'] },
      { key: 'category', label: 'Category', aliases: ['category', 'type', 'group'] },
      { key: 'ram', label: 'RAM (GB)', aliases: ['ram', 'ram gb', 'memory'], numeric: true },
      { key: 'storage', label: 'Storage (GB)', aliases: ['storage', 'storage gb', 'rom', 'capacity'], numeric: true },
      { key: 'color', label: 'Color', aliases: ['color', 'colour', 'shade'] },
      { key: 'variant', label: 'Variant / Region', aliases: ['variant', 'region', 'country', 'version'] },
      { key: 'network', label: 'Network', aliases: ['network', '4g/5g', '5g', 'connectivity'] },
      { key: 'cost', label: 'Cost', aliases: ['cost', 'buy price', 'purchase price', 'unit cost', 'cp'], numeric: true },
      { key: 'price', label: 'Selling price', aliases: ['price', 'sell price', 'selling price', 'mrp', 'sp', 'rate'], numeric: true },
      { key: 'barcode', label: 'Barcode', aliases: ['barcode', 'ean', 'upc'] },
      { key: 'minStock', label: 'Minimum stock', aliases: ['min', 'min stock', 'minimum', 'reorder level', 'rol'], numeric: true },
      { key: 'warehouse', label: 'Warehouse', aliases: ['warehouse', 'site', 'store', 'branch', 'wh'] },
      { key: 'qty', label: 'Quantity', aliases: ['qty', 'quantity', 'stock', 'units', 'on hand', 'in hand', 'total'], numeric: true },
    ],
    devices: [
      { key: 'imei1', label: 'IMEI 1', aliases: ['imei', 'imei1', 'imei 1', 'primary imei'], required: true },
      { key: 'imei2', label: 'IMEI 2', aliases: ['imei2', 'imei 2', 'secondary imei'] },
      { key: 'serial', label: 'Serial number', aliases: ['serial', 'serial no', 'sn', 'serial number'] },
      { key: 'sku', label: 'SKU', aliases: ['sku', 'model', 'product', 'item', 'code'], required: true },
      { key: 'color', label: 'Color', aliases: ['color', 'colour'] },
      { key: 'warehouse', label: 'Warehouse', aliases: ['warehouse', 'site', 'store', 'branch', 'wh'] },
      { key: 'condition', label: 'Condition', aliases: ['condition', 'grade'] },
      { key: 'cost', label: 'Cost', aliases: ['cost', 'unit cost', 'buy price'], numeric: true },
    ],
  };

  const normHeader = (h) => String(h || '').trim().toLowerCase().replace(/[\s_\-.()]+/g, ' ');

  /** Propose column→field mapping. Returns { mapping: {colIndex: fieldKey}, unknown: [colIndex] }. */
  function detectMapping(headers, fieldSet) {
    const fields = FIELD_SETS[fieldSet] || [];
    const mapping = {};
    const used = new Set();
    headers.forEach((h, i) => {
      const n = normHeader(h);
      let best = null; let bestScore = 0;
      for (const f of fields) {
        if (used.has(f.key)) continue;
        for (const a of [f.label, ...f.aliases]) {
          const an = normHeader(a);
          let score = 0;
          if (n === an) score = 100;
          else if (n.startsWith(an) || n.endsWith(an)) score = 70;
          else if (n.includes(an) && an.length > 2) score = 50;
          if (score > bestScore) { bestScore = score; best = f.key; }
        }
      }
      if (best && bestScore >= 50) { mapping[i] = best; used.add(best); }
    });
    const unknown = headers.map((_, i) => i).filter((i) => mapping[i] === undefined);
    return { mapping, unknown };
  }

  /* ════════════════════════════════════════════════════════ VALIDATE */

  /**
   * Validate rows against the mapping. Returns:
   * { rows: [{index, data, errors[], warnings[], dup}], requiredMissing: [] }
   * Nothing is written by this function — ever.
   */
  function validateRows(fieldSet, headers, bodyRows, mapping) {
    const fields = FIELD_SETS[fieldSet] || [];
    const requiredMissing = fields.filter((f) => f.required && !Object.values(mapping).includes(f.key)).map((f) => f.label);
    const seen = new Map();
    const rows = bodyRows.map((cells, ri) => {
      const data = {};
      const errors = [];
      const warnings = [];
      for (const [colStr, fieldKey] of Object.entries(mapping)) {
        const col = Number(colStr);
        const f = fields.find((x) => x.key === fieldKey);
        const raw = (cells[col] ?? '').trim();
        if (f?.numeric && raw !== '') {
          const num = Number(raw.replace(/[,৳$ ]/g, ''));
          if (!Number.isFinite(num)) errors.push(`${f.label}: "${raw}" is not a number`);
          else data[fieldKey] = num;
        } else data[fieldKey] = raw;
      }
      for (const f of fields) {
        if (f.required && mapping && Object.values(mapping).includes(f.key) && !String(data[f.key] ?? '').trim()) {
          errors.push(`${f.label} is required`);
        }
      }
      if (fieldSet === 'devices') {
        for (const slot of ['imei1', 'imei2']) {
          const v = SP.imei.clean(data[slot]);
          if (v && v.length !== 15) warnings.push(`${slot.toUpperCase()} has ${v.length} digits (expected 15)`);
          if (v && !SP.imei.valid(v)) warnings.push(`${slot.toUpperCase()} fails the Luhn check`);
        }
        const v = SP.imei.clean(data.imei1);
        if (v) {
          if (seen.has(v)) { errors.push(`Duplicate IMEI within file (row ${seen.get(v) + 2})`); data.dup = true; }
          seen.set(v, ri);
          if (SP.imei.find(v).length) { errors.push('IMEI already registered in StockPilot'); data.dup = true; }
        }
      }
      if (fieldSet === 'products' && data.sku) {
        const k = String(data.sku).toLowerCase();
        if (seen.has(k)) warnings.push(`SKU repeated within file (row ${seen.get(k) + 2})`);
        seen.set(k, ri);
        if (SP.store.state.products.some((p) => p.sku.toLowerCase() === k)) {
          warnings.push('SKU already exists — row will update that product, not duplicate it');
        }
      }
      return { index: ri, data, errors, warnings };
    });
    return { rows, requiredMissing };
  }

  /* ══════════════════════════════════════════════════════════ EXPORT */

  function downloadCSV(rows, headers, filename) {
    SP.download(SP.toCSV(rows, headers), filename, 'text/csv');
  }

  /** Printable document: opens the browser print dialog (→ PDF). */
  function printDocument({ title, subtitle, bodyHtml, footer }) {
    const doc = SP.el('div.printdoc', { html: `
      <div class="printdoc__head">
        <div>
          <strong>${SP.esc(title)}</strong>
          ${subtitle ? `<div class="printdoc__sub">${SP.esc(subtitle)}</div>` : ''}
        </div>
        <div class="printdoc__meta">
          ${SP.esc(SP.store.state.settings.company.name || 'StockPilot')}<br>
          ${SP.fmt.dateTime(Date.now())}
        </div>
      </div>
      <div class="printdoc__body">${bodyHtml}</div>
      ${footer ? `<div class="printdoc__foot">${SP.esc(footer)}</div>` : ''}
    ` });
    document.body.appendChild(doc);
    document.body.classList.add('is-printing');
    const cleanup = () => {
      document.body.classList.remove('is-printing');
      doc.remove();
      removeEventListener('afterprint', cleanup);
    };
    addEventListener('afterprint', cleanup);
    setTimeout(() => { window.print(); setTimeout(cleanup, 1500); }, 60);
  }

  const tableHtml = (headers, rows) => `
    <table class="printdoc__table">
      <thead><tr>${headers.map((h) => `<th>${SP.esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${SP.esc(c ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;

  return { parseCSV, detectMapping, validateRows, FIELD_SETS, downloadCSV, printDocument, tableHtml };
})();
