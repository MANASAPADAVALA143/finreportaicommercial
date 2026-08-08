import { joinApiUrl } from '@/utils/backendOrigin';
import { getStoredAccessToken } from '@/utils/authToken';
import { getStoredWorkspaceId } from '@/services/workspaceService';

type ApiResponse<T> = { data: T | null; error: string | null };

function companyId(): string {
  return localStorage.getItem('active_company_id') || localStorage.getItem('ap_company_id') || '';
}

function headers(extra?: HeadersInit): HeadersInit {
  const ws = getStoredWorkspaceId();
  const token = getStoredAccessToken();
  const cid = companyId();
  return {
    'Content-Type': 'application/json',
    'X-Workspace-ID': ws,
    'X-Tenant-ID': ws,
    ...(cid ? { 'X-Company-ID': cid, 'X-Firm-Id': cid } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function apiCall<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(joinApiUrl(path), {
      ...init,
      headers: headers(init.headers),
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      const detail = (err as { detail?: unknown }).detail;
      return {
        data: null,
        error: typeof detail === 'string' ? detail : `API ${path} failed (${res.status})`,
      };
    }
    if (res.status === 204) return { data: {} as T, error: null };
    return { data: (await res.json()) as T, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Request failed' };
  }
}

export const ifrs15Api = {
  billingReconUploadBilling: (body: Record<string, unknown>) =>
    apiCall<{ imported: number; errors: string[] }>('/api/ifrs15/billing-recon/upload-billing', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  billingReconUploadGl: (body: Record<string, unknown>) =>
    apiCall<{ imported: number; errors: string[] }>('/api/ifrs15/billing-recon/upload-gl', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  billingReconRun: (body: { company_id?: string; period: string; contract_id?: string }) =>
    apiCall<{
      success: boolean;
      results: Record<string, unknown>[];
      count: number;
      result: Record<string, unknown>;
    }>('/api/ifrs15/billing-recon/run', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  billingReconResults: (params: { company_id?: string; period?: string; contract_id?: string }) => {
    const qs = new URLSearchParams();
    if (params.company_id) qs.set('company_id', params.company_id);
    if (params.period) qs.set('period', params.period);
    if (params.contract_id) qs.set('contract_id', params.contract_id);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiCall<{ success: boolean; results: Record<string, unknown>[]; count: number }>(
      `/api/ifrs15/billing-recon/results${suffix}`,
    );
  },
  billingReconExceptions: (params: { company_id?: string; period?: string }) => {
    const qs = new URLSearchParams();
    if (params.company_id) qs.set('company_id', params.company_id);
    if (params.period) qs.set('period', params.period);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiCall<{ success: boolean; exceptions: Array<Record<string, unknown>>; count: number }>(
      `/api/ifrs15/billing-recon/exceptions${suffix}`,
    );
  },
  billingReconReview: (resultId: string, reviewedBy: string) =>
    apiCall<{ success: boolean; result: Record<string, unknown> }>(
      `/api/ifrs15/billing-recon/results/${encodeURIComponent(resultId)}/review`,
      { method: 'PATCH', body: JSON.stringify({ reviewed_by: reviewedBy }) },
    ),
  modificationsList: (params: { company_id?: string; contract_id?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params.company_id) qs.set('company_id', params.company_id);
    if (params.contract_id) qs.set('contract_id', params.contract_id);
    if (params.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiCall<{ success: boolean; modifications: Record<string, unknown>[]; count: number }>(
      `/api/ifrs15/modifications${suffix}`,
    );
  },
  modificationsContracts: (cid?: string) => {
    const qs = cid ? `?company_id=${encodeURIComponent(cid)}` : '';
    return apiCall<{ success: boolean; contracts: Record<string, unknown>[] }>(
      `/api/ifrs15/modifications/contracts${qs}`,
    );
  },
  modificationsGet: (id: string) =>
    apiCall<{
      success: boolean;
      modification: Record<string, unknown>;
      audit_trail: Record<string, unknown>[];
    }>(`/api/ifrs15/modifications/${encodeURIComponent(id)}`),
  modificationsClassify: (body: Record<string, unknown>) =>
    apiCall<{
      success: boolean;
      modification: Record<string, unknown>;
      classification: Record<string, unknown>;
      catch_up: Record<string, unknown> | null;
    }>('/api/ifrs15/modifications/classify', { method: 'POST', body: JSON.stringify(body) }),
  modificationsCatchup: (body: { modification_id: string; override_progress_pct?: number }) =>
    apiCall<{ success: boolean; modification: Record<string, unknown>; catch_up: Record<string, unknown> }>(
      '/api/ifrs15/modifications/calculate-catchup',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  modificationsOverride: (id: string, body: { human_treatment: string; reason: string; actor: string }) =>
    apiCall<{ success: boolean; modification: Record<string, unknown> }>(
      `/api/ifrs15/modifications/${encodeURIComponent(id)}/override`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  modificationsApprove: (id: string, approvedBy: string) =>
    apiCall<{ success: boolean; modification: Record<string, unknown> }>(
      `/api/ifrs15/modifications/${encodeURIComponent(id)}/approve`,
      { method: 'POST', body: JSON.stringify({ approved_by: approvedBy }) },
    ),
  modificationsGenerateMemo: (id: string) =>
    apiCall<{ success: boolean; memo: string; modification: Record<string, unknown> }>(
      `/api/ifrs15/modifications/${encodeURIComponent(id)}/generate-memo`,
      { method: 'POST' },
    ),
  modificationsPostJe: (id: string, body: { je_date: string; actor: string }) =>
    apiCall<{ success: boolean; modification: Record<string, unknown> }>(
      `/api/ifrs15/modifications/${encodeURIComponent(id)}/post-je`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  modificationsMemoPdf: async (id: string) => {
    try {
      const res = await fetch(joinApiUrl(`/api/ifrs15/modifications/${encodeURIComponent(id)}/memo-pdf`), {
        headers: headers(),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        return { blob: null as Blob | null, filename: null as string | null, error: String((err as { detail?: string }).detail || res.statusText) };
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/);
      return { blob, filename: match?.[1] || 'IFRS15_modification_memo.pdf', error: null as string | null };
    } catch (e) {
      return { blob: null as Blob | null, filename: null as string | null, error: e instanceof Error ? e.message : 'Download failed' };
    }
  },
  rpoDashboardCurrent: (cid?: string) => {
    const qs = cid ? `?company_id=${encodeURIComponent(cid)}` : '';
    return apiCall<{
      success: boolean;
      snapshot: Record<string, unknown>;
      contract_detail: Record<string, unknown>[];
      groups: Record<string, unknown>;
    }>(`/api/ifrs15/rpo-dashboard/current${qs}`);
  },
  rpoDashboardSnapshots: (params: { company_id?: string; last_n_periods?: number }) => {
    const qs = new URLSearchParams();
    if (params.company_id) qs.set('company_id', params.company_id);
    if (params.last_n_periods) qs.set('last_n_periods', String(params.last_n_periods));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiCall<{ success: boolean; snapshots: Record<string, unknown>[]; count: number }>(
      `/api/ifrs15/rpo-dashboard/snapshots${suffix}`,
    );
  },
  rpoDashboardSnapshot: (id: string) =>
    apiCall<{
      success: boolean;
      snapshot: Record<string, unknown>;
      contract_detail: Record<string, unknown>[];
      groups: Record<string, unknown>;
    }>(`/api/ifrs15/rpo-dashboard/snapshots/${encodeURIComponent(id)}`),
  rpoDashboardWaterfall: (params: { company_id?: string; periods?: number }) => {
    const qs = new URLSearchParams();
    if (params.company_id) qs.set('company_id', params.company_id);
    if (params.periods) qs.set('periods', String(params.periods));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiCall<{ success: boolean; waterfall: Record<string, unknown>[]; count: number }>(
      `/api/ifrs15/rpo-dashboard/waterfall${suffix}`,
    );
  },
  rpoDashboardRun: (body: {
    company_id?: string;
    snapshot_date?: string;
    period?: string;
    ltm_revenue?: number;
  }) =>
    apiCall<{
      success: boolean;
      snapshot: Record<string, unknown>;
      contract_detail: Record<string, unknown>[];
      groups: Record<string, unknown>;
    }>('/api/ifrs15/rpo-dashboard/run-snapshot', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  rpoDashboardExportPdf: async (params: { company_id?: string; snapshot_id?: string }) => {
    try {
      const qs = new URLSearchParams();
      if (params.company_id) qs.set('company_id', params.company_id);
      if (params.snapshot_id) qs.set('snapshot_id', params.snapshot_id);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const res = await fetch(joinApiUrl(`/api/ifrs15/rpo-dashboard/export-disclosure${suffix}`), {
        method: 'POST',
        headers: headers(),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        return { blob: null as Blob | null, filename: null as string | null, error: String((err as { detail?: string }).detail || res.statusText) };
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/);
      return { blob, filename: match?.[1] || 'IFRS15_RPO_disclosure.pdf', error: null as string | null };
    } catch (e) {
      return { blob: null as Blob | null, filename: null as string | null, error: e instanceof Error ? e.message : 'Download failed' };
    }
  },
};
