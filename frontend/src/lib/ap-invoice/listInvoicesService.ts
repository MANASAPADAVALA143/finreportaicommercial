/**
 * List AP invoices via backend service role (bypasses browser Supabase RLS).
 * Needed when user is logged in with FinReport JWT but has no Supabase auth session.
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

export async function listInvoicesViaApi(
  companyId: string,
  limit = 500,
): Promise<Invoice[]> {
  const token = getStoredAccessToken();
  const headers = workspaceHeaders(token, { 'Content-Type': 'application/json' });
  const body = JSON.stringify({
    company_id: companyId,
    limit,
    workspace_id: workspaceId(),
  });

  let res = await fetch(joinApiUrl('/api/uae/ap/list-invoices'), {
    method: 'POST',
    headers,
    credentials: 'include',
    body,
  });
  if (res.status === 404 || res.status === 405) {
    res = await fetch(joinApiUrl('/api/ap/invoices/list'), {
      method: 'POST',
      headers,
      credentials: 'include',
      body,
    });
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `List invoices failed (${res.status})`);
  }
  const data = (await res.json()) as { invoices?: Invoice[]; ok?: boolean; error?: string };
  if (data.error) throw new Error(data.error);
  return Array.isArray(data.invoices) ? data.invoices : [];
}
