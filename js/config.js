/**
 * config.js — application configuration and domain constants.
 * Loaded first; everything hangs off the single global `SP`.
 */
window.SP = window.SP || {};

SP.VERSION = '1.0.0';
SP.BUILD = '2026.09.01';

/* ───────────────────────────────────────────────────────────── storage */
SP.STORAGE_KEY = 'stockpilot.state.v2';
SP.SESSION_KEY = 'stockpilot.session.v1';
SP.PREF_KEY = 'stockpilot.prefs.v1';
SP.SPACE = 24; // PBKDF2 rounds multiplier

/* ─────────────────────────────────────────────── Google Sheet linkage */
SP.sheet = {
  docId: '1yFF3xhseJdsJQFRnyQYP9P3qakIhoDECITxTJclE39Y',
  url: 'https://docs.google.com/spreadsheets/d/1yFF3xhseJdsJQFRnyQYP9P3qakIhoDECITxTJclE39Y/edit?usp=sharing',
  csvUrl: 'https://docs.google.com/spreadsheets/d/1yFF3xhseJdsJQFRnyQYP9P3qakIhoDECITxTJclE39Y/export?format=csv',
  /**
   * Optional Apps Script web-app bridge. When set, StockPilot uses it for
   * authenticated read + write. Leave blank to run on the bundled snapshot.
   * Setup instructions: README.md → "Connect the Google Sheet".
   */
  bridgeUrl: '',
  autoSyncMinutes: 30,
  timeoutMs: 12000,
};

/* ────────────────────────────────────────────────────────────── domain */

/** Fallback colours; the seed file supplies the authoritative hex list. */
SP.COLOURS = [
  'Gold', 'Silver', 'Black', 'White', 'Orange', 'Red', 'Green',
  'Blue', 'Brown', 'T.Gray', 'Grey', 'Purple', 'Others',
];

SP.WAREHOUSES = [
  { id: 'MAIN', label: 'Main Warehouse', short: 'Main', custodian: 'Abraar Ahmed', color: '#5b8cff' },
  { id: 'ADMIN', label: 'Admin Store', short: 'Admin', custodian: 'Ref. Abraar', color: '#a78bfa' },
  { id: 'ALPANA', label: 'Alpana Store', short: 'Alpana', custodian: 'Abraar / Mr. Rashed', color: '#34d399' },
  { id: 'NAZRUL', label: 'Nazrul Store', short: 'Nazrul', custodian: 'Ref. Mr. Ahad', color: '#fbbf24' },
];

/**
 * The refill decision rule carried over from the source workbook:
 *   0 units        → Restock Priority   (do not sell, buy now)
 *   1 – 50 units   → Refill             (watch, plan a top-up)
 *   > 50 units     → Adequate           (do not spend)
 */
SP.RULES = {
  refillMax: 50,
  targetCover: 2,      // target on-hand expressed in weeks of cover
  defaultCoverWeeks: 4,
  deadStockDays: 60,
  minOrderValue: 5000,
};

