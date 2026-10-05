/**
 * modules/products.js — product master & the 360° product page.
 * List, create/edit, images, import pipeline, and per-product tabs:
 * Overview · Stock · Devices · Movements · Transfers · Sales · Purchases · History
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.products = (() => {
  const state = { q: '', brand: 'all', category: 'all', showArchived: false };

  const MOD = {
    title: 'Products / SKUs',
    subtitle: () => `${SP.fmt.pluralise(SP.store.state.products.filter((p) => !p.archived).length, 'product')}`,
    mount,
    openImport,
    editProduct,
  };

  /* ════════════════════════════════════════════════════════════ LIST */

  function mount(params) {
    if (params?.id) return detail(params.id);
    if (params?.compose === 'import') setTimeout(openImport, 100);
    if (params?.compose === 'new') setTimeout(() => editProduct(null), 100);

    const root = SP.el('div.stack.gap-3');
    const rows = () => {
      let list = SP.store.state.products.filter((p) => state.showArchived || !p.archived);
      if (state.q) list = list.filter((p) => `${p.name} ${p.sku} ${p.brand} ${p.model} ${p.color} ${p.ram} ${p.storage} ${p.barcode}`.toLowerCase().includes(state.q));
      if (state.brand !== 'all') list = list.filter((p) => p.brand === state.brand);
      if (state.category !== 'all') list = list.filter((p) => p.category === state.category);
      return list;
    };

    const table = SP.table.create({
      columns: [
        { key: 'name', label: 'Product', value: (p) => p.name, render: (p) => SP.el('div.row.gap-2', { style: { alignItems: 'center' } }, thumb(p, 34), SP.el('div.stack', SP.el('strong', p.name), SP.el('small.mute', `${p.sku}${p.barcode ? ` · ${p.barcode}` : ''}`))) },
        { key: 'brand', label: 'Brand', width: '90px', value: (p) => p.brand },
        { key: 'spec', label: 'Spec', width: '130px', value: (p) => `${p.ram || ''}/${p.storage || ''}`, render: (p) => SP.el('span.tiny', [p.ram && `${p.ram}GB`, p.storage && `${p.storage}GB`, p.color, p.network].filter(Boolean).join(' · ') || '—') },
        { key: 'stock', label: 'Stock', width: '80px', align: 'right', value: (p) => SP.ledger.stockOf(p.id), render: (p) => { const q = SP.ledger.stockOf(p.id); return SP.el('strong', { style: { color: q <= 0 ? 'var(--danger)' : undefined } }, SP.fmt.n(q)); } },
        { key: 'cost', label: 'Cost', width: '100px', align: 'right', value: (p) => p.cost, hidden: !SP.auth.can('cost:view'), render: (p) => SP.fmt.money(p.cost) },
        { key: 'price', label: 'Price', width: '100px', align: 'right', value: (p) => p.price, render: (p) => SP.fmt.money(p.price) },
        { key: 'status', label: 'Status', width: '90px', value: (p) => p.status, render: (p) => SP.ui2.tag(p.archived ? 'Archived' : SP.fmt.titleCase(p.status), p.archived ? 'mute' : p.status === 'active' ? 'ok' : 'warn') },
      ],
      rows,
      rowId: (p) => p.id,
      defaultSort: 'name', defaultDir: 'asc',
      selectable: true,
      empty: { icon: 'tag', title: 'No products', body: 'Create your first product or import a spreadsheet.' },
      onRowClick: (p) => SP.router.go('products', { id: p.id }),
      bulkActions: [
        { id: 'archive', label: 'Archive', icon: 'trash', confirm: 'Archive {n} products? Their ledger history is preserved.', run: (list) => bulkArchive(list) },
        { id: 'export', label: 'Export CSV', icon: 'download', run: (list) => exportProducts(list) },
      ],
    });

    const brands = SP.unique(SP.store.state.products.map((p) => p.brand).filter(Boolean)).sort();
    const cats = SP.unique(SP.store.state.products.map((p) => p.category).filter(Boolean)).sort();

    const filters = SP.ui2.filterBar({
      placeholder: 'Search SKU, model, brand, colour, barcode…',
      onChange: (f) => { state.q = f.q; table.refresh(); },
    });

    const scopeRow = SP.el('div.row.gap-2', { style: { flexWrap: 'wrap', alignItems: 'center' } },
      SP.el('select.select', { onchange: (e) => { state.brand = e.target.value; table.refresh(); } },
        SP.el('option', { value: 'all' }, 'All brands'),
        ...brands.map((b) => SP.el('option', { value: b, selected: state.brand === b }, b))),
      SP.el('select.select', { onchange: (e) => { state.category = e.target.value; table.refresh(); } },
        SP.el('option', { value: 'all' }, 'All categories'),
        ...cats.map((c) => SP.el('option', { value: c, selected: state.category === c }, c))),
      SP.el('label.check.check--sm',
        SP.el('input', { type: 'checkbox', checked: state.showArchived, onchange: (e) => { state.showArchived = e.target.checked; table.refresh(); } }),
        SP.el('span.check__box'), SP.el('span.check__text', 'Show archived')),
    );

    const actions = [];
    if (SP.auth.can('products:create')) actions.push(SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => editProduct(null) }, SP.icon('plus'), 'New product'));
    if (SP.auth.can('products:import')) actions.push(SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: openImport }, SP.icon('file'), 'Import'));

    root.append(
      SP.ui2.pageHead({ title: 'Products / SKUs', sub: 'The product master. One page per product holds everything.', actions }),
      filters.el, scopeRow, table.el,
    );
    return root;
  }

  function thumb(p, size = 34) {
    const primary = (p.images || []).find((i) => i.primary) || (p.images || [])[0];
    if (primary) return SP.el('img.pthumb', { src: primary.dataUrl, alt: '', width: size, height: size, loading: 'lazy' });
    return SP.el('span.pthumb.pthumb--ph', { style: { width: `${size}px`, height: `${size}px` } }, SP.icon('box'));
  }

  function bulkArchive(list) {
    SP.store.update(['products'], (s) => {
      for (const p of list) {
        const t = s.products.find((x) => x.id === p.id);
        if (t) { t.archived = true; t.updatedAt = Date.now(); }
      }
    });
    SP.store.audit('product.archive', `${list.length} products`, list.map((p) => p.sku).join(', '));
    SP.ui.toast({ tone: 'ok', title: `${list.length} product${list.length === 1 ? '' : 's'} archived` });
  }

  function exportProducts(list) {
    SP.impexp.downloadCSV(list.map((p) => ({
      sku: p.sku, name: p.name, brand: p.brand, category: p.category, ram: p.ram, storage: p.storage,
      color: p.color, variant: p.variant, network: p.network, condition: p.condition,
      cost: p.cost, price: p.price, barcode: p.barcode, min_stock: p.minStock, reorder_point: p.reorderPoint,
      stock: SP.ledger.stockOf(p.id),
    })), ['sku', 'name', 'brand', 'category', 'ram', 'storage', 'color', 'variant', 'network', 'condition', 'cost', 'price', 'barcode', 'min_stock', 'reorder_point', 'stock'],
      `stockpilot-products-${Date.now()}.csv`);
  }

  /* ════════════════════════════════════════════════════ CREATE / EDIT */

  function editProduct(p, onSaved) {
    const isNew = !p;
    p = p || {
      id: null, sku: '', name: '', brand: '', model: '', category: 'Smartphone',
      variant: '', network: '', ram: null, storage: null, color: '', country: '',
      condition: 'new', cost: 0, price: 0, barcode: '', description: '',
      status: 'active', stockType: 'regular', minStock: 0, maxStock: 0,
      reorderPoint: 0, leadTimeDays: 7, preferredSupplierId: null,
      images: [], attributes: {}, serialized: false, notes: '', archived: false,
    };
    const suppliers = SP.store.state.suppliers;
    const types = [...SP.STOCK_TYPES, ...SP.store.state.settings.stockTypes];

    const imageHost = SP.el('div.pimgs');
    const drawImages = (imgs) => {
      SP.clear(imageHost);
      imgs.forEach((img, i) => {
        imageHost.appendChild(SP.el('div.pimg',
          SP.el('img', { src: img.dataUrl, alt: `Product image ${i + 1}` }),
          img.primary ? SP.el('span.pimg__star', { title: 'Primary image' }, '★') : null,
          SP.el('div.pimg__bar',
            SP.el('button.btn.btn--icon.btn--sm.btn--quiet', { type: 'button', 'aria-label': 'Make primary', onclick: () => { imgs.forEach((x) => { x.primary = false; }); img.primary = true; drawImages(imgs); } }, SP.icon('check')),
            SP.el('button.btn.btn--icon.btn--sm.btn--quiet', { type: 'button', 'aria-label': 'Remove image', onclick: () => { imgs.splice(i, 1); drawImages(imgs); } }, SP.icon('trash')),
          )));
      });
      imageHost.appendChild(SP.el('label.pimg.pimg--add',
        SP.icon('plus'), SP.el('span.tiny', 'Add'),
        SP.el('input', {
          type: 'file', accept: 'image/*', multiple: true, hidden: true,
          onchange: async (e) => {
            for (const file of e.target.files) {
              const dataUrl = await downscale(file, 640);
              imgs.push({ id: SP.uid('img'), dataUrl, primary: imgs.length === 0 });
            }
            drawImages(imgs);
          },
        })));
    };
    const imgs = SP.deepClone(p.images || []);
    drawImages(imgs);

    const res = SP.modal({
      title: isNew ? 'New product' : `Edit ${p.sku}`,
      subtitle: isNew ? 'A product is a sellable SKU variant.' : undefined,
      icon: 'tag',
      okLabel: isNew ? 'Create product' : 'Save changes',
      fields: [
        { key: 'sku', label: 'SKU / Model', required: true, value: p.sku, placeholder: 'e.g. Xiaomi 14 Ultra' },
        { key: 'brand', label: 'Brand', required: true, value: p.brand, placeholder: 'e.g. Xiaomi' },
        { key: 'category', label: 'Category', value: p.category },
        { key: 'variant', label: 'Variant / Region', value: p.variant, placeholder: 'International · Global · China · BD · Other' },
        { key: 'network', label: 'Network', type: 'select', value: p.network, options: [{ value: '', label: '—' }, { value: '4G', label: '4G' }, { value: '5G', label: '5G' }] },
        { key: 'ram', label: 'RAM (GB)', type: 'number', min: 0, value: p.ram },
        { key: 'storage', label: 'Storage (GB)', type: 'number', min: 0, value: p.storage },
        { key: 'color', label: 'Colour', value: p.color },
        { key: 'condition', label: 'Condition', type: 'select', value: p.condition, options: [{ value: 'new', label: 'New' }, { value: 'used', label: 'Used' }, { value: 'refurbished', label: 'Refurbished' }] },
        { key: 'stockType', label: 'Stock type', type: 'select', value: p.stockType, options: types.map((t) => ({ value: t.id, label: t.label })) },
        { key: 'cost', label: 'Unit cost (৳)', type: 'number', min: 0, value: p.cost },
        { key: 'price', label: 'Selling price (৳)', type: 'number', min: 0, value: p.price },
        { key: 'barcode', label: 'Barcode', value: p.barcode },
        { key: 'minStock', label: 'Minimum stock', type: 'number', min: 0, value: p.minStock },
        { key: 'reorderPoint', label: 'Reorder point', type: 'number', min: 0, value: p.reorderPoint, hint: 'Alert & reorder trigger' },
        { key: 'maxStock', label: 'Maximum stock', type: 'number', min: 0, value: p.maxStock },
        { key: 'leadTimeDays', label: 'Lead time (days)', type: 'number', min: 0, value: p.leadTimeDays },
        { key: 'preferredSupplierId', label: 'Preferred supplier', type: 'select', value: p.preferredSupplierId || '', options: [{ value: '', label: '—' }, ...suppliers.map((sp) => ({ value: sp.id, label: sp.name }))] },
        { key: 'serialized', label: 'IMEI tracking', type: 'checkbox', checkboxLabel: 'Track individual devices (IMEI / serial)', value: p.serialized },
        { key: 'description', label: 'Description', type: 'textarea', value: p.description },
      ],
      body: SP.el('div.stack.gap-2', SP.el('strong', { class: 'tiny mute' }, 'IMAGES'), imageHost),
      onOk: async (v) => {
        const name = `${v.sku}${v.ram || v.storage ? ` ${v.ram || ''} | ${v.storage || ''}GB` : ''}${v.color ? ` · ${v.color}` : ''}`.replace(/\s+/g, ' ').trim();
        const data = {
          sku: String(v.sku).trim(), name,
          brand: String(v.brand).trim(), model: String(v.sku).trim(),
          category: v.category || '', variant: v.variant || '', network: v.network || '',
          ram: v.ram, storage: v.storage, color: v.color || '', country: v.country || '',
          condition: v.condition, cost: v.cost || 0, price: v.price || 0,
          barcode: v.barcode || '', description: v.description || '',
          stockType: v.stockType, minStock: v.minStock || 0, maxStock: v.maxStock || 0,
          reorderPoint: v.reorderPoint || 0, leadTimeDays: v.leadTimeDays || 0,
          preferredSupplierId: v.preferredSupplierId || null,
          serialized: !!v.serialized, images: imgs,
        };
        if (isNew) {
          const dupe = SP.store.state.products.find((x) => !x.archived
            && x.sku.toLowerCase() === data.sku.toLowerCase()
            && (x.color || '').toLowerCase() === (data.color || '').toLowerCase()
            && x.ram === data.ram && x.storage === data.storage);
          if (dupe) throw new Error(`This exact variant already exists as ${dupe.name}. Edit it instead.`);
          const rec = { id: SP.uid('prd'), status: 'active', archived: false, createdAt: Date.now(), updatedAt: Date.now(), attributes: {}, ...data };
          SP.store.update(['products'], (s) => { s.products.push(rec); });
          SP.store.audit('product.create', rec.sku, rec.name);
          SP.ui.toast({ tone: 'ok', title: 'Product created', body: rec.name });
          onSaved?.(rec);
          setTimeout(() => SP.router.refresh(), 50);
        } else {
          SP.store.update(['products'], (s) => {
            const t = s.products.find((x) => x.id === p.id);
            if (t) Object.assign(t, data, { updatedAt: Date.now() });
          });
          SP.store.audit('product.update', p.sku, Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(p[k])).join(', '));
          SP.ui.toast({ tone: 'ok', title: 'Product saved' });
          onSaved?.(p);
          setTimeout(() => SP.router.refresh(), 50);
        }
      },
    });
    return res;
  }

  /** Downscale an image file to a max-edge JPEG data URL. */
  function downscale(file, maxEdge) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
      img.src = url;
    });
  }

  /* ════════════════════════════════════════════════════ 360° DETAIL */

  function detail(productId, tab = 'overview') {
    const p = SP.store.state.products.find((x) => x.id === productId);
    if (!p) return SP.empty({ icon: 'tag', title: 'Product not found', body: 'It may have been deleted.', action: { label: 'Back to products', onClick: () => SP.router.go('products') } });

    const root = SP.el('div.stack.gap-4');
    const qty = SP.ledger.stockOf(p.id);
    const value = qty * (p.cost || 0);
    const byWh = SP.ledger.stockByWarehouse(p.id);

    /* header */
    root.appendChild(SP.el('div.pdhead.card.card--pad',
      SP.el('div.row.gap-3', { style: { alignItems: 'flex-start', flexWrap: 'wrap' } },
        thumb(p, 64),
        SP.el('div.grow',
          SP.el('div.row.gap-2', { style: { alignItems: 'center', flexWrap: 'wrap' } },
            SP.el('h1.pdhead__name', p.name),
            SP.ui2.tag(p.archived ? 'Archived' : SP.fmt.titleCase(p.status), p.archived ? 'mute' : 'ok'),
            SP.ui2.tag([...SP.STOCK_TYPES, ...SP.store.state.settings.stockTypes].find((t) => t.id === p.stockType)?.label || p.stockType, 'mute'),
            p.serialized ? SP.ui2.tag('IMEI tracked', 'brand') : null,
          ),
          SP.el('p.phead__sub', `${p.sku} · ${p.brand}${p.variant ? ` · ${p.variant}` : ''}${p.network ? ` · ${p.network}` : ''}`),
        ),
        SP.el('div.pdhead__kpis',
          SP.el('div.pdhead__kpi', SP.el('b', { style: { color: qty <= 0 ? 'var(--danger)' : undefined } }, SP.fmt.n(qty)), SP.el('span', 'on hand')),
          SP.auth.can('cost:view') ? SP.el('div.pdhead__kpi', SP.el('b', SP.fmt.moneyCompact(value)), SP.el('span', 'stock value')) : null,
          SP.el('div.pdhead__kpi', SP.el('b', SP.fmt.money(p.price)), SP.el('span', 'sell price')),
        ),
        SP.el('div.row.gap-2',
          SP.auth.can('products:edit') ? SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => editProduct(p) }, SP.icon('edit'), 'Edit') : null,
          SP.auth.can('movements:create') ? SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => SP.modules.movements.receiveForm({ productId: p.id }) }, SP.icon('download'), 'Receive') : null,
          SP.el('button.btn.btn--ghost.btn--sm', {
            type: 'button', onclick: (e) => SP.menu(e.currentTarget, [
              { label: 'Adjust stock', icon: 'edit', disabled: !SP.auth.can('movements:adjust'), onClick: () => SP.modules.movements.adjustForm({ productId: p.id }) },
              { label: 'New transfer', icon: 'swap', disabled: !SP.auth.can('transfers:create'), onClick: () => SP.modules.transfers.openForm({ items: [{ productId: p.id, qty: 1 }] }) },
              { label: 'Sell', icon: 'truck', disabled: !SP.auth.can('sales:create'), onClick: () => SP.modules.sales.openForm({ items: [{ productId: p.id, qty: 1, price: p.price }] }) },
              '-',
              { label: 'Export history CSV', icon: 'download', onClick: () => exportHistory(p) },
              { label: p.archived ? 'Unarchive' : 'Archive', icon: 'trash', danger: !p.archived, onClick: () => { bulkArchive([p]); if (p.archived) SP.router.go('products'); else SP.router.refresh(); } },
            ]),
          }, SP.icon('menu'), 'Actions'),
        ),
      ),
    ));

    /* tabs */
    const tabs = [
      ['overview', 'Overview'], ['stock', 'Stock'], ['devices', 'Devices / IMEI'],
      ['movements', 'Movements'], ['transfers', 'Transfers'],
      ['sales', 'Sales'], ['purchases', 'Purchases'], ['history', 'History'],
    ];
    const tabHost = SP.el('div.stack.gap-3');
    root.appendChild(SP.el('div.tabs', ...tabs.map(([id, label]) => SP.el('button.tabs__tab', {
      type: 'button', class: id === tab ? 'is-active' : '',
      onclick: () => { tab = id; SP.$$('.tabs__tab', root).forEach((t, i) => t.classList.toggle('is-active', tabs[i][0] === id)); drawTab(); },
    }, label))));
    root.appendChild(tabHost);

    function drawTab() {
      SP.clear(tabHost);
      tabHost.appendChild(TABS[tab](p));
    }
    drawTab();
    return root;
  }

  const TABS = {
    overview(p) {
      const spec = SP.fmt.parseSpec(`${p.ram || ''} | ${p.storage || ''}GB`);
      void spec;
      const wrap = SP.el('div.grid.grid--2.gap-3',
        SP.el('div.card.card--pad',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Details'),
          SP.el('dl.kv',
            SP.el('dt', 'SKU'), SP.el('dd', p.sku),
            SP.el('dt', 'Brand'), SP.el('dd', p.brand || '—'),
            SP.el('dt', 'Category'), SP.el('dd', p.category || '—'),
            SP.el('dt', 'RAM / Storage'), SP.el('dd', `${p.ram || '—'} / ${p.storage || '—'}GB`),
            SP.el('dt', 'Colour'), SP.el('dd', p.color || '—'),
            SP.el('dt', 'Variant'), SP.el('dd', p.variant || '—'),
            SP.el('dt', 'Network'), SP.el('dd', p.network || '—'),
            SP.el('dt', 'Condition'), SP.el('dd', SP.fmt.titleCase(p.condition || 'new')),
            SP.el('dt', 'Barcode'), SP.el('dd', p.barcode || '—'),
            SP.el('dt', 'Stock type'), SP.el('dd', SP.STOCK_TYPES.find((t) => t.id === p.stockType)?.label || p.stockType),
          )),
        SP.el('div.card.card--pad',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Replenishment'),
          SP.el('dl.kv',
            SP.el('dt', 'Minimum stock'), SP.el('dd', SP.fmt.n(p.minStock)),
            SP.el('dt', 'Reorder point'), SP.el('dd', SP.fmt.n(p.reorderPoint)),
            SP.el('dt', 'Maximum stock'), SP.el('dd', SP.fmt.n(p.maxStock)),
            SP.el('dt', 'Lead time'), SP.el('dd', `${p.leadTimeDays || 0} days`),
            SP.el('dt', 'Preferred supplier'), SP.el('dd', SP.store.state.suppliers.find((s) => s.id === p.preferredSupplierId)?.name || '—'),
          ),
          p.description ? SP.el('p.tiny', { style: { marginTop: 'var(--sp-2)' } }, p.description) : null),
      );
      if ((p.images || []).length > 1) {
        wrap.appendChild(SP.el('div.card.card--pad',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Gallery'),
          SP.el('div.pimgs', ...p.images.map((img) => SP.el('div.pimg', SP.el('img', { src: img.dataUrl, alt: '' }))))));
      }
      return wrap;
    },

    stock(p) {
      const byWh = SP.ledger.stockByWarehouse(p.id);
      const { perProduct } = SP.ledger.ageing(p.id);
      const age = perProduct[p.id];
      const wrap = SP.el('div.stack.gap-3');
      wrap.appendChild(SP.el('div.card.card--pad',
        SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Stock by warehouse'),
        SP.el('div.stack.gap-1', ...SP.store.state.warehouses.map((w) => {
          const q = byWh[w.id] || 0;
          return SP.el('div.lrow',
            SP.el('span.lrow__ico', { style: { background: `${(w.color || '#5b8cff')}22`, color: w.color } }, SP.icon('home')),
            SP.el('div.lrow__main', SP.el('strong', w.name), SP.el('small', `reserved ${SP.fmt.n(SP.ledger.reservedOf(p.id, w.id))}`)),
            SP.el('div.lrow__end', SP.el('span.lrow__val', { style: { color: q <= 0 ? 'var(--danger)' : undefined } }, SP.fmt.n(q))));
        }))));
      if (age) {
        wrap.appendChild(SP.el('div.card.card--pad',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Ageing (FIFO)'),
          SP.ui2.stackedParts([
            { label: '0–30d', value: age.d30, color: '#34d399' },
            { label: '31–60d', value: age.d60, color: '#a3e635' },
            { label: '61–90d', value: age.d90, color: '#fbbf24' },
            { label: '91–180d', value: age.d180, color: '#fb923c' },
            { label: '180d+', value: age.d180p, color: '#f87171' },
          ]),
          SP.el('div.legend',
            SP.el('span.legend__item', SP.el('i', { style: { background: '#34d399' } }), `0–30d · ${SP.fmt.n(age.d30)}`),
            SP.el('span.legend__item', SP.el('i', { style: { background: '#a3e635' } }), `31–60d · ${SP.fmt.n(age.d60)}`),
            SP.el('span.legend__item', SP.el('i', { style: { background: '#fbbf24' } }), `61–90d · ${SP.fmt.n(age.d90)}`),
            SP.el('span.legend__item', SP.el('i', { style: { background: '#fb923c' } }), `91–180d · ${SP.fmt.n(age.d180)}`),
            SP.el('span.legend__item', SP.el('i', { style: { background: '#f87171' } }), `180d+ · ${SP.fmt.n(age.d180p)}`))));
      }
      return wrap;
    },

    devices(p) {
      const devices = SP.store.state.devices.filter((d) => d.productId === p.id);
      if (!p.serialized && !devices.length) {
        return SP.el('div.card.card--pad', SP.empty({
          icon: 'layers', title: 'Not IMEI-tracked',
          body: 'Enable IMEI tracking on this product to register individual devices.',
          action: SP.auth.can('products:edit') ? { label: 'Enable tracking', onClick: () => { SP.store.update(['products'], (s) => { const t = s.products.find((x) => x.id === p.id); if (t) t.serialized = true; }); SP.store.audit('product.update', p.sku, 'IMEI tracking enabled'); SP.router.refresh(); } } : null,
        }));
      }
      return SP.el('div.stack.gap-1', ...devices.map((d) => {
        const w = SP.store.state.warehouses.find((x) => x.id === d.warehouseId);
        return SP.el('button.lrow', { type: 'button', onclick: () => SP.modules.devices.openDevice(d.id) },
          SP.el('span.lrow__ico', SP.icon('layers')),
          SP.el('div.lrow__main', SP.el('strong', d.imei1 || d.serial || d.id), SP.el('small', [d.imei2 && `IMEI2 ${d.imei2}`, w?.name || '—'].filter(Boolean).join(' · '))),
          SP.ui2.tag(SP.deviceStatus(d.status).label, SP.deviceStatus(d.status).tone));
      }));
    },

    movements(p) {
      const moves = SP.ledger.explain(p.id).reverse().slice(0, 60);
      return SP.el('div.card.card--pad',
        SP.el('div.row', { style: { justifyContent: 'space-between', marginBottom: 'var(--sp-2)' } },
          SP.el('strong', `Why ${SP.fmt.n(SP.ledger.stockOf(p.id))} units? The full calculation`),
          SP.el('button.btn.btn--quiet.btn--sm', { type: 'button', onclick: () => exportHistory(p) }, 'Export')),
        SP.ui2.timeline(moves.map((m) => {
          const w = SP.store.state.warehouses.find((x) => x.id === m.warehouseId);
          return {
            at: m.ts, tone: SP.movementType(m.type).tone,
            title: `${SP.movementType(m.type).label} · ${m.direction > 0 ? '+' : m.direction < 0 ? '−' : ''}${m.qty}`,
            body: `${w?.name || m.warehouseId} · balance ${m.before} → ${m.after}${m.reason ? ` · ${m.reason}` : ''}`,
            meta: `${m.ref} · ${m.by}${m.deviceIds?.length ? ` · ${m.deviceIds.length} device(s)` : ''}`,
          };
        })));
    },

    transfers(p) {
      const list = SP.store.state.transfers.filter((t) => t.items.some((i) => i.productId === p.id));
      if (!list.length) return SP.el('div.card.card--pad', SP.empty({ icon: 'swap', title: 'No transfers', body: 'This product has never been transferred.' }));
      return SP.el('div.stack.gap-1', ...list.map((t) => {
        const item = t.items.find((i) => i.productId === p.id);
        return SP.el('button.lrow', { type: 'button', onclick: () => SP.router.go('transfers', { id: t.id }) },
          SP.el('span.lrow__ico', SP.icon('swap')),
          SP.el('div.lrow__main', SP.el('strong', `${t.ref} · ${t.from} → ${t.to}`), SP.el('small', `${item.qty} units · ${SP.fmt.date(t.createdAt)}`)),
          SP.ui2.badge('transfer', t.status, { sm: true }));
      }));
    },

    sales(p) {
      const list = SP.store.state.sales.filter((s) => (s.items || []).some((i) => i.productId === p.id));
      if (!list.length) return SP.el('div.card.card--pad', SP.empty({ icon: 'truck', title: 'No sales', body: 'This product has not been sold yet.' }));
      return SP.el('div.stack.gap-1', ...list.map((s) => {
        const item = s.items.find((i) => i.productId === p.id);
        return SP.el('button.lrow', { type: 'button', onclick: () => SP.router.go('sales', { id: s.id }) },
          SP.el('span.lrow__ico', SP.icon('truck')),
          SP.el('div.lrow__main', SP.el('strong', `${s.ref} · ${s.customerName || 'Walk-in'}`), SP.el('small', `${item.qty} × ${SP.fmt.money(item.price)} · ${SP.fmt.date(s.ts)}`)),
          SP.ui2.badge('sale', s.status, { sm: true }));
      }));
    },

    purchases(p) {
      const list = SP.store.state.purchases.filter((po) => (po.items || []).some((i) => i.productId === p.id));
      if (!list.length) return SP.el('div.card.card--pad', SP.empty({ icon: 'cart', title: 'No purchases', body: 'This product has never been purchased.' }));
      return SP.el('div.stack.gap-1', ...list.map((po) => {
        const item = po.items.find((i) => i.productId === p.id);
        return SP.el('button.lrow', { type: 'button', onclick: () => SP.router.go('purchases', { id: po.id }) },
          SP.el('span.lrow__ico', SP.icon('cart')),
          SP.el('div.lrow__main', SP.el('strong', `${po.ref} · ${po.supplierName || '—'}`), SP.el('small', `${item.qty} × ${SP.fmt.money(item.cost)} · ${SP.fmt.date(po.createdAt)}`)),
          SP.ui2.badge('po', po.status, { sm: true }));
      }));
    },

    history(p) {
      const entries = SP.store.state.audit.filter((a) => a.productId === p.id || a.target?.includes(p.sku)).slice(0, 80);
      return SP.el('div.card.card--pad', SP.ui2.timeline(entries.map((a) => ({
        at: a.at, title: a.action, body: a.detail, meta: `${a.by} · ${a.target}`,
      }))));
    },
  };

  function exportHistory(p) {
    const moves = SP.ledger.explain(p.id);
    SP.impexp.downloadCSV(moves.map((m) => ({
      ref: m.ref, date: new Date(m.ts).toISOString(), type: m.type, direction: m.direction,
      qty: m.qty, warehouse: m.warehouseId, before: m.before, after: m.after,
      unit_cost: m.unitCost, ref_type: m.refType, ref_id: m.refId, reason: m.reason, by: m.by,
    })), ['ref', 'date', 'type', 'direction', 'qty', 'warehouse', 'before', 'after', 'unit_cost', 'ref_type', 'ref_id', 'reason', 'by'],
      `stockpilot-history-${p.sku}-${Date.now()}.csv`);
  }

  /* ══════════════════════════════════════════════════════════ IMPORT */

  /** 4-step import wizard: upload → map → validate → confirm. */
  async function openImport(fieldSet = 'products') {
    const file = await pickFile('.csv,text/csv,text/plain');
    if (!file) return;
    const text = await file.text();
    const rows = SP.impexp.parseCSV(text);
    if (rows.length < 2) { SP.ui.toast({ tone: 'warn', title: 'Nothing to import', body: 'The file has no data rows.' }); return; }

    const headers = rows[0];
    const bodyRows = rows.slice(1);
    const { mapping, unknown } = SP.impexp.detectMapping(headers, fieldSet);
    const fields = SP.impexp.FIELD_SETS[fieldSet];

    /* step 2: mapping */
    const mapRows = SP.el('div.stack.gap-2');
    headers.forEach((h, i) => {
      mapRows.appendChild(SP.el('div.row.gap-2', { style: { alignItems: 'center' } },
        SP.el('span.grow.tiny', { style: { fontWeight: 600 } }, h || `(column ${i + 1})`),
        SP.el('select.select', { dataset: { col: i }, style: { maxWidth: '220px' } },
          SP.el('option', { value: '', selected: mapping[i] === undefined }, '— ignore —'),
          ...fields.map((f) => SP.el('option', { value: f.key, selected: mapping[i] === f.key }, f.label))),
      ));
    });
    if (unknown.length) {
      mapRows.appendChild(SP.el('div.callout', { dataset: { tone: 'warn' } },
        SP.el('span.callout__ico', SP.icon('alert')),
        SP.el('div.callout__body', SP.el('strong', `${unknown.length} unrecognised column${unknown.length === 1 ? '' : 's'}`),
          SP.el('p', 'Unmapped columns are imported into the product record as custom attributes — never discarded silently.'))));
    }

    const mapRes = await SP.modal({
      title: `Import ${fieldSet} — map columns`,
      subtitle: `${bodyRows.length} rows detected in ${file.name}`,
      body: mapRows, okLabel: 'Validate rows',
    });
    if (!mapRes) return;

    const finalMapping = {};
    SP.$$('select', mapRows).forEach((sel) => { if (sel.value) finalMapping[sel.dataset.col] = sel.value; });

    /* step 3: validate */
    const { rows: validated, requiredMissing } = SP.impexp.validateRows(fieldSet, headers, bodyRows, finalMapping);
    const errors = validated.filter((r) => r.errors.length);
    const warnings = validated.filter((r) => !r.errors.length && r.warnings.length);
    const clean = validated.filter((r) => !r.errors.length);

    const preview = SP.el('div.stack.gap-2',
      SP.el('div.row.gap-2', { style: { flexWrap: 'wrap' } },
        SP.ui2.tag(`${clean.length} ready`, 'ok'),
        SP.ui2.tag(`${errors.length} blocked`, errors.length ? 'danger' : 'mute'),
        SP.ui2.tag(`${warnings.length} warnings`, warnings.length ? 'warn' : 'mute')),
      requiredMissing.length ? SP.el('div.callout', { dataset: { tone: 'danger' } },
        SP.el('span.callout__ico', SP.icon('alert')),
        SP.el('div.callout__body', SP.el('strong', 'Required fields unmapped'), SP.el('p', requiredMissing.join(', ')))) : null,
      SP.el('div.stack.gap-1', { style: { maxHeight: '40vh', overflow: 'auto' } },
        ...validated.slice(0, 120).map((r) => SP.el('div.lrow', { style: { cursor: 'default' } },
          SP.el('span.lrow__ico', { style: { background: r.errors.length ? 'var(--danger-soft)' : 'var(--ok-soft)', color: r.errors.length ? 'var(--danger)' : 'var(--ok)' } }, SP.icon(r.errors.length ? 'x' : 'check')),
          SP.el('div.lrow__main',
            SP.el('strong', r.data.sku || r.data.imei1 || `Row ${r.index + 2}`),
            SP.el('small', [...r.errors, ...r.warnings].join(' · ') || 'Ready')),
        ))));

    const confirmRes = await SP.modal({
      title: 'Review & confirm',
      subtitle: `${clean.length} of ${validated.length} rows will import. Blocked rows are listed above and skipped — nothing is partially hidden.`,
      body: preview,
      okLabel: `Import ${clean.length} rows`,
      tone: clean.length ? 'brand' : 'danger',
    });
    if (!confirmRes || !clean.length) return;

    /* step 4: apply */
    const result = fieldSet === 'products' ? applyProductRows(clean, finalMapping, headers) : applyDeviceRows(clean);
    SP.store.audit('import.applied', fieldSet, `${result.created} created · ${result.updated} updated · ${result.skipped} skipped`);
    SP.store.notify({ tone: 'ok', kind: 'import', title: 'Import complete', body: `${result.created} created, ${result.updated} updated, ${result.skipped} skipped. ${errors.length} rows were blocked.` });

    await SP.modal({
      title: 'Import reconciliation',
      icon: 'checkCircle', tone: 'ok',
      body: SP.el('dl.kv',
        SP.el('dt', 'File'), SP.el('dd', file.name),
        SP.el('dt', 'Rows in file'), SP.el('dd', SP.fmt.n(validated.length)),
        SP.el('dt', 'Created'), SP.el('dd', SP.fmt.n(result.created)),
        SP.el('dt', 'Updated'), SP.el('dd', SP.fmt.n(result.updated)),
        SP.el('dt', 'Skipped (duplicates)'), SP.el('dd', SP.fmt.n(result.skipped)),
        SP.el('dt', 'Blocked (errors)'), SP.el('dd', SP.fmt.n(errors.length))),
      okLabel: 'Done', cancelLabel: 'Close',
    });
    SP.router.refresh();
  }

  function applyProductRows(cleanRows, mapping, headers) {
    let created = 0; let updated = 0; let skipped = 0;
    const unknownCols = Object.keys(mapping).map(Number).filter((i) => !SP.impexp.FIELD_SETS.products.some((f) => f.key === mapping[i]));

    SP.store.update(null, (s) => {
      for (const r of cleanRows) {
        const d = r.data;
        const wh = d.warehouse ? s.warehouses.find((w) => w.name.toLowerCase() === String(d.warehouse).toLowerCase() || w.id.toLowerCase() === String(d.warehouse).toLowerCase()) : null;
        if (d.warehouse && !wh) {
          // Never silently drop unknown warehouses — surface and skip stock.
          r.warnings.push(`Unknown warehouse "${d.warehouse}" — stock not posted`);
        }
        let p = s.products.find((x) => x.sku.toLowerCase() === String(d.sku).toLowerCase()
          && (x.color || '').toLowerCase() === (d.color || '').toLowerCase());
        const attrs = {};
        for (const ci of unknownCols) attrs[headers[ci]] = r.data[mapping[ci]] ?? '';

        if (p) {
          Object.assign(p, {
            brand: d.brand || p.brand, category: d.category || p.category,
            ram: d.ram ?? p.ram, storage: d.storage ?? p.storage,
            cost: d.cost ?? p.cost, price: d.price ?? p.price,
            barcode: d.barcode || p.barcode,
            minStock: d.minStock ?? p.minStock,
            variant: d.variant || p.variant, network: d.network || p.network,
            attributes: { ...p.attributes, ...attrs },
            updatedAt: Date.now(),
          });
          updated += 1;
        } else {
          p = {
            id: SP.uid('prd'), sku: String(d.sku).trim(),
            name: `${d.sku}${d.ram || d.storage ? ` ${d.ram || ''} | ${d.storage || ''}GB` : ''}${d.color ? ` · ${d.color}` : ''}`,
            brand: d.brand || '', model: String(d.sku).trim(), category: d.category || 'Smartphone',
            variant: d.variant || '', network: d.network || '', ram: d.ram ?? null, storage: d.storage ?? null,
            color: d.color || '', country: '', condition: 'new',
            cost: d.cost || 0, price: d.price || 0, barcode: d.barcode || '',
            description: '', status: 'active', stockType: 'regular',
            minStock: d.minStock || 0, maxStock: 0, reorderPoint: 0, leadTimeDays: 7,
            preferredSupplierId: null, images: [], attributes: attrs, serialized: false,
            notes: '', archived: false, createdAt: Date.now(), updatedAt: Date.now(),
          };
          s.products.push(p);
          created += 1;
        }
        if (d.qty > 0 && wh) {
          s.movements.push({
            id: SP.uid('mov'), ref: SP.store.nextRef('movement'),
            ts: Date.now(), type: 'opening', direction: 1,
            productId: p.id, qty: d.qty, warehouseId: wh.id, locationId: null,
            deviceIds: [], unitCost: d.cost || p.cost || null,
            refType: 'import', refId: null,
            reason: 'Spreadsheet import opening quantity', notes: '', by: SP.auth.current()?.name || 'system',
            before: SP.ledger.stockOf(p.id, wh.id), after: SP.ledger.stockOf(p.id, wh.id) + d.qty,
          });
        } else if (d.qty > 0 && !wh) skipped += 1;
      }
    });
    return { created, updated, skipped };
  }

  function applyDeviceRows(cleanRows) {
    let created = 0; let updated = 0; let skipped = 0;
    SP.store.update(['devices'], (s) => {
      for (const r of cleanRows) {
        const d = r.data;
        const imei = SP.imei.clean(d.imei1);
        if (SP.imei.find(imei).length) { skipped += 1; continue; }
        const p = s.products.find((x) => x.sku.toLowerCase() === String(d.sku || '').toLowerCase());
        if (!p) { skipped += 1; continue; }
        const wh = d.warehouse
          ? s.warehouses.find((w) => w.name.toLowerCase() === String(d.warehouse).toLowerCase() || w.id.toLowerCase() === String(d.warehouse).toLowerCase())
          : s.warehouses[0];
        s.devices.push({
          id: SP.uid('dev'), imei1: imei, imei2: SP.imei.clean(d.imei2), serial: d.serial || '',
          productId: p.id, warehouseId: wh?.id || null, locationId: null,
          status: 'available', condition: d.condition || 'new',
          cost: d.cost || p.cost || 0, purchaseRef: null, saleRef: null,
          receivedAt: Date.now(), updatedAt: Date.now(), notes: 'Imported',
        });
        created += 1;
      }
    });
    return { created, updated, skipped };
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = SP.el('input', { type: 'file', accept, style: { display: 'none' } });
      input.addEventListener('change', () => resolve(input.files[0] || null));
      document.body.appendChild(input);
      input.click();
      setTimeout(() => input.remove(), 60000);
    });
  }

  return MOD;
})();
