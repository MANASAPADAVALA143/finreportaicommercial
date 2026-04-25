import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useClient } from '../context/ClientContext';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || 'http://localhost:8000';

export type AgentRow = {
  agent: string;
  last_run_at: string | null;
  last_status: string | null;
  last_run_id: string | null;
};

export function AgentStatusGrid({
  agents,
  onTrigger,
  busy,
}: {
  agents: AgentRow[];
  onTrigger: (name: string) => void;
  busy: string | null;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {agents.map((a) => (
        <div
          key={a.agent}
          className="rounded-xl border border-slate-600 bg-slate-800/60 p-4 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-white capitalize">{a.agent.replace(/_/g, ' ')}</span>
            <span className="text-xl" title={a.last_status || ''}>
              {a.last_status === 'completed' ? '✅' : a.last_status === 'needs_review' ? '⚠️' : a.last_status ? '❔' : '—'}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Last run: {a.last_run_at ? new Date(a.last_run_at).toLocaleString() : 'Never'}
          </p>
          {a.last_run_id && (
            <p className="text-xs text-slate-500 font-mono truncate" title={a.last_run_id}>
              {a.last_run_id.slice(0, 8)}…
            </p>
          )}
          <button
            type="button"
            disabled={busy === a.agent}
            onClick={() => onTrigger(a.agent)}
            className="mt-auto text-sm px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy === a.agent ? 'Starting…' : 'Run now'}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function AgentStatusPage() {
  const { activeClient } = useClient();
  const tenantId = activeClient?.companyId || 'default';
  const hdrs = useMemo(() => ({ 'X-Tenant-ID': tenantId }), [tenantId]);

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/agents/status`, { headers: hdrs });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setAgents(j.agents || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [hdrs]);

  useEffect(() => {
    void load();
  }, [load]);

  const onTrigger = async (name: string) => {
    setBusy(name);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/agents/run/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...hdrs },
        body: JSON.stringify({ context: {} }),
      });
      if (!r.ok) throw new Error(await r.text());
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100 p-6">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Agent status</h1>
          <p className="text-slate-400 text-sm">CFO Command Center — specialist agents</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <Link to="/command-center" className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">
            Full briefing →
          </Link>
        </div>
      </div>
      {err && (
        <div className="max-w-5xl mx-auto mb-4 rounded-lg border border-red-800 bg-red-950/40 text-red-200 text-sm p-3">
          {err}
        </div>
      )}
      <div className="max-w-5xl mx-auto">
        <AgentStatusGrid agents={agents} onTrigger={onTrigger} busy={busy} />
      </div>
    </div>
  );
}
