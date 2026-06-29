const API_BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8000';
const BASE = `${API_BASE}/api/gulftax/cit-return`;

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
