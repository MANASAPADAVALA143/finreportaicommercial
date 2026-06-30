/**
 * APIntegrations.tsx — Zoho Books + QuickBooks integration hub
 */
import { useCallback, useEffect, useState } from 'react';
import { Link2, CheckCircle, AlertCircle, RefreshCw, ExternalLink, Zap, Settings, ArrowRight, Database } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  disconnectIntegration,
  getIntegrationStatuses,
  getQuickBooksOAuthUrl,
  getZohoOAuthUrl,
  triggerIntegrationSync,
  type IntegrationId,
  type IntegrationStatus,
} from '../../lib/ap-invoice/apIntegrationsService';

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

const CORE_INTEGRATIONS: Array<{
  id: IntegrationId;
  name: string;
  logo: string;
  description: string;
  color: string;
  features: string[];
  connectUrl: string;
  settingsPath: string;
}> = [
  {
    id: 'zoho',
    name: 'Zoho Books',
    logo: '🟠',
    description: 'Sync AP invoices, vendor payments, and purchase orders with Zoho Books.',
    color: 'from-orange-900/40 to-orange-800/20 border-orange-700/50',
    features: ['Vendor sync', 'Invoice push', 'Payment reconciliation', 'TRN validation', 'OAuth'],
    connectUrl: '/ap-invoices/integrations',
    settingsPath: '/ap-invoices/settings',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks Online',
    logo: '🟢',
    description: 'Two-way sync with QuickBooks: push approved invoices, pull vendor bills.',
    color: 'from-green-900/40 to-green-800/20 border-green-700/50',
    features: ['Vendor bills import', 'AP aging sync', 'GL code mapping', 'Multi-currency', 'OAuth'],
    connectUrl: '/ap-invoices/integrations',
    settingsPath: '/ap-invoices/settings',
  },
];

