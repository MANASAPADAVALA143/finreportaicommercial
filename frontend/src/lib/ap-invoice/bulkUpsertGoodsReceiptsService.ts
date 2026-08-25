/**
 * Bulk upsert goods receipts via backend service role (bypasses Supabase browser RLS).
 * Works for any company — stamps company_id from the request body.
 */
import { joinApiUrl } from '@/utils/backendOrigin';
import { getStoredAccessToken } from '@/utils/authToken';
import { getStoredWorkspaceId, workspaceHeaders } from '@/services/workspaceService';

export type BulkUpsertGrnRowResult = {
  ok: boolean;
  grn_number?: string;
  id?: string;
  po_id?: string | null;
  needs_review?: boolean;
  warning?: string;
  skipped?: boolean;
  error?: string;
};

export type BulkUpsertGrnResult = {
  ok: boolean;
  success: number;
  failed: number;
  skipped: number;
  unlinked_po: number;
  needs_review: number;
  results: BulkUpsertGrnRowResult[];
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

export async function bulkUpsertGoodsReceiptsViaApi(
  companyId: string,
  goodsReceipts: Record<string, unknown>[],
): Promise<BulkUpsertGrnResult> {
  const token = getStoredAccessToken();
  const headers = {
    ...workspaceHeaders(token, { 'Content-Type': 'application/json' }),
  };
  const body = JSON.stringify({
    company_id: companyId,
    goods_receipts: goodsReceipts,
    workspace_id: workspaceId(),
  });

  let res = await fetch(joinApiUrl('/api/ap/goods-receipts/bulk'), {
    method: 'POST',
    headers,
    credentials: 'include',
    body,
  });
  if (res.status === 404 || res.status === 405) {
    res = await fetch(joinApiUrl('/api/uae/ap/bulk-upsert-goods-receipts'), {
      method: 'POST',
      headers,
      credentials: 'include',
      body,
    });
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(
      typeof err.detail === 'string' ? err.detail : `GRN bulk upsert failed (${res.status})`,
    );
  }
  return (await res.json()) as BulkUpsertGrnResult;
}

export async function listPurchaseOrdersViaApi(
  companyId: string,
  limit = 500,
): Promise<{ ok: boolean; purchase_orders: Record<string, unknown>[]; error?: string }> {
  const token = getStoredAccessToken();
  const headers = {
    ...workspaceHeaders(token, { 'Content-Type': 'application/json' }),
  };
  const body = JSON.stringify({ company_id: companyId, limit });
  let res = await fetch(joinApiUrl('/api/uae/ap/list-purchase-orders'), {
    method: 'POST',
    headers,
    credentials: 'include',
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(
      typeof err.detail === 'string' ? err.detail : `List POs failed (${res.status})`,
    );
  }
  return (await res.json()) as {
    ok: boolean;
    purchase_orders: Record<string, unknown>[];
    error?: string;
  };
}

export async function listGoodsReceiptsViaApi(
  companyId: string,
  limit = 500,
): Promise<{ ok: boolean; goods_receipts: Record<string, unknown>[]; error?: string }> {
  const token = getStoredAccessToken();
  const headers = {
    ...workspaceHeaders(token, { 'Content-Type': 'application/json' }),
  };
  const body = JSON.stringify({ company_id: companyId, limit });
  const res = await fetch(joinApiUrl('/api/uae/ap/list-goods-receipts'), {
    method: 'POST',
    headers,
    credentials: 'include',
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(
      typeof err.detail === 'string' ? err.detail : `List GRNs failed (${res.status})`,
    );
  }
  return (await res.json()) as {
    ok: boolean;
    goods_receipts: Record<string, unknown>[];
    error?: string;
  };
}
