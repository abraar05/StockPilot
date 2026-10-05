/**
 * modules/warehouses.js — warehouse network: dashboards, valuation,
 * capacity and per-warehouse stock.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.warehouses = (() => {
  const MOD = { title: 'Warehouses', subtitle: () => `${SP.fmt.pluralise(SP.store.state.warehouses.length, 'site')}`, mount, editWarehouse };

  function mount(params) {
    if (params?.id) return detail(params.id);
    const root = SP.el('div.stack.gap-3');
    const s = SP.store.state;

    const actions = [];
    if (SP.auth.can('warehouses:manage')) {
      actions.push(SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => editWarehouse(null) }, SP.icon('plus'), 'New warehouse'));
    }
    root.appendChild(SP.ui2.pageHead({ title: 'Warehouses', sub: 'Company → warehouse → zone → rack → shelf → bin.', actions }));

    const grid = SP.el('div.grid.grid--2.gap-3');
    for (const w of s.warehouses) {
      const sum = SP.ledger.summary({ warehouse: w.id });
      const locs = s.locations.filter((l) => l.warehouseId === w.id);
      const usedBins = new Set(s.devices.filter((d) => d.warehouseId === w.id && d.locationId).map((d) => d.locationId));
      grid.appendChild(SP.el('button.card.card--pad.whcard', { type: 'button', onclick: () => SP.router.go('warehouses', { id: w.id }) },
        SP.el('div.row', { style: { alignItems: 'center', gap: 'var(--sp-2)' } },
          SP.el('span.lrow__ico', { style: { background: `${(w.color || '#5b8cff')}22`, color: w.color || '#5b8cff' } }, SP.icon('home')),
          SP.el('div.grow', SP.el('strong', w.name), SP.el('small.mute', { style: { display: 'block' } }, [w.type, w.address].filter(Boolean).join(' · ') || '—')),
          w.active ? null : SP.ui2.tag('Inactive', 'mute')),
        SP.el('div.whcard__stats',
          SP.el('div', SP.el('b', SP.fmt.n(sum.gross)), SP.el('span', 'units')),
          SP.auth.can('cost:view') ? SP.el('div', SP.el('b', SP.fmt.moneyCompact(sum.value)), SP.el('span', 'value')) : null,
          SP.el('div', SP.el('b', { style: { color: sum.critical ? 'var(--danger)' : undefined } }, SP.fmt.n(sum.critical)), SP.el('span', 'out')),
          SP.el('div', SP.el('b', SP.fmt.n(locs.length)), SP.el('span', 'locations')),
        ),
        w.capacity ? SP.el('div.meter', SP.el('div.meter__bar',
          SP.el('i', { class: 'on', style: { width: `${Math.min(100, usedBins.size / w.capacity * 100)}%` } })),
          SP.el('span.meter__text', `Capacity ${usedBins.size}/${w.capacity}`)) : null,
      ));
    }
    root.appendChild(grid);
    return root;
  }

  /* ────────────────────────────────────────────────────────── detail */

  function detail(id) {
    const w = SP.store.state.warehouses.find((x) => x.id === id);
    if (!w) return SP.empty({ icon: 'home', title: 'Warehouse not found', action: { label: 'All warehouses', onClick: () => SP.router.go('warehouses') } });
    const s = SP.store.state;
    const sum = SP.ledger.summary({ warehouse: id });
    const root = SP.el('div.stack.gap-4');

    root.appendChild(SP.ui2.pageHead({
      title: w.name, sub: [w.address, w.phone].filter(Boolean).join(' · ') || w.code,
      actions: [
        SP.auth.can('warehouses:manage') ? SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => editWarehouse(w) }, SP.icon('edit'), 'Edit') : null,
        SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => SP.router.go('locations', { wh: id }) }, SP.icon('pin'), 'Locations'),
      ],
    }));

    root.appendChild(SP.el('div.kpi-grid',
      SP.ui2.kpi({ label: 'Units on hand', value: SP.fmt.n(sum.gross), icon: 'box' }),
      SP.auth.can('cost:view') ? SP.ui2.kpi({ label: 'Stock value', value: SP.fmt.moneyCompact(sum.value), icon: 'database' }) : null,
      SP.ui2.kpi({ label: 'In transit', value: SP.fmt.n(sum.inTransit), icon: 'swap' }),
      SP.ui2.kpi({ label: 'Out of stock', value: SP.fmt.n(sum.critical), tone: sum.critical ? 'danger' : null, icon: 'alert' }),
    ));

    /* top stock at this warehouse */
    const map = SP.ledger.stockMap(id);
    const top = [...map.entries()].filter(([, q]) => q > 0)
      .map(([pid, qty]) => ({ p: s.products.find((x) => x.id === pid), qty }))
      .filter((r) => r.p).sort((a, b) => b.qty - a.qty).slice(0, 15);

    root.appendChild(SP.el('div.grid.grid--2.gap-3',
      SP.el('div.card.card--pad',
        SP.el('div.row', { style: { justifyContent: 'space-between', marginBottom: 'var(--sp-2)' } },
          SP.el('strong', 'Largest holdings'),
          SP.el('button.btn.btn--quiet.btn--sm', { type: 'button', onclick: () => SP.router.go('inventory', { wh: id }) }, 'Full inventory')),
        top.length ? SP.ui2.hbars(top.map((r) => ({ label: r.p.name, value: r.qty, color: w.color || '#5b8cff' }))) : SP.el('p.tiny.mute', 'No stock here yet.')),
      SP.el('div.card.card--pad',
        SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Locations'),
        (() => {
          const locs = s.locations.filter((l) => l.warehouseId === id);
          if (!locs.length) return SP.empty({ icon: 'pin', title: 'No locations', body: 'Create zones, racks, shelves and bins.', action: SP.auth.can('warehouses:manage') ? { label: 'Add locations', onClick: () => SP.router.go('locations', { wh: id }) } : null });
          return SP.el('div.stack.gap-1', ...locs.slice(0, 10).map((l) => SP.el('div.lrow',
            SP.el('span.lrow__ico', SP.icon('pin')),
            SP.el('div.lrow__main', SP.el('strong', l.code), SP.el('small', [l.zone && `Zone ${l.zone}`, l.rack && `Rack ${l.rack}`, l.shelf && `Shelf ${l.shelf}`, l.bin && `Bin ${l.bin}`].filter(Boolean).join(' · '))),
            SP.el('span.tiny.mute', `${s.devices.filter((d) => d.locationId === l.id).length} devices`))));
        })()),
    ));

    /* recent activity here */
    const moves = s.movements.filter((m) => m.warehouseId === id).slice(-10).reverse();
    root.appendChild(SP.el('div.card.card--pad',
      SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Recent activity'),
      SP.ui2.timeline(moves.map((m) => ({
        at: m.ts, tone: SP.movementType(m.type).tone,
        title: `${SP.movementType(m.type).label} · ${s.products.find((x) => x.id === m.productId)?.name || '?'}`,
        body: `${m.direction > 0 ? '+' : m.direction < 0 ? '−' : ''}${m.qty} · balance ${m.after}`,
        meta: `${m.ref} · ${m.by}`,
      })))));
    return root;
  }

  /* ────────────────────────────────────────────────────────── editor */

  function editWarehouse(w) {
    const isNew = !w;
    w = w || { id: null, code: '', name: '', type: 'warehouse', address: '', phone: '', color: '#5b8cff', capacity: 0, active: true };
    return SP.modal({
      title: isNew ? 'New warehouse' : `Edit ${w.name}`, icon: 'home',
      okLabel: isNew ? 'Create' : 'Save',
      fields: [
        { key: 'name', label: 'Name', required: true, value: w.name, placeholder: 'e.g. Dhaka Warehouse' },
        { key: 'code', label: 'Code', required: true, value: w.code, placeholder: 'e.g. DHK' },
        { key: 'type', label: 'Type', type: 'select', value: w.type, options: [{ value: 'warehouse', label: 'Warehouse' }, { value: 'store', label: 'Store' }, { value: 'van', label: 'Van / mobile' }] },
        { key: 'address', label: 'Address', value: w.address },
        { key: 'phone', label: 'Phone', value: w.phone, inputmode: 'tel' },
        { key: 'capacity', label: 'Capacity (locations)', type: 'number', min: 0, value: w.capacity },
      ],
      onOk: async (v) => {
        const code = String(v.code).trim().toUpperCase();
        const clash = SP.store.state.warehouses.find((x) => x.code === code && x.id !== w.id);
        if (clash) throw new Error(`Code ${code} is already used by ${clash.name}.`);
        if (isNew) {
          const rec = { id: code, code, name: v.name, type: v.type, address: v.address || '', phone: v.phone || '', managerId: null, color: SP.auth.randomColour(), capacity: v.capacity || 0, active: true, createdAt: Date.now() };
          SP.store.update(['warehouses'], (s) => { s.warehouses.push(rec); });
          SP.store.audit('warehouse.create', code, v.name);
          SP.ui.toast({ tone: 'ok', title: 'Warehouse created' });
        } else {
          SP.store.update(['warehouses'], (s) => {
            const t = s.warehouses.find((x) => x.id === w.id);
            if (t) Object.assign(t, { name: v.name, code, type: v.type, address: v.address, phone: v.phone, capacity: v.capacity });
          });
          SP.store.audit('warehouse.update', code, v.name);
          SP.ui.toast({ tone: 'ok', title: 'Warehouse saved' });
        }
        SP.router.refresh();
      },
    });
  }

  return MOD;
})();

