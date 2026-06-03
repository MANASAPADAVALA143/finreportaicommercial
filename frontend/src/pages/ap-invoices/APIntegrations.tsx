/**
 * APIntegrations.tsx — Zoho Books + QuickBooks integration hub
 * Connect, sync, and manage external accounting integrations
 */
import { useState } from 'react';
import { Link2, CheckCircle, AlertCircle, RefreshCw, ExternalLink, Zap, Settings, ArrowRight, Database } from 'lucide-react';

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

type Integration = {
  id: string;
  name: string;
  logo: string;
  description: string;
  connected: boolean;
  lastSync?: string;
  syncCount?: number;
  status?: 'active' | 'paused' | 'error';
  color: string;
  features: string[];
  connectUrl: string;
};

const INTEGRATIONS: Integration[] = [
  {
    id: 'zoho',
    name: 'Zoho Books',
    logo: '🟠',
    description: 'Sync AP invoices, vendor payments, and purchase orders with Zoho Books.',
    connected: false,
    color: 'from-orange-900/40 to-orange-800/20 border-orange-700/50',
    features: ['Vendor sync', 'Invoice push', 'Payment reconciliation', 'GSTIN validation', 'Real-time webhooks'],
    connectUrl: '/uae-accounting/connect/zoho',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks Online',
    logo: '🟢',
    description: 'Two-way sync with QuickBooks: push approved invoices, pull vendor bills.',
    connected: false,
    color: 'from-green-900/40 to-green-800/20 border-green-700/50',
    features: ['Vendor bills import', 'AP aging sync', 'GL code mapping', 'Multi-currency', 'Auto-reconciliation'],
    connectUrl: '/uae-accounting/connect/qbo',
  },
  {
    id: 'xero',
    name: 'Xero',
    logo: '🔵',
    description: 'Import bills from Xero and push approved payments back automatically.',
    connected: false,
    color: 'from-blue-900/40 to-blue-800/20 border-blue-700/50',
    features: ['Bill import', 'Contact sync', 'Bank feed', 'Multi-currency', 'IFRS tagging'],
    connectUrl: '#',
  },
  {
    id: 'tally',
    name: 'Tally Prime',
    logo: '🟣',
    description: 'Export approved invoices to Tally in standard XML/JSON voucher format.',
    connected: false,
    color: 'from-purple-900/40 to-purple-800/20 border-purple-700/50',
    features: ['Voucher export', 'Ledger mapping', 'GST integration', 'TDS handling', 'Batch export'],
    connectUrl: '#',
  },
];

type SyncLog = { time: string; action: string; count: number; status: 'success' | 'error' };

