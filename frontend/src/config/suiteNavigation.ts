export type NavLeaf = {
  label: string;
  path: string;
  icon?: string;
  badge?: string;
  /** Shared routes (e.g. /ap-invoices) render different data per market — pin it
   *  explicitly on click instead of relying on whatever the toggle last set. */
  pinMarket?: 'uae' | 'india';
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

// ── Internal Audit (UAE + India suites) ──────────────────────────────────────
export const INTERNAL_AUDIT_NAV: NavSection = {
  section: 'Internal Audit',
  items: [
    { label: 'Committee Dashboard',   path: '/internal-audit/dashboard',   icon: 'layout-dashboard' },
    { label: 'Audit Universe & Plan', path: '/internal-audit/universe',    icon: 'globe' },
    { label: 'Engagements',           path: '/internal-audit/engagements', icon: 'briefcase' },
    { label: 'Findings & CAPA',       path: '/internal-audit/findings',    icon: 'alert-triangle' },
    { label: 'Overdue Follow-up',     path: '/internal-audit/overdue',     icon: 'clock' },
    { label: 'Historical Baseline',   path: '/internal-audit/baseline',    icon: 'history' },
    { label: 'JE Review',             path: '/internal-audit/je-review',   icon: 'file-search' },
  ],
};

// ── Technical Accounting AI (UAE + India suites) ─────────────────────────────
export const TECHNICAL_ACCOUNTING_NAV: NavSection = {
  section: 'Technical Accounting AI',
  items: [
    { label: 'Overview',                path: '/technical-accounting/overview',    icon: 'layout-dashboard' },
    { label: 'AI Assistant',            path: '/technical-accounting/assistant',   icon: 'message-square', badge: 'Dev' },
    { label: 'IFRS / Ind AS',           path: '/technical-accounting/ifrs',        icon: 'book',           badge: 'Soon' },
    { label: 'Revenue Recognition',     path: '/technical-accounting/revenue',     icon: 'trending-up',    badge: 'Soon' },
    { label: 'Lease Accounting',        path: '/technical-accounting/leases',      icon: 'building-2',     badge: 'Soon' },
    { label: 'Disclosure Intelligence', path: '/technical-accounting/disclosures', icon: 'file-search',    badge: 'Soon' },
    { label: 'Accounting Memos',        path: '/technical-accounting/memos',       icon: 'file-text' },
  ],
};

// ── UAE Finance Suite (uae_client role) ───────────────────────────────────────
export const UAE_FINANCE_SUITE_NAV: NavEntry[] = [
  {
    section: '🇦🇪 UAE Finance Suite',
    items: [
      { label: 'AP InvoiceFlow', path: '/ap-invoices', icon: 'shopping-cart', badge: 'AP', pinMarket: 'uae' },
      { label: 'AR', path: '/uae-full/ar', icon: 'receipt', badge: 'AR' },
      { label: 'UAE Tax (GulfTax)', path: '/gulftax', icon: 'shield' },
      { label: 'E-Invoicing', path: '/gulftax/e-invoicing', icon: 'receipt', badge: 'Peppol' },
      { label: 'IFRS 16 Leases', path: '/ifrs/16', icon: 'building-2', badge: 'IFRS' },
    ],
  },
];

// ── UAE Finance Suite Full (uae_suite role — AP + AR + Tax) ───────────────────
export const UAE_SUITE_NAV: NavEntry[] = [
  {
    section: '🇦🇪 UAE Finance Suite',
    items: [
      { label: 'UAE Taxation', path: '/uae-suite', icon: 'layout-dashboard', badge: 'AP+Tax' },
      { label: 'AP InvoiceFlow', path: '/ap-invoices', icon: 'shopping-cart', badge: 'AP', pinMarket: 'uae' },
      { label: 'AR', path: '/uae-full/ar', icon: 'receipt', badge: 'AR' },
      { label: 'UAE Tax (GulfTax)', path: '/gulftax', icon: 'shield' },
      { label: 'E-Invoicing', path: '/gulftax/e-invoicing', icon: 'receipt', badge: 'Peppol' },
      { label: 'IFRS 16 Leases', path: '/ifrs/16', icon: 'building-2', badge: 'IFRS' },
    ],
  },
  {
    section: 'AR',
    items: [
      { label: 'Invoices & Aging', path: '/uae-full/ar', icon: 'file-text' },
      { label: 'Customer Risk', path: '/uae-full/ar/customer-risk', icon: 'shield' },
      { label: 'Dunning', path: '/uae-full/ar/dunning', icon: 'clock' },
      { label: 'Recurring Invoices', path: '/uae-full/ar/recurring', icon: 'calendar' },
    ],
  },
];

// ── Both markets side by side (full_access / admin accounts) ──────────────────
// Shown as two permanent sections on the dashboard so switching markets is a
// scroll, not a toggle click that silently swaps context behind the scenes.
export const TWO_MARKET_NAV: NavEntry[] = [
  {
    section: '🇦🇪 UAE Finance Suite',
    items: [
      { label: 'AP InvoiceFlow', path: '/ap-invoices', icon: 'shopping-cart', badge: 'AP', pinMarket: 'uae' },
      { label: 'AR', path: '/uae-full/ar', icon: 'receipt', badge: 'AR' },
      { label: 'UAE Tax (GulfTax)', path: '/gulftax', icon: 'shield' },
    ],
  },
  {
    section: '🇮🇳 India',
    items: [
      { label: 'AP InvoiceFlow', path: '/ap-invoices', icon: 'shopping-cart', badge: 'AP', pinMarket: 'india' },
      { label: 'GST Returns', path: '/india-full/gst', icon: 'percent' },
    ],
  },
];

// ── India Suite ───────────────────────────────────────────────────────────────
export const INDIA_NAV: NavEntry[] = [
  { label: 'Dashboard',          path: '/india-full',           icon: 'layout-dashboard' },
  { label: 'Chart of Accounts',  path: '/india-full/coa',       icon: 'book' },
  { label: 'Journal Entries',    path: '/india-full/journals',  icon: 'file-text' },
  { label: 'Sales Invoices',     path: '/india-full/sales',     icon: 'receipt' },
  { label: 'AP InvoiceFlow',     path: '/ap-invoices',          icon: 'shopping-cart', badge: 'AP', pinMarket: 'india' },
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
  INTERNAL_AUDIT_NAV,
  TECHNICAL_ACCOUNTING_NAV,
];

// ── UAE Suite ─────────────────────────────────────────────────────────────────
export const UAE_NAV: NavEntry[] = [
  { label: 'Workspaces',         path: '/workspaces',            icon: 'building-2' },
  { label: 'Company Setup',      path: '/company-setup',         icon: 'sliders', badge: 'Setup' },
  { label: 'UAE Taxation',       path: '/uae-suite',             icon: 'shield', badge: 'AP+Tax' },
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
  { label: 'AP InvoiceFlow',     path: '/ap-invoices',           icon: 'shopping-cart',  badge: 'AP', pinMarket: 'uae' },
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
      { label: 'Audit Exports',      path: '/gulftax/audit-exports',         icon: 'shield' },
      { label: 'Anomaly Detection',  path: '/gulftax/anomaly-detection',     icon: 'activity' },
      { label: 'Tax Compliance',     path: '/gulftax/tax-compliance',        icon: 'file-check' },
      { label: 'Recon Summary',      path: '/gulftax/recon-summary',         icon: 'git-merge' },
      { label: 'Financial Statements', path: '/gulftax/financial-statements', icon: 'file-text' },
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
      { label: 'Command Center',     path: '/audit/command-center', icon: 'shield-check',  badge: 'AI' },
      { label: 'Board Pack',         path: '/reports/board-pack',  icon: 'presentation',   badge: 'AI' },
    ],
  },
  INTERNAL_AUDIT_NAV,
  TECHNICAL_ACCOUNTING_NAV,
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