/* ══════════════════════════════════════════════════════════ LOCATIONS */

SP.modules.locations = (() => {
  const state = { warehouse: null };
  const MOD = { title: 'Locations', subtitle: () => `${SP.fmt.pluralise(SP.store.state.locations.length, 'location')}`, mount, editLocation, relocateForm };

  function mount(params) {
    if (params?.wh) state.warehouse = params.wh;
    const root = SP.el('div.stack.gap-3');
    const s = SP.store.state;
    const whId = state.warehouse || s.warehouses[0]?.id;

    const actions = [];
    if (SP.auth.can('warehouses:manage')) {
      actions.push(SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => editLocation(null, whId) }, SP.icon('plus'), 'New location'));
      actions.push(SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => generateGrid(whId) }, SP.icon('layers'), 'Generate grid'));
    }
    root.appendChild(SP.ui2.pageHead({ title: 'Locations', sub: 'Zone → Rack → Shelf → Bin', actions }));

    const locs = s.locations.filter((l) => l.warehouseId === whId);
    const grouped = SP.groupBy(locs, (l) => l.zone || '—');

    root.appendChild(SP.el('div.row.gap-2', SP.ui2.warehouseSelect({
      value: whId, allowAll: false, onChange: (v) => { state.warehouse = v; SP.router.refresh(); },
    })));

    if (!locs.length) {
      root.appendChild(SP.empty({
        icon: 'pin', title: 'No locations yet',
        body: 'Create individual locations or generate a zone/rack/shelf/bin grid in one go.',
        action: SP.auth.can('warehouses:manage') ? { label: 'Generate a grid', onClick: () => generateGrid(whId) } : null,
      }));
      return root;
    }

    for (const [zone, list] of Object.entries(grouped)) {
      root.appendChild(SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', `Zone ${zone}`), SP.el('p', `${list.length} locations`))),
        SP.el('div.grid.grid--3.gap-2', ...list.map((l) => {
          const devices = s.devices.filter((d) => d.locationId === l.id);
          return SP.el('button.card.card--pad', { type: 'button', style: { textAlign: 'left' }, onclick: () => locationSheet(l) },
            SP.el('div.row', { style: { justifyContent: 'space-between' } },
              SP.el('strong', l.code),
              SP.el('span.tiny.mute', `${devices.length} devices`)),
            SP.el('small.mute', [l.rack && `Rack ${l.rack}`, l.shelf && `Shelf ${l.shelf}`, l.bin && `Bin ${l.bin}`].filter(Boolean).join(' · ') || '—'));
        }))));
    }
    return root;
  }

  function locationSheet(l) {
    const s = SP.store.state;
    const devices = s.devices.filter((d) => d.locationId === l.id);
    const shell = SP.sheet({
      title: l.code,
      subtitle: s.warehouses.find((w) => w.id === l.warehouseId)?.name,
      content: SP.el('div.stack.gap-2',
        SP.el('dl.kv',
          SP.el('dt', 'Zone / Rack / Shelf / Bin'), SP.el('dd', [l.zone, l.rack, l.shelf, l.bin].filter(Boolean).join(' / ') || '—'),
          SP.el('dt', 'Devices stored'), SP.el('dd', SP.fmt.n(devices.length))),
        devices.length ? SP.el('div.stack.gap-1', ...devices.slice(0, 20).map((d) => {
          const p = s.products.find((x) => x.id === d.productId);
          return SP.el('button.lrow', { type: 'button', onclick: () => { shell.close(); SP.modules.devices.openDevice(d.id); } },
            SP.el('span.lrow__ico', SP.icon('layers')),
            SP.el('div.lrow__main', SP.el('strong', d.imei1 || d.serial), SP.el('small', p?.name || '')),
            SP.ui2.tag(SP.deviceStatus(d.status).label, SP.deviceStatus(d.status).tone));
        })) : SP.el('p.tiny.mute', 'No devices at this location.')),
      actions: SP.auth.can('warehouses:manage') ? [
        SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => { shell.close(); editLocation(l, l.warehouseId); } }, SP.icon('edit'), 'Edit'),
        SP.el('button.btn.btn--danger', {
          type: 'button',
          onclick: async () => {
            if (devices.length) { SP.ui.toast({ tone: 'warn', title: 'Location not empty', body: 'Relocate devices first.' }); return; }
            const ok = await SP.modal({ title: `Delete ${l.code}?`, body: 'This cannot be undone.', tone: 'danger', okLabel: 'Delete' });
            if (!ok) return;
            SP.store.update(['locations'], (st) => { st.locations = st.locations.filter((x) => x.id !== l.id); });
            SP.store.audit('location.delete', l.code, '');
            shell.close(); SP.router.refresh();
          },
        }, SP.icon('trash'), 'Delete'),
      ] : null,
    });
  }

  function editLocation(l, warehouseId) {
    const isNew = !l;
    l = l || { id: null, warehouseId, zone: '', rack: '', shelf: '', bin: '', capacity: 0 };
    return SP.modal({
      title: isNew ? 'New location' : `Edit ${l.code}`, icon: 'pin',
      okLabel: isNew ? 'Create' : 'Save',
      fields: [
        { key: 'zone', label: 'Zone', value: l.zone, placeholder: 'A' },
        { key: 'rack', label: 'Rack', value: l.rack, placeholder: '01' },
        { key: 'shelf', label: 'Shelf', value: l.shelf, placeholder: '02' },
        { key: 'bin', label: 'Bin', value: l.bin, placeholder: '05' },
      ],
      onOk: async (v) => {
        const code = [v.zone && `Z${v.zone}`, v.rack && `R${v.rack}`, v.shelf && `S${v.shelf}`, v.bin && `B${v.bin}`].filter(Boolean).join('-') || 'LOC';
        if (isNew) {
          SP.store.update(['locations'], (s) => {
            s.locations.push({ id: SP.uid('loc'), warehouseId, zone: v.zone || '', rack: v.rack || '', shelf: v.shelf || '', bin: v.bin || '', code, capacity: 0, notes: '' });
          });
          SP.store.audit('location.create', code, warehouseId);
        } else {
          SP.store.update(['locations'], (s) => {
            const t = s.locations.find((x) => x.id === l.id);
            if (t) Object.assign(t, { zone: v.zone, rack: v.rack, shelf: v.shelf, bin: v.bin, code });
          });
          SP.store.audit('location.update', code, '');
        }
        SP.router.refresh();
      },
    });
  }

  function generateGrid(warehouseId) {
    return SP.modal({
      title: 'Generate a location grid',
      subtitle: 'Creates zone/rack/shelf/bin combinations in one go.',
      icon: 'layers', okLabel: 'Generate',
      fields: [
        { key: 'zones', label: 'Zones (comma separated)', value: 'A', required: true, placeholder: 'A,B,C' },
        { key: 'racks', label: 'Racks per zone', type: 'number', min: 1, max: 99, value: 2, required: true },
        { key: 'shelves', label: 'Shelves per rack', type: 'number', min: 1, max: 99, value: 2, required: true },
        { key: 'bins', label: 'Bins per shelf', type: 'number', min: 1, max: 99, value: 3, required: true },
      ],
      onOk: async (v) => {
        const zones = String(v.zones).split(',').map((z) => z.trim()).filter(Boolean);
        let n = 0;
        SP.store.update(['locations'], (s) => {
          for (const z of zones) {
            for (let r = 1; r <= v.racks; r += 1) {
              for (let sh = 1; sh <= v.shelves; sh += 1) {
                for (let b = 1; b <= v.bins; b += 1) {
                  const pad = (x) => String(x).padStart(2, '0');
                  const code = `Z${z}-R${pad(r)}-S${pad(sh)}-B${pad(b)}`;
                  if (s.locations.some((l) => l.warehouseId === warehouseId && l.code === code)) continue;
                  s.locations.push({ id: SP.uid('loc'), warehouseId, zone: z, rack: pad(r), shelf: pad(sh), bin: pad(b), code, capacity: 0, notes: '' });
                  n += 1;
                }
              }
            }
          }
        });
        SP.store.audit('location.generate', `${n} locations`, warehouseId);
        SP.ui.toast({ tone: 'ok', title: `${n} locations created` });
        SP.router.refresh();
      },
    });
  }

  /** Move devices to a different location. */
  async function relocateForm(deviceIds) {
    const s = SP.store.state;
    const res = await SP.modal({
      title: `Relocate ${deviceIds.length} device${deviceIds.length === 1 ? '' : 's'}`, icon: 'pin', okLabel: 'Relocate',
      fields: [{
        key: 'locationId', label: 'Destination', type: 'select', required: true,
        options: s.locations.map((l) => ({ value: l.id, label: `${s.warehouses.find((w) => w.id === l.warehouseId)?.code || ''} · ${l.code}` })),
      }],
      onOk: async (v) => {
        const loc = s.locations.find((x) => x.id === v.locationId);
        SP.store.update(['devices'], (st) => {
          for (const id of deviceIds) {
            const d = st.devices.find((x) => x.id === id);
            if (d) { d.locationId = v.locationId; d.warehouseId = loc.warehouseId; d.updatedAt = Date.now(); }
          }
        });
        SP.store.audit('location.relocate', `${deviceIds.length} devices`, `→ ${loc.code}`);
        SP.ui.toast({ tone: 'ok', title: 'Relocated', body: `→ ${loc.code}` });
      },
    });
    return res;
  }

  return MOD;
})();
