import type { Invoice } from '@/lib/ap-invoice/supabase';
import type { KpiSummary, ResolvedRange } from './metrics';

export const DASHBOARD_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'processing', label: 'Invoice Processing' },
  { id: 'approvals', label: 'Approvals & Exceptions' },
  { id: 'spend', label: 'Spend Analysis' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'gl', label: 'Cost Center & GL' },
  { id: 'compliance', label: 'IFRS & Compliance' },
  { id: 'payments', label: 'Payments & Cash Flow' },
  { id: 'invoices', label: 'Recent Invoices' },
] as const;

export type TabId = (typeof DASHBOARD_TABS)[number]['id'];

export type DashboardCtx = {
  /** All invoices for the active organization. */
  all: Invoice[];
  /** Invoices whose invoice date falls in the selected range. */
  period: Invoice[];
  range: ResolvedRange;
  monthKeys: { keys: string[]; truncated: boolean };
  kpis: KpiSummary;
  today: string;
  baseCurrency: string;
  fmt: (n: number) => string;
  fmtCompact: (n: number) => string;
  dateFormat: string;
  costCenterLabel: string;
  companyId: string | null;
  workspaceId: string;
  isUAE: boolean;
  openInvoice: (inv: Invoice) => void;
  goTab: (tab: TabId) => void;
  reload: () => void;
};
