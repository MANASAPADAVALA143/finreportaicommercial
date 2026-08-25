/**
 * Post a fully-approved AP invoice to UAE GL + GulfTax via shared backend service.
 */
import type { Invoice } from './supabase';
import { getStoredWorkspaceId, workspaceHeaders } from '../../services/workspaceService';
import { getStoredAccessToken } from '../../utils/authToken';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || '';

export const AP_GL_POST_FAILURES_KEY = 'ap_gl_post_failures';

export type ApproveAndPostResult = {
  ok: boolean;
  skipped?: boolean;
  je_posted?: boolean;
  je_reference?: string;
  je_id?: string;
  message?: string;
  error?: string;
};

export type GlPostFailure = {
  invoice_id: string;
  company_id: string;
  failed_at: string;
};

export type GlPostToastFn = (opts: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

function workspaceId(): string {
  return (
    localStorage.getItem('active_workspace_id') ||
    getStoredWorkspaceId() ||
    localStorage.getItem('gnanova_workspace_id') ||
    localStorage.getItem('tenantId') ||
    ''
  );
}

function readFailures(): GlPostFailure[] {
  try {
    const raw = localStorage.getItem(AP_GL_POST_FAILURES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GlPostFailure[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFailures(list: GlPostFailure[]): void {
  try {
    localStorage.setItem(AP_GL_POST_FAILURES_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* ignore quota errors */
  }
}

/** Track invoice IDs whose GL post failed so we can retry on next page load. */
export function recordGlPostFailure(invoiceId: string, companyId: string | null): void {
  if (!invoiceId) return;
  const entry: GlPostFailure = {
    invoice_id: invoiceId,
    company_id: companyId || '',
    failed_at: new Date().toISOString(),
  };
  const next = [entry, ...readFailures().filter((x) => x.invoice_id !== invoiceId)];
  writeFailures(next);
}

export function clearGlPostFailure(invoiceId: string): void {
  writeFailures(readFailures().filter((x) => x.invoice_id !== invoiceId));
}

/** Re-post invoices that previously failed GL sync. Returns count successfully posted. */
export async function retryPendingGlPosts(): Promise<number> {
  const pending = readFailures();
  if (pending.length === 0) return 0;

  let retried = 0;
  const remaining: GlPostFailure[] = [];

  for (const item of pending) {
    try {
      const result = await postApprovedInvoiceToGL({ id: item.invoice_id }, item.company_id || null);
      if (result.ok && (result.je_posted || result.skipped)) {
        retried += 1;
        clearGlPostFailure(item.invoice_id);
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  writeFailures(remaining);
  return retried;
}

function showGlPostFailureToast(description: string | undefined, toastFn?: GlPostToastFn): void {
  const title = 'Invoice approved but GL post failed — will retry';
  if (toastFn) {
    toastFn({ title, description });
    return;
  }
  void import('sonner')
    .then(({ toast }) => {
      toast.warning(title, { description });
    })
    .catch(() => {
      console.warn('[AP]', title, description);
    });
}

/** Shared entry — call after any path sets invoice status to Approved. */
export async function postApprovedInvoiceToGL(
  invoice: Invoice | { id: string },
  companyId: string | null,
): Promise<ApproveAndPostResult> {
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

/**
 * Await GL post after approval; record failures for retry and surface an amber warning.
 */
export async function awaitGlPostAfterApproval(
  invoice: Invoice,
  companyId: string | null,
  toastFn?: GlPostToastFn,
): Promise<ApproveAndPostResult> {
  try {
    const result = await postApprovedInvoiceToGL(invoice, companyId);
    if (!result.ok || (!result.je_posted && !result.skipped)) {
      recordGlPostFailure(invoice.id, companyId);
      showGlPostFailureToast(result.message || result.error, toastFn);
    } else {
      clearGlPostFailure(invoice.id);
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    recordGlPostFailure(invoice.id, companyId);
    showGlPostFailureToast(msg, toastFn);
    return { ok: false, je_posted: false, error: msg, message: msg };
  }
}

/** @deprecated Use awaitGlPostAfterApproval — kept for imports that have not migrated yet. */
export function triggerGlPostForApprovedInvoice(
  invoice: Invoice,
  companyId: string | null,
): void {
  void awaitGlPostAfterApproval(invoice, companyId);
}

/** Notify GulfTax pages that a new AP transaction was synced */
export function emitGulfTaxTransactionAdded(invoiceId: string, companyId: string) {
  window.dispatchEvent(
    new CustomEvent('gulftax:transaction_added', {
      detail: { invoice_id: invoiceId, company_id: companyId },
    }),
  );
}
