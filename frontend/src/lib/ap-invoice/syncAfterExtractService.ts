/**
 * After PDF/OCR extract + save — auto-sync to gulftax when confidence >= 85%.
 * Uses shared backend helper (same as single/bulk approve).
 */
import type { Invoice } from './supabase';
import { joinApiUrl } from '@/utils/backendOrigin';
import { getStoredAccessToken } from '@/utils/authToken';
import { getStoredWorkspaceId, workspaceHeaders } from '@/services/workspaceService';
import { getEffectiveExtractionScore } from '@/utils/extractionConfidence';

export type SyncAfterExtractResult = {
  ok: boolean;
  synced?: boolean;
  skipped?: boolean;
  reason?: string;
  confidence?: number;
  status?: string;
  fta_box?: string;
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

/** Call after invoice row is saved from PDF/OCR pipeline. Safe no-op on network failure. */
export async function syncAfterPdfExtract(
  invoice: Invoice | { id: string; company_id?: string | null; ocr_confidence?: number | null },
  companyId: string | null,
  confidenceOverride?: number | null,
): Promise<SyncAfterExtractResult> {
  if (!invoice?.id) return { ok: false, error: 'missing_invoice_id' };

  const conf =
    confidenceOverride != null && Number.isFinite(confidenceOverride)
      ? Number(confidenceOverride)
      : getEffectiveExtractionScore(invoice as Invoice);

  try {
    const token = getStoredAccessToken();
    const res = await fetch(joinApiUrl('/api/uae/ap/sync-after-extract'), {
      method: 'POST',
      headers: {
        ...workspaceHeaders(token, { 'Content-Type': 'application/json' }),
      },
      credentials: 'include',
      body: JSON.stringify({
        invoice_id: invoice.id,
        company_id: companyId || invoice.company_id || '',
        workspace_id: workspaceId(),
        confidence: conf,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      return {
        ok: false,
        error: typeof err.detail === 'string' ? err.detail : `sync-after-extract failed (${res.status})`,
      };
    }
    return (await res.json()) as SyncAfterExtractResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[AP] sync-after-extract failed:', msg);
    return { ok: false, error: msg };
  }
}
