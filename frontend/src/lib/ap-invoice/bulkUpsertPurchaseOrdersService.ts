/**
 * Bulk upsert purchase orders via backend service role (bypasses Supabase browser RLS).
 */
import { joinApiUrl } from '@/utils/backendOrigin';
import { getStoredAccessToken } from '@/utils/authToken';
import { getStoredWorkspaceId, workspaceHeaders } from '@/services/workspaceService';

export type BulkUpsertPoRowResult = {
  ok: boolean;
  po_number?: string;
  id?: string;
  error?: string;
};

export type BulkUpsertPoResult = {
  ok: boolean;
  success: number;
  failed: number;
  results: BulkUpsertPoRowResult[];
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

export async function bulkUpsertPurchaseOrdersViaApi(
  companyId: string,
  purchaseOrders: Record<string, unknown>[],
): Promise<BulkUpsertPoResult> {
  const token = getStoredAccessToken();
  const headers = {
    ...workspaceHeaders(token, { 'Content-Type': 'application/json' }),
  };
  const body = JSON.stringify({
    company_id: companyId,
    purchase_orders: purchaseOrders,
    workspace_id: workspaceId(),
  });

  let res = await fetch(joinApiUrl('/api/ap/purchase-orders/bulk'), {
    method: 'POST',
    headers,
    credentials: 'include',
    body,
  });
  if (res.status === 404 || res.status === 405) {
    res = await fetch(joinApiUrl('/api/uae/ap/bulk-upsert-purchase-orders'), {
      method: 'POST',
      headers,
      credentials: 'include',
      body,
    });
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(
      typeof err.detail === 'string' ? err.detail : `PO bulk upsert failed (${res.status})`,
    );
  }
  return (await res.json()) as BulkUpsertPoResult;
}
