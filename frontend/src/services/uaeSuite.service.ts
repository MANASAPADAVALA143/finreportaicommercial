import { getStoredAccessToken, workspaceHeaders } from '../utils/workspaceHeaders';

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? '';

function hdrs(extra: Record<string, string> = {}): Record<string, string> {
  const cid = localStorage.getItem('active_company_id');
  return workspaceHeaders(getStoredAccessToken(), {
    ...(cid ? { 'X-Company-ID': cid } : {}),
    ...extra,
  });
}

export interface UaeSuiteSummary {
  company: { name: string | null; trn: string | null };
  banner: {
    vat_period_label: string;
    vat_period_start: string;
    vat_period_end: string;
    days_to_vat_filing: number;
    vat_filing_deadline: string;
    ct_return_status: string;
    ct_filing_deadline: string;
  };
  ap: {
    total_outstanding: number;
    total_overdue: number;
    pending_approvals: number;
    pending_amount: number;
    top_overdue_vendor: { vendor_name: string; overdue_amount: number } | null;
  };
  ar: {
    total_outstanding: number;
    total_overdue: number;
    worst_aging_bucket: { bucket: string; label: string; amount: number } | null;
    credit_notes_issued: { count: number; total_amount: number };
  };
  uae_tax: {
    tax_period: string;
    recon_status: string;
    recon_difference_aed: number | null;
    estimated_vat_payable_aed: number;
    ct_return: {
      status: string;
      ct_payable_aed: number;
      period_start: string | null;
      period_end: string | null;
      return_id: string | null;
    };
    e_invoicing: {
      readiness_score: number;
      urgency?: string;
      days_to_go_live?: number;
    };
  };
  generated_at: string;
}

export async function fetchUaeSuiteSummary(period?: string): Promise<UaeSuiteSummary> {
  const cid = localStorage.getItem('active_company_id');
  const q = new URLSearchParams({ ...(cid ? { company_id: cid } : {}), ...(period ? { period } : {}) });
  const res = await fetch(`${API_BASE}/api/uae-suite/summary?${q}`, { headers: hdrs(), credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
