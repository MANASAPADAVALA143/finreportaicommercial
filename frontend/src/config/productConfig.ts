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
// InvoiceFlow items — AP Automation
// These open InvoiceFlow (separate app) in a new tab.
// In local dev InvoiceFlow runs on port 5175; in production it's on Railway.
// ─────────────────────────────────────────────────────────────────────────────

const INVOICEFLOW_URL =
  (import.meta.env.VITE_INVOICEFLOW_URL as string | undefined) ??
  'https://apinvoice-production.up.railway.app';

/** Shorthand — build a fully-qualified InvoiceFlow URL */
const ap = (route: string) => `${INVOICEFLOW_URL}${route}`;

const invoiceflowSections: NavSection[] = [
  {
    heading: 'AP Automation',
    items: [
      { label: 'Invoice List',      path: ap('/invoices'),        icon: 'FileText',    external: true },
      { label: 'Approvals',         path: ap('/approvals'),       icon: 'CheckCircle', external: true },
      { label: 'Upload Invoice',    path: ap('/upload'),          icon: 'Upload',      external: true },
      { label: 'Vendors',           path: ap('/vendors'),         icon: 'Users',       external: true },
      { label: 'Purchase Orders',   path: ap('/purchase-orders'), icon: 'ShoppingCart',external: true },
      { label: 'Goods Receipts',    path: ap('/goods-receipts'),  icon: 'Package',     external: true },
      { label: 'GL Accounts',       path: ap('/gl-accounts'),     icon: 'BookOpen',    external: true },
      { label: 'Bank Recon',        path: ap('/bank-recon'),      icon: 'RefreshCcw',  external: true },
      { label: 'AP Aging',          path: ap('/reports/aging'),   icon: 'Clock',       external: true },
      { label: 'GST Recon',         path: ap('/gst-recon'),       icon: 'Receipt',     external: true },
      { label: 'Payment Log',       path: ap('/payment-log'),     icon: 'CreditCard',  external: true },
    ],
  },
];

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
  ...invoiceflowSections,
  ...finreportaiSections,
  caFirmSection,
];

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export const sidebarConfig: Record<ProductKey, NavSection[]> = {
  invoiceflow: invoiceflowSections,
  finreportai: [...finreportaiSections, caFirmSection],
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
