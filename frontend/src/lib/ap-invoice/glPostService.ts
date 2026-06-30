/**
 * Post a fully-approved AP invoice to UAE GL via embedded approve-and-post endpoint.
 */
import type { Invoice } from './supabase';
import { getStoredWorkspaceId } from '../../services/workspaceService';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || '';

export type ApproveAndPostResult = {
  ok: boolean;
  je_posted?: boolean;
  je_reference?: string;
  je_id?: string;
  message?: string;
};

function workspaceId(): string {
  return (
    localStorage.getItem('active_workspace_id') ||
    getStoredWorkspaceId() ||
    localStorage.getItem('tenantId') ||
    ''
  );
}

export async function postApprovedInvoiceToGL(
  invoice: Invoice,
  companyId: string | null,
): Promise<ApproveAndPostResult> {
  const taxAmount = Number(invoice.tax_amount ?? invoice.vat_amount ?? 0);
  const totalAmount = Number(invoice.total_amount ?? 0);
  const vatTreatment = String(invoice.vat_treatment || 'standard_rated');

  const res = await fetch(`${API_BASE}/api/uae/ap/approve-and-post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      vendor_name: invoice.vendor_name,
      total_amount: totalAmount,
      vat_amount_aed: taxAmount,
      vat_treatment: vatTreatment,
      decision: String(invoice.gulftax_decision || 'AUTO_APPROVE'),
      risk_score: Number(invoice.gulftax_risk_score ?? invoice.risk_score ?? 0),
      invoice_date: invoice.invoice_date || new Date().toISOString().slice(0, 10),
      gl_code: invoice.gl_code || '6100',
      company_id: companyId || '',
      workspace_id: workspaceId(),
      blocked_input_vat: vatTreatment === 'blocked' || vatTreatment === 'non_recoverable',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `GL post failed (${res.status})`);
  }

  const result = await res.json() as ApproveAndPostResult;
  if (result.ok && invoice.id && companyId) {
    emitGulfTaxTransactionAdded(invoice.id, companyId);
  }
  return result;
}

/** Notify GulfTax pages that a new AP transaction was synced */
export function emitGulfTaxTransactionAdded(invoiceId: string, companyId: string) {
  window.dispatchEvent(
    new CustomEvent('gulftax:transaction_added', {
      detail: { invoice_id: invoiceId, company_id: companyId },
    }),
  );
}
