export type NavLeaf = {
  label: string;
  path: string;
  icon?: string;
  badge?: string;
};

export type NavSection = {
  section: string;
  items: NavLeaf[];
};

export type NavEntry = NavLeaf | NavSection;

export function isSection(e: NavEntry): e is NavSection {
  return 'section' in e;
}

// ── IFRS Suite (all roles) ────────────────────────────────────────────────────
export const IFRS_SUITE_NAV: NavSection = {
  section: 'IFRS Suite',
  items: [
    { label: 'IFRS 15 — Revenue', path: '/ifrs/15', icon: 'bar-chart-2', badge: 'Soon' },
    { label: 'IFRS 9 — Instruments', path: '/ifrs/9', icon: 'shield', badge: 'Soon' },
  ],
};

// ── UAE Finance Suite (uae_client role) ───────────────────────────────────────
export const UAE_FINANCE_SUITE_NAV: NavEntry[] = [
  {
    section: '🇦🇪 UAE Finance Suite',
    items: [
      { label: 'AP InvoiceFlow', path: '/ap-invoices', icon: 'shopping-cart', badge: 'AP' },
      { label: 'UAE Tax (GulfTax)', path: '/gulftax', icon: 'shield' },
      { label: 'E-Invoicing', path: '/gulftax/e-invoicing', icon: 'receipt', badge: 'Peppol' },
      { label: 'IFRS 16 Leases', path: '/ifrs/16', icon: 'building-2', badge: 'IFRS' },
    ],
  },
];

// ── India Suite ───────────────────────────────────────────────────────────────
export const INDIA_NAV: NavEntry[] = [
  { label: 'Dashboard',          path: '/india-full',           icon: 'layout-dashboard' },
  { label: 'Chart of Accounts',  path: '/india-full/coa',       icon: 'book' },
  { label: 'Journal Entries',    path: '/india-full/journals',  icon: 'file-text' },
  { label: 'Sales Invoices',     path: '/india-full/sales',     icon: 'receipt' },
  { label: 'Purchase + ITC',     path: '/india-full/purchases', icon: 'shopping-cart' },
  { label: 'GST Returns',        path: '/india-full/gst',       icon: 'percent' },
  { label: 'TDS Management',     path: '/india-full/tds',       icon: 'calculator' },
  { label: 'Payroll',            path: '/india-full/payroll',   icon: 'users' },
  { label: 'Fixed Assets',       path: '/india-full/assets',    icon: 'building-2' },
  { label: 'Bank Recon',         path: '/ca-firm/bank-recon',   icon: 'landmark' },
  { label: 'Period-End Close',   path: '/india-full/close',     icon: 'lock' },
  { label: 'Management Accounts',path: '/india-full/management',icon: 'bar-chart-2' },
  {
    section: 'India AI Layer',
    items: [
      { label: 'JE Anomaly Detection', path: '/r2r/pattern',           icon: 'brain',    badge: 'AI' },
      { label: 'GST Notice Bot',        path: '/ca-firm/bank-processor',icon: 'bot',      badge: 'AI' },
      { label: 'Tally Connector',       path: '/erp/tally',             icon: 'plug',     badge: 'ERP' },
    ],
  },
];

