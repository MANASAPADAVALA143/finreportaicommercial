/**
 * GulfTax VAT Advanced — FastAPI/RDS primary, Supabase PostgREST fallback
 * (migration 026_vat_advanced.sql tables).
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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = backendOrigin();
  if (!base) throw new Error('Set VITE_API_URL to your FastAPI backend');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...(init?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed (${res.status})`);
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

function mapPeRow(row: Record<string, unknown>): PartialExemptionRecord {
  return {
    id: String(row.id),
    period: String(row.period ?? ''),
    period_type: row.period_type != null ? String(row.period_type) : undefined,
    taxable_supplies: Number(row.taxable_supplies ?? 0),
    exempt_supplies: Number(row.exempt_supplies ?? 0),
    input_vat_paid: Number(row.input_vat_paid ?? 0),
    recovery_pct: Number(row.recovery_pct ?? 0),
    recoverable_vat: Number(row.recoverable_vat ?? 0),
    irrecoverable_vat: Number(row.irrecoverable_vat ?? 0),
    breakdown: row.breakdown,
    status: row.status != null ? String(row.status) : 'draft',
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

async function savePeSupabase(
  workspaceId: string,
  companyId: string | null,
  period: string,
  periodType: string,
  inputs: { taxable: number; exempt: number; inputVat: number; provisionalPct?: number },
  result: PartialExemptionResult,
): Promise<PartialExemptionRecord> {
  const payload: Record<string, unknown> = {
    workspace_id: workspaceId,
    company_id: companyId,
    period,
    period_type: periodType,
    taxable_supplies: inputs.taxable,
    exempt_supplies: inputs.exempt,
    input_vat_paid: inputs.inputVat,
    recovery_pct: result.recoveryPct,
    recoverable_vat: result.recoverableVat,
    irrecoverable_vat: result.irrecoverableVat,
    provisional_pct: inputs.provisionalPct ?? null,
    annual_adjustment_required: Boolean(result.annualAdjustmentRequired),
    breakdown: result.breakdown,
  };
  const { data, error } = await supabase
    .from('partial_exemption_calculations')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapPeRow(data as Record<string, unknown>);
}

export async function savePartialExemption(
  workspaceId: string,
  companyId: string | null,
  period: string,
  periodType: string,
  inputs: { taxable: number; exempt: number; inputVat: number; provisionalPct?: number },
  result: PartialExemptionResult,
): Promise<PartialExemptionRecord> {
  // Prefer FastAPI → RDS; fall back to Supabase (026_vat_advanced.sql).
  try {
    if (backendOrigin()) {
      return await apiFetch<PartialExemptionRecord>('/api/gulftax/vat-advanced/partial-exemption', {
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
          breakdown: result.breakdown,
        }),
      });
    }
  } catch (e) {
    console.warn('[vatAdvanced] FastAPI PE save failed, trying Supabase:', e);
  }
  if (!workspaceId) throw new Error('No workspace — cannot save partial exemption');
  return savePeSupabase(workspaceId, companyId, period, periodType, inputs, result);
}

export async function listPartialExemptions(workspaceId: string): Promise<PartialExemptionRecord[]> {
  try {
    if (backendOrigin()) {
      const data = await apiFetch<{ items: PartialExemptionRecord[] }>(
        '/api/gulftax/vat-advanced/partial-exemption',
      );
      if (data.items?.length) return data.items;
    }
  } catch {
    /* fall through to Supabase */
  }
  if (!workspaceId) return [];
  const { data, error } = await supabase
    .from('partial_exemption_calculations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    console.warn('[vatAdvanced] list PE supabase:', error.message);
    return [];
  }
  return (data ?? []).map((r) => mapPeRow(r as Record<string, unknown>));
}

export async function approvePartialExemption(recordId: string): Promise<PartialExemptionRecord | null> {
  try {
    return await apiFetch<PartialExemptionRecord>(
      `/api/gulftax/vat-advanced/partial-exemption/${recordId}/approve`,
      { method: 'PATCH' },
    );
  } catch (e) {
    console.warn('[vatAdvanced] approve PE FastAPI failed, trying Supabase status:', e);
  }
  const { data, error } = await supabase
    .from('partial_exemption_calculations')
    .update({ status: 'approved' })
    .eq('id', recordId)
    .select('*')
    .single();
  if (error) {
    console.warn('[vatAdvanced] approve PE supabase:', error.message);
    return null;
  }
  return mapPeRow(data as Record<string, unknown>);
}

