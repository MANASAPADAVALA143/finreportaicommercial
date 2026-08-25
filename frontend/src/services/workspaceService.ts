/**
 * Workspace API — multi-tenant company management.
 */

import { backendOrigin } from '../utils/backendOrigin';
import { getStoredAccessToken } from '../utils/authToken';
import { getActiveWorkspaceId } from '../utils/workspaceHeaders';

const STORAGE_KEY = 'gnanova_workspace_id';

export interface Workspace {
  id: string;
  name: string;
  legal_entity_name: string;
  trn_number?: string | null;
  country: string;
  currency: string;
  fiscal_year_start_month: number;
  fiscal_year_end_month: number;
  industry?: string | null;
  role?: string | null;
  is_active?: boolean;
  created_at?: string;
  vat_settings?: {
    entity_type: string;
    vat_registered: boolean;
    standard_rate: string;
    filing_frequency: string;
  };
}

export interface WorkspaceDashboard {
  workspace_id: string;
  revenue: number;
  expenses: number;
  profit: number;
  cash_balance: number;
  open_ap: number;
  open_ar: number;
  vat_payable: number;
  assets: number;
  liabilities: number;
  journal_count: number;
  customer_count: number;
  fixed_asset_count: number;
}

export interface WorkspaceMember {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
}

export function getStoredWorkspaceId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredWorkspaceId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
  localStorage.setItem('tenantId', id);
}

export function workspaceHeaders(token: string | null, extra: Record<string, string> = {}): Record<string, string> {
  const wsId = getActiveWorkspaceId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (wsId) {
    headers['X-Workspace-ID'] = wsId;
    headers['X-Tenant-ID'] = wsId;
  }
  const bearer = token ?? getStoredAccessToken();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}

async function apiFetch(path: string, token: string | null, init?: RequestInit): Promise<Response> {
  const base = backendOrigin();
  const headers = workspaceHeaders(token, Object.fromEntries(new Headers(init?.headers || {}).entries()));
  return fetch(`${base}${path}`, { ...init, headers, credentials: 'include' });
}

export async function listWorkspaces(token: string | null): Promise<Workspace[]> {
  const res = await apiFetch('/api/workspaces', token);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.workspaces ?? [];
}

function authError(res: Response, body: string): Error {
  if (res.status === 401) {
    return new Error('Please log in first — workspace creation requires authentication.');
  }
  return new Error(body || res.statusText);
}

export async function createWorkspace(
  token: string | null,
  payload: {
    name: string;
    legal_entity_name: string;
    trn_number?: string;
    country?: string;
    currency?: string;
    fiscal_year_start_month?: number;
    fiscal_year_end_month?: number;
    industry?: string;
  },
): Promise<Workspace> {
  if (!token) throw new Error('Please log in first — workspace creation requires authentication.');
  const res = await apiFetch('/api/workspaces', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw authError(res, await res.text());
  const data = await res.json();
  return data.workspace;
}

export async function getWorkspace(token: string | null, id: string): Promise<Workspace> {
  const res = await apiFetch(`/api/workspaces/${id}`, token);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.workspace;
}

export async function updateWorkspace(
  token: string | null,
  id: string,
  payload: Partial<Workspace>,
): Promise<Workspace> {
  const res = await apiFetch(`/api/workspaces/${id}`, token, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.workspace;
}

export async function getWorkspaceDashboard(token: string | null, id: string): Promise<WorkspaceDashboard> {
  const res = await apiFetch(`/api/workspaces/${id}/dashboard`, token);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listWorkspaceMembers(token: string | null, id: string): Promise<WorkspaceMember[]> {
  const res = await apiFetch(`/api/workspaces/${id}/users`, token);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.members ?? [];
}

export async function addWorkspaceMember(
  token: string | null,
  workspaceId: string,
  userId: string,
  role: string,
): Promise<void> {
  const res = await apiFetch(`/api/workspaces/${workspaceId}/users`, token, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, role }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function seedAbcTrading(token: string | null): Promise<{ workspace_id: string; name: string }> {
  const res = await apiFetch('/api/workspaces/seed/abc-trading', token, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
