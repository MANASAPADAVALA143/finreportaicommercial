/**
 * Company Setup wizard API — /api/company-setup/*
 */

import { backendOrigin } from '../utils/backendOrigin';
import { getStoredWorkspaceId, workspaceHeaders } from './workspaceService';

export interface CompanyProfile {
  id: string;
  workspace_id: string;
  company_name: string;
  trade_name?: string | null;
  legal_type?: string | null;
  trn?: string | null;
  license_number?: string | null;
  license_authority?: string | null;
  base_currency: string;
  reporting_standard: string;
  financial_year_start: number;
  industry?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logo_url?: string | null;
  status: 'setup' | 'active';
  setup_step: number;
  coa_option?: string | null;
  opening_balance_date?: string | null;
}

export interface SetupAccount {
  id: string;
  code: string;
  name: string;
  account_type: string;
  sub_type?: string;
  currency: string;
  is_active: boolean;
}

export interface SetupStatus {
  has_active_company: boolean;
  active_company: CompanyProfile | null;
  draft_company: CompanyProfile | null;
  setup_required: boolean;
}

function hdrs(token: string | null, extra: Record<string, string> = {}): Record<string, string> {
  return workspaceHeaders(token, extra);
}

function parseApiError(text: string, fallback: string): string {
  if (!text) return fallback;
  try {
    const json = JSON.parse(text) as { detail?: unknown };
    const detail = json.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'msg' in item) {
            const loc = 'loc' in item && Array.isArray(item.loc) ? item.loc.join('.') : 'field';
            return `${loc}: ${String((item as { msg: unknown }).msg)}`;
          }
          return String(item);
        })
        .join('; ');
    }
  } catch {
    // not JSON — use raw text
  }
  return text;
}

async function api<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`${backendOrigin()}${path}`, {
    ...init,
    headers: hdrs(token, Object.fromEntries(new Headers(init?.headers || {}).entries())),
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseApiError(text, res.statusText));
  }
  return res.json();
}

export const getSetupStatus = (token: string | null) =>
  api<SetupStatus>('/api/company-setup/status', token);

export const listCompanies = (token: string | null) =>
  api<{ companies: CompanyProfile[]; count: number }>('/api/company-setup/companies', token);

export const getProfile = (token: string | null) =>
  api<{ profile: CompanyProfile }>('/api/company-setup/profile', token);

export const saveProfile = (token: string | null, body: Partial<CompanyProfile>) =>
  api<{ profile: CompanyProfile }>('/api/company-setup/profile', token, {
    method: 'POST',
    body: JSON.stringify({
      company_name: body.company_name?.trim() ?? '',
      trade_name: body.trade_name?.trim() || null,
      legal_type: body.legal_type?.trim() || null,
      trn: body.trn?.trim() || null,
      license_number: body.license_number?.trim() || null,
      license_authority: body.license_authority?.trim() || null,
      base_currency: body.base_currency || 'AED',
      reporting_standard: body.reporting_standard || 'IFRS',
      financial_year_start: body.financial_year_start ?? 1,
      industry: body.industry?.trim() || null,
      address: body.address?.trim() || null,
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      website: body.website?.trim() || null,
      logo_url: body.logo_url || null,
    }),
  });

export const uploadLogo = async (token: string | null, file: File): Promise<string> => {
  const form = new FormData();
  form.append('file', file);
  const wsId = getStoredWorkspaceId();
  const headers: Record<string, string> = {
    'X-Workspace-ID': wsId,
    'X-Tenant-ID': wsId,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${backendOrigin()}/api/company-setup/logo`, {
    method: 'POST',
    headers,
    body: form,
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.logo_url as string;
};

export const setupCoA = (token: string | null, option: 'default' | 'csv' | 'blank', csvContent?: string) =>
  api<{ accounts: SetupAccount[]; count: number; option: string }>('/api/company-setup/coa', token, {
    method: 'POST',
    body: JSON.stringify({ option, csv_content: csvContent }),
  });

export const listCoA = (token: string | null) =>
  api<{ accounts: SetupAccount[]; count: number }>('/api/company-setup/coa', token);

export const createAccount = (token: string | null, body: Omit<SetupAccount, 'id'>) =>
  api<SetupAccount>('/api/company-setup/coa/accounts', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateAccount = (token: string | null, id: string, body: Partial<SetupAccount>) =>
  api<SetupAccount>(`/api/company-setup/coa/accounts/${id}`, token, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const deleteAccount = (token: string | null, id: string) =>
  api<{ status: string }>(`/api/company-setup/coa/accounts/${id}`, token, { method: 'DELETE' });

export const saveOpeningBalances = (
  token: string | null,
  openingDate: string,
  lines: { account_code: string; account_name: string; debit: number; credit: number; prior_year?: number }[],
) =>
  api<{ journal_entry_id: string; entry_number: string }>('/api/company-setup/opening-balances', token, {
    method: 'POST',
    body: JSON.stringify({ opening_date: openingDate, lines }),
  });

export const saveControls = (token: string | null, body: Record<string, unknown>) =>
  api<{ id: string }>('/api/company-setup/controls', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const getControls = (token: string | null) =>
  api<{ controls: Record<string, unknown> | null }>('/api/company-setup/controls', token);

export const listSetupUsers = (token: string | null) =>
  api<{
    users: { user_id: string; name: string; email: string; workspace_role: string }[];
    roles: { user_id: string; module: string; role: string }[];
    module_options: Record<string, string[]>;
  }>('/api/company-setup/users', token);

export const saveRoles = (token: string | null, assignments: { user_id: string; module: string; role: string }[]) =>
  api<{ assignments: unknown[] }>('/api/company-setup/roles', token, {
    method: 'POST',
    body: JSON.stringify({ assignments }),
  });

export const getReview = (token: string | null) =>
  api<Record<string, unknown>>('/api/company-setup/review', token);

export const activateCompany = (token: string | null) =>
  api<{ profile: CompanyProfile; redirect: string }>('/api/company-setup/activate', token, {
    method: 'POST',
  });

export function logoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${backendOrigin()}${path}`;
}
