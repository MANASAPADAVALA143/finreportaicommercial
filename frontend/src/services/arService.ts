/** UAE AR — /api/uae/ar endpoints */

import { backendOrigin } from '../utils/backendOrigin';
import { getStoredAccessToken, workspaceHeaders } from '../utils/workspaceHeaders';

const BASE = `${backendOrigin()}/api/uae/ar`;

function hdrs(extra: Record<string, string> = {}): Record<string, string> {
  return workspaceHeaders(getStoredAccessToken(), extra);
}

function companyParams(extra: Record<string, string> = {}): Record<string, string> {
  const cid = localStorage.getItem('active_company_id');
  const wsId = localStorage.getItem('gnanova_workspace_id') ?? localStorage.getItem('tenantId');
  return {
    ...(cid ? { company_id: cid } : {}),
    workspace_id: wsId,
    ...extra,
  };
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const q = new URLSearchParams(companyParams(params ?? {})).toString();
  const url = `${BASE}${path}${q ? `?${q}` : ''}`;
  const res = await fetch(url, { headers: hdrs(), credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function patch<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: hdrs(),
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface ARLineItem {
  description: string;
  qty: number;
  unit_price: number;
  vat_rate: number;
  vat_amount?: number;
  line_total?: number;
}

export interface ARInvoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  customer_trn?: string | null;
  invoice_date: string | null;
  due_date: string | null;
  subtotal: number;
  vat_amount: number;
  total: number;
  amount_due: number;
  status: string;
  einvoicing_status?: string | null;
  is_overdue: boolean;
  je_reference?: string | null;
  sent_at?: string | null;
  paid_date?: string | null;
  payment_reference?: string | null;
  line_items: ARLineItem[];
  vat_treatment?: string | null;
  gulftax_decision?: 'AUTO_APPROVE' | 'REVIEW_QUEUE' | 'HARD_BLOCK' | string | null;
  gulftax_risk_score?: number | null;
  gulftax_confidence?: number | null;
  trn_valid?: boolean | null;
  flag_for_review?: boolean;
  gulftax_reasoning?: string | null;
}

export interface ARCustomerRiskRow {
  customer_id: string | null;
  customer_name: string;
  risk_tier: 'low' | 'medium' | 'high' | 'critical';
  total_outstanding: number;
  total_overdue: number;
  worst_bucket: string;
  credit_notes_count: number;
  total_credited: number;
  avg_days_to_pay: number | null;
  open_invoice_count: number;
}

export interface ARCreditNote {
  id: string;
  credit_note_number: string;
  parent_invoice_id: string;
  invoice_number?: string | null;
  customer_id?: string | null;
  customer_name: string;
  company_id?: string | null;
  amount: number;
  reason?: string | null;
  status: string;
  issued_date?: string | null;
  created_at?: string | null;
}

export interface ARAgingBucket {
  bucket: string;
  invoice_count: number;
  total_aed: number;
  customers: string[];
}

export interface CreateInvoicePayload {
  customer_name: string;
  customer_trn?: string;
  invoice_date: string;
  due_date: string;
  line_items: ARLineItem[];
  company_id: string;
  workspace_id?: string;
}

export const listARInvoices = (status?: string) =>
  get<{ invoices: ARInvoice[]; count: number }>('/invoices', status ? { status } : undefined);

export const getARAging = () =>
  get<{ buckets: ARAgingBucket[]; total_outstanding: number; currency: string }>('/aging');

export const getARCustomerRisk = (risk_tier?: string) =>
  get<{
    as_of: string;
    currency: string;
    total_outstanding: number;
    total_overdue: number;
    customer_count: number;
    customers: ARCustomerRiskRow[];
    risk_tier_filter?: string;
  }>('/customer-risk', risk_tier ? { risk_tier } : undefined);

export const createARInvoice = (body: CreateInvoicePayload) =>
  post<{
    invoice_id: string;
    invoice_number: string;
    subtotal: number;
    vat_amount: number;
    total: number;
    status: string;
    posted?: boolean;
    needs_manual_review?: boolean;
    je_id?: string | null;
    je_reference?: string | null;
    gulftax?: Record<string, unknown> | null;
    gulftax_decision?: string | null;
    gulftax_reasoning?: string | null;
    flag_for_review?: boolean;
    vat_treatment?: string | null;
    gulftax_risk_score?: number | null;
    gulftax_confidence?: number | null;
    trn_valid?: boolean | null;
    message?: string | null;
  }>(
    '/create-invoice',
    body,
  );

export const approveAndPostARInvoice = (invoice_id: string, company_id?: string) =>
  post<{
    ok: boolean;
    skipped?: boolean;
    je_posted: boolean;
    je_id?: string;
    je_reference?: string;
    status?: string;
    invoice_id?: string;
    invoice_number?: string;
    gulftax?: Record<string, unknown>;
    message?: string;
  }>('/approve-and-post', {
    invoice_id,
    company_id: company_id ?? localStorage.getItem('active_company_id'),
    workspace_id: localStorage.getItem('gnanova_workspace_id'),
  });

export const listARCreditNotes = (params?: {
  status?: string;
  customer_id?: string;
  parent_invoice_id?: string;
}) =>
  get<{ credit_notes: ARCreditNote[]; count: number }>(
    '/credit-notes',
    params as Record<string, string> | undefined,
  );

export const issueARCreditNote = (
  invoiceId: string,
  body: { amount: number; reason?: string; company_id?: string; issued_date?: string },
) =>
  post<{
    ok: boolean;
    credit_note: ARCreditNote;
    outstanding_after: number;
    invoice_status: string;
    je_id?: string;
    je_reference?: string;
  }>(`/${invoiceId}/credit-note`, {
    ...body,
    company_id: body.company_id ?? localStorage.getItem('active_company_id'),
    workspace_id: localStorage.getItem('gnanova_workspace_id'),
  });

export const voidARCreditNote = (creditNoteId: string) =>
  post<{
    ok: boolean;
    credit_note: ARCreditNote;
    outstanding_after: number;
    invoice_status: string;
  }>(`/credit-notes/${creditNoteId}/void`, {
    workspace_id: localStorage.getItem('gnanova_workspace_id'),
  });

export const sendARInvoice = (invoice_id: string, customer_email: string) =>
  post<{ sent: boolean; invoice_number: string; warning?: string }>('/send-invoice', {
    invoice_id,
    customer_email,
  });

export const recordARPayment = (body: {
  invoice_id: string;
  payment_date: string;
  bank_account_code: string;
  amount_received: number;
  reference?: string;
  company_id: string;
  workspace_id?: string;
}) => post<{ success: boolean; receipt_je_id: string; status: string }>('/record-payment', {
  ...body,
  workspace_id: body.workspace_id ?? localStorage.getItem('gnanova_workspace_id'),
});

export function arPdfUrl(invoiceId: string): string {
  const wsId = localStorage.getItem('gnanova_workspace_id');
  return `${BASE}/invoices/${invoiceId}/pdf`;
}

export const autoMatchPayments = (body: { company_id: string; bank_account_code?: string }) =>
  post<{
    matched: Array<{ invoice_id: string; invoice_number: string; amount: number; confidence: number }>;
    matched_count: number;
    matched_total_aed: number;
    needs_review: Array<{ invoice_id?: string; invoice_number?: string; amount: number; confidence: number; reason?: string }>;
    needs_review_count: number;
    unmatched: Array<{ amount: number; reference?: string }>;
    unmatched_count: number;
  }>('/auto-match-payment', {
    ...body,
    workspace_id: localStorage.getItem('gnanova_workspace_id'),
  });

export interface ARDunningHistoryRow {
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  last_dunning_level: number;
  last_dunning_sent_at: string | null;
  dunning_count: number;
  outstanding: number;
  days_overdue: number;
  due_date?: string | null;
}

export interface ARDunningTemplate {
  level: number;
  label: string;
  days_overdue_range: string;
  subject: string;
  body: string;
}

export const getARDunningHistory = (dunning_level?: number) =>
  get<{ as_of: string; count: number; invoices: ARDunningHistoryRow[]; dunning_level_filter?: number }>(
    '/dunning-history',
    dunning_level != null ? { dunning_level: String(dunning_level) } : undefined,
  );

export const getARDunningTemplates = () =>
  get<{ templates: ARDunningTemplate[] }>('/dunning-templates');

export const runCollectionsDunning = (company_id: string) =>
  post<{
    sent_count: number;
    skipped_count: number;
    sent: Array<{ invoice_number: string; customer: string; amount: number; level: number; email?: string }>;
    skipped: Array<{ invoice_number: string; customer: string; amount: number; level: number; reason: string }>;
    summary: string[];
  }>(
    '/run-dunning',
    { company_id, workspace_id: localStorage.getItem('gnanova_workspace_id') },
  );

export interface ARRecurringTemplate {
  id: string;
  customer_id: string;
  customer_name: string;
  description: string;
  amount: number;
  vat_rate: number;
  recurrence_type: 'weekly' | 'monthly' | 'quarterly' | 'annually';
  interval: number;
  start_date: string;
  next_due_date: string;
  end_date: string | null;
  status: 'active' | 'paused' | 'cancelled';
  last_generated_at: string | null;
  generated_count: number;
}

export interface ARGeneratedInvoice {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  subtotal: number;
  vat_amount: number;
  total: number;
  status: string;
}

export const listARRecurringTemplates = (status?: string) =>
  get<{ count: number; templates: ARRecurringTemplate[] }>(
    '/recurring-invoices',
    status ? { status } : undefined,
  );

export const createARRecurringTemplate = (body: {
  customer_id: string;
  description: string;
  amount: number;
  vat_rate: number;
  recurrence_type: string;
  interval: number;
  start_date: string;
  end_date?: string;
  company_id: string;
}) =>
  post<ARRecurringTemplate>('/recurring-invoices', {
    ...body,
    workspace_id: localStorage.getItem('gnanova_workspace_id'),
  });

export const generateDueARRecurring = (company_id?: string) =>
  post<{ as_of: string; generated_count: number; generated: Array<Record<string, unknown>> }>(
    '/recurring-invoices/generate-due',
    { company_id, workspace_id: localStorage.getItem('gnanova_workspace_id') },
  );

export const getARRecurringGenerated = (templateId: string) =>
  get<{ template_id: string; customer_name: string; count: number; invoices: ARGeneratedInvoice[] }>(
    `/recurring-invoices/${templateId}/generated`,
  );

export const pauseARRecurringTemplate = (templateId: string) =>
  patch<ARRecurringTemplate>(`/recurring-invoices/${templateId}/pause`, {
    workspace_id: localStorage.getItem('gnanova_workspace_id'),
  });

export const resumeARRecurringTemplate = (templateId: string) =>
  patch<ARRecurringTemplate>(`/recurring-invoices/${templateId}/resume`, {
    workspace_id: localStorage.getItem('gnanova_workspace_id'),
  });

export const cancelARRecurringTemplate = (templateId: string) =>
  patch<ARRecurringTemplate>(`/recurring-invoices/${templateId}/cancel`, {
    workspace_id: localStorage.getItem('gnanova_workspace_id'),
  });

export interface DSOMetrics {
  dso_current: number;
  dso_trend: Array<{ month: string; dso: number }>;
  best_dso: number;
  worst_dso: number;
  industry_benchmark: number;
  dso_vs_benchmark: number;
  dso_vs_benchmark_label: string;
  collections_efficiency_pct: number;
  total_outstanding_aed: number;
  total_revenue_aed: number;
  currency: string;
}

export interface PaymentPrediction {
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  total_aed: number;
  due_date: string;
  days_overdue: number;
  predicted_payment_date: string;
  predicted_days_to_collect: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  risk_flag: 'HIGH' | 'MEDIUM' | 'LOW';
  customer_avg_days_late: number;
  basis: string;
}

export const getDSOMetrics = (company_id: string, period_start?: string, period_end?: string) =>
  get<DSOMetrics>('/dso-metrics', {
    company_id,
    ...(period_start ? { period_start } : {}),
    ...(period_end ? { period_end } : {}),
  });

export const predictPayments = (body: { company_id: string; invoice_id?: string; workspace_id?: string }) =>
  post<{
    predictions: PaymentPrediction[];
    total_predicted_cash_next_30_days: number;
    total_predicted_cash_next_60_days: number;
    total_predicted_cash_next_90_days: number;
  }>('/predict-payment', {
    ...body,
    workspace_id: body.workspace_id ?? localStorage.getItem('gnanova_workspace_id'),
  });

export async function downloadARPdf(invoiceId: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE}/invoices/${invoiceId}/pdf`, { headers: hdrs(), credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
