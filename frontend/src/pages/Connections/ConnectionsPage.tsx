/**
 * ConnectionsPage.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * ERP Connections — connect Zoho Books or TallyPrime once.
 * Data syncs automatically into AP Invoices + JE Anomaly Detection.
 */

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Plug, RefreshCw, Trash2, CheckCircle, XCircle,
  Clock, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Connection {
  id: string;
  client_name: string;
  erp_type: 'zoho' | 'tally';
  is_active: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  sync_invoices: boolean;
  sync_journal_entries: boolean;
  sync_hour: number;
  days_to_pull: number;
  zoho_org_id?: string;
  tally_server_ip?: string;
  tally_port?: number;
  tally_company_name?: string;
}

interface SyncLog {
  id: string;
  erp_type: string;
  sync_type: string;
  records_fetched: number;
  anomalies_found: number;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-slate-500">Never synced</span>;
  const map: Record<string, string> = {
    success:   'bg-emerald-900/60 text-emerald-300',
    completed: 'bg-emerald-900/60 text-emerald-300',
    failed:    'bg-red-900/60 text-red-300',
    running:   'bg-blue-900/60 text-blue-300',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${map[status] ?? 'bg-slate-800 text-slate-400'}`}>
      {status}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [logs, setLogs] = useState<Record<string, SyncLog[]>>({});
  const [logsOpen, setLogsOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Zoho form
  const [zohoOrgId, setZohoOrgId] = useState('');
  const [zohoName, setZohoName] = useState('');

  // Tally form
  const [tallyIp, setTallyIp] = useState('localhost');
  const [tallyPort, setTallyPort] = useState(9000);
  const [tallyCompany, setTallyCompany] = useState('');
  const [tallyName, setTallyName] = useState('');
  const [tallyCompanies, setTallyCompanies] = useState<string[]>([]);
  const [tallyTesting, setTallyTesting] = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadConnections = async () => {
    try {
      const res = await fetch(`${API}/api/connections/status`);
      const data = await res.json();
      setConnections(data.connections ?? []);
    } catch {
      toast.error('Failed to load connections');
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async (connId: string) => {
    try {
      const res = await fetch(`${API}/api/connections/logs/${connId}`);
      const data = await res.json();
      setLogs(prev => ({ ...prev, [connId]: data.logs ?? [] }));
    } catch { /* silent */ }
  };

  useEffect(() => { void loadConnections(); }, []);

  // ── Zoho OAuth ───────────────────────────────────────────────────────────────

  const handleConnectZoho = () => {
    if (!zohoOrgId || !zohoName) { toast.error('Enter org ID and client name'); return; }
    const clientId    = import.meta.env.VITE_ZOHO_CLIENT_ID ?? '';
    const redirectUri = encodeURIComponent(`${window.location.origin}/connections/zoho/callback`);
    const scope       = encodeURIComponent('ZohoBooks.fullaccess.all');
    window.open(
      `https://accounts.zoho.in/oauth/v2/auth?response_type=code&client_id=${clientId}&scope=${scope}&redirect_uri=${redirectUri}&access_type=offline&state=${encodeURIComponent(JSON.stringify({ orgId: zohoOrgId, clientName: zohoName }))}`,
      'zoho-oauth',
      'width=600,height=700',
    );
  };

  // ── Tally ─────────────────────────────────────────────────────────────────────

  const handleTestTally = async () => {
    setTallyTesting(true);
    try {
      const res  = await fetch(`${API}/api/connections/tally/companies?server_ip=${tallyIp}&port=${tallyPort}`);
      const data = await res.json();
      if (data.connected) {
        setTallyCompanies(data.companies ?? []);
        if (data.companies?.length) setTallyCompany(data.companies[0]);
        toast.success(`Tally connected — ${data.companies?.length ?? 0} companies found`);
      } else {
        toast.error('Cannot reach Tally — check IP and port');
      }
    } catch {
      toast.error('Tally connection test failed');
    } finally {
      setTallyTesting(false);
    }
  };

  const handleConnectTally = async () => {
    if (!tallyCompany || !tallyName) { toast.error('Select a company and enter client name'); return; }
    try {
      const res  = await fetch(`${API}/api/connections/tally/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: tallyName, server_ip: tallyIp, port: tallyPort, company_name: tallyCompany }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('TallyPrime connected!');
        setTallyName(''); setTallyCompanies([]);
        void loadConnections();
      } else {
        toast.error(data.detail ?? 'Connection failed');
      }
    } catch {
      toast.error('Failed to connect Tally');
    }
  };

  // ── Sync / disconnect ────────────────────────────────────────────────────────

  const handleSync = async (conn: Connection) => {
    setBusy(b => ({ ...b, [conn.id]: true }));
    try {
      const url = `${API}/api/connections/${conn.erp_type}/sync/${conn.id}`;
      const res  = await fetch(url, { method: 'POST' });
      const data = await res.json();
      toast.success(`Sync complete — ${data.results?.invoices ?? 0} invoices, ${data.results?.je ?? 0} JEs`);
      void loadConnections();
      void loadLogs(conn.id);
    } catch {
      toast.error('Sync failed');
    } finally {
      setBusy(b => ({ ...b, [conn.id]: false }));
    }
  };

  const handleDisconnect = async (connId: string) => {
    if (!confirm('Disconnect this ERP? Existing data is not deleted.')) return;
    try {
      await fetch(`${API}/api/connections/${connId}`, { method: 'DELETE' });
      toast.success('Connection removed');
      void loadConnections();
    } catch {
      toast.error('Failed to disconnect');
    }
  };

  const toggleLogs = (connId: string) => {
    const open = !logsOpen[connId];
    setLogsOpen(l => ({ ...l, [connId]: open }));
    if (open && !logs[connId]) void loadLogs(connId);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const zohoConn  = connections.find(c => c.erp_type === 'zoho');
  const tallyConn = connections.find(c => c.erp_type === 'tally');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Plug className="w-6 h-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-white">ERP Connections</h1>
        </div>
        <p className="text-slate-400 text-sm">
          Connect your accounting system once. Data syncs automatically to AP Invoices and JE Analysis.
        </p>
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm">Loading connections…</div>
      ) : (
        <>
          {/* Connection cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

            {/* ── Zoho Books card ── */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-white">Zoho Books</span>
                    {zohoConn ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/40 px-2 py-0.5 rounded">
                        <CheckCircle className="w-3 h-3" /> Connected
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                        <XCircle className="w-3 h-3" /> Not connected
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Cloud accounting — bills &amp; journal entries</p>
                </div>
              </div>

              {zohoConn ? (
                <div className="space-y-3">
                  <div className="text-xs text-slate-400">
                    <span className="text-slate-500">Org ID:</span> {zohoConn.zoho_org_id ?? '—'}
                  </div>
                  <div className="text-xs text-slate-400">
                    <span className="text-slate-500">Last sync:</span>{' '}
                    {fmt(zohoConn.last_sync_at)} <StatusBadge status={zohoConn.last_sync_status} />
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => handleSync(zohoConn)}
                      disabled={busy[zohoConn.id]}
                      className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busy[zohoConn.id] ? 'animate-spin' : ''}`} />
                      {busy[zohoConn.id] ? 'Syncing…' : 'Sync Now'}
                    </button>
                    <button
                      onClick={() => handleDisconnect(zohoConn.id)}
                      className="flex items-center gap-1.5 bg-red-900/50 hover:bg-red-800 text-red-300 text-sm px-3 py-1.5 rounded-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Disconnect
                    </button>
                  </div>
                  <button
                    onClick={() => toggleLogs(zohoConn.id)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 mt-1"
                  >
                    {logsOpen[zohoConn.id] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    Sync history
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
                    placeholder="Client / company name"
                    value={zohoName}
                    onChange={e => setZohoName(e.target.value)}
                  />
                  <input
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
                    placeholder="Zoho Organization ID"
                    value={zohoOrgId}
                    onChange={e => setZohoOrgId(e.target.value)}
                  />
                  <button
                    onClick={handleConnectZoho}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm py-2 rounded-lg font-medium"
                  >
                    Connect with Zoho →
                  </button>
                  <p className="text-[11px] text-slate-500">
                    Opens Zoho OAuth. You will be redirected back after authorising.
                  </p>
                </div>
              )}
            </div>

            {/* ── TallyPrime card ── */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-white">TallyPrime</span>
                    {tallyConn ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/40 px-2 py-0.5 rounded">
                        <CheckCircle className="w-3 h-3" /> Connected
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                        <XCircle className="w-3 h-3" /> Not connected
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Desktop ERP — XML gateway on localhost:9000</p>
                </div>
              </div>

              {tallyConn ? (
                <div className="space-y-3">
                  <div className="text-xs text-slate-400">
                    <span className="text-slate-500">Company:</span> {tallyConn.tally_company_name ?? '—'}
                    {' '}· {tallyConn.tally_server_ip}:{tallyConn.tally_port}
                  </div>
                  <div className="text-xs text-slate-400">
                    <span className="text-slate-500">Last sync:</span>{' '}
                    {fmt(tallyConn.last_sync_at)} <StatusBadge status={tallyConn.last_sync_status} />
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => handleSync(tallyConn)}
                      disabled={busy[tallyConn.id]}
                      className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busy[tallyConn.id] ? 'animate-spin' : ''}`} />
                      {busy[tallyConn.id] ? 'Syncing…' : 'Sync Now'}
                    </button>
                    <button
                      onClick={() => handleDisconnect(tallyConn.id)}
                      className="flex items-center gap-1.5 bg-red-900/50 hover:bg-red-800 text-red-300 text-sm px-3 py-1.5 rounded-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Disconnect
                    </button>
                  </div>
                  <button
                    onClick={() => toggleLogs(tallyConn.id)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 mt-1"
                  >
                    {logsOpen[tallyConn.id] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    Sync history
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
                    placeholder="Client / company name"
                    value={tallyName}
                    onChange={e => setTallyName(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <input
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                      placeholder="Server IP"
                      value={tallyIp}
                      onChange={e => setTallyIp(e.target.value)}
                    />
                    <input
                      className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                      placeholder="Port"
                      type="number"
                      value={tallyPort}
                      onChange={e => setTallyPort(Number(e.target.value))}
                    />
                  </div>
                  <button
                    onClick={handleTestTally}
                    disabled={tallyTesting}
                    className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg"
                  >
                    {tallyTesting ? 'Testing…' : 'Test Connection'}
                  </button>
                  {tallyCompanies.length > 0 && (
                    <>
                      <select
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                        value={tallyCompany}
                        onChange={e => setTallyCompany(e.target.value)}
                      >
                        {tallyCompanies.map(c => <option key={c}>{c}</option>)}
                      </select>
                      <button
                        onClick={handleConnectTally}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm py-2 rounded-lg font-medium"
                      >
                        Connect TallyPrime →
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Sync history tables ── */}
          {connections.map(conn => logsOpen[conn.id] && logs[conn.id] && (
            <div key={conn.id} className="mb-6 bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-sm font-semibold text-white mb-3 capitalize">{conn.erp_type} — Sync History</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-slate-300">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="text-left py-2 pr-4">Date / Time</th>
                      <th className="text-left py-2 pr-4">Type</th>
                      <th className="text-right py-2 pr-4">Fetched</th>
                      <th className="text-right py-2 pr-4">Anomalies</th>
                      <th className="text-left py-2 pr-4">Status</th>
                      <th className="text-left py-2">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs[conn.id].map(log => {
                      const duration = log.completed_at
                        ? `${Math.round((new Date(log.completed_at).getTime() - new Date(log.started_at).getTime()) / 1000)}s`
                        : '—';
                      return (
                        <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="py-1.5 pr-4">{fmt(log.started_at)}</td>
                          <td className="py-1.5 pr-4 capitalize">{log.sync_type}</td>
                          <td className="py-1.5 pr-4 text-right">{log.records_fetched}</td>
                          <td className="py-1.5 pr-4 text-right">
                            {log.anomalies_found > 0
                              ? <span className="text-orange-400">{log.anomalies_found}</span>
                              : 0}
                          </td>
                          <td className="py-1.5 pr-4"><StatusBadge status={log.status} /></td>
                          <td className="py-1.5 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-500" /> {duration}
                          </td>
                        </tr>
                      );
                    })}
                    {logs[conn.id].length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-4 text-center text-slate-500">No sync history yet</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {logs[conn.id].some(l => l.error_message) && (
                <div className="mt-3 p-3 bg-red-950/40 border border-red-900/50 rounded-lg">
                  <p className="text-xs text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {logs[conn.id].find(l => l.error_message)?.error_message}
                  </p>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
