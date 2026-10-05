/**
 * modules/devices.js — device-level tracking: IMEI / serial registry,
 * scanning, duplicate detection, per-device movement history, bulk import.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.devices = (() => {
  const state = { q: '', status: 'all', warehouse: '*', dupesOnly: false };

  const MOD = {
    title: 'Devices / IMEI',
    subtitle: () => `${SP.fmt.pluralise(SP.store.state.devices.length, 'registered device')}`,
    mount, openDevice, registerForm, quickFind,
  };

  function rows() {
    const s = SP.store.state;
    let list = [...s.devices];
    if (state.dupesOnly) {
      const dupes = SP.imei.duplicates();
      const ids = new Set([...dupes.values()].flat().map((d) => d.id));
      list = list.filter((d) => ids.has(d.id));
    }
    if (state.q) {
      const q = state.q;
      list = list.filter((d) => {
        const p = s.products.find((x) => x.id === d.productId);
        return `${d.imei1} ${d.imei2} ${d.serial} ${p?.name} ${p?.sku}`.toLowerCase().includes(q);
      });
    }
    if (state.status !== 'all') list = list.filter((d) => d.status === state.status);
    if (state.warehouse !== '*') list = list.filter((d) => d.warehouseId === state.warehouse);
    return list.sort((a, b) => b.receivedAt - a.receivedAt);
  }

  function mount(params) {
    if (params?.q) state.q = params.q.toLowerCase();
    if (params?.dupes) state.dupesOnly = true;
    const root = SP.el('div.stack.gap-3');

    const dupes = SP.imei.duplicates();
    if (dupes.size) {
      root.appendChild(SP.el('div.callout', { dataset: { tone: 'danger' } },
        SP.el('span.callout__ico', SP.icon('alert')),
        SP.el('div.callout__body',
          SP.el('strong', `${SP.fmt.pluralise(dupes.size, 'duplicate IMEI')} detected`),
          SP.el('p', 'The same IMEI is registered on more than one device. Investigate before any sale.')),
        SP.el('button.btn.btn--sm.btn--ghost', {
          type: 'button', onclick: () => { state.dupesOnly = true; table.refresh(); },
        }, 'Show only duplicates')));
    }

    const table = SP.table.create({
      columns: [
        { key: 'imei1', label: 'IMEI / Serial', value: (d) => d.imei1, render: (d) => SP.el('div.stack', SP.el('strong', d.imei1 || d.serial || '—'), SP.el('small.mute', [d.imei2 && `IMEI2 ${d.imei2}`, d.serial && d.imei1 ? `SN ${d.serial}` : ''].filter(Boolean).join(' · '))) },
        { key: 'product', label: 'Product', value: (d) => productOf(d)?.name || '', render: (d) => { const p = productOf(d); return SP.el('span', p?.name || '—'); } },
        { key: 'warehouse', label: 'Warehouse', width: '120px', value: (d) => whOf(d)?.name || '', render: (d) => whOf(d)?.name || '—' },
        { key: 'location', label: 'Location', width: '100px', value: (d) => locOf(d), render: (d) => locOf(d) || SP.el('span.mute', '—') },
        { key: 'status', label: 'Status', width: '110px', value: (d) => d.status, render: (d) => SP.ui2.tag(SP.deviceStatus(d.status).label, SP.deviceStatus(d.status).tone) },
        { key: 'receivedAt', label: 'Received', width: '110px', value: (d) => d.receivedAt, render: (d) => SP.el('span.tiny', SP.fmt.date(d.receivedAt)) },
      ],
      rows,
      rowId: (d) => d.id,
      defaultSort: 'receivedAt', defaultDir: 'desc',
      selectable: true,
      empty: { icon: 'layers', title: 'No devices registered', body: 'Register devices individually, scan them, or bulk-import a spreadsheet.' },
      onRowClick: (d) => openDevice(d.id),
      bulkActions: [
        { id: 'status', label: 'Change status', icon: 'edit', run: bulkStatus },
        { id: 'export', label: 'Export CSV', icon: 'download', run: exportDevices },
      ],
    });

    const filters = SP.ui2.filterBar({
      placeholder: 'Search IMEI, serial, product…',
      onChange: (f) => { state.q = f.q; table.refresh(); },
    });

    const scopeRow = SP.el('div.row.gap-2', { style: { flexWrap: 'wrap', alignItems: 'center' } },
      SP.ui2.warehouseSelect({ value: state.warehouse, onChange: (v) => { state.warehouse = v; table.refresh(); } }),
      SP.el('select.select', { onchange: (e) => { state.status = e.target.value; table.refresh(); } },
        SP.el('option', { value: 'all' }, 'All statuses'),
        ...SP.DEVICE_STATUS.map((st) => SP.el('option', { value: st.id, selected: state.status === st.id }, st.label))),
      state.dupesOnly ? SP.el('button.chip.is-active', { type: 'button', onclick: () => { state.dupesOnly = false; table.refresh(); } }, 'Duplicates only ×') : null,
    );

    const actions = [];
    if (SP.auth.can('devices:create')) {
      actions.push(SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => registerForm() }, SP.icon('plus'), 'Register device'));
      if ('BarcodeDetector' in window) actions.push(SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: scanAndFind }, SP.icon('target'), 'Scan'));
    }
    if (SP.auth.can('devices:import')) actions.push(SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => SP.modules.products.openImport('devices') }, SP.icon('file'), 'Bulk import'));

    root.append(
      SP.ui2.pageHead({ title: 'Devices / IMEI', sub: 'Every physical device, individually tracked.', actions }),
      filters.el, scopeRow, table.el,
    );
    return root;
  }

  const productOf = (d) => SP.store.state.products.find((x) => x.id === d.productId);
  const whOf = (d) => SP.store.state.warehouses.find((x) => x.id === d.warehouseId);
  const locOf = (d) => {
    const l = SP.store.state.locations.find((x) => x.id === d.locationId);
    return l ? l.code : '';
  };

  /* ─────────────────────────────────────────────────── registration */

  async function registerForm(preset = {}) {
    let product = preset.productId ? SP.store.state.products.find((x) => x.id === preset.productId) : null;
    if (!product) {
      product = await SP.ui2.pickProduct({ title: 'Register device — which product?' });
      if (!product) return;
      if (!product.serialized) {
        const ok = await SP.modal({
          title: 'Enable IMEI tracking?',
          body: `${product.name} is not IMEI-tracked yet. Enable tracking to register devices against it.`,
          okLabel: 'Enable & continue', icon: 'layers',
        });
        if (!ok) return;
        SP.store.update(['products'], (s) => { const t = s.products.find((x) => x.id === product.id); if (t) t.serialized = true; });
      }
    }

    const res = await SP.modal({
      title: `Register device — ${product.name}`,
      icon: 'layers',
      okLabel: 'Register',
      fields: [
        { key: 'imei1', label: 'IMEI 1', required: true, inputmode: 'numeric', placeholder: '15 digits', validate: (raw) => { const v = SP.imei.clean(raw); if (v.length !== 15) return 'IMEI must be 15 digits'; if (!SP.imei.valid(v)) return 'Fails the Luhn check — double-check the digits'; if (SP.imei.find(v).length) return 'This IMEI is already registered'; return null; } },
        { key: 'imei2', label: 'IMEI 2 (optional)', inputmode: 'numeric', validate: (raw) => { const v = SP.imei.clean(raw); if (!v) return null; if (v.length !== 15) return 'IMEI must be 15 digits'; if (SP.imei.find(v).length) return 'This IMEI is already registered'; return null; } },
        { key: 'serial', label: 'Serial number (optional)' },
        { key: 'warehouseId', label: 'Warehouse', type: 'select', required: true, options: SP.store.state.warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: w.name })), value: preset.warehouseId || SP.store.state.warehouses[0]?.id },
        { key: 'condition', label: 'Condition', type: 'select', value: 'new', options: [{ value: 'new', label: 'New' }, { value: 'used', label: 'Used' }, { value: 'refurbished', label: 'Refurbished' }] },
        { key: 'cost', label: 'Unit cost (৳)', type: 'number', min: 0, value: product.cost },
      ],
      onOk: async (v) => {
        const device = {
          id: SP.uid('dev'),
          imei1: SP.imei.clean(v.imei1), imei2: SP.imei.clean(v.imei2), serial: v.serial || '',
          productId: product.id, warehouseId: v.warehouseId, locationId: null,
          status: 'available', condition: v.condition, cost: v.cost || 0,
          purchaseRef: null, saleRef: null,
          receivedAt: Date.now(), updatedAt: Date.now(), notes: '',
        };
        SP.store.update(['devices'], (s) => { s.devices.push(device); });
        SP.store.audit('device.register', device.imei1, product.name);
        SP.ui.toast({ tone: 'ok', title: 'Device registered', body: device.imei1 });
        SP.router.refresh();
      },
    });
    return res;
  }

  /* ─────────────────────────────────────────────────── device detail */

  function openDevice(id) {
    const d = SP.store.state.devices.find((x) => x.id === id);
    if (!d) return;
    const p = productOf(d);
    const w = whOf(d);
    const history = SP.store.state.movements.filter((m) => m.deviceIds?.includes(d.id)).sort((a, b) => b.ts - a.ts);

    const body = SP.el('div.stack.gap-3',
      SP.el('dl.kv',
        SP.el('dt', 'IMEI 1'), SP.el('dd', d.imei1 || '—'),
        SP.el('dt', 'IMEI 2'), SP.el('dd', d.imei2 || '—'),
        SP.el('dt', 'Serial'), SP.el('dd', d.serial || '—'),
        SP.el('dt', 'Product'), SP.el('dd', p?.name || '—'),
        SP.el('dt', 'Status'), SP.el('dd', SP.deviceStatus(d.status).label),
        SP.el('dt', 'Warehouse'), SP.el('dd', w?.name || '—'),
        SP.el('dt', 'Location'), SP.el('dd', locOf(d) || '—'),
        SP.el('dt', 'Condition'), SP.el('dd', SP.fmt.titleCase(d.condition || 'new')),
        SP.el('dt', 'Received'), SP.el('dd', SP.fmt.dateTime(d.receivedAt)),
        d.purchaseRef ? [SP.el('dt', 'Purchase ref'), SP.el('dd', d.purchaseRef)] : null,
        d.saleRef ? [SP.el('dt', 'Sale ref'), SP.el('dd', d.saleRef)] : null),
      SP.el('div',
        SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Movement history'),
        SP.ui2.timeline(history.map((m) => ({
          at: m.ts, tone: SP.movementType(m.type).tone,
          title: SP.movementType(m.type).label,
          body: `${SP.store.state.warehouses.find((x) => x.id === m.warehouseId)?.name || m.warehouseId}${m.reason ? ` · ${m.reason}` : ''}`,
          meta: `${m.ref} · ${m.by}`,
        })))),
    );

    const actions = [];
    if (SP.auth.can('devices:edit')) {
      actions.push(SP.el('button.btn.btn--ghost', {
        type: 'button',
        onclick: async () => {
          const res = await SP.modal({
            title: 'Change device status', icon: 'edit', okLabel: 'Save',
            fields: [
              { key: 'status', label: 'Status', type: 'select', value: d.status, options: SP.DEVICE_STATUS.map((s) => ({ value: s.id, label: s.label })) },
              { key: 'notes', label: 'Note', type: 'textarea', value: d.notes },
            ],
            onOk: async (v) => {
              SP.store.update(['devices'], (s) => {
                const t = s.devices.find((x) => x.id === d.id);
                Object.assign(t, { status: v.status, notes: v.notes, updatedAt: Date.now() });
              });
              SP.store.audit('device.status', d.imei1, `${d.status} → ${v.status}${v.notes ? ` · ${v.notes}` : ''}`);
              SP.ui.toast({ tone: 'ok', title: 'Device updated' });
            },
          });
          if (res) shell.close();
        },
      }, SP.icon('edit'), 'Change status'));
    }
    actions.push(SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => { shell.close(); if (p) SP.router.go('products', { id: p.id }); } }, 'Open product'));

    const shell = SP.sheet({ title: d.imei1 || d.serial || 'Device', subtitle: p?.name, content: body, actions });
  }

  /* ──────────────────────────────────────────────────────── scanning */

  async function scanAndFind() {
    const input = SP.el('input.input', { placeholder: 'Result appears here' });
    const shell = SP.sheet({ title: 'Scan IMEI / serial', content: SP.el('div.stack.gap-2', input) });
    SP.ui2.scanInto(input, (value) => {
      shell.close();
      quickFind(value);
    });
  }

  /** Global "find this IMEI" used by scan + command palette. */
  function quickFind(value) {
    const v = SP.imei.clean(value) || String(value || '').trim();
    const devices = SP.store.state.devices.filter((d) => [d.imei1, d.imei2, d.serial].includes(v));
    if (devices.length === 1) { openDevice(devices[0].id); return; }
    if (devices.length > 1) {
      state.q = v.toLowerCase(); state.dupesOnly = false;
      SP.router.go('devices', { q: v });
      return;
    }
    SP.ui.toast({ tone: 'warn', title: 'No device found', body: `${v} is not registered.` });
  }

  /* ────────────────────────────────────────────────────────── bulk */

  async function bulkStatus(list) {
    const res = await SP.modal({
      title: `Change status of ${list.length} devices`, icon: 'edit', okLabel: 'Apply',
      fields: [{ key: 'status', label: 'New status', type: 'select', options: SP.DEVICE_STATUS.map((s) => ({ value: s.id, label: s.label })), value: 'available' }],
      onOk: async (v) => {
        SP.store.update(['devices'], (s) => {
          for (const d of list) {
            const t = s.devices.find((x) => x.id === d.id);
            if (t) { t.status = v.status; t.updatedAt = Date.now(); }
          }
        });
        SP.store.audit('device.bulkstatus', `${list.length} devices`, `→ ${v.status}`);
      },
    });
    return res;
  }

  function exportDevices(list) {
    SP.impexp.downloadCSV(list.map((d) => ({
      imei1: d.imei1, imei2: d.imei2, serial: d.serial,
      product: productOf(d)?.name || '', warehouse: whOf(d)?.name || '',
      status: d.status, condition: d.condition, received: new Date(d.receivedAt).toISOString(),
    })), ['imei1', 'imei2', 'serial', 'product', 'warehouse', 'status', 'condition', 'received'],
      `stockpilot-devices-${Date.now()}.csv`);
  }

  return MOD;
})();
