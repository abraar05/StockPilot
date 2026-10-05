/**
 * config.js — application configuration and domain constants.
 * Loaded first; everything hangs off the single global `SP`.
 *
 * StockPilot 2.0 — Inventory Intelligence & Warehouse Operations Platform.
 */
window.SP = window.SP || {};

SP.VERSION = '2.0.0';
SP.BUILD = '2026.10.05';
SP.PRODUCT_NAME = 'StockPilot 2.0';

/* ───────────────────────────────────────────────────────────── storage */
SP.STORAGE_KEY = 'stockpilot.state.v3';
SP.LEGACY_STORAGE_KEYS = ['stockpilot.state.v2'];
SP.SESSION_KEY = 'stockpilot.session.v1';
SP.PREF_KEY = 'stockpilot.prefs.v1';
SP.SPACE = 24; // PBKDF2 rounds multiplier

/* ─────────────────────────────────────────────── Google Sheet linkage */
SP.sheet = {
  docId: '1yFF3xhseJdsJQFRnyQYP9P3qakIhoDECITxTJclE39Y',
  url: 'https://docs.google.com/spreadsheets/d/1yFF3xhseJdsJQFRnyQYP9P3qakIhoDECITxTJclE39Y/edit?usp=sharing',
  csvUrl: 'https://docs.google.com/spreadsheets/d/1yFF3xhseJdsJQFRnyQYP9P3qakIhoDECITxTJclE39Y/export?format=csv',
  bridgeUrl: '',
  autoSyncMinutes: 30,
  timeoutMs: 12000,
};

/* ────────────────────────────────────────────────────────────── domain */

SP.COLOURS = [
  'Gold', 'Silver', 'Black', 'White', 'Orange', 'Red', 'Green',
  'Blue', 'Brown', 'T.Gray', 'Grey', 'Purple', 'Others',
];

/** Configurable stock classifications (admins may extend in Settings). */
SP.STOCK_TYPES = [
  { id: 'regular', label: 'Regular' },
  { id: 'lmp', label: 'LMP' },
  { id: 'repair_return', label: 'Repair & Return' },
];

/** Ledger movement types. direction: +1 in, -1 out, 0 neutral. */
SP.MOVEMENT_TYPES = [
  { id: 'opening', label: 'Opening stock', direction: 1, tone: 'mute' },
  { id: 'receive', label: 'Goods received', direction: 1, tone: 'ok' },
  { id: 'purchase_return_in', label: 'Return in', direction: 1, tone: 'ok' },
  { id: 'transfer_out', label: 'Transfer out', direction: -1, tone: 'warn' },
  { id: 'transfer_in', label: 'Transfer in', direction: 1, tone: 'ok' },
  { id: 'sale', label: 'Sale', direction: -1, tone: 'brand' },
  { id: 'sale_return', label: 'Sale return', direction: 1, tone: 'info' },
  { id: 'adjust_in', label: 'Adjustment in', direction: 1, tone: 'info' },
  { id: 'adjust_out', label: 'Adjustment out', direction: -1, tone: 'warn' },
  { id: 'damage', label: 'Damage', direction: -1, tone: 'danger' },
  { id: 'write_off', label: 'Write-off', direction: -1, tone: 'danger' },
  { id: 'repair_out', label: 'Sent to repair', direction: -1, tone: 'warn' },
  { id: 'repair_in', label: 'Back from repair', direction: 1, tone: 'ok' },
  { id: 'reserve', label: 'Reservation', direction: 0, tone: 'info' },
  { id: 'release', label: 'Release reservation', direction: 0, tone: 'mute' },
];

SP.movementType = (id) => SP.MOVEMENT_TYPES.find((t) => t.id === id)
  || { id, label: id, direction: 0, tone: 'mute' };

/** Physical device lifecycle statuses. */
SP.DEVICE_STATUS = [
  { id: 'received', label: 'Received', tone: 'info' },
  { id: 'available', label: 'Available', tone: 'ok' },
  { id: 'reserved', label: 'Reserved', tone: 'brand' },
  { id: 'in_transit', label: 'In transit', tone: 'warn' },
  { id: 'transferred', label: 'Transferred', tone: 'info' },
  { id: 'sold', label: 'Sold', tone: 'mute' },
  { id: 'returned', label: 'Returned', tone: 'info' },
  { id: 'repair', label: 'Repair', tone: 'warn' },
  { id: 'refurbished', label: 'Refurbished', tone: 'brand' },
  { id: 'damaged', label: 'Damaged', tone: 'danger' },
  { id: 'written_off', label: 'Written off', tone: 'danger' },
];

