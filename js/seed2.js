/**
 * seed2.js — converts the bundled v1 sheet snapshot (SP.SEED) into the
 * StockPilot 2.0 schema: warehouses, one product per SKU × colour variant,
 * and opening movements so every seeded unit is ledger-explainable.
 *
 * The snapshot is DEMO DATA: it exists so the app is useful on first run.
 * It is labelled as such in the UI and can be wiped from Settings → Data.
 */
window.SP = window.SP || {};

SP.seed2 = (() => {

  /** Reference unit cost heuristic carried over from v1 config. */
  function estimateCost(sku) {
    const m = /(\d+)\s*\|\s*(\d+)\s*GB/i.exec(sku.specs || '');
    const ram = m ? Number(m[1]) : 8;
    const storage = m ? Number(m[2]) : 128;
    const base = 4200 + ram * 210 + storage * 3.4;
    const premium = /PAD|TAB|17T|MAGIC 8|PRO\+/i.test(sku.sku || '') ? 1.42 : 1;
    return Math.round(base * premium / 50) * 50;
  }

  function hydrate() {
    const seed = SP.SEED;
    if (!seed || !Array.isArray(seed.skus) || !seed.skus.length) return false;

    const now = Date.now();
    const whColor = { MAIN: '#5b8cff', ADMIN: '#a78bfa', ALPANA: '#34d399', NAZRUL: '#fbbf24' };

    const warehouses = (seed.warehouses || []).map((w) => ({
      id: w.id, code: w.id, name: w.label || w.id, type: 'warehouse',
      address: '', phone: '', managerId: null,
      color: whColor[w.id] || '#5b8cff', capacity: 0, active: true, createdAt: now,
    }));
    if (!warehouses.length) warehouses.push({ id: 'MAIN', code: 'MAIN', name: 'Main Warehouse', type: 'warehouse', address: '', phone: '', managerId: null, color: '#5b8cff', capacity: 0, active: true, createdAt: now });

    const products = [];
    const movements = [];
    let movSeq = 0;

    for (const s of seed.skus) {
      const spec = SP.fmt.parseSpec(s.specs || '');
      const colourQtys = Object.entries(s.colours || {}).filter(([, q]) => Number(q) > 0);
      const variants = colourQtys.length ? colourQtys : [['', Object.values(s.byWarehouse || s.byWh || {}).reduce((a, b) => a + (Number(b) || 0), 0)]];

      for (const [colour, colourQty] of variants) {
        const pid = `${s.id}${colour ? `-${colour.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}` : ''}`;
        const base = estimateCost(s);
        products.push({
          id: pid,
          sku: s.sku,
          name: `${s.sku} ${s.specs || ''}${colour ? ` · ${colour}` : ''}`.trim(),
          brand: s.brand || '', model: s.sku,
          category: 'Smartphone',
          variant: '', network: /5G/i.test(s.sku) ? '5G' : '4G',
          ram: spec.ram, storage: spec.storage,
          color: colour || '', country: '', condition: 'new',
          cost: base, price: Math.round(base * 1.08 / 50) * 50,
          barcode: '', description: '', status: 'active',
          stockType: 'regular',
          minStock: 0, maxStock: 0, reorderPoint: 10,
          leadTimeDays: 7, preferredSupplierId: null,
          images: [], attributes: {}, serialized: false,
          notes: '', archived: false,
          createdAt: now, updatedAt: now,
        });

        // Distribute each warehouse's SKU units across colours proportionally.
        const byWh = s.byWarehouse || s.byWh || {};
        const totalColour = SP.sum(variants, ([, q]) => Number(q) || 0) || 1;
        for (const [whId, whQtyRaw] of Object.entries(byWh)) {
          const whQty = Number(whQtyRaw) || 0;
          if (whQty <= 0) continue;
          let qty = Math.round(whQty * (Number(colourQty) / totalColour));
          if (variants.length === 1) qty = whQty;
          if (qty <= 0) continue;
          movSeq += 1;
          movements.push({
            id: SP.uid('mov'), ref: `MOV-OPEN-${String(movSeq).padStart(4, '0')}`,
            ts: now, type: 'opening', direction: 1,
            productId: pid, qty, warehouseId: whId, locationId: null,
            deviceIds: [], unitCost: base,
            refType: 'snapshot', refId: seed.docId,
            reason: `Opening stock from sheet snapshot (${seed.sourceDate || 'demo'})`,
            notes: 'DEMO DATA', by: 'system', before: 0, after: qty,
          });
        }
      }
    }

    SP.store.update(null, (st) => {
      st.warehouses = warehouses;
      st.products = products;
      st.movements = movements;
      st.counters.movement = movSeq;
      st.settings.demo = true;
      st.sheet.lastSync = seed.exportedAt ? Date.parse(seed.exportedAt) : null;
      st.sheet.mode = 'snapshot';
    });
    SP.store.audit('system.seed', 'snapshot', `${products.length} products · ${movements.length} opening movements (demo data)`, 'system');
    return true;
  }

  return { hydrate };
})();
