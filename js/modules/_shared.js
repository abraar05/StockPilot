/**
 * modules/_shared.js — cross-module widgets: warehouse selector, product
 * picker, device picker, status badges, page headers, KPI cards.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.ui2 = (() => {

  /** Warehouse <select> limited to the signed-in user's visible scope. */
  function warehouseSelect({ value = '*', allowAll = true, scope = 'visible', onChange, id } = {}) {
    const s = SP.store.state;
    const allowed = scope === 'write' ? SP.auth.scopeOf() : SP.auth.visibleWarehouses();
    const whs = s.warehouses.filter((w) => w.active && allowed.includes(w.id));
    const sel = SP.el('select.select', { id: id || SP.uid('wh') },
      allowAll ? SP.el('option', { value: '*', selected: value === '*' }, 'All warehouses') : null,
      ...whs.map((w) => SP.el('option', { value: w.id, selected: value === w.id }, w.name)),
    );
    if (onChange) sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  /** Status badge from SP.STATUS. */
  function badge(kind, id, opts = {}) {
    const s = SP.statusOf(kind, id);
    return SP.el('span.tag', { class: `tag--${s.tone}${opts.sm ? ' tag--sm' : ''}` }, s.label);
  }

  /** Generic tone badge. */
  function tag(label, tone = 'mute') { return SP.el('span.tag', { class: `tag--${tone}` }, label); }

  /** KPI card. */
  function kpi({ label, value, sub, tone, icon, onClick, spark }) {
    return SP.el(onClick ? 'button.kpi' : 'div.kpi', {
      type: onClick ? 'button' : null, onclick: onClick,
      class: tone ? `kpi--${tone}` : '',
    },
      SP.el('div.kpi__top',
        SP.el('span.kpi__label', label),
        icon ? SP.el('span.kpi__ico', SP.icon(icon)) : null,
      ),
      SP.el('div.kpi__value', value),
      sub ? SP.el('div.kpi__sub', sub) : null,
      spark || null,
    );
  }

  /** Page action header. */
  function pageHead({ title, sub, actions = [] }) {
    return SP.el('div.phead',
      SP.el('div.grow',
        SP.el('h1.phead__title', title),
        sub ? SP.el('p.phead__sub', sub) : null,
      ),
      SP.el('div.phead__actions', ...actions),
    );
  }

  /**
   * Product picker modal. Returns a Promise<product|null>.
   * opts: { warehouse?, onlyInStock?, title }
   */
  function pickProduct(opts = {}) {
    return new Promise((resolve) => {
      let chosen = null;
      const listHost = SP.el('div.stack.gap-1', { style: { maxHeight: '46vh', overflow: 'auto' } });
      const input = SP.el('input.input', { type: 'search', placeholder: 'Search SKU, brand, model, RAM, colour…', autofocus: true });

      function draw() {
        const q = input.value.trim().toLowerCase();
        let rows = SP.store.state.products.filter((p) => !p.archived);
        if (q) rows = rows.filter((p) => `${p.sku} ${p.name} ${p.brand} ${p.color} ${p.ram} ${p.storage}`.toLowerCase().includes(q));
        if (opts.onlyInStock) rows = rows.filter((p) => SP.ledger.stockOf(p.id, opts.warehouse || null) > 0);
        SP.clear(listHost);
        if (!rows.length) listHost.appendChild(SP.empty({ icon: 'search', title: 'No products found', body: 'Try a different search, or create the product first.' }));
        for (const p of rows.slice(0, 60)) {
          const qty = SP.ledger.stockOf(p.id, opts.warehouse || null);
          listHost.appendChild(SP.el('button.lrow', {
            type: 'button',
            onclick: () => { chosen = p; shell.close(p); },
          },
            SP.el('span.lrow__ico', SP.icon('box')),
            SP.el('div.lrow__main', SP.el('strong', p.name), SP.el('small', `${p.brand} · ${p.category || '—'}${p.serialized ? ' · IMEI-tracked' : ''}`)),
            SP.el('div.lrow__end', SP.el('span.lrow__val', { style: { color: qty <= 0 ? 'var(--danger)' : undefined } }, SP.fmt.n(qty)), SP.el('small.mute', 'in stock')),
          ));
        }
      }
      input.addEventListener('input', SP.debounce(draw, 120));
      draw();
      const shell = SP.sheet({
        title: opts.title || 'Choose a product',
        content: SP.el('div.stack.gap-3', input, listHost),
        onClose: () => resolve(chosen),
      });
    });
  }

  /**
   * Device picker for a product at a warehouse. Returns Promise<device[]>.
   * Supports IMEI scanning via camera where BarcodeDetector is available.
   */
  function pickDevices({ productId, warehouseId, qty, statuses = ['available', 'received', 'reserved'], title }) {
    return new Promise((resolve) => {
      const selected = new Set();
      const listHost = SP.el('div.stack.gap-1', { style: { maxHeight: '40vh', overflow: 'auto' } });
      const counter = SP.el('strong');
      const input = SP.el('input.input', { type: 'search', placeholder: 'Search or type IMEI / serial…', inputmode: 'numeric' });

      const pool = () => SP.store.state.devices.filter((d) => d.productId === productId
        && (!warehouseId || d.warehouseId === warehouseId)
        && statuses.includes(d.status));

      function draw() {
        const q = input.value.trim();
        SP.clear(listHost);
        let rows = pool();
        if (q) rows = rows.filter((d) => `${d.imei1} ${d.imei2} ${d.serial}`.includes(q));
        counter.textContent = `${selected.size}${qty ? ` / ${qty}` : ''} selected`;
        if (!rows.length) listHost.appendChild(SP.empty({ icon: 'layers', title: 'No devices available', body: 'No registered devices match at this warehouse.' }));
        for (const d of rows.slice(0, 80)) {
          const on = selected.has(d.id);
          listHost.appendChild(SP.el('button.lrow', {
            type: 'button',
            onclick: () => {
              if (selected.has(d.id)) selected.delete(d.id);
              else { if (qty && selected.size >= qty) { SP.ui.toast({ tone: 'warn', title: `Only ${qty} needed` }); return; } selected.add(d.id); }
              draw();
            },
          },
            SP.el('span.lrow__ico', { class: on ? 'is-on' : '' }, SP.icon(on ? 'check' : 'layers')),
            SP.el('div.lrow__main', SP.el('strong', d.imei1 || d.serial || d.id), SP.el('small', [d.imei2 && `IMEI2 ${d.imei2}`, d.serial && `SN ${d.serial}`, SP.deviceStatus(d.status).label].filter(Boolean).join(' · '))),
          ));
        }
      }
      input.addEventListener('input', SP.debounce(draw, 100));
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        // Typed/scanned an exact IMEI: select it immediately.
        const hit = pool().find((d) => [d.imei1, d.imei2, d.serial].includes(input.value.trim()));
        if (hit && !selected.has(hit.id)) { selected.add(hit.id); input.value = ''; draw(); SP.buzz(10); }
      });
      draw();

      const shell = SP.sheet({
        title: title || 'Select devices',
        content: SP.el('div.stack.gap-3',
          SP.el('div.row', { style: { justifyContent: 'space-between', alignItems: 'center' } }, counter,
            'BarcodeDetector' in window ? SP.el('button.btn.btn--sm.btn--ghost', {
              type: 'button', onclick: () => scanInto(input, draw),
            }, SP.icon('target'), 'Scan') : null,
          ),
          input, listHost),
        actions: [
          SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => shell.close(null) }, 'Cancel'),
          SP.el('button.btn.btn--primary', {
            type: 'button',
            onclick: () => {
              const devices = [...selected].map((id) => SP.store.state.devices.find((d) => d.id === id)).filter(Boolean);
              shell.close(devices);
            },
          }, `Use selected`),
        ],
        onClose: (r) => resolve(Array.isArray(r) ? r : null),
      });
    });
  }

  /** Camera barcode scanning where the platform supports it. */
  async function scanInto(input, after) {
    if (!('BarcodeDetector' in window)) {
      SP.ui.toast({ tone: 'info', title: 'Camera scanning unavailable', body: 'This browser has no BarcodeDetector. Type the code instead.' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = SP.el('video', { autoplay: true, playsinline: true, style: { width: '100%', borderRadius: '12px', background: '#000' } });
      video.srcObject = stream;
      const status = SP.el('p.tiny.mute', 'Point the camera at a barcode or QR code…');
      const shell = SP.sheet({ title: 'Scan', content: SP.el('div.stack.gap-2', video, status), onClose: () => stream.getTracks().forEach((t) => t.stop()) });
      const detector = new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'code_128', 'code_39', 'upc_a', 'itf'] });
      const tick = async () => {
        if (!shell.el.isConnected) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            input.value = codes[0].rawValue;
            SP.buzz([10, 40, 10]);
            shell.close();
            after?.(codes[0].rawValue);
            return;
          }
        } catch { /* keep trying */ }
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      SP.ui.toast({ tone: 'warn', title: 'Camera unavailable', body: e.message });
    }
  }

  /** Filter bar: search + chips, reruns `onChange(state)`. */
  function filterBar({ placeholder = 'Search…', filters = [], onChange }) {
    const state = { q: '', f: {} };
    const q = SP.el('input.input', { type: 'search', placeholder, 'aria-label': placeholder });
    q.addEventListener('input', SP.debounce(() => { state.q = q.value.trim().toLowerCase(); onChange(state); }, 160));
    const wrap = SP.el('div.stack.gap-2', SP.el('div.searchbar', SP.icon('search'), q));
    if (filters.length) {
      const chipHost = SP.el('div.chips');
      for (const f of filters) {
        state.f[f.key] = f.value ?? 'all';
        chipHost.appendChild(SP.chipRow(
          [{ value: 'all', label: f.allLabel || `All ${f.label}` }, ...f.options],
          state.f[f.key],
          (v) => { state.f[f.key] = v; onChange(state); },
        ));
      }
      wrap.appendChild(chipHost);
    }
    return { el: wrap, state };
  }

  /** Timeline renderer (movements / history entries). */
  function timeline(items) {
    const wrap = SP.el('div.tline');
    for (const it of items) {
      wrap.appendChild(SP.el('div.tline__item',
        SP.el('span.tline__dot', { class: it.tone ? `tline__dot--${it.tone}` : '' }),
        SP.el('div.tline__body',
          SP.el('div.tline__head', SP.el('strong', it.title), SP.el('span.tiny.mute', SP.fmt.dateTime(it.at))),
          it.body ? SP.el('p.tline__text', it.body) : null,
          it.meta ? SP.el('p.tiny.mute', it.meta) : null,
        ),
      ));
    }
    if (!items.length) wrap.appendChild(SP.empty({ icon: 'history', title: 'No history yet', body: 'Activity will appear here.' }));
    return wrap;
  }

  /** Adapters onto charts.js with a friendlier {label,value,color} shape. */
  function hbars(items, format) {
    return SP.charts.hbars({
      data: items.map((i) => ({ label: i.label, value: i.value, colour: i.color || i.colour })),
      format,
    });
  }
  function stackedParts(parts, opts = {}) {
    return SP.charts.stacked({
      rows: [{ label: opts.label || '', parts: parts.map((p) => ({ label: p.name || p.label, value: p.value, colour: p.color || p.colour })) }],
      rowH: opts.rowH || 30,
      format: opts.format,
    });
  }

  return { warehouseSelect, badge, tag, kpi, pageHead, pickProduct, pickDevices, scanInto, filterBar, timeline, hbars, stackedParts };
})();
