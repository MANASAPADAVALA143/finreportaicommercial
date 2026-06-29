/** CFO Operating Desk API — workspace-aware fetches */
import { backendOrigin } from '../utils/backendOrigin';

function hdrs(): Record<string, string> {
  const wsId = localStorage.getItem('gnanova_workspace_id') ?? localStorage.getItem('tenantId');
  const cid = localStorage.getItem('active_company_id');
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Workspace-ID': wsId,
    'X-Tenant-ID': wsId,
  };
  const token = localStorage.getItem('accessToken') ?? localStorage.getItem('access_token');
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function companyQs(extra: Record<string, string> = {}): string {
  const cid = localStorage.getItem('active_company_id');
  const params = new URLSearchParams({ ...extra, ...(cid ? { company_id: cid } : {}) });
  const q = params.toString();
  return q ? `?${q}` : '';
}

export async function cfoGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = `${backendOrigin()}${path}${companyQs(params ?? {})}`;
  const res = await fetch(url, { headers: hdrs(), credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function cfoPost<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = `${backendOrigin()}${path}${companyQs(params ?? {})}`;
  const res = await fetch(url, { method: 'POST', headers: hdrs(), credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function fmtMoney(n: number, currency = 'AED'): string {
  const abs = Math.abs(n);
  const sym = currency === 'EUR' ? '€' : currency === 'AED' ? 'AED ' : `${currency} `;
  const s = abs >= 1_000_000 ? `${sym}${(abs / 1_000_000).toFixed(2)}M` : `${sym}${(abs / 1_000).toFixed(0)}K`;
  return n < 0 ? `+${s}` : s;
}
