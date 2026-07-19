/**
 * Post a fully-approved AP invoice to UAE GL + GulfTax via shared backend service.
 */
import type { Invoice } from './supabase';
import { getStoredWorkspaceId, workspaceHeaders } from '../../services/workspaceService';
import { getStoredAccessToken } from '../../utils/authToken';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || '';

export type ApproveAndPostResult = {
  ok: boolean;
  skipped?: boolean;
  je_posted?: boolean;
  je_reference?: string;
  je_id?: string;
  message?: string;
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

/** Shared entry — call after any path sets invoice status to Approved. */
export async function postApprovedInvoiceToGL(
  invoice: Invoice | { id: string },
  companyId: string | null,
): Promise<ApproveAndPostResult> {
  // Must use the same token source as other UAE API calls — localStorage 'token' is often empty.
  const token = getStoredAccessToken();
  const res = await fetch(`${API_BASE}/api/uae/ap/post-approved-invoice`, {
    method: 'POST',
    headers: {
      ...workspaceHeaders(token, { 'Content-Type': 'application/json' }),
    },
    credentials: 'include',
    body: JSON.stringify({
      invoice_id: invoice.id,
      company_id: companyId || '',
      workspace_id: workspaceId(),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `GL post failed (${res.status})`);
  }

  const result = (await res.json()) as ApproveAndPostResult;
  if (result.ok && invoice.id && companyId) {
    emitGulfTaxTransactionAdded(invoice.id, companyId);
  }
  return result;
}

/** Fire-and-forget GL+GulfTax post (logs warning on failure). */
export function triggerGlPostForApprovedInvoice(
  invoice: Invoice,
  companyId: string | null,
): void {
  void postApprovedInvoiceToGL(invoice, companyId).catch((e) => {
    console.warn('[AP] GL/GulfTax post after approval failed:', e);
  });
}

/** Notify GulfTax pages that a new AP transaction was synced */
export function emitGulfTaxTransactionAdded(invoiceId: string, companyId: string) {
  window.dispatchEvent(
    new CustomEvent('gulftax:transaction_added', {
      detail: { invoice_id: invoiceId, company_id: companyId },
    }),
  );
}
