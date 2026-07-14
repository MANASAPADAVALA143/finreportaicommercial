/**
 * GulfTax ported API client — mirrors uaetax lib/api.ts axios interface.
 * Uses VITE_API_URL + CompanyContext / workspace headers (same as gulfTaxApi.ts).
 */
import { getStoredWorkspaceId } from './workspaceService';
import { getActiveCompanyId } from '../context/CompanyContext';
import { getStoredAccessToken } from '../utils/authToken';
import { supabase } from '../lib/supabase';

const API = import.meta.env.VITE_API_URL || '';

/** GulfTax ported company/profile endpoints (not FinReportAI RBAC /api/auth). */
export const GULFTAX_AUTH_API = '/api/gulftax/auth';

function workspaceId(): string {
  return (
    localStorage.getItem('active_workspace_id') ||
    getStoredWorkspaceId() ||
    localStorage.getItem('tenantId') ||
    ''
  );
}

function companyId(): string {
  return getActiveCompanyId() || localStorage.getItem('gulftax_company_id') || '';
}

async function resolveBearerToken(): Promise<string | null> {
  const stored = getStoredAccessToken();
  if (stored) return stored;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (token) {
      // Mirror AuthContext persistence so later sync callers find it
      localStorage.setItem('token', token);
    }
    return token;
  } catch {
    return null;
  }
}

async function buildHeaders(
  extra?: Record<string, string>,
  isFormData = false,
): Promise<Record<string, string>> {
  const h: Record<string, string> = { ...extra };
  const ws = workspaceId();
  if (ws) h['X-Workspace-Id'] = ws;
  if (!isFormData) h['Content-Type'] = 'application/json';
  const cid = companyId();
  if (cid) h['X-Company-Id'] = cid;
  const token = await resolveBearerToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function parseError(res: Response): Promise<string> {
  try {
    const err = await res.json();
    if (typeof err.detail === 'string') return err.detail;
    if (Array.isArray(err.detail)) return err.detail.map((d: { msg?: string }) => d.msg).join(', ');
  } catch {
    /* ignore */
  }
  return res.statusText || `API error ${res.status}`;
}

type RequestConfig = { headers?: Record<string, string>; timeout?: number };

async function request<T>(
  method: string,
  path: string,
  body?: FormData | Record<string, unknown>,
  config?: RequestConfig,
): Promise<{ data: T }> {
  const isForm = body instanceof FormData;
  const controller = new AbortController();
  const timeout = config?.timeout ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: await buildHeaders(config?.headers, isForm),
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: 'include',
    });
    if (!res.ok) {
      const msg = await parseError(res);
      const err = new Error(msg) as Error & { response?: { data?: { detail?: string }; status?: number } };
      err.response = { data: { detail: msg }, status: res.status };
      throw err;
    }
    if (res.status === 204) return { data: undefined as T };
    return { data: await res.json() };
  } finally {
    clearTimeout(timer);
  }
}

export const gulfTaxClient = {
  get<T>(path: string, config?: RequestConfig) {
    return request<T>('GET', path, undefined, config);
  },
  post<T>(path: string, body?: FormData | Record<string, unknown>, config?: RequestConfig) {
    return request<T>('POST', path, body, config);
  },
  patch<T>(path: string, body?: Record<string, unknown>, config?: RequestConfig) {
    return request<T>('PATCH', path, body, config);
  },
  delete<T>(path: string, config?: RequestConfig) {
    return request<T>('DELETE', path, undefined, config);
  },
};

/** Alias for ported pages that import `apiClient` from uaetax */
export const apiClient = gulfTaxClient;
