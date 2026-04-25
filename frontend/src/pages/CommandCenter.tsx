import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, X } from 'lucide-react';
import { AgentStatusGrid, type AgentRow } from './AgentStatus';
import { useClient } from '../context/ClientContext';
import { dismissCfoAlert, fetchCompletedAgents, type CompletedAgentItem } from '../services/cfoAgents';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || 'http://localhost:8000';

type Alert = {
  id: number;
  severity: string;
  agent: string;
  title: string;
  body: string | null;
  created_at: string | null;
};

export default function CommandCenter() {
  const { activeClient } = useClient();
  const tenantId = activeClient?.companyId || 'default';
  const hdrs = useMemo(() => ({ 'X-Tenant-ID': tenantId }), [tenantId]);

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [completed, setCompleted] = useState<CompletedAgentItem[]>([]);
  const [briefing, setBriefing] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [chatQ, setChatQ] = useState('');
  const [chatA, setChatA] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [auditJson, setAuditJson] = useState<string | null>(null);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const sal = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return `${sal} · ${t}`;
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [st, al, br, co] = await Promise.all([
        fetch(`${API_BASE}/api/agents/status`, { headers: hdrs }),
        fetch(`${API_BASE}/api/agents/alerts`, { headers: hdrs }),
        fetch(`${API_BASE}/api/briefing/today`, { headers: hdrs }),
        fetchCompletedAgents(24, tenantId),
      ]);
      if (!st.ok) throw new Error(await st.text());
      if (!al.ok) throw new Error(await al.text());
      if (!br.ok) throw new Error(await br.text());
      const sj = await st.json();
      const aj = await al.json();
      const bj = await br.json();
      setAgents(sj.agents || []);
      setAlerts(aj.alerts || []);
      setCompleted(co.completed || []);
      setBriefing(bj.content && typeof bj.content === 'object' ? (bj.content as Record<string, unknown>) : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [hdrs, tenantId]);

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

  const genBriefing = async () => {
    setBusy('briefing');
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/briefing/generate`, {
        method: 'POST',
        headers: { ...hdrs },
      });
      if (!r.ok) throw new Error(await r.text());
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const askNexus = async () => {
    const q = chatQ.trim();
    if (!q) return;
    setChatBusy(true);
    setChatA(null);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/briefing/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...hdrs },
        body: JSON.stringify({ question: q }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setChatA(typeof j.answer === 'string' ? j.answer : JSON.stringify(j));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setChatBusy(false);
    }
  };

  const onDismissAlert = async (id: number) => {
    try {
      await dismissCfoAlert(id, tenantId);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const openAuditTrail = async (runId: string) => {
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/agents/runs/${encodeURIComponent(runId)}`, { headers: hdrs });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setAuditJson(JSON.stringify(j, null, 2));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const urgentAlerts = alerts.filter((a) => a.severity === 'urgent');
  const warnAlerts = alerts.filter((a) => a.severity !== 'urgent');
  const nexus = briefing && typeof briefing === 'object' ? (briefing as { nexus_json?: Record<string, unknown> }).nexus_json : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100">
      {auditJson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog">
          <div className="max-w-3xl w-full max-h-[85vh] rounded-xl border border-slate-600 bg-slate-900 shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-600 px-4 py-2">
              <span className="text-sm font-semibold text-white">Audit trail (run)</span>
              <button type="button" onClick={() => setAuditJson(null)} className="p-1 rounded hover:bg-slate-800 text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <pre className="text-xs overflow-auto p-4 text-emerald-100/90 flex-1">{auditJson}</pre>
          </div>
        </div>
      )}

      <div className="border-b border-slate-700 bg-slate-900/60">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-slate-400 text-sm">FinReportAI · AGENTIC · tenant: {tenantId}</p>
            <h1 className="text-2xl font-bold text-white">{greeting}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void genBriefing()}
              disabled={busy === 'briefing'}
              className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 disabled:opacity-50"
            >
              {busy === 'briefing' ? 'Building…' : 'Generate briefing'}
            </button>
            <Link to="/dashboard" className="px-3 py-2 rounded-lg border border-slate-600 text-sm text-slate-200 hover:bg-slate-800">
              Dashboard
            </Link>
            <Link to="/agent-status" className="px-3 py-2 rounded-lg border border-slate-600 text-sm text-slate-200 hover:bg-slate-800">
              Agents only
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {err && (
          <div className="rounded-lg border border-red-800 bg-red-950/40 text-red-200 text-sm p-3">{err}</div>
        )}

        <section>
          <h2 className="text-lg font-semibold text-red-300 mb-3">Urgent</h2>
          <div className="rounded-xl border border-red-900/60 bg-red-950/20 p-4 space-y-2 min-h-[4rem]">
            {urgentAlerts.length === 0 ? (
              <p className="text-slate-500 text-sm">No urgent items. JE high-risk flags appear here.</p>
            ) : (
              urgentAlerts.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-red-900/30 pb-2 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium text-red-100">{a.title}</p>
                    <p className="text-xs text-slate-400">{a.agent}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Link to="/r2r-pattern" className="text-xs text-red-200 underline">
                      Open R2R →
                    </Link>
                    <button
                      type="button"
                      onClick={() => void onDismissAlert(a.id)}
                      className="text-xs px-2 py-1 rounded border border-red-800 text-red-100 hover:bg-red-950/50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-amber-200 mb-3">Attention</h2>
          <div className="rounded-xl border border-amber-900/40 bg-amber-950/10 p-4 space-y-2">
            {warnAlerts.length === 0 ? (
              <p className="text-slate-500 text-sm">No warnings. Variance / budget / recon alerts land here.</p>
            ) : (
              warnAlerts.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 text-sm text-amber-50 border-b border-amber-900/20 pb-2 last:border-0"
                >
                  <div>
                    <span className="text-slate-400 text-xs mr-2">{a.agent}</span>
                    {a.title}
                  </div>
                  <button
                    type="button"
                    onClick={() => void onDismissAlert(a.id)}
                    className="text-xs px-2 py-1 rounded border border-amber-800 text-amber-100 hover:bg-amber-950/40 shrink-0 self-start"
                  >
                    Dismiss
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-emerald-300 mb-3">Completed (last 24h)</h2>
          <p className="text-xs text-slate-500 mb-3">
            Successful agent runs with validation. Variance and R2R flows push here automatically when you use those pages.
          </p>
          <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/10 p-4 space-y-4">
            {completed.length === 0 ? (
              <p className="text-slate-500 text-sm">No completed runs yet in this window.</p>
            ) : (
              completed.map((c) => (
                <CompletedAgentCard key={`${c.run_id}-${c.completed_at}`} item={c} onViewAudit={() => void openAuditTrail(c.run_id)} />
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-emerald-200/90 mb-3">Briefing</h2>
          <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/10 p-4 text-sm text-slate-200 space-y-3">
            {nexus && typeof nexus === 'object' ? (
              <pre className="text-xs overflow-auto max-h-64 text-emerald-100/90 whitespace-pre-wrap">
                {JSON.stringify(nexus, null, 2)}
              </pre>
            ) : (
              <p className="text-slate-500">
                No AI briefing JSON yet. Click <strong>Generate briefing</strong> (requires ANTHROPIC_API_KEY on the
                server). Raw snapshots are still stored in history.
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Agent grid</h2>
          <p className="text-xs text-slate-500 mb-3">
            Manual run (empty context). Prefer running from FP&amp;A variance, R2R Pattern, or Bank Recon so real data
            flows in automatically.
          </p>
          <AgentStatusGrid agents={agents} onTrigger={onTrigger} busy={busy} />
        </section>

        <section className="border-t border-slate-700 pt-6">
          <h2 className="text-lg font-semibold text-indigo-200 mb-2">Ask NEXUS-C</h2>
          <p className="text-xs text-slate-500 mb-2">Uses recent agent summaries and open alerts (server needs ANTHROPIC_API_KEY).</p>
          <div className="flex flex-col gap-2">
            <textarea
              value={chatQ}
              onChange={(e) => setChatQ(e.target.value)}
              rows={3}
              placeholder='e.g. "Why is marketing over budget?"'
              className="w-full rounded-lg bg-slate-950 border border-slate-600 text-slate-100 p-3 text-sm"
            />
            <button
              type="button"
              disabled={chatBusy || !chatQ.trim()}
              onClick={() => void askNexus()}
              className="self-start px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm disabled:opacity-50"
            >
              {chatBusy ? 'Thinking…' : 'Send'}
            </button>
            {chatA && (
              <div className="rounded-lg border border-slate-600 bg-slate-900/80 p-3 text-sm text-slate-200 whitespace-pre-wrap">
                {chatA}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function CompletedAgentCard({ item, onViewAudit }: { item: CompletedAgentItem; onViewAudit: () => void }) {
  const t = item.completed_at ? new Date(item.completed_at).toLocaleString() : '—';
  const cp = item.checks_passed ?? 0;
  const ct = item.checks_total ?? 12;
  const ok = item.all_checks_passed && cp === ct;
  const rows = item.row_count ?? 0;
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-900/50 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-white capitalize">{item.agent.replace(/_/g, ' ')}</span>
        <span className="text-xs text-slate-400 font-mono truncate max-w-[200px]" title={item.run_id}>
          {item.run_id}
        </span>
      </div>
      <p className={`text-sm ${ok ? 'text-emerald-300' : 'text-amber-200'}`}>
        {ok ? '✅ Validated' : '⚠️ Review'} — {cp}/{ct} checks passed
      </p>
      <p className="text-xs text-slate-400">
        Completed: {t}
        {rows > 0 ? ` · Data: ${rows.toLocaleString()} row${rows === 1 ? '' : 's'} processed` : ''}
      </p>
      <button
        type="button"
        onClick={onViewAudit}
        className="text-xs text-indigo-300 hover:text-indigo-200 underline"
      >
        View audit trail
      </button>
    </div>
  );
}
