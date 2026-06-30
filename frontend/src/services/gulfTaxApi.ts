import { getStoredWorkspaceId } from './workspaceService';
import { getActiveCompanyId } from '../context/CompanyContext';

/** Empty string = use Vite proxy (/api → localhost:8001) in dev */
const API = import.meta.env.VITE_API_URL || '';

function workspaceId(): string {
  return (
    localStorage.getItem('active_workspace_id') ||
    getStoredWorkspaceId() ||
    localStorage.getItem('tenantId') ||
    ''
  );
}

function companyId(): string {
  return getActiveCompanyId() || localStorage.getItem('gulftax_company_id') || '';
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const ws = workspaceId();
  if (ws) h['X-Workspace-Id'] = ws;
  const cid = companyId();
  if (cid) h['X-Company-Id'] = cid;
  return h;
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ workspace_id: workspaceId(), company_id: companyId() || undefined, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `API error ${res.status}`);
  }
  return res.json();
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({
    workspace_id: workspaceId(),
    ...(companyId() ? { company_id: companyId() } : {}),
    ...params,
  });
  const res = await fetch(`${API}${path}?${qs}`, { headers: headers() });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export type ClassificationBucket = 'auto_approve' | 'review' | 'blocked';

export type VATClassification = {
  vat_treatment: string;
  vat_rate: number;
  vat_amount_aed: number;
  confidence_score: number;
  reasoning: string;
  blocked_input_vat?: boolean;
  blocked_reason?: string;
  reverse_charge?: boolean;
  art54_entertainment?: boolean;
  box_number?: number;
  bucket?: ClassificationBucket;
};

export async function classifyTransaction(params: {
  description: string;
  amount_aed: number;
  vendor_or_customer?: string;
  transaction_type?: string;
}): Promise<VATClassification> {
  return post('/api/gulftax/vat/classify', params);
}

export async function classifyBulk(file: File, entityType = 'mainland') {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(
    `${API}/api/gulftax/classify-bulk?entity_type=${entityType}&transaction_type=purchase`,
    { method: 'POST', body: form },
  );
  if (!res.ok) throw new Error(`Bulk classify failed ${res.status}`);
  return res.json();
}

export async function fetchVatReturnBoxes(period: string) {
  return get<{
    box9_standard_rated_expenses: number;
    box10_reverse_charge_imports: number;
    box11_recoverable_input_vat: number;
    entry_count: number;
    entries: Array<Record<string, unknown>>;
  }>('/api/gulftax/vat-return/boxes', { period });
}