// ── UAE Suite ─────────────────────────────────────────────────────────────────
export const UAE_NAV: NavEntry[] = [
  { label: 'Workspaces',         path: '/workspaces',            icon: 'building-2' },
  { label: 'Company Setup',      path: '/company-setup',         icon: 'sliders', badge: 'Setup' },
  { label: 'Dashboard',          path: '/uae-full',              icon: 'layout-dashboard' },
  { label: 'Chart of Accounts',  path: '/uae-full/coa',          icon: 'book' },
  { label: 'Journal Entries',    path: '/uae-full/journals',     icon: 'file-text' },
  { label: 'Classify Accounts',  path: '/uae-full/classify-accounts', icon: 'tags', badge: 'AI' },
  { label: 'Sales Invoices',     path: '/uae-full/invoices',     icon: 'receipt' },
  {
    section: 'Receivables',
    items: [
      { label: 'Sales Invoices', path: '/uae-full/ar',           icon: 'receipt' },
      { label: 'Customer Risk',  path: '/uae-full/ar/customer-risk', icon: 'shield-alert' },
      { label: 'AR Dunning',     path: '/uae-full/ar/dunning',     icon: 'mail' },
      { label: 'Recurring',      path: '/uae-full/ar/recurring',   icon: 'calendar-clock' },
      { label: 'AR Aging',       path: '/uae-full/ar#aging',     icon: 'bar-chart-2' },
      { label: 'O2C Dashboard',  path: '/o2c',                   icon: 'activity', badge: 'O2C' },
    ],
  },
  {
    section: 'CRM',
    items: [
      { label: 'Dashboard',  path: '/crm',             icon: 'layout-dashboard' },
      { label: 'Contacts',   path: '/crm/contacts',    icon: 'users' },
      { label: 'Deals',      path: '/crm/deals',       icon: 'trending-up' },
      { label: 'Quotes',     path: '/crm/quotes',      icon: 'file-text' },
      { label: 'Activities', path: '/crm/activities',  icon: 'calendar' },
    ],
  },
  { label: 'AP InvoiceFlow',     path: '/ap-invoices',           icon: 'shopping-cart',  badge: 'AP' },
  { label: 'Bank Recon',         path: '/uae-full/bank-recon',   icon: 'landmark' },
  { label: 'Accruals',           path: '/uae-full/accruals',     icon: 'clock' },
  { label: 'Fixed Assets',       path: '/uae-full/fixed-assets', icon: 'building-2' },
  { label: 'Period-End Close',   path: '/uae-full/period-close',       icon: 'lock' },
  { label: 'Close Status',       path: '/accounting/close-status',     icon: 'activity', badge: 'NEW' },
  { label: 'Management Accounts',path: '/uae-full/management',         icon: 'bar-chart-2' },
  {
    section: 'GulfTax AI',
    items: [
      { label: 'GulfTax Dashboard',  path: '/gulftax',                       icon: 'shield' },
      { label: 'E-Invoicing',        path: '/gulftax/e-invoicing',           icon: 'receipt',  badge: 'Peppol' },
      { label: 'VAT Classifier',     path: '/gulftax/vat-classifier',        icon: 'percent' },
      { label: 'Invoice Flow',       path: '/gulftax/invoice-flow',          icon: 'file-text' },
      { label: 'VAT Return',         path: '/gulftax/vat-return',            icon: 'file-text' },
      { label: 'Reconciliation',     path: '/gulftax/reconciliation',        icon: 'git-merge' },
      { label: 'Corporate Tax',      path: '/gulftax/corporate-tax',         icon: 'building' },
      { label: 'CIT Return',         path: '/gulftax/corporate-tax/return',  icon: 'file-text', badge: 'CT' },
      { label: 'ESR Filing',         path: '/gulftax/esr-filing',            icon: 'file-check' },
      { label: 'Transfer Pricing',   path: '/gulftax/transfer-pricing',      icon: 'scale' },
      { label: 'CbCR Report',        path: '/gulftax/cbcr',                  icon: 'globe' },
      { label: 'Tax Memo',           path: '/gulftax/tax-memo',              icon: 'scroll-text' },
      { label: 'FTA Reports',        path: '/gulftax/fta-reports',           icon: 'bar-chart-2' },
      { label: 'Supplier Ledger',    path: '/gulftax/suppliers',             icon: 'factory' },
      { label: 'GulfTax Settings',   path: '/gulftax/settings',              icon: 'sliders' },
    ],
  },
  {
    section: 'UAE Compliance',
    items: [
      { label: 'VAT Returns',        path: '/uae-accounting',    icon: 'percent',          badge: 'VAT' },
      { label: 'Corporate Tax 9%',   path: '/uae-accounting',    icon: 'building',         badge: 'CT' },
      { label: 'IFRS Statement Gen', path: '/ifrs-statement',    icon: 'file-text',        badge: 'IFRS' },
    ],
  },
  IFRS_SUITE_NAV,
  {
    section: 'IFRS 15 Revenue',
    items: [
      { label: 'Rev Rec Recon',       path: '/r2r/rev-rec',              icon: 'bar-chart-2' },
      { label: 'Contract Portfolio',  path: '/r2r/rev-rec/contracts',    icon: 'file-text', badge: 'IFRS 15' },
    ],
  },
  {
    section: 'IFRS 9 — Credit Losses',
    items: [
      { label: 'ECL Dashboard',   path: '/ifrs9',              icon: 'shield' },
      { label: 'ECL Calculator',  path: '/ifrs9/calculator',   icon: 'calculator' },
      { label: 'Asset Staging',   path: '/ifrs9/staging',      icon: 'layers' },
      { label: 'ECL History',     path: '/ifrs9/history',      icon: 'clock', badge: 'IFRS 9' },
    ],
  },
  {
    section: 'UAE AI Layer',
    items: [
      { label: 'R2R Pattern Engine', path: '/r2r/pattern',         icon: 'git-merge',      badge: 'AI' },
      { label: 'Audit Intelligence', path: '/audit',               icon: 'shield',         badge: 'AI' },
      { label: 'Board Pack',         path: '/reports/board-pack',  icon: 'presentation',   badge: 'AI' },
    ],
  },
];