/** Roles, ordered least → most privileged. */
SP.ROLES = [
  {
    id: 'viewer',
    label: 'Viewer',
    blurb: 'Read-only access to dashboards and stock levels.',
    perms: ['view:dashboard', 'view:inventory', 'view:insights'],
  },
  {
    id: 'storekeeper',
    label: 'Storekeeper',
    blurb: 'Update stock, record dispatches and raise transfers.',
    perms: [
      'view:dashboard', 'view:inventory', 'view:insights',
      'edit:stock', 'create:sale', 'create:transfer',
    ],
  },
  {
    id: 'manager',
    label: 'Manager',
    blurb: 'Everything a storekeeper can do, plus purchasing and approvals.',
    perms: [
      'view:dashboard', 'view:inventory', 'view:insights',
      'edit:stock', 'edit:anywhere', 'create:sale', 'create:transfer',
      'create:po', 'approve:po', 'view:cost',
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    blurb: 'Full control: users, rules, catalogue, sheet sync and audit.',
    perms: ['*'],
  },
];

SP.PERMS = {
  'view:dashboard': 'View dashboards',
  'view:inventory': 'View inventory',
  'view:insights': 'View insights',
  'edit:stock': 'Edit stock in own warehouse',
  'edit:anywhere': 'Edit stock in any warehouse',
  'create:sale': 'Record dispatches / sales',
  'create:transfer': 'Create transfers',
  'create:po': 'Create purchase orders',
  'approve:po': 'Approve purchase orders',
  'view:cost': 'View cost & capital figures',
  'manage:users': 'Manage users & roles',
  'manage:rules': 'Manage decision rules',
  'manage:sheet': 'Manage sheet connection',
  'manage:data': 'Delete / purge data',
};

/** Order status machine shared by purchases and transfers. */
SP.STATUS = {
  po: [
    { id: 'draft', label: 'Draft', tone: 'mute' },
    { id: 'pending', label: 'Awaiting approval', tone: 'warn' },
    { id: 'approved', label: 'Approved', tone: 'info' },
    { id: 'ordered', label: 'Ordered', tone: 'brand' },
    { id: 'received', label: 'Received', tone: 'ok' },
    { id: 'cancelled', label: 'Cancelled', tone: 'danger' },
  ],
  transfer: [
    { id: 'requested', label: 'Requested', tone: 'info' },
    { id: 'approved', label: 'Approved', tone: 'brand' },
    { id: 'in_transit', label: 'In transit', tone: 'warn' },
    { id: 'received', label: 'Received', tone: 'ok' },
    { id: 'rejected', label: 'Rejected', tone: 'danger' },
  ],
};

/** Reference unit costs used for capital planning (editable in Admin). */
SP.costFor = (sku) => {
  const m = /(\d+)\s*\|\s*(\d+)\s*GB/i.exec(sku.specs || '');
  const ram = m ? Number(m[1]) : 8;
  const storage = m ? Number(m[2]) : 128;
  const base = 4200 + ram * 210 + storage * 3.4;
  const premium = /PAD|TAB|17T|MAGIC 8|PRO\+/i.test(sku.sku || '') ? 1.42 : 1;
  return Math.round(base * premium / 50) * 50;
};

/* ───────────────────────────────────────────────────────── navigation */
SP.NAV = [
  {
    group: 'Overview',
    items: [
      { route: 'dashboard', label: 'Dashboard', icon: 'grid', tab: true },
      { route: 'refill', label: 'Refill Radar', icon: 'radar', tab: true, badge: 'alerts' },
      { route: 'insights', label: 'Insights', icon: 'sparkles', tab: true },
    ],
  },
  {
    group: 'Stock',
    items: [
      { route: 'inventory', label: 'Inventory', icon: 'box', tab: true },
      { route: 'warehouses', label: 'Warehouses', icon: 'home' },
      { route: 'sales', label: 'Dispatch Log', icon: 'truck', tab: true },
      { route: 'transfers', label: 'Transfers', icon: 'swap' },
    ],
  },
  {
    group: 'Supply',
    items: [
      { route: 'purchase', label: 'Purchase Orders', icon: 'cart' },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { route: 'admin', label: 'Admin Console', icon: 'shield', perm: 'manage:users' },
      { route: 'settings', label: 'Settings', icon: 'cog' },
      { route: 'help', label: 'Help & Tips', icon: 'help' },
    ],
  },
];

/** Bottom tab bar order (mobile). */
SP.TABS = ['dashboard', 'refill', 'inventory', 'sales', 'more'];

/* ────────────────────────────────────────────────────── onboarding copy */
SP.ONBOARD = [
  {
    title: 'What brings you here?',
    sub: 'We tailor the dashboard to your role. You can change this any time.',
    field: 'role',
  },
  {
    title: 'Which site do you look after?',
    sub: 'Sets your default warehouse. Admins can see every site.',
    field: 'warehouse',
  },
  {
    title: 'How should we alert you?',
    sub: 'Control how loudly StockPilot interrupts you about low stock.',
    field: 'alerts',
  },
];

/** First-run tips surfaced progressively across the app. */
SP.TIPS = [
  { id: 'search', where: 'dashboard', text: 'Tap the magnifier (or press Ctrl + K) to jump to any SKU or module instantly.' },
  { id: 'bands', where: 'dashboard', text: 'The three coloured bands are the decision rule: red = buy now, amber = plan a top-up, green = leave alone.' },
  { id: 'quickstock', where: 'inventory', text: 'Tap any row to adjust colour-level quantities instantly — changes are logged and can be pushed to the sheet.' },
  { id: 'radar', where: 'refill', text: 'Refill Radar ranks what to buy by urgency and suggests quantities sized to cover the gap.' },
  { id: 'transfer', where: 'warehouses', text: 'Before buying, try a transfer — moving stock between sites is nearly always cheaper.' },
  { id: 'offline', where: 'settings', text: 'Edits queue while offline and sync automatically once you reconnect.' },
];