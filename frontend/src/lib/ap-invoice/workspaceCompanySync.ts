/**
 * Links FinReportAI workspaces (top banner / backend SQLite) to AP Supabase companies.
 * Uses backend service role — frontend anon key cannot insert/read tenant companies under RLS.
 */
import { getStoredWorkspaceId, workspaceHeaders, type Workspace } from '../../services/workspaceService';
import { backendOrigin } from '../../utils/backendOrigin';
import { supabase } from './supabase';
import type { Company } from './companyService';
import { clearCompanyCache } from './companyService';

let _accessToken: string | null = null;
let _syncInFlight: Promise<Company | null> | null = null;
const _syncedByWorkspace: Record<string, Company> = {};
/** Cooldown after failed sync so 503s don't tight-loop from fetchInvoices / modal onUpdate. */
const _failedUntilByWorkspace: Record<string, number> = {};
const FAIL_COOLDOWN_MS = 60_000;
const FAIL_COOLDOWN_503_MS = 120_000;

export type ApCompanySyncStatus = 'idle' | 'syncing' | 'synced' | 'pending' | 'error';

let _syncStatus: ApCompanySyncStatus = 'idle';
let _syncStatusDetail = '';

export function setApSyncAccessToken(token: string | null) {
  _accessToken = token;
}

export function getApCompanySyncStatus(): { status: ApCompanySyncStatus; detail: string } {
  return { status: _syncStatus, detail: _syncStatusDetail };
}

export function getCachedSyncedCompany(workspaceId: string): Company | null {
  return _syncedByWorkspace[workspaceId] ?? null;
}

function setSyncStatus(status: ApCompanySyncStatus, detail = '') {
  _syncStatus = status;
  _syncStatusDetail = detail;
  try {
    window.dispatchEvent(
      new CustomEvent('ap-company-sync-status', { detail: { status, detail } }),
    );
  } catch {
    /* ignore */
  }
}

function cacheCompany(workspaceId: string, company: Company) {
  _syncedByWorkspace[workspaceId] = company;
  delete _failedUntilByWorkspace[workspaceId];
  setSyncStatus('synced');
  try {
    localStorage.setItem(`ap_company_${workspaceId}`, company.id);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent('ap-company-synced', { detail: { workspaceId, companyId: company.id } }));
  } catch {
    /* ignore */
  }
}

function markSyncFailed(workspaceId: string, status: number, text: string) {
  const cooldown = status === 503 ? FAIL_COOLDOWN_503_MS : FAIL_COOLDOWN_MS;
  _failedUntilByWorkspace[workspaceId] = Date.now() + cooldown;
  setSyncStatus(
    status === 503 ? 'pending' : 'error',
    status === 503
      ? 'Company sync pending — will retry shortly'
      : `Company sync failed (${status})`,
  );
  console.warn('[AP] sync-ap-company failed:', status, text);
}

async function findCompanyByWorkspaceId(workspaceId: string): Promise<Company | null> {
  const cached = getCachedSyncedCompany(workspaceId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) {
    console.warn('[AP] companies lookup by workspace_id:', error.message);
    return null;
  }
  if (data) {
    cacheCompany(workspaceId, data as Company);
    return data as Company;
  }
  return null;
}

async function syncViaBackend(workspaceId: string, token: string): Promise<Company | null> {
  const base = backendOrigin();
  if (!base) {
    console.warn('[AP] VITE_API_URL not set — cannot sync company via backend');
    markSyncFailed(workspaceId, 0, 'VITE_API_URL not set');
    return null;
  }
  const res = await fetch(`${base}/api/workspaces/${workspaceId}/sync-ap-company`, {
    method: 'POST',
    headers: workspaceHeaders(token),
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    markSyncFailed(workspaceId, res.status, text);
    return null;
  }
  const body = (await res.json()) as { company?: Company };
  if (body.company?.id) {
    cacheCompany(workspaceId, body.company);
    clearCompanyCache();
    return body.company;
  }
  markSyncFailed(workspaceId, 502, 'empty company payload');
  return null;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'company';
}

async function ensureCompanyConfig(companyId: string): Promise<void> {
  await supabase
    .from('company_config')
    .upsert({ company_id: companyId }, { onConflict: 'company_id' })
    .then(() => null, () => null);
}

/** Create Supabase companies row from workspace (direct — fallback only). */
export async function syncApCompanyFromWorkspace(ws: Workspace): Promise<Company | null> {
  const existing = await findCompanyByWorkspaceId(ws.id);
  if (existing) return existing;

  const slug = `${slugify(ws.name)}-${ws.id.slice(0, 8)}`;
  const market =
    (ws.country ?? '').toLowerCase() === 'uae' || (ws.country ?? '').toLowerCase() === 'ae'
      ? 'uae'
      : 'india';

  const { data, error } = await supabase
    .from('companies')
    .insert({
      name: ws.name,
      slug,
      industry: ws.industry ?? 'general',
      accounting_standard: 'IFRS',
      market,
      subscription_tier: 'starter',
      subscription_status: 'trial',
      max_invoices_per_month: 100,
      max_users: 5,
      workspace_id: ws.id,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') return findCompanyByWorkspaceId(ws.id);
    console.error('[AP] sync company insert failed:', error.message);
    return null;
  }

  const company = data as Company;
  cacheCompany(ws.id, company);
  await ensureCompanyConfig(company.id);
  clearCompanyCache();
  return company;
}

/**
 * Read active workspace from localStorage, ensure Supabase company exists via backend.
 * Failed syncs enter a cooldown so callers (list refresh, detail modal) do not hammer 503.
 */
export async function ensureApCompanySynced(accessToken?: string | null): Promise<Company | null> {
  const token = accessToken ?? _accessToken;
  const workspaceId = getStoredWorkspaceId();
  if (!workspaceId) return null;

  const existing = await findCompanyByWorkspaceId(workspaceId);
  if (existing) return existing;

  const failedUntil = _failedUntilByWorkspace[workspaceId] ?? 0;
  if (failedUntil > Date.now()) {
    return getCachedSyncedCompany(workspaceId);
  }

  if (!token) {
    console.warn('[AP] workspace selected but not logged in — cannot sync AP company');
    return null;
  }

  if (_syncInFlight) return _syncInFlight;

  setSyncStatus('syncing');
  _syncInFlight = (async () => {
    try {
      const viaBackend = await syncViaBackend(workspaceId, token);
      return viaBackend;
    } catch (e) {
      console.warn('[AP] ensureApCompanySynced:', e instanceof Error ? e.message : e);
      markSyncFailed(workspaceId, 0, e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      _syncInFlight = null;
    }
  })();

  return _syncInFlight;
}

/**
 * Supabase AP `companies.id` for the active workspace — NOT FinReportAI `active_company_id`.
 * Using the wrong ID causes invoice inserts to fail FK checks and list queries to miss rows.
 */
export async function resolveApSupabaseCompanyId(accessToken?: string | null): Promise<string> {
  const workspaceId = getStoredWorkspaceId();
  if (workspaceId) {
    const byWorkspace = await findCompanyByWorkspaceId(workspaceId);
    if (byWorkspace?.id) return byWorkspace.id;
  }
  const synced = await ensureApCompanySynced(accessToken);
  if (synced?.id) return synced.id;
  const { getMyCompany } = await import('./companyService');
  const company = await getMyCompany();
  if (company?.id) return company.id;
  throw new Error(
    'No AP company linked to this workspace. Select a workspace in the top banner and ensure the backend is running.',
  );
}
