/**
 * Bulk upsert invoices via backend service role (bypasses Supabase browser RLS).
 */
import { joinApiUrl } from '@/utils/backendOrigin';
import { getStoredAccessToken } from '@/utils/authToken';
import { getStoredWorkspaceId, workspaceHeaders } from '@/services/workspaceService';
import type { Invoice } from './supabase';

export type BulkUpsertRowResult = {
  ok: boolean;
  invoice_number?: string;
  id?: string;
  invoice?: Invoice;
  error?: string;
};

export type BulkUpsertResult = {
  ok: boolean;
  success: number;
  failed: number;
  results: BulkUpsertRowResult[];
  error?: string;
};

function workspaceId(): string {
  return (
    localStorage.getItem('active_workspace_id') ||
    getStoredWorkspaceId() ||
    localStorage.getItem('gnanova_workspace_id') ||
    localStorage.getItem('tenantId') ||
    ''
  );
}

export async function bulkUpsertInvoicesViaApi(
  companyId: string,
  invoices: Record<string, unknown>[],
): Promise<BulkUpsertResult> {
  const token = getStoredAccessToken();
  const headers = {
    ...workspaceHeaders(token, { 'Content-Type': 'application/json' }),
  };
  const body = JSON.stringify({
    company_id: companyId,
    invoices,
    workspace_id: workspaceId(),
  });

  let res = await fetch(joinApiUrl('/api/uae/ap/bulk-upsert'), {
    method: 'POST',
    headers,
    credentials: 'include',
    body,
  });
  if (res.status === 404 || res.status === 405) {
    res = await fetch(joinApiUrl('/api/ap/invoices/bulk-upsert'), {
      method: 'POST',
      headers,
      credentials: 'include',
      body,
    });
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `Bulk upsert failed (${res.status})`);
  }
  return (await res.json()) as BulkUpsertResult;
}
