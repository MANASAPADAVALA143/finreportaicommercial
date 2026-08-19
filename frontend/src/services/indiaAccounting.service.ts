/**
 * India Accounting Service
 * Wraps all /api/india/full/* endpoints.
 */

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8000';
const BASE = `${API_BASE}/api/india/full`;

function hdrs(extra: Record<string, string> = {}): Record<string, string> {
  const tenantId = localStorage.getItem('tenantId') || 'demo';
  const accessToken = localStorage.getItem('access_token');
  return {
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...extra,
  };
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

export interface IndiaAccount {
  id: string; code: string; name: string;
  account_type: string; sub_type?: string;
  is_gst: boolean; gst_type?: string;
  is_tds: boolean; is_active: boolean;
}

export interface IndiaJournalEntry {
  id: string; entry_date: string; period: string;
  description: string; reference?: string;
  source: string; status: string; total_debit: number;
  lines?: IndiaJournalLine[];
}

export interface IndiaJournalLine {
  id: string; account_code: string; description: string;
  debit: number; credit: number;
}

export interface IndiaCustomer {
  id: string; name: string; gstin?: string; pan?: string;
  email?: string; state_code?: string; state_name?: string;
  credit_limit: number; payment_terms_days: number;
}

export interface IndiaVendor {
  id: string; name: string; gstin?: string; pan?: string;
  tds_applicable: boolean; tds_section?: string;
  state_code?: string; payment_terms_days: number;
}

export interface IndiaSalesInvoice {
  id: string; invoice_number: string; customer_id: string;
  invoice_date: string; due_date: string;
  supply_type: string;
  subtotal: number; cgst_amount: number; sgst_amount: number;
  igst_amount: number; total_amount: number;
  outstanding: number; status: string; e_invoice_irn?: string;
}

export interface IndiaPurchaseInvoice {
  id: string; invoice_number: string; vendor_id: string;
  invoice_date: string; due_date: string; supply_type: string;
  subtotal: number; cgst_amount: number; sgst_amount: number;
  igst_amount: number; total_amount: number; outstanding: number;
  itc_eligible: boolean; itc_claimed: number;
  tds_deducted: number; status: string;
}

export interface IndiaTDSEntry {
  id: string; period: string; deductee_name: string;
  deductee_pan?: string; section: string; nature: string;
  payment_amount: number; tds_rate: number; net_tds: number;
  status: string; challan_number?: string; deposit_date?: string;
}

export interface IndiaGSTReturn {
  id: string; return_type: string; period: string;
  b2b_taxable: number; b2c_taxable: number;
  total_taxable: number; total_cgst: number; total_sgst: number;
  total_igst: number; total_payable: number;
  itc_cgst: number; itc_sgst: number; itc_igst: number;
  net_cgst_payable: number; net_sgst_payable: number; net_igst_payable: number;
  status: string; arn?: string; ai_summary?: string;
}

export interface IndiaEmployee {
  id: string; employee_code: string; name: string;
  department?: string; designation?: string;
  basic_salary: number; hra: number; special_allowance: number;
  gross_salary: number; pf_applicable: boolean;
  esi_applicable: boolean; status: string;
}

export interface IndiaPayrollRun {
  id: string; period: string; total_employees: number;
  total_gross: number; total_pf_employee: number; total_pf_employer: number;
  total_esi_employee: number; total_esi_employer: number;
  total_pt: number; total_net_pay: number;
  total_gratuity_provision: number; status: string;
}

export interface IndiaFixedAsset {
  id: string; asset_code: string; name: string; category: string;
  purchase_date: string; purchase_cost: number;
  accumulated_depreciation: number; net_book_value: number;
  depreciation_method: string; useful_life_years: number;
  wdv_rate: number; status: string;
}

export interface IndiaPeriodClose {
  id: string; period: string; status: string; is_locked: boolean;
  checklist: Record<string, boolean>; closed_at?: string;
}

export interface IndiaDashboard {
  period: string; coa_count: number; je_count: number;
  asset_count: number; employee_count: number;
  vendor_count: number; customer_count: number;
  revenue: number; ar_outstanding: number; payroll_cost: number;
  gst_payable: number; tds_deducted: number; tds_pending_deposit: number;
}

// ── Chart of Accounts ─────────────────────────────────────────────────────

export const seedIndiaCoA = () => post<{ seeded: number }>('/coa/seed');
export const listIndiaAccounts = (account_type?: string) =>
  get<{ accounts: IndiaAccount[]; count: number }>(
    '/coa', account_type ? { account_type } : undefined
  );

// ── Journal Entries ───────────────────────────────────────────────────────

export const listIndiaJournals = (params?: { period?: string; source?: string; status?: string }) =>
  get<{ entries: IndiaJournalEntry[]; count: number }>(
    '/journals', params as Record<string, string> | undefined
  );
export const createIndiaJE = (body: {
  entry_date: string; description: string; reference?: string;
  source?: string; auto_post?: boolean; narration?: string;
  lines: { account_code: string; description?: string; debit: number; credit: number }[];
}) => post<{ id: string; status: string }>('/journals', body);
export const postIndiaJE = (jeId: string) =>
  post<{ id: string; status: string }>(`/journals/${jeId}/post`);
export const getIndiaJE = (jeId: string) => get<IndiaJournalEntry>(`/journals/${jeId}`);

// ── Customers ────────────────────────────────────────────────────────────

export const listIndiaCustomers = () =>
  get<{ customers: IndiaCustomer[]; count: number }>('/customers');
export const createIndiaCustomer = (body: Omit<IndiaCustomer, 'id'>) =>
  post<{ id: string }>('/customers', body);

// ── Vendors ──────────────────────────────────────────────────────────────

export const listIndiaVendors = () =>
  get<{ vendors: IndiaVendor[]; count: number }>('/vendors');
export const createIndiaVendor = (body: Omit<IndiaVendor, 'id'>) =>
  post<{ id: string }>('/vendors', body);

// ── Sales Invoices ────────────────────────────────────────────────────────

export const listSalesInvoices = (params?: { status?: string; customer_id?: string }) =>
  get<{ invoices: IndiaSalesInvoice[]; count: number }>(
    '/sales-invoices', params as Record<string, string> | undefined
  );
export const createSalesInvoice = (body: {
  customer_id: string; invoice_date: string; due_date: string;
  supply_type?: string; place_of_supply?: string; invoice_number?: string;
  lines: { description: string; hsn_sac?: string; quantity: number; unit_price: number; gst_rate?: number }[];
}) => post<{ id: string; invoice_number: string; total_amount: number }>('/sales-invoices', body);
export const postSalesInvoice = (invId: string) =>
  post<{ id: string; status: string; je_id: string }>(`/sales-invoices/${invId}/post`);

// ── Purchase Invoices ─────────────────────────────────────────────────────

export const listPurchaseInvoices = (params?: { status?: string }) =>
  get<{ invoices: IndiaPurchaseInvoice[]; count: number }>(
    '/purchase-invoices', params as Record<string, string> | undefined
  );
export const createPurchaseInvoice = (body: {
  vendor_id: string; invoice_date: string; due_date: string;
  invoice_number: string; supply_type?: string; tds_section?: string;
  lines: { description: string; hsn_sac?: string; quantity: number; unit_price: number; gst_rate?: number; itc_eligible?: boolean }[];
}) => post<{ id: string; invoice_number: string; total_amount: number; tds_deducted: number }>('/purchase-invoices', body);
export const postPurchaseInvoice = (invId: string) =>
  post<{ id: string; status: string; je_id: string; itc_claimed: number }>(`/purchase-invoices/${invId}/post`);

// ── TDS ───────────────────────────────────────────────────────────────────

export const listTDS = (params?: { period?: string; section?: string }) =>
  get<{ entries: IndiaTDSEntry[]; count: number }>(
    '/tds', params as Record<string, string> | undefined
  );
export const createTDSEntry = (period: string, body: {
  deductee_name: string; deductee_pan?: string; section: string;
  nature: string; payment_amount: number; deductee_type?: string; vendor_id?: string;
}) => post<{ id: string; net_tds: number }>(`/tds?period=${period}`, body);
export const depositTDS = (body: { period: string; challan_number: string; deposit_date?: string }) =>
  post<{ entries_deposited: number; total_tds_deposited: number }>('/tds/deposit', body);
export const getTDSSummary = (period: string) =>
  get<{ total_tds: number; pending_deposit: number; by_section: any[] }>(
    '/tds/summary', { period }
  );
export const getTDSSections = () =>
  get<{ sections: { code: string; desc: string; rate_company: number }[] }>('/tds/sections');

// ── GST Returns ──────────────────────────────────────────────────────────

export const listGSTReturns = (params?: { period?: string; return_type?: string }) =>
  get<{ returns: IndiaGSTReturn[]; count: number }>(
    '/gst-returns', params as Record<string, string> | undefined
  );
export const compileGSTReturn = (period: string, return_type: string = 'GSTR3B', gstin: string = '') =>
  post<IndiaGSTReturn>(`/gst-returns/compile?period=${period}&return_type=${return_type}&gstin=${gstin}`);
export const fileGSTReturn = (returnId: string, arn?: string) =>
  post<{ id: string; status: string; arn: string }>(
    `/gst-returns/${returnId}/file${arn ? `?arn=${arn}` : ''}`
  );

// ── Payroll ───────────────────────────────────────────────────────────────

export const listEmployees = () =>
  get<{ employees: IndiaEmployee[]; count: number }>('/employees');
export const createEmployee = (body: Omit<IndiaEmployee, 'id' | 'gross_salary' | 'status'>) =>
  post<{ id: string; employee_code: string }>('/employees', body);
export const seedEmployees = () => post<{ seeded: number }>('/employees/seed');
export const runPayroll = (period: string) =>
  post<IndiaPayrollRun>(`/payroll/run?period=${period}`);
export const postPayroll = (runId: string) =>
  post<{ id: string; status: string; je_id: string }>(`/payroll/${runId}/post`);
export const listPayrollRuns = () =>
  get<{ runs: IndiaPayrollRun[]; count: number }>('/payroll');
export const getPayslips = (runId: string) =>
  get<{ slips: any[]; count: number }>(`/payroll/${runId}/slips`);

// ── Fixed Assets ──────────────────────────────────────────────────────────

export const listIndiaAssets = (status?: string) =>
  get<{ assets: IndiaFixedAsset[]; count: number }>(
    '/fixed-assets', status ? { status } : undefined
  );
export const createIndiaAsset = (body: {
  asset_name: string; asset_code?: string; category: string;
  purchase_date: string; purchase_cost: number;
  residual_value?: number; useful_life_years?: number;
  depreciation_method?: string;
}) => post<{ id: string; asset_code: string }>('/fixed-assets', body);
export const runIndiaDepreciation = (period: string) =>
  post<{ period: string; assets_processed: number; total_depreciation: number }>(
    `/fixed-assets/run-depreciation?period=${period}`
  );
export const getIndiaDepreciationSchedule = (assetId: string) =>
  get<{ asset_id: string; asset_name: string; method: string; schedule: any[] }>(
    `/fixed-assets/${assetId}/schedule`
  );

// ── Period-End Close ──────────────────────────────────────────────────────

export const listIndiaCloseRuns = () =>
  get<{ runs: IndiaPeriodClose[] }>('/period-close');
export const startIndiaClose = (period: string) =>
  post<{ id: string; period: string; status: string; checklist: Record<string, boolean> }>(
    `/period-close/start?period=${period}`
  );
export const updateIndiaChecklist = (runId: string, item: string, done: boolean) =>
  patch<{ id: string; checklist: Record<string, boolean>; status: string }>(
    `/period-close/${runId}/check?item=${item}&done=${done}`
  );
export const lockIndiaPeriod = (runId: string) =>
  post<{ id: string; period: string; status: string; is_locked: boolean }>(
    `/period-close/${runId}/lock`
  );

// ── Management Accounts + Dashboard ──────────────────────────────────────

export const generateIndiaManagementAccounts = (period: string) =>
  post<{
    period: string; pnl: Record<string, number>;
    balance_sheet: Record<string, number>;
    compliance: Record<string, number>;
    narrative: Record<string, string>;
    generated_at: string;
  }>(`/management-accounts?period=${period}`);

export const getIndiaDashboard = (period: string) =>
  get<IndiaDashboard>('/dashboard', { period });

// ── Excel Export ──────────────────────────────────────────────────────────

export interface ExtractedInvoicePayload {
  invoice_number?: string;
  vendor_name?: string;
  vendor_gstin?: string;
  invoice_date?: string;
  due_date?: string;
  hsn_sac?: string;
  supply_type?: string;
  subtotal: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
  itc_eligible?: boolean;
  status?: string;
}

/** Download extracted invoice as Excel — returns a Blob the caller can save. */
export async function downloadExtractedInvoiceExcel(payload: ExtractedInvoicePayload): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/india/invoice/extract-to-excel`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

function filenameFromResponse(res: Response, fallback: string): string {
  const cd = res.headers.get('Content-Disposition') ?? '';
  const match = cd.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

/** Download all purchase invoices as Excel register. */
export async function downloadPurchaseInvoicesExcel(period?: string): Promise<{ blob: Blob; filename: string }> {
  const url = period
    ? `${API_BASE}/api/india/full/purchase-invoices/export/excel?period=${period}`
    : `${API_BASE}/api/india/full/purchase-invoices/export/excel`;
  const res = await fetch(url, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return { blob: await res.blob(), filename: filenameFromResponse(res, 'GST_Purchase_Register.xlsx') };
}

/** Download all purchase invoices as a branded PDF register. */
export async function downloadPurchaseInvoicesPdf(
  period?: string,
  companyName?: string,
  companyGstin?: string
): Promise<{ blob: Blob; filename: string }> {
  const params = new URLSearchParams();
  if (period) params.set('period', period);
  if (companyName) params.set('company_name', companyName);
  if (companyGstin) params.set('company_gstin', companyGstin);
  const qs = params.toString();
  const url = `${API_BASE}/api/india/full/purchase-invoices/export/pdf${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return { blob: await res.blob(), filename: filenameFromResponse(res, 'GST_Purchase_Register.pdf') };
}

/** Download a GSTR-3B return's underlying data as a JSON file (client-side, no network). */
export function downloadGstReturnJson(gstReturn: IndiaGSTReturn): void {
  const json = JSON.stringify(gstReturn, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  saveBlobAs(blob, `GSTR3B_${gstReturn.period}.json`);
}

/** Download a two-sheet Excel summary (GSTR-3B totals + underlying invoices). */
export async function downloadGstReturnExcel(returnId: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${API_BASE}/api/india/full/gst-returns/${returnId}/export/excel`, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return { blob: await res.blob(), filename: filenameFromResponse(res, `GSTR3B_Summary.xlsx`) };
}

/** Trigger browser file download from a Blob. */
export function saveBlobAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Google Sheets Settings ────────────────────────────────────────────────

export interface GoogleSheetsConfig {
  sheet_url: string;
  enabled: boolean;
  sheet_name?: string;
}

export const getGoogleSheetsConfig = () =>
  fetch(`${API_BASE}/api/india/settings/google-sheets`, { headers: hdrs() })
    .then(r => r.json() as Promise<GoogleSheetsConfig>);

export const saveGoogleSheetsConfig = (cfg: GoogleSheetsConfig) =>
  fetch(`${API_BASE}/api/india/settings/google-sheets`, {
    method: 'POST', headers: hdrs(), body: JSON.stringify(cfg),
  }).then(r => r.json());

export const syncInvoiceToSheets = (payload: ExtractedInvoicePayload) =>
  fetch(`${API_BASE}/api/india/invoice/sync-to-sheets`, {
    method: 'POST', headers: hdrs(), body: JSON.stringify(payload),
  }).then(r => r.json() as Promise<{ synced: boolean; message?: string; sheet_url?: string }>);

// ── Demo Data ─────────────────────────────────────────────────────────────

export interface DemoInvoiceDetail {
  invoice_number: string;
  vendor_name: string;
  vendor_gstin: string;
  supply_type: string;
  subtotal: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
}

export const seedDemoInvoices = () =>
  fetch(`${API_BASE}/api/india/demo/seed`, { method: 'POST', headers: hdrs() })
    .then(r => r.json() as Promise<{
      seeded: number; message: string; period?: string;
      invoices?: string[]; detail?: DemoInvoiceDetail[];
    }>);
