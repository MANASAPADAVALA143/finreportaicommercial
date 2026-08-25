/**
 * productConfig.ts
 * ─────────────────
 * Single source of truth for which sidebar sections/items each product shows.
 *
 * Controlled by VITE_PRODUCT environment variable:
 *   VITE_PRODUCT=invoiceflow  → AP Automation only
 *   VITE_PRODUCT=finreportai  → R2R + FP&A + CFO + Tax
 *   VITE_PRODUCT=combined     → everything (Gnanova Finance OS)
 *
 * Each Vercel deployment sets its own VITE_PRODUCT.
 * Same codebase. Same backend. Three products.
 */

export type ProductKey = 'invoiceflow' | 'finreportai' | 'combined';

export interface NavItem {
  label:    string;
  path:     string;
  icon:     string;           // lucide icon name
  permission?: string;        // hasPermission() key — omit = always visible
  /** If true, path is an absolute URL opened in a new tab (cross-app nav) */
  external?: boolean;
}

export interface NavSection {
  heading:    string;
  headingColor?: string;  // tailwind text class e.g. 'text-amber-500'
  items:      NavItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// AP Invoices — native FinReportAI module (ftlycgfgbboxapxhlpad Supabase)
// ─────────────────────────────────────────────────────────────────────────────

const apInvoiceSection: NavSection = {
  heading:      'AP Invoices',
  headingColor: 'text-blue-400',
  items: [
    { label: 'AP Dashboard',    path: '/ap-invoices',              icon: 'LayoutDashboard' },
    { label: 'All Invoices',    path: '/ap-invoices/list',         icon: 'FileText' },
    { label: 'Upload Invoice',  path: '/ap-invoices/upload',       icon: 'Upload' },
    { label: 'Approvals',       path: '/ap-invoices/approvals',    icon: 'CheckCircle' },
    { label: 'Vendors',         path: '/ap-invoices/vendors',      icon: 'Users' },
    { label: 'Purchase Orders', path: '/ap-invoices/po',           icon: 'ShoppingCart' },
    { label: 'Goods Receipts',  path: '/ap-invoices/grn',          icon: 'Package' },
    { label: 'GL Accounts',     path: '/ap-invoices/gl-accounts',  icon: 'BookOpen' },
    { label: 'Bank Recon',      path: '/ap-invoices/bank-recon',   icon: 'RefreshCcw' },
    { label: 'AP Aging',        path: '/ap-invoices/aging',        icon: 'Clock' },
    { label: 'GST Recon',       path: '/ap-invoices/gst-recon',    icon: 'Receipt' },
    { label: 'Payment Log',     path: '/ap-invoices/payment-log',  icon: 'CreditCard' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// FinReportAI items — R2R + FP&A + CFO
// ─────────────────────────────────────────────────────────────────────────────

const finreportaiSections: NavSection[] = [
  {
    heading: 'FinReport AI',
    items: [
      { label: 'Dashboard',         path: '/dashboard',           icon: 'LayoutDashboard' },
      { label: 'Connections',       path: '/connections',         icon: 'Plug' },
    ],
  },
  {
    heading: 'R2R Intelligence',
    items: [
      { label: 'Pattern Analysis',  path: '/r2r/pattern',         icon: 'BarChart2' },
      { label: 'Learning',          path: '/r2r/learning',        icon: 'BookOpen' },
      { label: 'History',           path: '/r2r/history',         icon: 'History' },
      { label: 'Rev Rec Recon',     path: '/r2r/rev-rec',         icon: 'LineChart' },
      { label: 'Month-End Close',   path: '/close',               icon: 'Calendar',      permission: 'close' },
      { label: 'GL Reconciler',     path: '/recon/gl',            icon: 'GitMerge',      permission: 'gl_recon' },
    ],
  },
  {
    heading: 'FP&A',
    items: [
      { label: 'Earnings Reviewer', path: '/earnings',            icon: 'TrendingUp',    permission: 'earnings' },
      { label: 'Model Builder',     path: '/model',               icon: 'BarChart2',     permission: 'model_builder' },
      { label: 'Variance Analysis', path: '/fpa/variance-analysis', icon: 'Activity' },
      { label: 'Budget',            path: '/fpa/budget',          icon: 'PieChart' },
      { label: 'Headcount',         path: '/fpa/headcount',       icon: 'Users' },
      { label: 'Scenario Engine',   path: '/fpa/scenario',        icon: 'Layers' },
    ],
  },
  {
    heading: 'CFO Operating Desk',
    items: [
      { label: 'Entity Health',     path: '/cfo/entity-health',   icon: 'Building2' },
      { label: 'Payment Calendar',  path: '/cfo/payment-calendar',icon: 'CalendarDays' },
      { label: 'Covenant Tracker',  path: '/cfo/covenant-tracker',icon: 'ShieldAlert' },
      { label: 'AR & Collections',  path: '/cfo/ar-collections',  icon: 'FileText' },
    ],
  },
  {
    heading: 'Reports',
    items: [
      { label: 'Board Pack',        path: '/reports/board-pack',  icon: 'BookOpen' },
      { label: 'IFRS Statements',   path: '/ifrs-statement',      icon: 'TableProperties' },
      { label: 'Audit Intelligence',path: '/audit',               icon: 'ShieldAlert' },
    ],
  },
  {
    heading:      'UAE Accounting',
    headingColor: 'text-green-500',
    items: [
      { label: 'Company Setup',       path: '/company-setup',                 icon: 'Settings' },
      { label: 'UAE Overview',        path: '/uae-full',                      icon: 'Globe' },
      { label: 'Chart of Accounts',   path: '/uae-full/coa',                  icon: 'BookOpen' },
      { label: 'Journal Entries',     path: '/uae-full/journals',             icon: 'FileText' },
      { label: 'Classify Accounts',   path: '/uae-full/classify-accounts',    icon: 'Tags' },
      { label: 'Sales Invoices',      path: '/uae-full/invoices',             icon: 'Receipt' },
      { label: 'AR Invoices',         path: '/uae-full/ar',                   icon: 'Receipt' },
      { label: 'Customer Risk',       path: '/uae-full/ar/customer-risk',     icon: 'ShieldAlert' },
      { label: 'AR Dunning',          path: '/uae-full/ar/dunning',           icon: 'Mail' },
      { label: 'Recurring Invoices',  path: '/uae-full/ar/recurring',         icon: 'CalendarClock' },
      { label: 'Bank Reconciliation', path: '/uae-full/bank-recon',           icon: 'Landmark' },
      { label: 'Fixed Assets',        path: '/uae-full/fixed-assets',         icon: 'Building2' },
      { label: 'Accruals',            path: '/uae-full/accruals',             icon: 'AlertCircle' },
      { label: 'Period-End Close',    path: '/uae-full/period-close',         icon: 'Lock' },
      { label: 'Management Accounts', path: '/uae-full/management',           icon: 'TrendingUp' },
      { label: '— Zoho/QBO Sync',    path: '/uae-accounting',                icon: 'Plug' },
      { label: 'Connected Accounts',  path: '/uae-accounting/accounts',       icon: 'Link' },
      { label: 'Trial Balances',      path: '/uae-accounting/trial-balances', icon: 'TableProperties' },
    ],
  },
  {
    id: 'india-accounting',
    label: 'India Accounting',
    icon: 'IndianRupee',
    items: [
      { label: 'India Overview',       path: '/india-full',               icon: 'IndianRupee' },
      { label: 'Chart of Accounts',    path: '/india-full/coa',           icon: 'BookOpen' },
      { label: 'Journal Entries',      path: '/india-full/journals',      icon: 'FileText' },
      { label: 'Sales Invoices (GST)', path: '/india-full/sales',         icon: 'Receipt' },
      { label: 'Purchase + ITC',       path: '/india-full/purchases',     icon: 'ShoppingCart' },
      { label: 'TDS Management',       path: '/india-full/tds',           icon: 'Calculator' },
      { label: 'GST Returns',          path: '/india-full/gst',           icon: 'Landmark' },
      { label: 'Payroll (PF/ESI/PT)',  path: '/india-full/payroll',       icon: 'Users' },
      { label: 'Fixed Assets (Ind AS)',path: '/india-full/assets',        icon: 'TrendingUp' },
      { label: 'Period-End Close',     path: '/india-full/close',         icon: 'Lock' },
      { label: 'Management Accounts',  path: '/india-full/management',    icon: 'BarChart2' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CA Firm tools — shown in combined + finreportai
// ─────────────────────────────────────────────────────────────────────────────

const caFirmSection: NavSection = {
  heading:      'CA Firm Tools',
  headingColor: 'text-amber-500',
  items: [
    { label: 'Bank Processor',    path: '/ca-firm/bank-processor', icon: 'Landmark' },
    { label: 'TB → Financials',   path: '/ca-firm/tb-financials',  icon: 'TableProperties' },
    { label: 'Bank Recon (BRS)',  path: '/ca-firm/bank-recon',     icon: 'RefreshCcw' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Combined — all sections
// ─────────────────────────────────────────────────────────────────────────────

const combinedSections: NavSection[] = [
  apInvoiceSection,
  ...finreportaiSections,
  caFirmSection,
];

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export const sidebarConfig: Record<ProductKey, NavSection[]> = {
  invoiceflow: [apInvoiceSection],
  finreportai: [apInvoiceSection, ...finreportaiSections, caFirmSection],
  combined:    combinedSections,
};

/** Branding per product */
export const productBranding: Record<ProductKey, { name: string; tagline: string }> = {
  invoiceflow: { name: 'InvoiceFlow',   tagline: 'AP Automation' },
  finreportai: { name: 'FinReport AI',  tagline: 'R2R Intelligence' },
  combined:    { name: 'Gnanova OS',    tagline: 'Finance OS' },
};

function getProduct(): ProductKey {
  const env = (import.meta.env.VITE_PRODUCT as string | undefined) ?? '';
  if (env === 'invoiceflow' || env === 'finreportai') return env;
  return 'combined';
}

export const PRODUCT         = getProduct();
export const currentSections = sidebarConfig[PRODUCT];
export const currentBranding = productBranding[PRODUCT];
