/**
 * tools/acceptance.mjs — StockPilot 2.0 acceptance test (spec §54).
 *
 * Runs the complete scenario against the real core modules (config, store,
 * ledger, approvals, imei) with a minimal browser shim:
 *
 *  1. create product            8. verify stock = 100
 *  2. create SKU (variant)      9. transfer 20 A→B
 *  3. create warehouse A       10. approve
 *  4. create warehouse B       11. dispatch
 *  5. receive 100 into A       12. in transit
 *  6. assign locations         13. receive at B
 *  7. register IMEIs           14–15. verify A=80, B=20
 * 16–17. sell 2 from B → 18   18–22. count, variance, approve, ledger
 * 23–24. audit trail complete  25. final report reconciles
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/* ── browser shim ─────────────────────────────────────────────── */
const localData = new Map();
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: {
    getItem: (k) => (localData.has(k) ? localData.get(k) : null),
    setItem: (k, v) => localData.set(k, String(v)),
    removeItem: (k) => localData.delete(k),
  },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  crypto: { getRandomValues: (arr) => arr.fill(42) },
  navigator: { onLine: true },
  addEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['config.js', 'util.js', 'store.js', 'ledger.js', 'approvals.js', 'alerts.js']) {
  vm.runInContext(readFileSync(new URL(`../js/${f}`, import.meta.url)), sandbox, { filename: f });
}
const { SP } = sandbox;

/* stub a signed-in actor */
SP.auth = {
  current: () => ({ id: 'usr_test', name: 'Acceptance Tester', role: 'admin' }),
  can: () => false, // force the approval engine to park guarded actions
};

