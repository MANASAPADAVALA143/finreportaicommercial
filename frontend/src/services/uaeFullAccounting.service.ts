/**
 * UAE Full Accounting Service
 * Wraps all /api/uae/full/* endpoints.
 */

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8000';
const BASE = `${API_BASE}/api/uae/full`;

function hdrs(extra: Record<string, string> = {}): Record<string, string> {
  const tenantId = localStorage.getItem('tenantId') ?? 'demo';
  return { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId, ...extra };
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  let url = `${BASE}${path}`;
  if (params) { const q = new URLSearchParams(params).toString(); if (q) url += '?' + q; }
  const res = await fetch(url, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: hdrs(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH', headers: hdrs(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface UAEAccount {
  id: string; account_code: string; account_name: string;
  account_type: string; sub_type?: string; parent_code?: string;
  currency: string; is_vat: boolean; vat_rate: number;
  is_ct: boolean; is_active: boolean;
}

export interface JournalEntry {
  id: string; entry_date: string; period: string; description: string;
  reference?: string; source: string; status: string;
  total_debit: number; lines?: JournalLine[];
}

export interface JournalLine {
  id: string; account_code: string; description: string;
  debit: number; credit: number;
}

export interface Customer {
  id: string; name: string; trn?: string; email?: string;
  credit_limit: number; payment_terms: number;
}

export interface SalesInvoice {
  id: string; invoice_number: string; customer_id: string;
  invoice_date: string; due_date: string;
  subtotal: number; vat_amount: number; total_amount: number;
  amount_due: number; status: string;
}

export interface BankAccount {
  id: string; bank_name: string; account_number: string; account_name: string;
  currency: string; gl_account_code: string; current_balance: number;
}

export interface BankStatement {
  id: string; bank_account_id: string; statement_date: string;
  opening_balance: number; closing_balance: number; status: string;
}

export interface FixedAsset {
  id: string; asset_code: string; asset_name: string; asset_category: string;
  acquisition_date: string; cost: number;
  accumulated_depreciation: number; net_book_value: number;
  ct_accumulated_dep: number; ct_net_book_value: number; status: string;
}

export interface Accrual {
  id: string; period: string; description: string; amount: number;
  account_code: string; accrual_type: string; is_mandatory: boolean;
  status: string; ai_confidence?: number; ai_reasoning?: string;
}

export interface PeriodClose {
  id: string; period: string; status: string; is_locked: boolean;
  checklist: Record<string, boolean>; closed_at?: string;
}

export interface DashboardKPIs {
  period: string; coa_count: number; je_count: number;
  asset_count: number; invoice_count: number; accrual_count: number;
  ar_outstanding: number; revenue: number; expenses: number;
  net_profit: number; total_assets: number;
}

// ── Chart of Accounts ─────────────────────────────────────────────────────

export const seedCoA = () => post<{ seeded: number }>('/coa/seed');
export const listAccounts = () => get<{ accounts: UAEAccount[]; count: number }>('/coa');
export const createAccount = (body: Omit<UAEAccount, 'id'>) =>
  post<{ id: string; account_code: string }>('/coa', body);
export const getBalances = (period: string) =>
  get<{ period: string; balances: Record<string, number> }>('/coa/balances', { period });

// ── Journal Entries ───────────────────────────────────────────────────────

export const listJournals = (params?: { period?: string; source?: string; status?: string }) =>
  get<{ entries: JournalEntry[]; count: number }>(
    '/journals', params as Record<string, string> | undefined
  );
export const createJE = (body: {
  entry_date: string; description: string; reference?: string;
  source?: string; auto_post?: boolean;
  lines: { account_code: string; description?: string; debit: number; credit: number }[];
}) => post<{ id: string; status: string }>('/journals', body);
export const postJE = (jeId: string) =>
  post<{ id: string; status: string }>(`/journals/${jeId}/post`);
export const reverseJE = (jeId: string, reversalDate: string) =>
  post<{ id: string; status: string }>(`/journals/${jeId}/reverse?reversal_date=${reversalDate}`);
export const getJE = (jeId: string) => get<JournalEntry>(`/journals/${jeId}`);
export const getTrialBalance = (period: string) =>
  get<{ period: string; lines: unknown[]; totals: Record<string, number> }>(
    '/trial-balance', { period }
  );

// ── Customers & AR ────────────────────────────────────────────────────────

export const listCustomers = () => get<{ customers: Customer[]; count: number }>('/customers');
export const createCustomer = (body: Omit<Customer, 'id'>) =>
  post<{ id: string }>('/customers', body);
export const listInvoices = (params?: { status?: string; customer_id?: string }) =>
  get<{ invoices: SalesInvoice[]; count: number }>(
    '/invoices', params as Record<string, string> | undefined
  );
export const createInvoice = (body: {
  customer_id: string; invoice_date: string; due_date: string;
  invoice_number?: string; reference?: string;
  lines: { description: string; quantity: number; unit_price: number; vat_rate?: number }[];
}) => post<{ id: string; invoice_number: string; total_amount: number }>('/invoices', body);
export const postInvoice = (invId: string) =>
  post<{ id: string; status: string; je_id: string }>(`/invoices/${invId}/post`);
export const getARaging = (asOf?: string) =>
  get<{ as_of: string; buckets: Record<string, number>; invoices: unknown[] }>(
    '/ar-aging', asOf ? { as_of: asOf } : undefined
  );

// ── Bank Reconciliation ───────────────────────────────────────────────────

export const listBankAccounts = () => get<{ accounts: BankAccount[] }>('/bank-accounts');
export const createBankAccount = (body: Omit<BankAccount, 'id' | 'current_balance'>) =>
  post<{ id: string }>('/bank-accounts', body);
export const listStatements = (bankAccountId?: string) =>
  get<{ statements: BankStatement[] }>(
    '/bank-statements', bankAccountId ? { bank_account_id: bankAccountId } : undefined
  );
export const reconcileStatement = (statementId: string) =>
  post<{ total: number; exact: number; fuzzy: number; ai: number; unmatched: number }>(
    `/bank-statements/${statementId}/reconcile`
  );
export const getReconSummary = (statementId: string) =>
  get<{
    statement_id: string; status: string; total_lines: number;
    matched: number; unmatched: number; match_rate: number; unmatched_lines: unknown[];
  }>(`/bank-statements/${statementId}/summary`);

// ── Fixed Assets ──────────────────────────────────────────────────────────

export const listAssets = (status?: string) =>
  get<{ assets: FixedAsset[]; count: number }>(
    '/fixed-assets', status ? { status } : undefined
  );
export const createAsset = (body: {
  asset_name: string; asset_code?: string; asset_category: string;
  acquisition_date: string; cost: number; residual_value?: number;
  useful_life_years?: number; depreciation_method?: string;
}) => post<{ id: string; asset_code: string }>('/fixed-assets', body);
export const runDepreciation = (period: string) =>
  post<{ period: string; assets_processed: number; total_ifrs_depreciation: number; total_ct_depreciation: number }>(
    `/fixed-assets/run-depreciation?period=${period}`
  );
export const getDepreciationSchedule = (assetId: string) =>
  get<{ asset_id: string; asset_name: string; schedule: unknown[] }>(
    `/fixed-assets/${assetId}/schedule`
  );

// ── Accruals ──────────────────────────────────────────────────────────────

export const listAccruals = (period?: string) =>
  get<{ accruals: Accrual[]; count: number }>(
    '/accruals', period ? { period } : undefined
  );
export const suggestAccruals = (period: string) =>
  post<{ period: string; suggestions: unknown[]; count: number }>(
    `/accruals/suggest?period=${period}`
  );
export const createAccrual = (body: Omit<Accrual, 'id' | 'status' | 'ai_confidence'>) =>
  post<{ id: string }>('/accruals', body);
export const postAccrualRoute = (accrualId: string) =>
  post<{ id: string; je_id: string; status: string }>(`/accruals/${accrualId}/post`);

// ── Period-End Close ──────────────────────────────────────────────────────

export const listCloseRuns = () => get<{ runs: PeriodClose[] }>('/period-close');
export const startClose = (period: string) =>
  post<{ id: string; period: string; status: string; checklist: Record<string, boolean> }>(
    `/period-close/start?period=${period}`
  );
export const updateChecklist = (runId: string, item: string, done: boolean) =>
  patch<{ id: string; checklist: Record<string, boolean>; status: string }>(
    `/period-close/${runId}/check?item=${item}&done=${done}`
  );
export const lockPeriod = (runId: string) =>
  post<{ id: string; period: string; status: string; is_locked: boolean }>(
    `/period-close/${runId}/lock`
  );

// ── Management Accounts ───────────────────────────────────────────────────

export const generateManagementAccounts = (period: string) =>
  post<{
    period: string;
    pnl: Record<string, number>;
    balance_sheet: Record<string, number>;
    narrative: Record<string, string>;
    generated_at: string;
  }>(`/management-accounts?period=${period}`);

// ── Dashboard ─────────────────────────────────────────────────────────────

export const getDashboard = (period: string) =>
  get<DashboardKPIs>('/dashboard', { period });
