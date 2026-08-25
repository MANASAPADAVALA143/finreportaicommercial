/**
 * Bulk approve AP invoices + sync GulfTax (shared backend helper).
 */
import { joinApiUrl } from '@/utils/backendOrigin';
import { getStoredAccessToken } from '@/utils/authToken';
import { getStoredWorkspaceId, workspaceHeaders } from '@/services/workspaceService';

export type BulkApproveResult = {
  ok: boolean;
  approved_count: number;
  requested_count: number;
  gulftax_synced: number;
  gulftax_skipped: number;
  gulftax_errors: number;
  failed?: Array<{ invoice_id: string; error: string }>;
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

/** Prefer UAE alias (same auth as single approve); fall back to /api/ap/invoices. */
export async function bulkApproveApInvoices(
  invoiceIds: string[],
  companyId: string | null,
): Promise<BulkApproveResult> {
  const token = getStoredAccessToken();
  const body = {
    invoice_ids: invoiceIds,
    company_id: companyId || '',
    workspace_id: workspaceId(),
  };
  const headers = {
    ...workspaceHeaders(token, { 'Content-Type': 'application/json' }),
  };

  let res = await fetch(joinApiUrl('/api/uae/ap/bulk-approve'), {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (res.status === 404 || res.status === 405) {
    res = await fetch(joinApiUrl('/api/ap/invoices/bulk-approve'), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `Bulk approve failed (${res.status})`);
  }

  return (await res.json()) as BulkApproveResult;
}
