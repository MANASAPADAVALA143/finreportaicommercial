import { backendOrigin } from '../utils/backendOrigin';
import { workspaceHeaders } from './workspaceService';

export interface AccountingPeriod {
  id: string; period_name: string; period_number: number;
  start_date: string; end_date: string; status: string;
}

export interface ConsolidationRow {
  key: string; label: string; calculated?: boolean; bold?: boolean;
  companies: Record<string, number>; eliminations: number; group_total: number;
  elimination_note?: string | null;
}

export interface SummaryCard {
  key: string; label: string; total: number;
  breakdown: { company_id: string; company_name: string; amount: number }[];
}

export interface CompanyComparison {
  company_id: string; company_name: string; legal_type?: string | null;
  revenue: number; net_profit: number; total_assets: number;
  status: string; status_ok: boolean;
}

function hdrs(token: string | null) {
  return workspaceHeaders(token);
}

async function api<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`${backendOrigin()}${path}`, {
    ...init,
    headers: hdrs(token),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const listConsolidationPeriods = (t: string | null) =>
  api<{ periods: AccountingPeriod[] }>('/api/consolidation/periods', t);

export const getSummary = (t: string | null, periodId: string) =>
  api<{ cards: SummaryCard[] }>(`/api/consolidation/summary?period_id=${periodId}`, t);

export const getPL = (t: string | null, periodId: string) =>
  api<{ period_name: string; companies: { id: string; company_name: string }[]; rows: ConsolidationRow[] }>(
    `/api/consolidation/pl?period_id=${periodId}`, t);

export const getBS = (t: string | null, periodId: string) =>
  api<{ period_name: string; companies: { id: string; company_name: string }[]; rows: ConsolidationRow[];
    total_assets: number; total_liabilities_equity: number; is_balanced: boolean }>(
    `/api/consolidation/bs?period_id=${periodId}`, t);

export const getComparison = (t: string | null, periodId: string) =>
  api<{ companies: CompanyComparison[] }>(`/api/consolidation/comparison?period_id=${periodId}`, t);

export const saveElimination = (t: string | null, body: { period_id: string; account_category: string; amount: number }) =>
  api('/api/consolidation/eliminations', t, { method: 'POST', body: JSON.stringify(body) });

export async function exportConsolidationPdf(t: string | null, periodId: string): Promise<Blob> {
  const res = await fetch(`${backendOrigin()}/api/consolidation/export?period_id=${periodId}`, {
    method: 'POST', headers: hdrs(t), credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

export function fmtAed(n: number): string {
  if (n < 0) return `(AED ${Math.abs(n).toLocaleString('en-AE', { maximumFractionDigits: 0 })})`;
  return `AED ${n.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
}
