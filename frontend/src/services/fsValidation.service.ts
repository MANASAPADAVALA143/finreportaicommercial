const API_BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8000';
const BASE = `${API_BASE}/api/uae/fs`;

function hdrs(): Record<string, string> {
  const wsId = localStorage.getItem('gnanova_workspace_id') ?? localStorage.getItem('tenantId');
  return { 'Content-Type': 'application/json', 'X-Workspace-ID': wsId, 'X-Tenant-ID': wsId };
}

function params(periodStart: string, periodEnd: string): string {
  const cid = localStorage.getItem('active_company_id');
  const q = new URLSearchParams({
    period_start: periodStart,
    period_end: periodEnd,
    ...(cid ? { company_id: cid } : {}),
  });
  return q.toString();
}

export interface FSCheck {
  check: string;
  passed: boolean;
  message: string;
  difference?: number;
  total_assets?: number;
  total_liabilities?: number;
  total_equity?: number;
  bs_cash?: number;
  cf_closing?: number;
}

export interface FSValidationResult {
  all_passed: boolean;
  checks: FSCheck[];
  validated_at: string;
  period: string;
}

export async function validateFS(periodStart: string, periodEnd: string): Promise<FSValidationResult> {
  const res = await fetch(`${BASE}/validate?${params(periodStart, periodEnd)}`, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function exportFSExcel(periodStart: string, periodEnd: string): Promise<Blob> {
  const res = await fetch(`${BASE}/export-excel?${params(periodStart, periodEnd)}`, {
    method: 'POST',
    headers: hdrs(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}
