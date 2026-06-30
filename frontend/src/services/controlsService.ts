/** UAE accounting controls — /api/uae/controls */

import { backendOrigin } from '../utils/backendOrigin';

const BASE = `${backendOrigin()}/api/uae/controls`;

function hdrs(): Record<string, string> {
  const wsId = localStorage.getItem('gnanova_workspace_id') ?? localStorage.getItem('tenantId');
  return {
    'Content-Type': 'application/json',
    'X-Workspace-ID': wsId,
    'X-Tenant-ID': wsId,
  };
}

function companyQs(): string {
  const cid = localStorage.getItem('active_company_id');
  return cid ? `?company_id=${cid}` : '';
}

export interface AccountingControls {
  je_approval_threshold_aed: number | null;
  allow_backdating: boolean;
  max_backdate_days: number;
  require_docs_account_ids: string[];
  dual_approval_account_ids: string[];
}

export interface PendingJournal {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string;
  source: string;
  status: string;
  total_debit: number;
  lines: { account_code: string; debit: number; credit: number; description?: string }[];
}

export async function getControls(): Promise<AccountingControls> {
  const res = await fetch(`${BASE}${companyQs()}`, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.controls;
}

export async function saveControls(body: Partial<AccountingControls>): Promise<AccountingControls> {
  const cid = localStorage.getItem('active_company_id');
  const res = await fetch(`${BASE}`, {
    method: 'PATCH',
    headers: hdrs(),
    body: JSON.stringify({ ...body, company_id: cid }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.controls;
}

export async function listPendingJournals(): Promise<PendingJournal[]> {
  const res = await fetch(`${BASE}/pending-journals${companyQs()}`, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.entries;
}

export async function approveJournal(jeId: string): Promise<void> {
  const res = await fetch(`${BASE}/journals/${jeId}/approve`, { method: 'POST', headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
}

export async function rejectJournal(jeId: string): Promise<void> {
  const res = await fetch(`${BASE}/journals/${jeId}/reject`, { method: 'POST', headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
}
