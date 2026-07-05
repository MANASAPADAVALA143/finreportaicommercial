const API_BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8000';
const BASE = `${API_BASE}/api/uae/accounts`;

function hdrs(): Record<string, string> {
  const wsId = localStorage.getItem('gnanova_workspace_id') ?? localStorage.getItem('tenantId');
  return {
    'Content-Type': 'application/json',
    'X-Workspace-ID': wsId,
    'X-Tenant-ID': wsId,
  };
}

function params(extra: Record<string, string> = {}): string {
  const cid = localStorage.getItem('active_company_id');
  const q = new URLSearchParams({ ...extra, ...(cid ? { company_id: cid } : {}) });
  return q.toString();
}

export interface ClassifiedAccount {
  account_id: string;
  account_code: string;
  account_name: string;
  balance: number;
  status: 'not_classified' | 'partial' | 'classified';
  status_color: string;
  bs_pl_main: string | null;
  bs_pl_sub: string | null;
  fs_note_number: number | null;
  fs_note_heading: string | null;
  cash_flow_category: string | null;
  cit_category: string | null;
  cit_add_back: boolean;
  missing_classifications: string[];
}

export interface ClassificationSummary {
  total_accounts: number;
  classified: number;
  partial: number;
  not_classified: number;
  ready_for_fs: boolean;
  classification_pct: number;
}

export async function fetchAccounts(period?: string) {
  const q = params(period ? { period } : {});
  const res = await fetch(`${BASE}/unclassified?${q}`, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ accounts: ClassifiedAccount[]; summary: ClassificationSummary }>;
}

export async function fetchSummary() {
  const res = await fetch(`${BASE}/classification-summary?${params()}`, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<ClassificationSummary>;
}

export async function aiClassify(accountIds: string[] = []) {
  const wsId = localStorage.getItem('gnanova_workspace_id');
  const cid = localStorage.getItem('active_company_id');
  const res = await fetch(`${BASE}/ai-classify`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify({
      workspace_id: wsId,
      company_id: cid,
      account_ids: accountIds,
      classifications: ['bs_pl', 'cash_flow', 'cit', 'fs_notes'],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function manualClassify(accountId: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/manual-classify/${accountId}?${params()}`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function clearClassifications() {
  const res = await fetch(`${BASE}/clear?${params()}`, { method: 'DELETE', headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const BS_PL_MAIN_OPTIONS = [
  'Current Assets', 'Non-Current Assets', 'Current Liabilities', 'Non-Current Liabilities',
  'Equity', 'Revenue', 'Cost of Sales', 'Operating Expenses', 'Other Income', 'Other Expenses', 'Tax',
];

export const CASH_FLOW_OPTIONS = ['Operating', 'Investing', 'Financing', 'Not Applicable'];

export const CIT_OPTIONS = [
  'Revenue',
  'Deductible Expense',
  'Non-Deductible',
  'Entertainment',
  'Fines',
  'Capital',
  'Tax Payable',
  'Not Applicable',
];