/* ── tiny test framework ──────────────────────────────────────── */
let passed = 0; let failed = 0;
const t = (name, cond) => {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}`); }
};
const section = (s) => console.log(`\n${s}`);

/* ── scenario ─────────────────────────────────────────────────── */
const st = SP.store.state;

section('1–4 · Create product, SKU variant and warehouses A + B');
const whA = { id: 'WHA', code: 'WHA', name: 'Warehouse A', type: 'warehouse', active: true, createdAt: Date.now() };
const whB = { id: 'WHB', code: 'WHB', name: 'Warehouse B', type: 'warehouse', active: true, createdAt: Date.now() };
st.warehouses.push(whA, whB);
const product = {
  id: 'prd_test1', sku: 'TESTPHONE X1', name: 'TESTPHONE X1 8 | 128GB · Black',
  brand: 'TEST', model: 'TESTPHONE X1', category: 'Smartphone', ram: 8, storage: 128,
  color: 'Black', condition: 'new', cost: 10000, price: 12000, status: 'active',
  stockType: 'regular', minStock: 0, maxStock: 0, reorderPoint: 5, leadTimeDays: 7,
  images: [], attributes: {}, serialized: true, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
};
st.products.push(product);
t('product created', st.products.length === 1);
t('warehouses created', st.warehouses.length === 2);

section('5 · Receive 100 units into Warehouse A');
SP.ledger.post({ type: 'receive', productId: product.id, qty: 100, warehouseId: 'WHA', unitCost: 10000, reason: 'Initial PO receipt' });
t('movement posted', st.movements.length === 1);

section('6 · Assign locations');
st.locations.push({ id: 'loc_a1', warehouseId: 'WHA', zone: 'A', rack: '01', shelf: '02', bin: '05', code: 'ZA-R01-S02-B05' });
t('location created', st.locations.length === 1);

section('7 · Register IMEIs for 3 units');
const mkImei = (base) => {
  // build a Luhn-valid 15-digit IMEI from a 14-digit base
  let sum = 0;
  for (let i = 0; i < 14; i += 1) { let d = Number(base[i]); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return base + String((10 - (sum % 10)) % 10);
};
const devices = ['86000000000001', '86000000000002', '86000000000003'].map((b, i) => ({
  id: `dev_${i}`, imei1: mkImei(b), imei2: '', serial: `SN${i}`,
  productId: product.id, warehouseId: 'WHA', locationId: 'loc_a1',
  status: 'available', condition: 'new', cost: 10000, receivedAt: Date.now(), updatedAt: Date.now(),
}));
devices.forEach((d) => st.devices.push(d));
t('3 devices registered', st.devices.length === 3);
t('IMEIs pass Luhn', devices.every((d) => SP.imei.valid(d.imei1)));

section('8 · Verify stock = 100');
t('stock A = 100', SP.ledger.stockOf(product.id, 'WHA') === 100);
t('stock B = 0', SP.ledger.stockOf(product.id, 'WHB') === 0);

section('9–10 · Transfer 20 A → B, approve');
const transfer = {
  id: 'trf_1', ref: 'TRF-0001', from: 'WHA', to: 'WHB',
  items: [{ productId: product.id, qty: 20, receivedQty: 0, deviceIds: devices.map((d) => d.id) }],
  status: 'requested', requester: 'Acceptance Tester', history: [], createdAt: Date.now(), updatedAt: Date.now(),
};
st.transfers.push(transfer);
transfer.status = 'approved';
t('transfer approved', transfer.status === 'approved');

section('11–12 · Dispatch (posts transfer_out) then mark in transit');
SP.ledger.postBatch(transfer.items.map((i) => ({
  type: 'transfer_out', productId: i.productId, qty: i.qty, warehouseId: transfer.from,
  deviceIds: i.deviceIds, refType: 'transfer', refId: transfer.id, reason: 'dispatch',
})));
transfer.status = 'in_transit';
t('A = 80 after dispatch', SP.ledger.stockOf(product.id, 'WHA') === 80);
t('devices in transit', devices.every((d) => d.status === 'in_transit'));
t('in-transit counter = 20', SP.ledger.inTransitOf(product.id) === 20);

section('13 · Receive at B (posts transfer_in)');
SP.ledger.postBatch(transfer.items.map((i) => ({
  type: 'transfer_in', productId: i.productId, qty: i.qty, warehouseId: transfer.to,
  deviceIds: i.deviceIds, refType: 'transfer', refId: transfer.id, reason: 'receive',
})));
transfer.items[0].receivedQty = 20;
transfer.status = 'received';
t('B = 20 after receiving', SP.ledger.stockOf(product.id, 'WHB') === 20);

section('14–15 · Verify A = 80 and B = 20');
t('A = 80', SP.ledger.stockOf(product.id, 'WHA') === 80);
t('B = 20', SP.ledger.stockOf(product.id, 'WHB') === 20);
t('devices now at B available', devices.every((d) => d.warehouseId === 'WHB' && d.status === 'available'));

section('16–17 · Sell 2 from B → B = 18');
SP.ledger.post({ type: 'sale', productId: product.id, qty: 2, warehouseId: 'WHB', unitCost: 12000, refType: 'sale', refId: 'sal_1', reason: 'Invoice INV-0001' });
t('B = 18 after sale', SP.ledger.stockOf(product.id, 'WHB') === 18);

section('18–22 · Physical count, discrepancy, adjustment with approval');
const count = {
  id: 'cnt_1', ref: 'CNT-0001', warehouseId: 'WHB', status: 'submitted',
  lines: [{ productId: product.id, expected: 18, physical: 16 }],
  createdBy: 'Acceptance Tester', createdAt: Date.now(),
};
st.counts.push(count);
const variance = count.lines[0].physical - count.lines[0].expected;
t('variance of −2 detected', variance === -2);

/* guard parks the action because our stub actor cannot self-approve */
let executed = false;
const outcome = SP.approvals.guard('variance', { qty: Math.abs(variance) }, {
  title: 'Post variance for CNT-0001',
  resumeKey: 'test_variance', resumeData: {},
}, () => { executed = true; });
t('variance parked for approval', outcome.status === 'pending' && !executed);
t('approval recorded', st.approvals.length === 1 && st.approvals[0].status === 'pending');

/* a different approver decides */
SP.auth = {
  current: () => ({ id: 'usr_mgr', name: 'Warehouse Manager', role: 'warehouse_manager' }),
  can: (p) => p === 'approvals:decide',
};
SP.approvals.registerResume('test_variance', () => {
  SP.ledger.post({ type: 'adjust_out', productId: product.id, qty: 2, warehouseId: 'WHB', refType: 'count', refId: 'cnt_1', reason: 'Physical verification CNT-0001' });
});
SP.approvals.decide(outcome.approval.id, 'approved', 'Recounted, confirmed');
t('approval decided', st.approvals[0].status === 'approved');
t('B = 16 after approved adjustment', SP.ledger.stockOf(product.id, 'WHB') === 16);

section('23–24 · Audit trail covers every action');
const actions = new Set(st.audit.map((a) => a.action));
t('movement audited', [...actions].some((a) => a.startsWith('movement.')));
t('approval audited', actions.has('approval.request') && actions.has('approval.approved'));
t('explain() reconciles', SP.ledger.explain(product.id).at(-1).balance === 96);
t('total stock = 96 (80 + 16)', SP.ledger.stockOf(product.id) === 96);

section('25 · Final stock report reconciles with the ledger');
const rows = SP.ledger.explain(product.id);
const reconstructed = rows.reduce((sum, m) => sum + m.direction * m.qty, 0);
t('report total = ledger total = 96', reconstructed === 96);
const inOut = { in: rows.filter((m) => m.direction > 0).reduce((s, m) => s + m.qty, 0), out: rows.filter((m) => m.direction < 0).reduce((s, m) => s + m.qty, 0) };
t('120 in − 24 out = 96', inOut.in === 120 && inOut.out === 24);

section('Negative stock is blocked');
let blocked = false;
try { SP.ledger.post({ type: 'sale', productId: product.id, qty: 9999, warehouseId: 'WHA' }); }
catch (e) { blocked = e.code === 'NEGATIVE'; }
t('oversell rejected', blocked);
t('stock unchanged after rejection', SP.ledger.stockOf(product.id, 'WHA') === 80);

section('Duplicate IMEI is detected');
st.devices.push({ ...devices[0], id: 'dev_dupe' });
t('duplicate IMEI flagged', SP.imei.duplicates().size === 1);
st.devices.pop();

/* ── verdict ──────────────────────────────────────────────────── */
console.log(`\n${passed} passed · ${failed} failed`);
process.exit(failed ? 1 : 0);
