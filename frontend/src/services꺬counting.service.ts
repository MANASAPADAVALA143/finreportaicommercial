/**
 * UAE Accounting Service
 * ─────────────────────
 * Wraps all /api/uae/* endpoints for the UAE Accounting module.
 * Reads X-Tenant-ID from localStorage (same pattern as the rest of the app).
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

function tenantHeaders(): Record<string, string> {
  const tenantId = localStorage.getItem('tenantId') ?? 'default';
  return {
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: tenantHeaders() });
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
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `DELETE ${path} failed: ${res.status}`);
  }
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Auth URL helpers ─────────────────────────────────────────────────────────

export async function getZohoAuthUrl(): Promise<{ auth_url: string }> {
  return apiGet('/api/uae/zoho/auth-url');
}

export async function getQBOAuthUrl(): Promise<{ auth_url: string }> {
  return apiGet('/api/uae/qbo/auth-url');
}

// ─── Connected Accounts ───────────────────────────────────────────────────────

export async function listConnectedAccounts(): Promise<ConnectedAccount[]> {
  return apiGet('/api/uae/connected-accounts');
}

export async function deleteConnectedAccount(id: number): Promise<{ message: string }> {
  return apiDelete(`/api/uae/connected-accounts/${id}`);
}

// ─── Trial Balances ───────────────────────────────────────────────────────────

export async function syncTrialBalance(req: SyncRequest): Promise<UAETrialBalance> {
  return apiPost('/api/uae/sync-trial-balance', req);
}

export async function listTrialBalances(): Promise<UAETrialBalance[]> {
  return apiGet('/api/uae/trial-balances');
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

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function getUAEStats(): Promise<UAEStats> {
  return apiGet('/api/uae/stats');
}