SP.deviceStatus = (id) => SP.DEVICE_STATUS.find((s) => s.id === id)
  || { id, label: id, tone: 'mute' };

/** Order status machines. */
SP.STATUS = {
  po: [
    { id: 'draft', label: 'Draft', tone: 'mute' },
    { id: 'pending', label: 'Awaiting approval', tone: 'warn' },
    { id: 'approved', label: 'Approved', tone: 'info' },
    { id: 'ordered', label: 'Ordered', tone: 'brand' },
    { id: 'partial', label: 'Partially received', tone: 'warn' },
    { id: 'received', label: 'Received', tone: 'ok' },
    { id: 'cancelled', label: 'Cancelled', tone: 'danger' },
  ],
  transfer: [
    { id: 'requested', label: 'Requested', tone: 'info' },
    { id: 'approved', label: 'Approved', tone: 'brand' },
    { id: 'picking', label: 'Picking', tone: 'info' },
    { id: 'dispatched', label: 'Dispatched', tone: 'warn' },
    { id: 'in_transit', label: 'In transit', tone: 'warn' },
    { id: 'received', label: 'Received', tone: 'ok' },
    { id: 'completed', label: 'Completed', tone: 'ok' },
    { id: 'rejected', label: 'Rejected', tone: 'danger' },
    { id: 'cancelled', label: 'Cancelled', tone: 'danger' },
  ],
  sale: [
    { id: 'quotation', label: 'Quotation', tone: 'mute' },
    { id: 'order', label: 'Sales order', tone: 'info' },
    { id: 'invoiced', label: 'Invoiced', tone: 'brand' },
    { id: 'delivered', label: 'Delivered', tone: 'ok' },
    { id: 'partial_return', label: 'Partial return', tone: 'warn' },
    { id: 'returned', label: 'Returned', tone: 'warn' },
    { id: 'cancelled', label: 'Cancelled', tone: 'danger' },
  ],
  payment: [
    { id: 'unpaid', label: 'Unpaid', tone: 'danger' },
    { id: 'partial', label: 'Partially paid', tone: 'warn' },
    { id: 'paid', label: 'Paid', tone: 'ok' },
  ],
  approval: [
    { id: 'pending', label: 'Pending', tone: 'warn' },
    { id: 'approved', label: 'Approved', tone: 'ok' },
    { id: 'rejected', label: 'Rejected', tone: 'danger' },
    { id: 'info_requested', label: 'Info requested', tone: 'info' },
    { id: 'cancelled', label: 'Cancelled', tone: 'mute' },
  ],
  count: [
    { id: 'open', label: 'Counting', tone: 'info' },
    { id: 'submitted', label: 'Submitted', tone: 'warn' },
    { id: 'approved', label: 'Approved', tone: 'ok' },
    { id: 'rejected', label: 'Rejected', tone: 'danger' },
  ],
};

SP.statusOf = (kind, id) => (SP.STATUS[kind] || []).find((s) => s.id === id)
  || { id, label: id, tone: 'mute' };

/** The refill decision rule carried over from v1. */
SP.RULES = {
  refillMax: 50,
  targetCover: 2,
  defaultCoverWeeks: 4,
  deadStockDays: 60,
  minOrderValue: 5000,
};

/* ─────────────────────────────────────────────── roles & permissions */

/**
 * Permission model: `module:action` where action ∈
 * view | create | edit | delete | approve | export | import
 * `*` grants everything. Warehouse scoping is applied on top.
 */
