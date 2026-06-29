/** IFRS 16 — calculator, repository, JEs, remeasurement, audit PDF */

import { backendOrigin } from '../utils/backendOrigin';
import { getStoredWorkspaceId } from './workspaceService';

const BASE = `${backendOrigin()}/api/ifrs16`;

function hdrs(companyId?: string | null): Record<string, string> {
  const wsId = getStoredWorkspaceId();
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Workspace-ID': wsId,
    'X-Tenant-ID': wsId,
  };
  if (companyId) h['X-Company-ID'] = companyId;
  return h;
}

export interface LeaseCalculatePayload {
  lease_id: string;
  asset_description: string;
  commencement_date: string;
  lease_term_months: number;
  monthly_payment: number;
  annual_discount_rate: number;
  currency?: string;
  lessee_name?: string;
  lessor_name?: string;
  payment_type?: string;
  asset_class?: string;
  escalation_rate?: number;
  initial_direct_costs?: number;
  legal_fees?: number;
  brokerage_fees?: number;
}

export interface LeaseCalculateResult {
  status: string;
  lease_id: string;
  lease_liability?: number;
  rou_asset?: number;
  total_interest?: number;
  currency?: string;
  results: Record<string, unknown>;
}

export interface LeaseRecord {
  id: string;
  lease_name: string;
  asset_description?: string;
  asset_class?: string;
  commencement_date?: string;
  lease_term_months?: number;
  lease_payments_aed?: number;
  incremental_borrowing_rate?: number;
  rou_asset_current?: number;
  lease_liability_current?: number;
  rou_asset_initial?: number;
  lease_liability_initial?: number;
  accumulated_depreciation?: number;
  depreciation_ytd?: number;
  interest_ytd?: number;
  status?: string;
  je_posted?: boolean;
  last_je_date?: string;
  end_date?: string;
  calculation_results?: Record<string, unknown>;
}

export interface PortfolioSummary {
  total_leases: number;
  active_leases: number;
  total_rou_assets_aed: number;
  total_lease_liability_aed: number;
  total_depreciation_ytd: number;
  total_interest_ytd: number;
  leases_expiring_30_days: number;
  leases_expiring_90_days: number;
  by_asset_class: Record<string, { count: number; rou_asset: number; liability: number }>;
  currency: string;
}

export interface LeaseExtractionResult {
  status: string;
  extraction_id?: string;
  file_id?: string;
  filename?: string;
  extracted_data: Record<string, unknown>;
  validation?: { is_valid?: boolean; requires_review?: boolean; errors?: string[] };
}

export async function calculateIFRS16Lease(body: LeaseCalculatePayload): Promise<LeaseCalculateResult> {
  const res = await fetch(`${BASE}/calculate`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify({ currency: 'AED', payment_type: 'Arrears', ...body }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function saveLeaseToRegister(
  body: Record<string, unknown>,
  companyId: string | null,
): Promise<{ lease: LeaseRecord }> {
  const res = await fetch(`${BASE}/leases`, {
    method: 'POST',
    headers: hdrs(companyId),
    body: JSON.stringify({ company_id: companyId, ...body }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchLeases(
  companyId: string | null,
  params?: { status?: string; asset_class?: string; search?: string },
): Promise<LeaseRecord[]> {
  const q = new URLSearchParams();
  if (companyId) q.set('company_id', companyId);
  if (params?.status) q.set('status', params.status);
  if (params?.asset_class) q.set('asset_class', params.asset_class);
  if (params?.search) q.set('search', params.search);
  const res = await fetch(`${BASE}/leases?${q}`, { headers: hdrs(companyId) });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.leases ?? [];
}

export async function fetchPortfolioSummary(companyId: string | null): Promise<PortfolioSummary> {
  const q = companyId ? `?company_id=${companyId}` : '';
  const res = await fetch(`${BASE}/portfolio-summary${q}`, { headers: hdrs(companyId) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function terminateLease(leaseId: string, companyId: string | null): Promise<void> {
  const q = companyId ? `?company_id=${companyId}` : '';
  const res = await fetch(`${BASE}/leases/${leaseId}${q}`, { method: 'DELETE', headers: hdrs(companyId) });
  if (!res.ok) throw new Error(await res.text());
}

export async function postMonthlyJE(
  leaseId: string,
  periodDate: string,
  companyId: string | null,
): Promise<{ success: boolean; je_ids: string[]; lease_name: string }> {
  const res = await fetch(`${BASE}/post-monthly-je`, {
    method: 'POST',
    headers: hdrs(companyId),
    body: JSON.stringify({ lease_id: leaseId, period_date: periodDate, company_id: companyId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function postAllMonthlyJEs(
  periodDate: string,
  companyId: string | null,
): Promise<{ successful: number; failed: number; results: Array<Record<string, unknown>> }> {
  const res = await fetch(`${BASE}/post-all-monthly-je`, {
    method: 'POST',
    headers: hdrs(companyId),
    body: JSON.stringify({ period_date: periodDate, company_id: companyId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function remeasureLease(
  body: {
    lease_id: string;
    remeasurement_date: string;
    new_cpi_rate: number;
    new_annual_payment_aed: number;
  },
  companyId: string | null,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/remeasure`, {
    method: 'POST',
    headers: hdrs(companyId),
    body: JSON.stringify({ ...body, company_id: companyId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function downloadIFRS16Excel(leaseId: string, calculationResults: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${BASE}/export-excel`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify({ lease_id: leaseId, calculation_results: calculationResults }),
  });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `IFRS16_${leaseId}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadAuditPdf(
  companyId: string | null,
  opts?: { leaseId?: string; periodDate?: string },
): Promise<void> {
  const res = await fetch(`${BASE}/audit-pdf`, {
    method: 'POST',
    headers: hdrs(companyId),
    body: JSON.stringify({
      company_id: companyId,
      lease_id: opts?.leaseId ?? null,
      period_date: opts?.periodDate ?? new Date().toISOString().slice(0, 7),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `IFRS16_Audit_${opts?.periodDate ?? 'report'}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function uploadIFRS16Contract(file: File): Promise<LeaseExtractionResult> {
  const form = new FormData();
  form.append('file', file);
  const wsId = getStoredWorkspaceId();
  const res = await fetch(`${BASE}/upload-contract`, {
    method: 'POST',
    headers: { 'X-Workspace-ID': wsId, 'X-Tenant-ID': wsId },
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function mapExtractionToForm(extracted: Record<string, unknown>): Partial<LeaseCalculatePayload> {
  const basic = (extracted.basic_info ?? {}) as Record<string, { value?: unknown }>;
  const dates = (extracted.dates ?? {}) as Record<string, { value?: unknown }>;
  const payments = (extracted.payments ?? {}) as Record<string, { value?: unknown }>;
  const rate = (extracted.discount_rate ?? {}) as Record<string, { value?: unknown }>;
  return {
    asset_description: String(basic.asset_description?.value ?? ''),
    lessee_name: String(basic.lessee_name?.value ?? ''),
    lessor_name: String(basic.lessor_name?.value ?? ''),
    commencement_date: String(dates.commencement_date?.value ?? ''),
    lease_term_months: dates.lease_term_months?.value != null ? Number(dates.lease_term_months.value) : undefined,
    monthly_payment: payments.monthly_amount?.value != null ? Number(payments.monthly_amount.value) : undefined,
    annual_discount_rate: rate.stated_rate?.value != null ? Number(rate.stated_rate.value) : undefined,
    currency: String(payments.currency?.value ?? 'AED'),
  };
}

export const IBR_STORAGE_KEY = 'ifrs16_suggested_ibr';
