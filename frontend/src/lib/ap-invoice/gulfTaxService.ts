import { getStoredWorkspaceId } from '../../services/workspaceService';

const FINREPORT_API = import.meta.env.VITE_API_URL || '';

function apiBase(): string {
  return FINREPORT_API || '';
}

export interface TRNValidationResult {
  valid: boolean;
  trn?: string;
  business_name?: string;
  status?: string;
  error?: string;
}

export interface VATClassificationResult {
  treatment: 'standard' | 'zero' | 'exempt' | 'out_of_scope';
  confidence: number;
  reason: string;
  applicable_rate: number;
  error?: string;
}

/** TRN format check via embedded GulfTax e-invoicing validator */
export async function validateTRNWithGulfTax(trn: string): Promise<TRNValidationResult> {
  const cleaned = trn.trim().replace(/\s/g, '');
  const valid = cleaned.length === 15 && /^\d+$/.test(cleaned);
  return {
    valid,
    trn: cleaned,
    status: valid ? 'format_ok' : 'invalid_format',
    error: valid ? undefined : 'TRN must be 15 numeric digits',
  };
}

/** Classify via embedded FinReportAI GulfTax — NOT standalone uaetax */
export async function classifyVATWithGulfTax(invoice: {
  vendor_name?: string;
  description?: string;
  total_amount?: number;
  vendor_trn?: string;
}): Promise<VATClassificationResult> {
  try {
    const wsId = getStoredWorkspaceId() ?? 'default';
    const response = await fetch(`${apiBase()}/api/gulftax/vat/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: invoice.description || `Invoice from ${invoice.vendor_name ?? 'vendor'}`,
        amount_aed: invoice.total_amount ?? 0,
        vendor_or_customer: invoice.vendor_name,
        transaction_type: 'purchase',
        entity_type: 'mainland',
        workspace_id: wsId,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const treatmentMap: Record<string, VATClassificationResult['treatment']> = {
      standard_rated: 'standard',
      zero_rated: 'zero',
      exempt: 'exempt',
      out_of_scope: 'out_of_scope',
      reverse_charge: 'standard',
    };
    return {
      treatment: treatmentMap[data.vat_treatment] ?? 'standard',
      confidence: Math.round((data.confidence_score ?? 0) * 100),
      reason: data.reasoning ?? '',
      applicable_rate: data.vat_rate ?? 5,
    };
  } catch (err) {
    return {
      treatment: 'standard',
      confidence: 0,
      reason: 'Embedded GulfTax unreachable — defaulting to standard rated',
      applicable_rate: 5,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/** Embedded FinReportAI GulfTax — classifies AP invoice via /api/uae/ap/classify-invoice */
export type GulfTaxAPClassification = {
  vat_treatment: string;
  vat_rate: number;
  vat_amount_aed: number;
  confidence_score: number;
  reasoning: string;
  risk_score: number;
  decision: 'AUTO_APPROVE' | 'REVIEW_QUEUE' | 'HARD_BLOCK';
  blocked_input_vat?: boolean;
  blocked_reason?: string;
  reverse_charge?: boolean;
  art54_entertainment?: boolean;
  box_number?: number;
};

export async function classifyAPInvoiceEmbedded(params: {
  invoice_number: string;
  vendor_name: string;
  total_amount: number;
  invoice_date?: string;
  description?: string;
  trn_number?: string;
  company_id?: string;
}): Promise<GulfTaxAPClassification> {
  const wsId = getStoredWorkspaceId() ?? params.company_id ?? 'default';
  const res = await fetch(`${apiBase()}/api/uae/ap/classify-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoice_number: params.invoice_number,
      vendor_name: params.vendor_name,
      total_amount: params.total_amount,
      invoice_date: params.invoice_date || new Date().toISOString().slice(0, 10),
      description: params.description || '',
      trn_number: params.trn_number || '',
      entity_type: 'mainland',
      company_id: wsId,
      workspace_id: wsId,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `GulfTax classify failed (${res.status})`);
  }
  return res.json();
}