export async function fetchVatReturnAllBoxes(period: string, companyIdParam?: string) {
  const cid = companyIdParam || companyId();
  if (!cid) throw new Error('company_id is required for VAT return');
  const qs = new URLSearchParams({ period, company_id: cid });
  const res = await fetch(`${API}/api/gulftax/vat-return/all-boxes?${qs}`, { headers: headers() });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

export type VatReturnSummary = {
  company_id: string;
  tax_period: string;
  transaction_count: number;
  ap_invoiceflow_count: number;
  box1: { gross: number; vat: number };
  box3: { gross: number; vat: number };
  box5: { gross: number; vat: number };
  box9: { gross: number; vat: number };
  box10: { gross: number; vat: number };
};

export type GulfTaxTransaction = {
  id: string;
  source: string;
  ap_invoice_id?: string | null;
  company_id: string;
  tax_period: string;
  transaction_date: string;
  vendor_name?: string | null;
  vendor_trn?: string | null;
  invoice_number?: string | null;
  gross_amount: number;
  vat_amount: number;
  net_amount?: number;
  vat_category: string;
  fta_box?: string | null;
  direction: string;
  status: string;
};

export async function fetchVatReturnSummary(period: string, companyIdParam?: string) {
  const cid = companyIdParam || companyId();
  if (!cid) throw new Error('company_id is required');
  return get<VatReturnSummary>('/api/gulftax/vat-return-summary', {
    tax_period: period,
    company_id: cid,
  });
}

export async function fetchGulfTaxTransactions(period: string, companyIdParam?: string) {
  const cid = companyIdParam || companyId();
  if (!cid) throw new Error('company_id is required');
  return get<{ items: GulfTaxTransaction[]; count: number }>('/api/gulftax/transactions', {
    tax_period: period,
    company_id: cid,
  });
}

export async function syncGulfTaxPeriod(period: string, companyIdParam?: string) {
  const cid = companyIdParam || companyId();
  if (!cid) throw new Error('company_id is required');
  return post<{ synced: number; skipped: number; total_invoices: number }>('/api/gulftax/sync-period', {
    tax_period: period,
    company_id: cid,
  });
}

export async function syncApprovedInvoiceToGulfTax(invoiceId: string, companyIdParam?: string) {
  const cid = companyIdParam || companyId();
  if (!cid) throw new Error('company_id is required');
  const res = await post<{ ok: boolean; skipped?: boolean }>('/api/gulftax/sync-invoice', {
    invoice_id: invoiceId,
    company_id: cid,
    workspace_id: workspaceId(),
  });
  if (res.ok && !res.skipped) {
    window.dispatchEvent(
      new CustomEvent('gulftax:transaction_added', {
        detail: { invoice_id: invoiceId, company_id: cid },
      }),
    );
  }
  return res;
}

export async function recordVatPayment(body: Record<string, unknown>) {
  return post('/api/gulftax/vat-return/record-payment', body);
}

export async function extractPdfInvoices(files: File[]) {
  const API = import.meta.env.VITE_API_URL || '';
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  const h = headers();
  delete h['Content-Type'];
  const res = await fetch(`${API}/api/gulftax/vat/extract-pdf-invoices`, { method: 'POST', headers: h, body: form });
  if (!res.ok) throw new Error(`Extract failed ${res.status}`);
  return res.json();
}

export async function savePdfTransactions(items: Record<string, unknown>[]) {
  return post('/api/gulftax/vat/save-pdf-transactions', { items });
}

export async function calculateAdvanceVatApi(params: {
  invoice_amount: number;
  contract_value: number;
  invoice_date: string;
  delivery_date: string;
  vat_rate?: number;
}) {
  return post('/api/gulftax/invoice/calculate-advance-vat', params);
}

export async function validatePintAeFromInvoice(params: Record<string, unknown>) {
  return post('/api/gulftax/einvoicing/validate-pint-ae', params);
}

export async function calculateEInvoicingPhase(annualRevenue: number, trn = '') {
  return post('/api/gulftax/einvoicing/calculate-phase', {
    trn,
    annual_revenue_aed: annualRevenue,
  });
}

export async function assessEInvoicingReadiness(params: Record<string, unknown>) {
  return post('/api/gulftax/einvoicing/readiness', params);
}

export async function validateEInvoice(params: Record<string, unknown>) {
  return post('/api/gulftax/einvoicing/validate', params);
}

export async function generateEInvoiceXml(params: Record<string, unknown>) {
  return post<{ xml_content: string }>('/api/gulftax/einvoicing/generate-xml', params);
}

export async function computeCorporateTax(params: Record<string, unknown>) {
  return post('/api/gulftax/corporate-tax/compute', params);
}

export async function generateCtReturn(params: Record<string, unknown>) {
  return post('/api/gulftax/corporate-tax/generate-return', params);
}

export async function transferPricingCheck(params: Record<string, unknown>) {
  return post('/api/gulftax/corporate-tax/tp-check', params);
}

export async function gulfTaxHealth() {
  return get<{ status: string; message: string }>('/api/gulftax/health');
}

/** Generic GET for ported uaetax API routes (/api/dashboard, /api/vat, etc.) */
export async function gulfTaxGet<T = unknown>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const qs = new URLSearchParams({ ...params });
  const suffix = qs.toString() ? `?${qs}` : '';
  const res = await fetch(`${API}${path}${suffix}`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `API error ${res.status}`);
  }
  return res.json();
}

/** Generic POST for ported uaetax API routes */
export async function gulfTaxPost<T = unknown>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `API error ${res.status}`);
  }
  return res.json();
}

/** Multipart POST (invoice extract, bulk upload via ported routes) */
export async function gulfTaxPostForm<T = unknown>(path: string, form: FormData): Promise<T> {
  const h = headers();
  delete h['Content-Type'];
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: h, body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `API error ${res.status}`);
  }
  return res.json();
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export async function fetchDashboardSummary() {
  return gulfTaxGet('/api/dashboard/summary');
}

