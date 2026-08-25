const API_BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8000';
const BASE = `${API_BASE}/api/gulftax/cit-return`;
const CT_BASE = `${API_BASE}/api/gulftax/ct-return`;

function hdrs(): Record<string, string> {
  const wsId = localStorage.getItem('gnanova_workspace_id') ?? localStorage.getItem('tenantId');
  return { 'Content-Type': 'application/json', 'X-Workspace-ID': wsId, 'X-Tenant-ID': wsId };
}

function companyQ(extra: Record<string, string> = {}): string {
  const cid = localStorage.getItem('active_company_id');
  return new URLSearchParams({ ...(cid ? { company_id: cid } : {}), ...extra }).toString();
}

export interface CITReturnData {
  entity_name: string;
  trn: string;
  address: string;
  ct_return_period: string;
  ct_return_due_date: string;
  filing_date: string;
  session_1: Record<string, unknown>;
  session_2: Record<string, unknown>;
  session_2a: Record<string, unknown>;
  session_3: Record<string, number>;
}

export async function generateCITReturn(fromDate: string, toDate: string): Promise<CITReturnData> {
  const q = companyQ({ from_date: fromDate, to_date: toDate });
  const res = await fetch(`${BASE}/generate?${q}`, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function recordCITVoucher(body: {
  period_from: string;
  period_to: string;
  tax_amount_aed: number;
  tax_expense_account: string;
  tax_payable_account: string;
  voucher_date: string;
  remarks?: string;
}) {
  const wsId = localStorage.getItem('gnanova_workspace_id');
  const cid = localStorage.getItem('active_company_id');
  const res = await fetch(`${BASE}/record-voucher`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify({ ...body, workspace_id: wsId, company_id: cid }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ je_id: string; voucher_number: string }>;
}

export interface CtReturnRecord {
  id: string;
  tenant_id: string;
  company_id: string;
  period_start: string;
  period_end: string;
  revenue: number;
  accounting_profit: number;
  non_deductible_expenses: number;
  taxable_income: number;
  ct_payable_aed: number;
  sbr_eligible: boolean;
  qfzp_eligible: boolean;
  free_zone_status: string;
  free_zone_income: number;
  breakdown: {
    computation?: {
      breakdown?: { label: string; amount_aed: number; note?: string }[];
      small_business_relief_applied?: boolean;
    };
    rate_bands?: { zero_band_aed: number; standard_rate_percent: number };
  };
  status: 'draft' | 'approved' | 'filed';
  override_reason?: string | null;
  approved_at?: string | null;
  filed_at?: string | null;
  created_at?: string;
  warning?: boolean;
  blocked?: boolean;
  message?: string;
  requires_approval?: boolean;
}

export async function generateCtReturn(periodStart: string, periodEnd: string): Promise<CtReturnRecord> {
  const wsId = localStorage.getItem('gnanova_workspace_id') ?? localStorage.getItem('tenantId');
  const cid = localStorage.getItem('active_company_id');
  const res = await fetch(`${CT_BASE}/generate`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify({
      company_id: cid,
      period_start: periodStart,
      period_end: periodEnd,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listCtReturns(status?: string): Promise<CtReturnRecord[]> {
  const q = companyQ(status ? { status } : {});
  const res = await fetch(`${CT_BASE}?${q}`, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.items ?? [];
}

export async function approveCtReturn(id: string): Promise<CtReturnRecord> {
  const res = await fetch(`${CT_BASE}/${id}/approve`, { method: 'POST', headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fileCtReturn(id: string, overrideReason?: string): Promise<CtReturnRecord> {
  const res = await fetch(`${CT_BASE}/${id}/file`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify({ override_reason: overrideReason ?? null }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
