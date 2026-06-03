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
  { label: 'Dashboard',          path: '/uae-full',              icon: 'layout-dashboard' },
  { label: 'Chart of Accounts',  path: '/uae-full/coa',          icon: 'book' },
  { label: 'Journal Entries',    path: '/uae-full/journals',     icon: 'file-text' },
  { label: 'Sales Invoices',     path: '/uae-full/invoices',     icon: 'receipt' },
  { label: 'AP InvoiceFlow',     path: '/ap-invoices',           icon: 'shopping-cart',  badge: 'AP' },
  { label: 'Bank Recon',         path: '/uae-full/bank-recon',   icon: 'landmark' },
  { label: 'Accruals',           path: '/uae-full/accruals',     icon: 'clock' },
  { label: 'Fixed Assets',       path: '/uae-full/fixed-assets', icon: 'building-2' },
  { label: 'Period-End Close',   path: '/uae-full/period-close', icon: 'lock' },
  { label: 'Management Accounts',path: '/uae-full/management',   icon: 'bar-chart-2' },
  {
    section: 'UAE Compliance',
    items: [
      { label: 'VAT Returns',        path: '/uae-accounting',    icon: 'percent',          badge: 'VAT' },
      { label: 'Corporate Tax 9%',   path: '/uae-accounting',    icon: 'building',         badge: 'CT' },
      { label: 'IFRS Statement Gen', path: '/ifrs-statement',    icon: 'file-text',        badge: 'IFRS' },
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
      { label: 'TB Variance',       path: '/tb-variance',           icon: 'table' },
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
