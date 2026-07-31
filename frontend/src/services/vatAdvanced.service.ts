/**
 * GulfTax VAT Advanced — FastAPI only (RDS, with server-side Supabase fallback).
 * Do not write from the browser Supabase client — RLS blocks anon inserts.
 */
import { supabase } from '../lib/supabase';
import { backendOrigin } from '../utils/backendOrigin';
import { getStoredAccessToken, workspaceHeaders } from '../utils/workspaceHeaders';
import { getActiveCompanyId } from '../context/CompanyContext';
import type { BadDebtResult, DesignatedZoneResult, PartialExemptionResult } from '../lib/gulftax/vatAdvanced';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const h = workspaceHeaders(data.session?.access_token ?? getStoredAccessToken());
  const cid = getActiveCompanyId() || localStorage.getItem('gulftax_company_id') || '';
  if (cid) h['X-Company-ID'] = cid;
  return h;
}

function parseApiError(text: string, status: number): string {
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    if (typeof j.detail === 'string') return j.detail;
    if (Array.isArray(j.detail)) {
      return j.detail
        .map((d) => (typeof d === 'object' && d && 'msg' in d ? String((d as { msg: string }).msg) : JSON.stringify(d)))
        .join('; ');
    }
  } catch {
    /* plain text */
  }
  return text || `Request failed (${status})`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = backendOrigin();
  if (!base) throw new Error('Set VITE_API_URL to your FastAPI backend');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...(init?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseApiError(text, res.status));
  }
  return res.json() as Promise<T>;
}

export interface PartialExemptionRecord {
  id: string;
  period: string;
  period_type?: string;
  taxable_supplies: number;
  exempt_supplies: number;
  input_vat_paid: number;
  recovery_pct: number;
  recoverable_vat: number;
  irrecoverable_vat: number;
  breakdown: unknown;
  status?: string;
  created_at: string;
}

export interface BadDebtClaimRecord {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  invoice_amount: number;
  vat_amount: number;
  status: string;
  eligible: boolean;
  eligibility_reason: string | null;
  claim_period?: string | null;
  extra?: Record<string, unknown>;
  created_at?: string;
}

export async function savePartialExemption(
  _workspaceId: string,
  _companyId: string | null,
  period: string,
  periodType: string,
  inputs: { taxable: number; exempt: number; inputVat: number; provisionalPct?: number },
  result: PartialExemptionResult,
): Promise<PartialExemptionRecord> {
  // Production OpenAPI still types breakdown as object|null — sending the UI's
  // label/value array causes 422 "Input should be a valid dictionary".
  const breakdownDict: Record<string, string> = {};
  for (const row of result.breakdown ?? []) {
    if (row?.label != null) breakdownDict[String(row.label)] = String(row.value ?? '');
  }

  return apiFetch<PartialExemptionRecord>('/api/gulftax/vat-advanced/partial-exemption', {
    method: 'POST',
    body: JSON.stringify({
      period,
      period_type: periodType,
      taxable_supplies: inputs.taxable,
      exempt_supplies: inputs.exempt,
      input_vat_paid: inputs.inputVat,
      recovery_pct: result.recoveryPct,
      recoverable_vat: result.recoverableVat,
      irrecoverable_vat: result.irrecoverableVat,
      breakdown: breakdownDict,
    }),
  });
}

export async function listPartialExemptions(_workspaceId: string): Promise<PartialExemptionRecord[]> {
  try {
    const data = await apiFetch<{ items: PartialExemptionRecord[] }>(
      '/api/gulftax/vat-advanced/partial-exemption',
    );
    return data.items ?? [];
  } catch (e) {
    console.warn('[vatAdvanced] list PE:', e);
    return [];
  }
}

export async function approvePartialExemption(recordId: string): Promise<PartialExemptionRecord | null> {
  try {
    return await apiFetch<PartialExemptionRecord>(
      `/api/gulftax/vat-advanced/partial-exemption/${recordId}/approve`,
      { method: 'PATCH' },
    );
  } catch (e) {
    console.warn('[vatAdvanced] approve PE:', e);
    return null;
  }
}

export async function saveBadDebtClaim(
  _workspaceId: string,
  _companyId: string | null,
  input: {
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    invoiceAmount: number;
    vatAmount: number;
    vatReturnPeriod: string;
    writtenOffDate: string;
    recoverySteps: string;
    connectedParty: boolean;
  },
  result: BadDebtResult,
): Promise<BadDebtClaimRecord> {
  return apiFetch<BadDebtClaimRecord>('/api/gulftax/vat-advanced/bad-debt', {
    method: 'POST',
    body: JSON.stringify({
      invoice_number: input.invoiceNumber,
      invoice_date: input.invoiceDate,
      due_date: input.dueDate,
      invoice_amount: input.invoiceAmount,
      vat_amount: input.vatAmount,
      status: result.eligible ? 'eligible' : 'ineligible',
      eligible: result.eligible,
      eligibility_reason: result.eligible ? null : result.reasons.join(' '),
      extra: {
        vat_return_period: input.vatReturnPeriod,
        written_off_date: input.writtenOffDate,
        recovery_steps: input.recoverySteps,
        connected_party: input.connectedParty,
        claim_period: result.claimPeriod,
      },
    }),
  });
}

export async function listBadDebtClaims(_workspaceId: string): Promise<BadDebtClaimRecord[]> {
  try {
    const data = await apiFetch<{ items: BadDebtClaimRecord[] }>('/api/gulftax/vat-advanced/bad-debt');
    return data.items ?? [];
  } catch {
    return [];
  }
}

export async function approveBadDebtClaim(recordId: string): Promise<BadDebtClaimRecord | null> {
  try {
    return await apiFetch<BadDebtClaimRecord>(
      `/api/gulftax/vat-advanced/bad-debt/${recordId}/approve`,
      { method: 'PATCH' },
    );
  } catch (e) {
    console.warn('[vatAdvanced] approve bad debt:', e);
    return null;
  }
}

export async function getPendingBadDebtTotal(workspaceId: string): Promise<number> {
  const items = await listBadDebtClaims(workspaceId);
  return items
    .filter((r) => r.eligible && ['eligible', 'draft', 'pending'].includes(r.status))
    .reduce((sum, r) => sum + Number(r.vat_amount || 0), 0);
}

export async function saveDesignatedZoneTransaction(
  _workspaceId: string,
  _companyId: string | null,
  input: {
    supplierLocation: string;
    customerLocation: string;
    transactionType: string;
    supplierZoneName?: string;
    customerZoneName?: string;
  },
  result: DesignatedZoneResult,
): Promise<void> {
  await apiFetch('/api/gulftax/vat-advanced/designated-zones', {
    method: 'POST',
    body: JSON.stringify({
      supplier_location: input.supplierLocation,
      customer_location: input.customerLocation,
      transaction_type: input.transactionType,
      vat_treatment: result.vatTreatment,
      vat_rate: result.vatRate,
      explanation: result.explanation,
      warning: result.warning,
    }),
  });
}