// ── CFO Intelligence OS (FP&A suite and full_access accounts) ─────────────────
// Every module grouped under one hub. Items a product role can't open are
// dropped by filterNavByRole, so UAE-only sections disappear for India roles.
export const CFO_INTELLIGENCE_NAV: NavEntry[] = [
  {
    section: 'Executive Hub',
    items: [
      { label: 'AI CFO Command Centre', path: '/ai-cfo',                  icon: 'bot',          badge: 'AGENTIC' },
      { label: 'Month-End Close (AI)', path: '/ai-cfo/executive-summary', icon: 'bot',         badge: 'AGENTIC' },
      { label: 'Executive Dashboard',  path: '/cfo-dashboard',           icon: 'layout-dashboard' },
      { label: 'CFO Morning Brief',    path: '/cfo',                     icon: 'brain',        badge: 'AGENTIC' },
      { label: 'Board Pack',           path: '/reports/board-pack',      icon: 'presentation', badge: 'AI' },
      { label: 'Entity Health',        path: '/cfo/entity-health',       icon: 'activity' },
    ],
  },
  {
    section: 'Cash & Working Capital',
    items: [
      { label: 'Cash Flow & Calendar', path: '/cfo/payment-calendar',    icon: 'banknote' },
      { label: 'AR & Collections',     path: '/cfo/ar-collections',      icon: 'coins' },
      { label: 'Covenant Tracker',     path: '/cfo/covenant-tracker',    icon: 'shield' },
    ],
  },
  {
    section: 'FP&A & Forecasting',
    items: [
      { label: 'Budget',               path: '/fpa/budget',              icon: 'calculator' },
      { label: 'Forecasting',          path: '/fpa/forecast',            icon: 'trending-up' },
      { label: 'Scenario Engine',      path: '/fpa/scenario',            icon: 'sliders' },
      { label: 'Monte Carlo',          path: '/fpa/monte-carlo',         icon: 'percent' },
      { label: 'Sensitivity Analysis', path: '/fpa/sensitivity',         icon: 'activity' },
      { label: 'Variance Analysis',    path: '/fpa/variance',            icon: 'bar-chart-2' },
      { label: 'PVM Analysis',         path: '/fpa/pvm',                 icon: 'layers' },
      { label: 'KPI Monitoring',       path: '/fpa/kpi',                 icon: 'activity' },
      { label: 'Headcount Planning',   path: '/fpa/headcount',           icon: 'users' },
    ],
  },
  {
    section: 'Financial Reporting',
    items: [
      { label: 'Management Accounts',   path: '/fpa/reports',             icon: 'bar-chart-2' },
      { label: 'Three Statement Model', path: '/fpa/three-statement',     icon: 'file-text' },
      { label: 'TB Variance',           path: '/tb-variance',             icon: 'table' },
      { label: 'Close Status',          path: '/accounting/close-status', icon: 'lock',      badge: 'NEW' },
      { label: 'IFRS Statement Gen',    path: '/ifrs-statement',          icon: 'file-text', badge: 'IFRS' },
      { label: 'Group Consolidation',   path: '/consolidation',           icon: 'layers',    badge: 'Group' },
    ],
  },
  {
    section: 'Risk & Controls',
    items: [
      { label: 'Audit Intelligence',   path: '/audit',                   icon: 'shield',       badge: 'AI' },
      { label: 'Command Center',       path: '/audit/command-center',    icon: 'shield-check', badge: 'AI' },
      { label: 'R2R Pattern Engine',   path: '/r2r/pattern',             icon: 'git-merge',    badge: 'AI' },
    ],
  },
  INTERNAL_AUDIT_NAV,
  TECHNICAL_ACCOUNTING_NAV,
  {
    section: 'UAE Finance & Tax',
    items: [
      { label: 'GulfTax Dashboard',    path: '/gulftax',                 icon: 'shield' },
      { label: 'VAT Return',           path: '/gulftax/vat-return',      icon: 'file-text' },
      { label: 'Corporate Tax',        path: '/gulftax/corporate-tax',   icon: 'building' },
      { label: 'E-Invoicing',          path: '/gulftax/e-invoicing',     icon: 'receipt',   badge: 'Peppol' },
      { label: 'Tax Compliance',       path: '/gulftax/tax-compliance',  icon: 'file-check' },
    ],
  },
  {
    section: 'Transactions',
    items: [
      { label: 'AP InvoiceFlow',       path: '/ap-invoices',             icon: 'shopping-cart', badge: 'AP', pinMarket: 'uae' },
      { label: 'AR & Sales',           path: '/uae-full/ar',             icon: 'receipt' },
      { label: 'Journal Entries',      path: '/uae-full/journals',       icon: 'file-text' },
      { label: 'Bank Reconciliation',  path: '/uae-full/bank-recon',     icon: 'landmark' },
      { label: 'Period-End Close',     path: '/uae-full/period-close',   icon: 'lock' },
    ],
  },
  {
    section: 'Data Sources',
    items: [
      { label: 'India Suite →',        path: '/india-full',              icon: 'arrow-right' },
      { label: 'UAE Suite →',          path: '/uae-full',                icon: 'arrow-right' },
    ],
  },
];

// full_access accounts work in both markets, so they also keep the India entries.
export const CFO_INTELLIGENCE_TWO_MARKET_NAV: NavEntry[] = [
  ...CFO_INTELLIGENCE_NAV,
  ...TWO_MARKET_NAV.filter((e) => isSection(e) && e.section === '🇮🇳 India'),
];