type SyncLog = { time: string; action: string; count: number; status: 'success' | 'error' };

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function APIntegrations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [statuses, setStatuses] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<Record<string, SyncStatus>>({});
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<IntegrationId | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getIntegrationStatuses();
      setStatuses(s);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) {
      setSyncLogs((p) => [{
        time: new Date().toLocaleTimeString(),
        action: `${connected} connected via OAuth`,
        count: 0,
        status: 'success',
      }, ...p]);
      void refresh();
      setSearchParams({}, { replace: true });
    } else if (error) {
      setSyncLogs((p) => [{
        time: new Date().toLocaleTimeString(),
        action: `OAuth failed: ${error}`,
        count: 0,
        status: 'error',
      }, ...p]);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, refresh, setSearchParams]);

  const statusFor = (id: IntegrationId) => statuses.find((s) => s.id === id);

  const handleConnect = async (id: IntegrationId) => {
    setConnecting(id);
    try {
      const url = id === 'zoho' ? await getZohoOAuthUrl() : await getQuickBooksOAuthUrl();
      window.location.href = url;
    } catch (e) {
      setSyncLogs((p) => [{
        time: new Date().toLocaleTimeString(),
        action: e instanceof Error ? e.message : 'OAuth failed — add client credentials in Settings first',
        count: 0,
        status: 'error',
      }, ...p]);
      setConnecting(null);
    }
  };

  const handleDisconnect = async (id: IntegrationId) => {
    const st = statusFor(id);
    if (!window.confirm('Disconnect this integration?')) return;
    await disconnectIntegration(id, st?.connectionId ?? null);
    await refresh();
    setSyncLogs((p) => [{
      time: new Date().toLocaleTimeString(),
      action: `Disconnected ${id}`,
      count: 0,
      status: 'success',
    }, ...p]);
  };

  const handleSync = async (id: IntegrationId) => {
    const st = statusFor(id);
    if (!st?.connected) return;
    setSyncStatus((p) => ({ ...p, [id]: 'syncing' }));
    try {
      const result = await triggerIntegrationSync(id, st.connectionId);
      setSyncStatus((p) => ({ ...p, [id]: result.ok ? 'success' : 'error' }));
      setSyncLogs((p) => [{
        time: new Date().toLocaleTimeString(),
        action: result.message,
        count: result.count ?? 0,
        status: result.ok ? 'success' : 'error',
      }, ...p.slice(0, 19)]);
      await refresh();
    } catch (e) {
      setSyncStatus((p) => ({ ...p, [id]: 'error' }));
      setSyncLogs((p) => [{
        time: new Date().toLocaleTimeString(),
        action: e instanceof Error ? e.message : 'Sync failed',
        count: 0,
        status: 'error',
      }, ...p]);
    }
    setTimeout(() => setSyncStatus((p) => ({ ...p, [id]: 'idle' })), 3000);
  };

  const connectedCount = statuses.filter((s) => s.connected).length;
  const lastSync = statuses
    .map((s) => s.lastSyncAt)
    .filter(Boolean)
    .sort()
    .reverse()[0];

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-950">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Link2 className="w-5 h-5 text-blue-400" /> Integrations
        </h1>
        <p className="text-slate-400 text-sm mt-0.5">Connect AP InvoiceFlow with Zoho Books or QuickBooks Online</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">Connected</p>
          <p className="text-xl font-bold text-green-400 mt-1">{loading ? '…' : connectedCount}</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">Available</p>
          <p className="text-xl font-bold text-white mt-1">{CORE_INTEGRATIONS.length}</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">Last Sync</p>
          <p className="text-sm font-bold text-slate-300 mt-1">{formatSyncTime(lastSync ?? null)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CORE_INTEGRATIONS.map((intg) => {
          const st = statusFor(intg.id);
          const connected = st?.connected ?? false;
          const sStatus = syncStatus[intg.id] ?? 'idle';
          const isSelected = selected === intg.id;

          return (
            <div
              key={intg.id}
              className={`bg-gradient-to-br border rounded-xl overflow-hidden transition-all ${intg.color} ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
            >
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{intg.logo}</span>
                    <div>
                      <h3 className="text-base font-bold text-white">{intg.name}</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {connected ? (
                          <span className="flex items-center gap-1 text-[11px] text-green-400 font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Connected
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" /> Not connected
                          </span>
                        )}
                      </div>
                      {st?.lastSyncAt && (
                        <p className="text-[10px] text-slate-400 mt-1">
                          Last sync: {formatSyncTime(st.lastSyncAt)}
                          {st.lastSyncStatus !== 'never' && ` (${st.lastSyncStatus})`}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(isSelected ? null : intg.id)}
                    className="p-1.5 rounded-lg bg-black/20 hover:bg-black/40 text-slate-400 hover:text-white"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-xs text-slate-300 mb-4">{intg.description}</p>
                {st?.message && !connected && (
                  <p className="text-[11px] text-amber-300 mb-3">{st.message}</p>
                )}

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {intg.features.map((f) => (
                    <span key={f} className="px-2 py-0.5 rounded-full bg-black/30 text-slate-300 text-[10px]">{f}</span>
                  ))}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {connected ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleSync(intg.id)}
                        disabled={sStatus === 'syncing'}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${sStatus === 'syncing' ? 'animate-spin' : ''}`} />
                        {sStatus === 'syncing' ? 'Syncing…' : sStatus === 'success' ? 'Synced' : sStatus === 'error' ? 'Failed' : 'Sync Now'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDisconnect(intg.id)}
                        className="px-3 py-1.5 rounded-lg bg-black/30 hover:bg-red-900/50 text-slate-300 hover:text-red-300 text-xs"
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleConnect(intg.id)}
                        disabled={connecting === intg.id}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold disabled:opacity-50"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        {connecting === intg.id ? 'Redirecting…' : 'Connect via OAuth'}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <a
                        href={intg.settingsPath}
                        className="px-3 py-1.5 rounded-lg bg-black/30 text-slate-300 hover:text-white text-xs"
                      >
                        Or paste credentials in Settings
                      </a>
                    </>
                  )}
                  <a
                    href={intg.connectUrl}
                    className="p-1.5 rounded-lg bg-black/20 hover:bg-black/40 text-slate-400 hover:text-white"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {isSelected && (
                  <div className="mt-4 pt-4 border-t border-white/10 space-y-2 text-xs text-slate-300">
                    <p className="font-semibold uppercase tracking-wide">Connection details</p>
                    <p>Configured: {st?.configured ? 'Yes (Settings)' : 'No'}</p>
                    <p>ERP connection ID: {st?.connectionId ?? '—'}</p>
                    <p>Status: {st?.lastSyncStatus ?? 'never'}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {syncLogs.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-bold text-white">Sync Log</h3>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {syncLogs.map((log, i) => (
              <div key={i} className="flex items-center justify-between text-xs text-slate-400 bg-slate-800/50 rounded px-3 py-1.5">
                <div className="flex items-center gap-2">
                  {log.status === 'success'
                    ? <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                    : <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                  <span className="text-slate-300">{log.action}</span>
                  {log.count > 0 && <span className="text-blue-400 font-medium">({log.count} records)</span>}
                </div>
                <span className="text-slate-600">{log.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
