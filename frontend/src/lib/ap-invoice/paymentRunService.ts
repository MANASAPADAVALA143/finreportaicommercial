/** AP Payment Run Center — /api/ap-invoices/payment-run */

import { backendOrigin } from '../../utils/backendOrigin';
import { getStoredAccessToken, workspaceHeaders } from '../../utils/workspaceHeaders';

const BASE = `${backendOrigin()}/api/ap-invoices/payment-run`;

function companyId(): string {
  return localStorage.getItem('active_company_id') || localStorage.getItem('ap_company_id') || '';
}

function workspaceId(): string {
  return (
    localStorage.getItem('gnanova_workspace_id') ||
    localStorage.getItem('active_workspace_id') ||
    localStorage.getItem('tenantId') ||
    ''
  );
}

function hdrs(extra: Record<string, string> = {}): Record<string, string> {
  const h = workspaceHeaders(getStoredAccessToken(), extra);
  const cid = companyId();
  if (cid) h['X-Company-Id'] = cid;
  const role =
    localStorage.getItem('product_role') ||
    localStorage.getItem('user_role') ||
    '';
  if (role) h['X-Product-Role'] = role;
  const email = localStorage.getItem('user_email') || localStorage.getItem('ap_user_email') || '';
  if (email) h['X-User-Email'] = email;
  return h;
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
  } catch {
    return await res.text();
  }
}

export type PaymentRunStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'executed'
  | 'rejected'
  | string;

export type PaymentRun = {
  id: string;
  run_number: string;
  workspace_id: string;
  company_id: string;
  created_by?: string | null;
  created_at?: string | null;
  submitted_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  executed_at?: string | null;
  status: PaymentRunStatus;
  rejection_reason?: string | null;
  total_invoices: number;
  vendor_count?: number;
  total_net_aed: number;
  total_vat_aed: number;
  total_gross_aed: number;
  invoice_ids: string[];
  journal_entry_id?: string | null;
  invoices?: EligibleInvoice[];
  message?: string;
};

export type EligibleInvoice = {
  id: string;
  invoice_number: string;
  vendor_name: string;
  due_date: string | null;
  amount: number;
  net_amount?: number;
  vat_amount?: number;
  days_overdue: number;
  discount_available?: number | null;
  category?: string;
  currency?: string;
  status?: string;
  payment_status?: string;
};

export async function listPaymentRuns(params?: {
  status?: string;
  date_from?: string;
  date_to?: string;
}): Promise<{ runs: PaymentRun[]; count: number }> {
  const q = new URLSearchParams({
    workspace_id: workspaceId(),
    company_id: companyId(),
    ...(params?.status ? { status: params.status } : {}),
    ...(params?.date_from ? { date_from: params.date_from } : {}),
    ...(params?.date_to ? { date_to: params.date_to } : {}),
  });
  const res = await fetch(`${BASE}?${q}`, { headers: hdrs(), credentials: 'include' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function listEligibleInvoices(params?: {
  due_from?: string;
  due_to?: string;
  vendor?: string;
  amount_min?: number;
  amount_max?: number;
  category?: string;
}): Promise<{ invoices: EligibleInvoice[]; categories: string[]; filters: { due_from: string; due_to: string } }> {
  const q = new URLSearchParams({
    workspace_id: workspaceId(),
    company_id: companyId(),
  });
  if (params?.due_from) q.set('due_from', params.due_from);
  if (params?.due_to) q.set('due_to', params.due_to);
  if (params?.vendor) q.set('vendor', params.vendor);
  if (params?.amount_min != null) q.set('amount_min', String(params.amount_min));
  if (params?.amount_max != null) q.set('amount_max', String(params.amount_max));
  if (params?.category) q.set('category', params.category);
  const res = await fetch(`${BASE}/eligible?${q}`, { headers: hdrs(), credentials: 'include' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function createPaymentRun(invoice_ids: string[]): Promise<PaymentRun> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: hdrs(),
    credentials: 'include',
    body: JSON.stringify({
      invoice_ids,
      workspace_id: workspaceId(),
      company_id: companyId(),
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function getPaymentRun(id: string): Promise<PaymentRun> {
  const q = new URLSearchParams({
    workspace_id: workspaceId(),
    company_id: companyId(),
  });
  const res = await fetch(`${BASE}/${id}?${q}`, { headers: hdrs(), credentials: 'include' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

async function postAction(id: string, action: string, body?: unknown): Promise<PaymentRun> {
  const q = new URLSearchParams({
    workspace_id: workspaceId(),
    company_id: companyId(),
  });
  const res = await fetch(`${BASE}/${id}/${action}?${q}`, {
    method: 'POST',
    headers: hdrs(),
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export const submitPaymentRun = (id: string) => postAction(id, 'submit');
export const approvePaymentRun = (id: string) => postAction(id, 'approve');
export const rejectPaymentRun = (id: string, reason: string) => postAction(id, 'reject', { reason });
export const executePaymentRun = (id: string) => postAction(id, 'execute');

export function bankFileUrl(id: string): string {
  const q = new URLSearchParams({
    workspace_id: workspaceId(),
    company_id: companyId(),
  });
  return `${BASE}/${id}/bank-file?${q}`;
}

export function remittanceUrl(id: string): string {
  const q = new URLSearchParams({
    workspace_id: workspaceId(),
    company_id: companyId(),
  });
  return `${BASE}/${id}/remittance?${q}`;
}

export async function downloadAuthenticated(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { headers: hdrs(), credentials: 'include' });
  if (!res.ok) throw new Error(await parseError(res));
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