// ── Tax Memo ─────────────────────────────────────────────────────────────────
export async function generateTaxMemo(params: {
  memo_type: string;
  period: string;
  regenerate?: boolean;
}) {
  return gulfTaxPost('/api/tax/generate-memo', params);
}

export async function fetchTaxMemos() {
  return gulfTaxGet('/api/tax/memos');
}

// ── FTA Reports ──────────────────────────────────────────────────────────────
export async function fetchFtaSummary(periodStart: string, periodEnd: string) {
  return gulfTaxGet('/api/fta/summary', { period_start: periodStart, period_end: periodEnd });
}

export async function fetchFtaTransactions(
  periodStart: string,
  periodEnd: string,
  txType = 'all',
) {
  return gulfTaxGet('/api/fta/transaction-listing', {
    period_start: periodStart,
    period_end: periodEnd,
    tx_type: txType,
  });
}

export async function fetchFtaApRisk() {
  return gulfTaxGet('/api/fta/ap-risk-summary');
}

// ── VAT Classifier / Transactions ────────────────────────────────────────────
export async function fetchVatTransactions(limit = 200) {
  return gulfTaxGet(`/api/vat/transactions`, { limit: String(limit) });
}

export async function verifyVatTransaction(id: number) {
  return gulfTaxPost(`/api/vat/transactions/${id}/verify`);
}

export async function reclassifyExempt() {
  return gulfTaxPost('/api/vat/reclassify-exempt');
}

// ── VAT Return (full lifecycle) ──────────────────────────────────────────────
export async function generateVatReturn(params: {
  period_start: string;
  period_end: string;
}) {
  return gulfTaxPost('/api/vat/generate-return', params);
}

export async function fetchVatReturnPdf(returnId: number) {
  const res = await fetch(`${API}/api/vat/returns/${returnId}/pdf`, { headers: headers() });
  if (!res.ok) throw new Error(`PDF download failed ${res.status}`);
  return res.blob();
}

// ── Supplier Ledger ──────────────────────────────────────────────────────────
export async function fetchInvoiceVendors() {
  return gulfTaxGet('/api/invoice/vendors');
}

// ── Reconciliation ───────────────────────────────────────────────────────────
export async function runReconciliation(params: Record<string, unknown>) {
  return gulfTaxPost('/api/vat/reconcile', params);
}

// ── Corporate Tax (ported narrative) ─────────────────────────────────────────
export async function fetchCtNarrative(params: Record<string, unknown>) {
  return gulfTaxPost('/api/ct/narrative', params);
}

// ── E-Invoicing automations ──────────────────────────────────────────────────
export async function fetchEInvoicingAssessments(companyId: string) {
  return gulfTaxGet('/api/automations/assessments', { company_id: companyId });
}

export async function triggerEInvoicingAutomation(companyId: string) {
  return gulfTaxPost(`/api/automations/trigger/${companyId}`);
}

// ── ASP submission (n8n webhook) ─────────────────────────────────────────────
export type AspSubmissionStatus = 'pending' | 'accepted' | 'rejected';

export interface AspSubmission {
  id: string;
  invoice_number: string;
  invoice_date: string;
  seller_trn?: string;
  buyer_trn?: string;
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
  status: AspSubmissionStatus;
  rejection_reason: string | null;
  submitted_at: string;
  updated_at: string;
}

export async function submitToAsp(params: {
  invoice_number: string;
  invoice_date?: string;
  seller_trn?: string;
  buyer_trn?: string;
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
  xml_content?: string;
}): Promise<{ submission_id: string; status: AspSubmissionStatus; message: string }> {
  return post('/api/gulftax/einvoicing/asp/submit', params);
}

export async function fetchAspSubmissions(limit = 20): Promise<{ items: AspSubmission[] }> {
  return get('/api/gulftax/einvoicing/asp/submissions', { limit: String(limit) });
}

export async function redriveAspSubmission(submissionId: string): Promise<{ submission_id: string; status: AspSubmissionStatus }> {
  return post(`/api/gulftax/einvoicing/asp/${submissionId}/redrive`, {});
}
