import { backendOrigin } from '../utils/backendOrigin';
import { getStoredWorkspaceId } from './workspaceService';

const BASE = `${backendOrigin()}/api/rev-rec`;

function hdrs(companyId?: string | null): Record<string, string> {
  const ws = getStoredWorkspaceId();
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'X-Workspace-ID': ws, 'X-Tenant-ID': ws };
  if (companyId) h['X-Company-ID'] = companyId;
  return h;
}

export interface PerformanceObligation {
  description: string;
  standalone_selling_price_aed?: number;
  allocated_transaction_price_aed?: number;
  satisfaction_method?: string;
  percentage_complete?: number;
  revenue_recognised_aed?: number;
  revenue_remaining_aed?: number;
  start_date?: string;
  end_date?: string;
}

export interface IFRS15Contract {
  id: string;
  contract_number: string;
  customer_name: string;
  contract_date?: string;
  contract_value_aed: number;
  performance_obligations: PerformanceObligation[];
  total_recognised_aed: number;
  total_remaining_aed: number;
  contract_liability_aed: number;
  contract_asset_aed: number;
  calculation_results?: Record<string, unknown>;
  has_calculation?: boolean;
  status: string;
  je_posted?: boolean;
}

export interface ExtractionValidation {
  is_valid?: boolean;
  errors?: string[];
  warnings?: string[];
  requires_review?: boolean;
  overall_confidence?: number;
  error_count?: number;
  warning_count?: number;
}

export interface ClauseScan {
  clauses_found?: number;
  high_severity?: number;
  medium_severity?: number;
  low_severity?: number;
  overall_risk?: string;
  summary?: string;
  clauses?: Array<{ clause_type?: string; severity?: string; description?: string }>;
}

export interface ExtractContractResponse {
  status: string;
  extracted_data: Record<string, unknown>;
  validation?: ExtractionValidation;
  clause_scan?: ClauseScan;
  contract_type_detected?: string;
  raw_extraction?: Record<string, unknown>;
}

export interface CalculateRecognitionResponse {
  method?: string;
  percentage_complete?: number | null;
  revenue_to_recognise?: number;
  journal_entry_amount?: number;
  incremental_recognition?: number;
  transaction_price?: number;
  calculation_results?: Record<string, unknown>;
  contract_balances?: Record<string, unknown>;
}

export async function fetchIFRS15Contracts(companyId: string | null): Promise<IFRS15Contract[]> {
  const q = companyId ? `?company_id=${companyId}` : '';
  const res = await fetch(`${BASE}/contracts${q}`, { headers: hdrs(companyId) });
  if (!res.ok) throw new Error(await res.text());
  const d = await res.json();
  return d.contracts ?? [];
}

export async function saveIFRS15Contract(body: Record<string, unknown>, companyId: string | null) {
  const res = await fetch(`${BASE}/contracts`, {
    method: 'POST', headers: hdrs(companyId), body: JSON.stringify({ company_id: companyId, ...body }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchIFRS15PortfolioSummary(companyId: string | null) {
  const q = companyId ? `?company_id=${companyId}` : '';
  const res = await fetch(`${BASE}/portfolio-summary${q}`, { headers: hdrs(companyId) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function calculateRecognition(
  body: Record<string, unknown>,
  companyId: string | null,
): Promise<CalculateRecognitionResponse> {
  const res = await fetch(`${BASE}/calculate-recognition`, {
    method: 'POST', headers: hdrs(companyId), body: JSON.stringify({ company_id: companyId, ...body }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function postRecognitionJE(body: Record<string, unknown>, companyId: string | null) {
  const res = await fetch(`${BASE}/post-recognition-je`, {
    method: 'POST', headers: hdrs(companyId), body: JSON.stringify({ company_id: companyId, ...body }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function extractIFRS15Contract(file: File, companyId: string | null): Promise<ExtractContractResponse> {
  const ws = getStoredWorkspaceId();
  const form = new FormData();
  form.append('file', file);
  const q = companyId ? `?company_id=${companyId}` : '';
  const res = await fetch(`${BASE}/extract-contract${q}`, {
    method: 'POST',
    headers: { 'X-Workspace-ID': ws, 'X-Tenant-ID': ws, ...(companyId ? { 'X-Company-ID': companyId } : {}) },
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
