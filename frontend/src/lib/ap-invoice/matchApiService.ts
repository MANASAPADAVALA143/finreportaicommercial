/**
 * Service-role helpers for 3-way match when browser Supabase RLS hides rows
 * (FinReport JWT sessions with no company_members link).
 */
import { joinApiUrl } from '@/utils/backendOrigin';
import { getStoredAccessToken } from '@/utils/authToken';
import { getStoredWorkspaceId, workspaceHeaders } from '@/services/workspaceService';
import type { Invoice } from './supabase';

function workspaceId(): string {
  return (
    localStorage.getItem('active_workspace_id') ||
    getStoredWorkspaceId() ||
    localStorage.getItem('gnanova_workspace_id') ||
    localStorage.getItem('tenantId') ||
    ''
  );
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = getStoredAccessToken();
  const headers = workspaceHeaders(token, { 'Content-Type': 'application/json' });
  const payload = JSON.stringify({ ...body, workspace_id: workspaceId() });
  const res = await fetch(joinApiUrl(path), {
    method: 'POST',
    headers,
    credentials: 'include',
    body: payload,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `API ${path} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function getInvoiceViaApi(
  companyId: string,
  opts: { invoiceId?: string; invoiceNumber?: string },
): Promise<Invoice | null> {
  const data = await postJson<{ ok?: boolean; invoice?: Invoice | null; error?: string }>(
    '/api/uae/ap/get-invoice',
    {
      company_id: companyId,
      invoice_id: opts.invoiceId || '',
      invoice_number: opts.invoiceNumber || '',
    },
  );
  if (data.error && !data.invoice) throw new Error(data.error);
  return data.invoice ?? null;
}

export async function patchInvoiceViaApi(
  companyId: string,
  invoiceId: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  const data = await postJson<{ ok?: boolean; error?: string }>('/api/uae/ap/patch-invoice', {
    company_id: companyId,
    invoice_id: invoiceId,
    fields,
  });
  if (data.error && !data.ok) throw new Error(data.error);
  return !!data.ok;
}

export async function listPurchaseOrdersViaApi(
  companyId: string,
): Promise<Record<string, unknown>[]> {
  const data = await postJson<{
    ok?: boolean;
    purchase_orders?: Record<string, unknown>[];
    error?: string;
  }>('/api/uae/ap/list-purchase-orders', { company_id: companyId, limit: 1000 });
  return Array.isArray(data.purchase_orders) ? data.purchase_orders : [];
}

export async function listGoodsReceiptsViaApi(
  companyId: string,
  poId?: string | null,
): Promise<Record<string, unknown>[]> {
  const data = await postJson<{
    ok?: boolean;
    goods_receipts?: Record<string, unknown>[];
    error?: string;
  }>('/api/uae/ap/list-goods-receipts', {
    company_id: companyId,
    po_id: poId || '',
    limit: 1000,
  });
  return Array.isArray(data.goods_receipts) ? data.goods_receipts : [];
}

export async function ensureWorkspaceMatchesViaApi(companyId: string): Promise<{
  ok?: boolean;
  copied_pos?: number;
  relinked_grns?: number;
  properties?: number;
  error?: string;
}> {
  try {
    return await postJson('/api/ap/purchase-orders/ensure-workspace-matches', {
      company_id: companyId,
    });
  } catch {
    return postJson('/api/uae/ap/ensure-workspace-matches', {
      company_id: companyId,
    });
  }
}
