/**
 * AP Integrations — Zoho Books & QuickBooks connection status + sync.
 */
import { loadZohoSettings } from './zohoService';
import { loadQBSettings } from './quickbooksService';
import { getSharedSettings } from './sharedSettingsService';
import { joinApiUrl } from '../../utils/backendOrigin';
import { logAction, getInvoiceflowWorkEmail } from './auditService';

export type IntegrationId = 'zoho' | 'quickbooks';

export interface IntegrationStatus {
  id: IntegrationId;
  connected: boolean;
  configured: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: 'success' | 'error' | 'never';
  connectionId: string | null;
  message?: string;
}

const SYNC_KEYS: Record<IntegrationId, string> = {
  zoho: 'ap_zoho_last_sync',
  quickbooks: 'ap_qb_last_sync',
};

async function readSyncSettings(): Promise<Record<string, string>> {
  return getSharedSettings(Object.values(SYNC_KEYS)).catch(() => ({}));
}

async function fetchErpConnections(): Promise<
  Array<{
    id: string;
    erp_type: string;
    is_active: boolean;
    last_sync_at?: string | null;
    last_sync_status?: string | null;
  }>
> {
  try {
    const res = await fetch(joinApiUrl('/api/connections/status'));
    if (!res.ok) return [];
    const j = (await res.json()) as { connections?: typeof connections };
    const connections = j.connections ?? [];
    return connections;
  } catch {
    return [];
  }
}

async function fetchApIntegrationStatus(): Promise<
  Array<{
    id: string;
    connected: boolean;
    configured: boolean;
    last_sync_at: string | null;
    last_sync_status: string;
    message?: string;
  }>
> {
  try {
    const res = await fetch(joinApiUrl('/api/ap/integrations/status'));
    if (!res.ok) return [];
    const j = (await res.json()) as { integrations?: Array<{
      id: string;
      connected: boolean;
      configured: boolean;
      last_sync_at: string | null;
      last_sync_status: string;
      message?: string;
    }> };
    return j.integrations ?? [];
  } catch {
    return [];
  }
}

export async function getZohoOAuthUrl(): Promise<string> {
  const res = await fetch(joinApiUrl('/api/ap/integrations/zoho/auth-url'));
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? 'Could not get Zoho OAuth URL');
  }
  const j = (await res.json()) as { auth_url: string };
  return j.auth_url;
}

export async function getQuickBooksOAuthUrl(): Promise<string> {
  const res = await fetch(joinApiUrl('/api/ap/integrations/qbo/auth-url'));
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? 'Could not get QuickBooks OAuth URL');
  }
  const j = (await res.json()) as { auth_url: string };
  return j.auth_url;
}

export async function getIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const [zoho, qb, erp, apApi] = await Promise.all([
    loadZohoSettings().catch(() => ({} as Awaited<ReturnType<typeof loadZohoSettings>>)),
    loadQBSettings().catch(() => ({} as Awaited<ReturnType<typeof loadQBSettings>>)),
    fetchErpConnections(),
    fetchApIntegrationStatus(),
  ]);

  const zohoErp = erp.find((c) => c.erp_type === 'zoho' && c.is_active);
  const qbErp = erp.find((c) => c.erp_type === 'quickbooks' && c.is_active);
  const zohoApi = apApi.find((i) => i.id === 'zoho');
  const qbApi = apApi.find((i) => i.id === 'quickbooks');

  const syncSettings = await readSyncSettings();
  const zohoSyncRaw = syncSettings[SYNC_KEYS.zoho] ?? null;
  const qbSyncRaw = syncSettings[SYNC_KEYS.quickbooks] ?? null;

  const parseSync = (raw: string | null) => {
    if (!raw) return { at: null as string | null, status: 'never' as const };
    try {
      const o = JSON.parse(raw) as { at?: string; status?: string };
      return {
        at: o.at ?? null,
        status: (o.status === 'success' || o.status === 'error' ? o.status : 'never') as 'success' | 'error' | 'never',
      };
    } catch {
      return { at: raw, status: 'success' as const };
    }
  };

  const zSync = parseSync(zohoSyncRaw);
  const qSync = parseSync(qbSyncRaw);

  const zohoConfigured = !!(zoho.has_refresh_token && zoho.organization_id && zoho.client_id);
  const qbConfigured = !!(qb.has_refresh_token && qb.realm_id && qb.client_id);

  const mapStatus = (s: string | null | undefined): 'success' | 'error' | 'never' => {
    if (s === 'success' || s === 'failed' || s === 'error') {
      return s === 'success' ? 'success' : 'error';
    }
    return 'never';
  };

  return [
    {
      id: 'zoho',
      connected: zohoApi?.connected ?? zohoConfigured ?? !!zohoErp,
      configured: zohoConfigured || !!zohoApi?.configured,
      lastSyncAt: zohoApi?.last_sync_at ?? zohoErp?.last_sync_at ?? zSync.at,
      lastSyncStatus: mapStatus(zohoApi?.last_sync_status ?? zohoErp?.last_sync_status ?? zSync.status),
      connectionId: zohoErp?.id ?? null,
      message: zohoApi?.message ?? (zohoConfigured ? 'Connected via OAuth / Settings' : 'Add Zoho credentials in Settings, then Connect'),
    },
    {
      id: 'quickbooks',
      connected: qbApi?.connected ?? qbConfigured ?? !!qbErp,
      configured: qbConfigured || !!qbApi?.configured,
      lastSyncAt: qbApi?.last_sync_at ?? qbErp?.last_sync_at ?? qSync.at,
      lastSyncStatus: mapStatus(qbApi?.last_sync_status ?? qbErp?.last_sync_status ?? qSync.status),
      connectionId: qbErp?.id ?? null,
      message: qbApi?.message ?? (qbConfigured ? 'Connected via OAuth / Settings' : 'Add QuickBooks credentials in Settings, then Connect'),
    },
  ];
}

export async function triggerIntegrationSync(id: IntegrationId, connectionId?: string | null): Promise<{
  ok: boolean;
  message: string;
  count?: number;
}> {
  let ok = false;
  let message = '';
  let count = 0;

  if (connectionId) {
    const path = id === 'zoho' ? `/api/connections/zoho/sync/${connectionId}` : `/api/connections/quickbooks/sync/${connectionId}`;
    const res = await fetch(path, { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    ok = res.ok;
    message = ok ? (j.message as string) || 'Sync completed' : (j.detail as string) || 'Sync failed';
    count = Number(j.records_synced ?? j.count ?? 0);
  } else {
    const path = id === 'zoho' ? '/api/ap/integrations/zoho/sync' : '/api/ap/integrations/quickbooks/sync';
    const res = await fetch(path, { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    ok = res.ok;
    message = ok ? (j.message as string) || 'Sync completed' : (j.detail as string) || 'Sync failed';
    count = Number(j.count ?? 0);
  }

  logAction('integration.sync', id, null, getInvoiceflowWorkEmail(), { ok, message, count });
  return { ok, message, count };
}

export async function disconnectIntegration(id: IntegrationId, connectionId: string | null): Promise<void> {
  if (connectionId) {
    await fetch(joinApiUrl(`/api/connections/${connectionId}`), { method: 'DELETE' });
  }
  logAction('integration.disconnect', id, null, getInvoiceflowWorkEmail(), {});
}