SP.PERMS = {
  'dashboard:view': 'View dashboard',
  'inventory:view': 'View inventory',
  'inventory:export': 'Export inventory',
  'products:view': 'View products',
  'products:create': 'Create products',
  'products:edit': 'Edit products',
  'products:delete': 'Delete products',
  'products:import': 'Import products',
  'devices:view': 'View devices & IMEI',
  'devices:create': 'Register devices',
  'devices:edit': 'Edit devices',
  'devices:import': 'Import IMEIs',
  'warehouses:view': 'View warehouses',
  'warehouses:manage': 'Manage warehouses & locations',
  'movements:view': 'View stock movements',
  'movements:create': 'Record stock IN/OUT',
  'movements:adjust': 'Create stock adjustments',
  'transfers:view': 'View transfers',
  'transfers:create': 'Create transfers',
  'transfers:approve': 'Approve transfers',
  'transfers:dispatch': 'Dispatch transfers',
  'transfers:receive': 'Receive transfers',
  'sales:view': 'View sales',
  'sales:create': 'Create sales & invoices',
  'sales:discount': 'Apply discounts',
  'purchases:view': 'View purchases',
  'purchases:create': 'Create purchase orders',
  'purchases:approve': 'Approve purchase orders',
  'purchases:receive': 'Receive goods',
  'customers:view': 'View customers',
  'customers:manage': 'Manage customers',
  'suppliers:view': 'View suppliers',
  'suppliers:manage': 'Manage suppliers',
  'payments:create': 'Record payments',
  'reports:view': 'View reports',
  'reports:export': 'Export reports',
  'approvals:view': 'View approvals',
  'approvals:decide': 'Decide approvals',
  'verify:perform': 'Perform stock verification',
  'verify:approve': 'Approve variances',
  'audit:view': 'View audit log',
  'audit:export': 'Export audit log',
  'users:manage': 'Manage users & roles',
  'settings:manage': 'Manage settings',
  'data:manage': 'Backup, restore & purge data',
  'cost:view': 'View cost & valuation figures',
  'ai:use': 'Use the AI assistant',
};

/** Roles, ordered least → most privileged. */
SP.ROLES = [
  {
    id: 'viewer', label: 'Viewer',
    blurb: 'Read-only access to dashboards and stock levels.',
    perms: ['dashboard:view', 'inventory:view', 'products:view', 'devices:view', 'reports:view'],
  },
  {
    id: 'auditor', label: 'Auditor',
    blurb: 'Read everything, including the audit log. Cannot modify.',
    perms: [
      'dashboard:view', 'inventory:view', 'inventory:export', 'products:view', 'devices:view',
      'warehouses:view', 'movements:view', 'transfers:view', 'sales:view', 'purchases:view',
      'customers:view', 'suppliers:view', 'reports:view', 'reports:export',
      'audit:view', 'audit:export', 'approvals:view', 'cost:view',
    ],
  },
  {
    id: 'salesperson', label: 'Salesperson',
    blurb: 'Sell stock and manage own customers.',
    perms: [
      'dashboard:view', 'inventory:view', 'products:view', 'devices:view',
      'sales:view', 'sales:create', 'customers:view', 'customers:manage',
      'payments:create', 'reports:view',
    ],
  },
  {
    id: 'warehouse_staff', label: 'Warehouse Staff',
    blurb: 'Receive, pick, transfer and verify stock in their warehouse.',
    perms: [
      'dashboard:view', 'inventory:view', 'products:view', 'devices:view', 'devices:create',
      'warehouses:view', 'movements:view', 'movements:create',
      'transfers:view', 'transfers:create', 'transfers:dispatch', 'transfers:receive',
      'verify:perform', 'purchases:view', 'purchases:receive',
    ],
  },
  {
    id: 'sales_manager', label: 'Sales Manager',
    blurb: 'Manage the sales team, discounts and customer credit.',
    perms: [
      'dashboard:view', 'inventory:view', 'inventory:export', 'products:view', 'devices:view',
      'sales:view', 'sales:create', 'sales:discount',
      'customers:view', 'customers:manage', 'payments:create',
      'reports:view', 'reports:export', 'approvals:view', 'approvals:decide',
    ],
  },
  {
    id: 'purchasing', label: 'Purchasing',
    blurb: 'Raise purchase orders and manage suppliers.',
    perms: [
      'dashboard:view', 'inventory:view', 'products:view', 'products:create',
      'suppliers:view', 'suppliers:manage',
      'purchases:view', 'purchases:create', 'purchases:receive',
      'payments:create', 'reports:view',
    ],
  },
  {
    id: 'finance', label: 'Finance',
    blurb: 'Payments, ledgers, valuation and cost visibility.',
    perms: [
      'dashboard:view', 'inventory:view', 'products:view',
      'sales:view', 'purchases:view', 'customers:view', 'suppliers:view',
      'payments:create', 'reports:view', 'reports:export',
      'cost:view', 'audit:view',
    ],
  },
  {
    id: 'warehouse_manager', label: 'Warehouse Manager',
    blurb: 'Full control of warehouse operations and approvals.',
    perms: [
      'dashboard:view', 'inventory:view', 'inventory:export',
      'products:view', 'products:create', 'products:edit',
      'devices:view', 'devices:create', 'devices:edit', 'devices:import',
      'warehouses:view', 'warehouses:manage',
      'movements:view', 'movements:create', 'movements:adjust',
      'transfers:view', 'transfers:create', 'transfers:approve', 'transfers:dispatch', 'transfers:receive',
      'verify:perform', 'verify:approve',
      'purchases:view', 'purchases:create', 'purchases:receive',
      'sales:view', 'sales:create',
      'reports:view', 'reports:export', 'approvals:view', 'approvals:decide',
      'cost:view', 'ai:use',
    ],
  },
  {
    id: 'admin', label: 'Administrator',
    blurb: 'Full control: users, rules, catalogue, integrations and audit.',
    perms: ['*'],
  },
];