export async function saveBadDebtClaim(
  workspaceId: string,
  companyId: string | null,
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
  const body = {
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
  };
  try {
    if (backendOrigin()) {
      return await apiFetch<BadDebtClaimRecord>('/api/gulftax/vat-advanced/bad-debt', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }
  } catch (e) {
    console.warn('[vatAdvanced] FastAPI bad debt save failed, trying Supabase:', e);
  }
  if (!workspaceId) throw new Error('No workspace — cannot save bad debt claim');
  const { data, error } = await supabase
    .from('bad_debt_relief_claims')
    .insert({
      workspace_id: workspaceId,
      company_id: companyId,
      invoice_number: input.invoiceNumber,
      invoice_date: input.invoiceDate,
      due_date: input.dueDate,
      invoice_amount: input.invoiceAmount,
      vat_amount: input.vatAmount,
      vat_return_period: input.vatReturnPeriod || null,
      written_off_date: input.writtenOffDate || null,
      recovery_steps: input.recoverySteps || null,
      connected_party: input.connectedParty,
      eligible: result.eligible,
      eligibility_reason: result.eligible ? null : result.reasons.join(' '),
      claim_period: result.claimPeriod,
      status: result.eligible ? 'eligible' : 'ineligible',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    invoice_number: String(row.invoice_number),
    invoice_date: String(row.invoice_date),
    due_date: String(row.due_date),
    invoice_amount: Number(row.invoice_amount),
    vat_amount: Number(row.vat_amount),
    status: String(row.status ?? 'draft'),
    eligible: Boolean(row.eligible),
    eligibility_reason: row.eligibility_reason != null ? String(row.eligibility_reason) : null,
    claim_period: row.claim_period != null ? String(row.claim_period) : null,
    created_at: row.created_at != null ? String(row.created_at) : undefined,
  };
}

export async function listBadDebtClaims(workspaceId: string): Promise<BadDebtClaimRecord[]> {
  try {
    if (backendOrigin()) {
      const data = await apiFetch<{ items: BadDebtClaimRecord[] }>('/api/gulftax/vat-advanced/bad-debt');
      if (data.items?.length) return data.items;
    }
  } catch {
    /* fall through */
  }
  if (!workspaceId) return [];
  const { data, error } = await supabase
    .from('bad_debt_relief_claims')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return [];
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      invoice_number: String(r.invoice_number),
      invoice_date: String(r.invoice_date),
      due_date: String(r.due_date),
      invoice_amount: Number(r.invoice_amount),
      vat_amount: Number(r.vat_amount),
      status: String(r.status ?? 'draft'),
      eligible: Boolean(r.eligible),
      eligibility_reason: r.eligibility_reason != null ? String(r.eligibility_reason) : null,
      claim_period: r.claim_period != null ? String(r.claim_period) : null,
      created_at: r.created_at != null ? String(r.created_at) : undefined,
    };
  });
}

export async function approveBadDebtClaim(recordId: string): Promise<BadDebtClaimRecord | null> {
  try {
    return await apiFetch<BadDebtClaimRecord>(
      `/api/gulftax/vat-advanced/bad-debt/${recordId}/approve`,
      { method: 'PATCH' },
    );
  } catch (e) {
    console.warn('[vatAdvanced] approve bad debt FastAPI failed:', e);
  }
  const { data, error } = await supabase
    .from('bad_debt_relief_claims')
    .update({ status: 'approved' })
    .eq('id', recordId)
    .select('*')
    .single();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    invoice_number: String(r.invoice_number),
    invoice_date: String(r.invoice_date),
    due_date: String(r.due_date),
    invoice_amount: Number(r.invoice_amount),
    vat_amount: Number(r.vat_amount),
    status: String(r.status ?? 'approved'),
    eligible: Boolean(r.eligible),
    eligibility_reason: r.eligibility_reason != null ? String(r.eligibility_reason) : null,
    claim_period: r.claim_period != null ? String(r.claim_period) : null,
    created_at: r.created_at != null ? String(r.created_at) : undefined,
  };
}

export async function getPendingBadDebtTotal(workspaceId: string): Promise<number> {
  const items = await listBadDebtClaims(workspaceId);
  return items
    .filter((r) => r.eligible && ['eligible', 'draft', 'pending'].includes(r.status))
    .reduce((sum, r) => sum + Number(r.vat_amount || 0), 0);
}

export async function saveDesignatedZoneTransaction(
  workspaceId: string,
  companyId: string | null,
  input: {
    supplierLocation: string;
    customerLocation: string;
    transactionType: string;
    supplierZoneName?: string;
    customerZoneName?: string;
  },
  result: DesignatedZoneResult,
): Promise<void> {
  const body = {
    supplier_location: input.supplierLocation,
    customer_location: input.customerLocation,
    transaction_type: input.transactionType,
    vat_treatment: result.vatTreatment,
    vat_rate: result.vatRate,
    explanation: result.explanation,
    warning: result.warning,
  };
  try {
    if (backendOrigin()) {
      await apiFetch('/api/gulftax/vat-advanced/designated-zones', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return;
    }
  } catch (e) {
    console.warn('[vatAdvanced] FastAPI DZ save failed, trying Supabase:', e);
  }
  if (!workspaceId) throw new Error('No workspace — cannot save designated zone transaction');
  const { error } = await supabase.from('designated_zone_transactions').insert({
    workspace_id: workspaceId,
    company_id: companyId,
    supplier_location: input.supplierLocation,
    customer_location: input.customerLocation,
    transaction_type: input.transactionType,
    supplier_zone_name: input.supplierZoneName ?? null,
    customer_zone_name: input.customerZoneName ?? null,
    vat_treatment: result.vatTreatment,
    vat_rate: result.vatRate,
    explanation: result.explanation,
    warning: result.warning,
  });
  if (error) throw new Error(error.message);
}