// ── FP&A Suite ────────────────────────────────────────────────────────────────
export const FPA_NAV: NavEntry[] = [
  { label: 'Executive Dashboard', path: '/r2r/pattern',         icon: 'layout-dashboard' },
  { label: 'CFO Morning Brief',   path: '/cfo',                 icon: 'brain',           badge: 'AGENTIC' },
  {
    section: 'Planning',
    items: [
      { label: 'Budget',          path: '/fpa/budget',          icon: 'calculator' },
      { label: 'Forecasting',     path: '/fpa/forecast',        icon: 'trending-up' },
      { label: 'Scenario Engine', path: '/fpa/scenario',        icon: 'sliders' },
      { label: 'Headcount',       path: '/fpa/headcount',       icon: 'users' },
    ],
  },
  {
    section: 'Analysis',
    items: [
      { label: 'Variance Analysis', path: '/fpa/variance',          icon: 'bar-chart-2' },
      { label: 'Cash Flow',         path: '/cfo/payment-calendar',  icon: 'banknote' },
      { label: 'KPI Monitoring',    path: '/fpa/kpi',               icon: 'activity' },
      { label: 'TB Variance',       path: '/tb-variance',               icon: 'table' },
      { label: 'Close Status',     path: '/accounting/close-status',   icon: 'lock', badge: 'NEW' },
    ],
  },
  {
    section: 'Executive',
    items: [
      { label: 'Board Pack',       path: '/reports/board-pack',     icon: 'presentation',  badge: 'AI' },
      { label: 'AI Commentary',    path: '/cfo',                    icon: 'message-square', badge: 'AI' },
      { label: 'Covenant Tracker', path: '/cfo/covenant-tracker',  icon: 'shield' },
      { label: 'Payment Calendar', path: '/cfo/payment-calendar',  icon: 'calendar' },
      { label: 'AR & Collections', path: '/cfo/ar-collections',    icon: 'coins' },
    ],
  },
  {
    section: 'Data Sources',
    items: [
      { label: 'India Suite →',    path: '/india-full',             icon: 'arrow-right' },
      { label: 'UAE Suite →',      path: '/uae-full',               icon: 'arrow-right' },
      { label: 'NEXUS-C Agent',    path: '/cfo',                    icon: 'bot',           badge: 'AGENTIC' },
    ],
  },
];