/* Legacy role ids from v1 map forward. */
SP.ROLE_MIGRATION = { storekeeper: 'warehouse_staff', manager: 'warehouse_manager', viewer: 'viewer', admin: 'admin' };

/* ───────────────────────────────────────────────────────── navigation */
SP.NAV = [
  {
    group: 'Operations',
    items: [
      { route: 'dashboard', label: 'Dashboard', icon: 'grid', tab: true },
      { route: 'inventory', label: 'Inventory', icon: 'box', tab: true },
      { route: 'movements', label: 'Stock Movements', icon: 'history', perm: 'movements:view' },
      { route: 'transfers', label: 'Transfers', icon: 'swap', perm: 'transfers:view', badge: 'transfers' },
      { route: 'warehouses', label: 'Warehouses', icon: 'home', perm: 'warehouses:view' },
      { route: 'locations', label: 'Locations', icon: 'pin', perm: 'warehouses:view' },
      { route: 'verify', label: 'Stock Verification', icon: 'scale', perm: 'verify:perform' },
    ],
  },
  {
    group: 'Catalogue',
    items: [
      { route: 'products', label: 'Products / SKUs', icon: 'tag', perm: 'products:view' },
      { route: 'devices', label: 'Devices / IMEI', icon: 'layers', perm: 'devices:view' },
    ],
  },
  {
    group: 'Commerce',
    items: [
      { route: 'sales', label: 'Sales', icon: 'truck', perm: 'sales:view' },
      { route: 'purchases', label: 'Purchases', icon: 'cart', perm: 'purchases:view' },
      { route: 'customers', label: 'Customers', icon: 'users', perm: 'customers:view' },
      { route: 'suppliers', label: 'Suppliers', icon: 'building', perm: 'suppliers:view' },
    ],
  },
  {
    group: 'Intelligence',
    items: [
      { route: 'reports', label: 'Reports', icon: 'file', perm: 'reports:view' },
      { route: 'analytics', label: 'Analytics', icon: 'chart', perm: 'reports:view' },
      { route: 'refill', label: 'Reorder Radar', icon: 'radar', perm: 'reports:view' },
      { route: 'ai', label: 'AI Assistant', icon: 'sparkles', perm: 'ai:use' },
      { route: 'alerts', label: 'Alert Center', icon: 'bell', badge: 'alerts' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { route: 'approvals', label: 'Approvals', icon: 'checkCircle', perm: 'approvals:view', badge: 'approvals' },
      { route: 'users', label: 'Users & Roles', icon: 'shield', perm: 'users:manage' },
      { route: 'audit', label: 'Audit Log', icon: 'database', perm: 'audit:view' },
      { route: 'settings', label: 'Settings', icon: 'cog' },
      { route: 'about', label: 'System Info', icon: 'info' },
      { route: 'help', label: 'Help & Tips', icon: 'help' },
    ],
  },
];

/** Bottom tab bar order (mobile). */
SP.TABS = ['dashboard', 'inventory', 'actions', 'transfers', 'more'];

/** Mobile primary actions surfaced in the centre tab. */
SP.MOBILE_ACTIONS = [
  { id: 'scan', label: 'Scan', icon: 'target', route: 'devices', perm: 'devices:view' },
  { id: 'receive', label: 'Receive', icon: 'download', route: 'purchases', params: { compose: 'receive' }, perm: 'purchases:receive' },
  { id: 'transfer', label: 'Transfer', icon: 'swap', route: 'transfers', params: { compose: '1' }, perm: 'transfers:create' },
  { id: 'pick', label: 'Pick', icon: 'box', route: 'transfers', params: { status: 'approved' }, perm: 'transfers:view' },
  { id: 'verify', label: 'Verify', icon: 'scale', route: 'verify', perm: 'verify:perform' },
  { id: 'sell', label: 'Sell', icon: 'truck', route: 'sales', params: { compose: '1' }, perm: 'sales:create' },
];

/* ─────────────────────────────────────────────────────── approval rules */
/**
 * Configurable approval workflows. `when` receives a context object and
 * returns true when the action requires a decision before it may proceed.
 */
SP.APPROVAL_KINDS = [
  { id: 'adjustment', label: 'Stock adjustment' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'discount', label: 'Sale discount' },
  { id: 'purchase', label: 'Purchase order' },
  { id: 'variance', label: 'Verification variance' },
  { id: 'write_off', label: 'Damage / write-off' },
];

SP.DEFAULT_APPROVAL_RULES = [
  { id: 'ar_discount', kind: 'discount', enabled: true, thresholdPct: 5, approverRoles: ['sales_manager', 'admin'], label: 'Discount above 5%' },
  { id: 'ar_adjust', kind: 'adjustment', enabled: true, thresholdQty: 5, approverRoles: ['warehouse_manager', 'admin'], label: 'Adjustment above 5 units' },
  { id: 'ar_transfer', kind: 'transfer', enabled: true, thresholdQty: 50, approverRoles: ['warehouse_manager', 'admin'], label: 'Transfer above 50 units' },
  { id: 'ar_purchase', kind: 'purchase', enabled: true, thresholdValue: 100000, approverRoles: ['admin'], label: 'Purchase above ৳100k' },
  { id: 'ar_variance', kind: 'variance', enabled: true, thresholdQty: 0, approverRoles: ['warehouse_manager', 'admin'], label: 'Any verification variance' },
  { id: 'ar_writeoff', kind: 'write_off', enabled: true, thresholdQty: 0, approverRoles: ['warehouse_manager', 'admin'], label: 'Any damage / write-off' },
];

/* ────────────────────────────────────────────────────── onboarding copy */
SP.ONBOARD = [
  { title: 'What brings you here?', sub: 'We tailor the dashboard to your role. You can change this any time.', field: 'role' },
  { title: 'Which warehouse do you look after?', sub: 'Sets your default warehouse. Admins can see every site.', field: 'warehouse' },
  { title: 'How should we alert you?', sub: 'Control how loudly StockPilot interrupts you about low stock.', field: 'alerts' },
];

/** First-run tips surfaced progressively across the app. */
SP.TIPS = [
  { id: 'search', where: 'dashboard', text: 'Tap the magnifier (or press Ctrl + K) to jump to any SKU, IMEI, transfer or module instantly.' },
  { id: 'ledger', where: 'inventory', text: 'Every quantity is derived from the movement ledger. Open any product to see the full calculation.' },
  { id: 'transfer', where: 'warehouses', text: 'Before buying, try a transfer — moving stock between warehouses is nearly always cheaper.' },
  { id: 'imei', where: 'devices', text: 'Scan or type an IMEI to see the complete history of one physical device.' },
  { id: 'verify', where: 'verify', text: 'Cycle counts keep the ledger honest. Generate a sheet, count, and post variances with approval.' },
  { id: 'offline', where: 'settings', text: 'StockPilot works offline. Edits are saved on this device and survive a restart.' },
];

/* ───────────────────────────────────────────────────────────── locale */
SP.LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'bn', label: 'বাংলা (planned)', planned: true },
];