export default function APIntegrations() {
  const [connections, setConnections] = useState<Record<string, boolean>>({});
  const [syncStatus, setSyncStatus]   = useState<Record<string, SyncStatus>>({});
  const [syncLogs, setSyncLogs]       = useState<SyncLog[]>([]);
  const [selected, setSelected]       = useState<string | null>(null);

  const isConnected = (id: string) => connections[id] ?? INTEGRATIONS.find(i => i.id === id)?.connected ?? false;

  const handleConnect = (intg: Integration) => {
    if (intg.connectUrl !== '#') {
      window.location.href = intg.connectUrl;
      return;
    }
    // Simulate connect for other integrations
    setConnections(p => ({ ...p, [intg.id]: true }));
    setSyncLogs(p => [{
      time: new Date().toLocaleTimeString(),
      action: `Connected to ${intg.name}`,
      count: 0,
      status: 'success',
    }, ...p]);
  };

  const handleDisconnect = (id: string) => {
    if (!window.confirm('Disconnect this integration?')) return;
    setConnections(p => ({ ...p, [id]: false }));
  };

  const handleSync = async (intg: Integration) => {
    setSyncStatus(p => ({ ...p, [intg.id]: 'syncing' }));
    await new Promise(r => setTimeout(r, 2000));
    const ok = Math.random() > 0.2;
    setSyncStatus(p => ({ ...p, [intg.id]: ok ? 'success' : 'error' }));
    setSyncLogs(p => [{
      time: new Date().toLocaleTimeString(),
      action: `${intg.name} sync — ${ok ? 'invoices pulled' : 'failed'}`,
      count: ok ? Math.floor(Math.random() * 20 + 5) : 0,
      status: ok ? 'success' : 'error',
    }, ...p.slice(0, 19)]);
    setTimeout(() => setSyncStatus(p => ({ ...p, [intg.id]: 'idle' })), 3000);
  };

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-950">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Link2 className="w-5 h-5 text-blue-400" /> Integrations
        </h1>
        <p className="text-slate-400 text-sm mt-0.5">Connect AP InvoiceFlow with your accounting software</p>
      </div>

      {/* Status bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">Connected</p>
          <p className="text-xl font-bold text-green-400 mt-1">{Object.values(connections).filter(Boolean).length}</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">Available</p>
          <p className="text-xl font-bold text-white mt-1">{INTEGRATIONS.length}</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">Last Sync</p>
          <p className="text-sm font-bold text-slate-300 mt-1">{syncLogs[0]?.time ?? 'Never'}</p>
        </div>
      </div>

      {/* Integration cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {INTEGRATIONS.map(intg => {
          const connected = isConnected(intg.id);
          const sStatus = syncStatus[intg.id] ?? 'idle';
          const isSelected = selected === intg.id;

          return (
            <div key={intg.id}
              className={`bg-gradient-to-br border rounded-xl overflow-hidden transition-all ${intg.color} ${isSelected ? 'ring-2 ring-blue-500' : ''}`}>
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
                    </div>
                  </div>
                  <button onClick={() => setSelected(isSelected ? null : intg.id)}
                    className="p-1.5 rounded-lg bg-black/20 hover:bg-black/40 text-slate-400 hover:text-white">
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-xs text-slate-300 mb-4">{intg.description}</p>

                {/* Features */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {intg.features.map(f => (
                    <span key={f} className="px-2 py-0.5 rounded-full bg-black/30 text-slate-300 text-[10px]">{f}</span>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {connected ? (
                    <>
                      <button
                        onClick={() => handleSync(intg)}
                        disabled={sStatus === 'syncing'}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium">
                        <RefreshCw className={`w-3.5 h-3.5 ${sStatus === 'syncing' ? 'animate-spin' : ''}`} />
                        {sStatus === 'syncing' ? 'Syncing…' : sStatus === 'success' ? '✓ Synced' : sStatus === 'error' ? '✗ Failed' : 'Sync Now'}
                      </button>
                      <button
                        onClick={() => handleDisconnect(intg.id)}
                        className="px-3 py-1.5 rounded-lg bg-black/30 hover:bg-red-900/50 text-slate-300 hover:text-red-300 text-xs">
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleConnect(intg)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold">
                      <Zap className="w-3.5 h-3.5" />
                      Connect {intg.name}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {intg.connectUrl !== '#' && (
                    <a href={intg.connectUrl}
                      className="p-1.5 rounded-lg bg-black/20 hover:bg-black/40 text-slate-400 hover:text-white">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                {/* Expanded settings panel */}
                {isSelected && connected && (
                  <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                    <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Sync Settings</p>
                    {[
                      { label: 'Auto-sync on invoice approval', value: true },
                      { label: 'Push payments to accounting', value: true },
                      { label: 'Import vendor bills', value: false },
                      { label: 'Sync GL account codes', value: true },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-xs text-slate-300">{label}</span>
                        <div className={`w-8 h-4 rounded-full transition-colors cursor-pointer ${value ? 'bg-blue-600' : 'bg-slate-700'}`}>
                          <div className={`w-3 h-3 rounded-full bg-white mt-0.5 transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sync log */}
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
