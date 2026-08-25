/**
 * UAE Accounting Service
 * Wraps all /api/uae/* endpoints for the UAE Accounting module.
 * NOTE: backend wraps list responses in {accounts:[...]} / {trial_balances:[...]} objects.
 */

import { getStoredAccessToken, workspaceHeaders } from '../utils/workspaceHeaders';

const API_BASE = (import.meta as any).env.VITE_API_URL ?? 'http://localhost:8000';

function tenantHeaders(): Record<string, string> {
  return workspaceHeaders(getStoredAccessToken());
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: tenantHeaders(), credentials: 'include' });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: tenantHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: tenantHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `DELETE ${path} failed: ${res.status}`);
  }
  return res.json();
}

export interface ConnectedAccount {
  id: number;
  source: 'zoho' | 'quickbooks' | 'manual_csv';
  company_name: string;
  company_id_external: string | null;
  currency_code: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface UAETrialBalanceLine {
  id: number;
  account_code: string;
  account_name: string;
  account_type: string;
  debit: number;
  credit: number;
  net_balance: number;
}

export interface UAETrialBalance {
  id: number;
  source: 'zoho' | 'quickbooks' | 'manual_csv';
  company_name: string;
  period_start: string;
  period_end: string;
  currency: string;
  account_count: number;
  total_debits: number;
  total_credits: number;
  is_balanced: boolean;
  synced_at: string;
  ifrs_trial_balance_id: number | null;
  lines?: UAETrialBalanceLine[];
}

export interface SyncRequest {
  connected_account_id: number;
  from_date: string;
  to_date: string;
}

export interface UAEStats {
  connected_accounts: number;
  trial_balances_synced: number;
  ifrs_statements_generated: number;
}

export async function getZohoAuthUrl(): Promise<{ auth_url: string }> {
  return apiGet('/api/uae/zoho/auth-url');
}

export async function getQBOAuthUrl(): Promise<{ auth_url: string }> {
  return apiGet('/api/uae/qbo/auth-url');
}

// Backend returns { accounts: [...], count: N } — unwrap to array
export async function listConnectedAccounts(): Promise<ConnectedAccount[]> {
  const data = await apiGet<{ accounts: ConnectedAccount[]; count: number }>('/api/uae/connected-accounts');
  return Array.isArray(data) ? data : (data?.accounts ?? []);
}

export async function deleteConnectedAccount(id: number): Promise<{ message: string }> {
  return apiDelete(`/api/uae/connected-accounts/${id}`);
}

export async function syncTrialBalance(req: SyncRequest): Promise<UAETrialBalance> {
  return apiPost('/api/uae/sync-trial-balance', req);
}

// Backend returns { trial_balances: [...], count: N } — unwrap to array
export async function listTrialBalances(): Promise<UAETrialBalance[]> {
  const data = await apiGet<{ trial_balances: UAETrialBalance[]; count: number }>('/api/uae/trial-balances');
  return Array.isArray(data) ? data : (data?.trial_balances ?? []);
}

export async function getTrialBalance(id: number): Promise<UAETrialBalance> {
  return apiGet(`/api/uae/trial-balances/${id}`);
}

export async function generateIFRS(tbId: number): Promise<{
  ifrs_trial_balance_id: number;
  redirect_to: string;
  message: string;
}> {
  return apiPost(`/api/uae/trial-balances/${tbId}/generate-ifrs`);
}

export async function getUAEStats(): Promise<UAEStats> {
  return apiGet('/api/uae/stats');
}
