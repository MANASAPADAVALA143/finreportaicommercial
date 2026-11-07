import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Play, RefreshCw } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { aiCfoApi } from '../../services/aiCfo.service';
import { aiCloseApi, type CloseRun, type CloseRunSummary, type SelectableAgent } from '../../services/aiClose.service';
import { ErrorBanner, errorText } from '../internal-audit/shared';
import { Card, GOLD, NAVY, StatusPill } from './parts';
import {
  AgentCard, CloseApproval, Deliverables, ExceptionsTable, ExecutionSequence, JournalApprovalCentre, KpiGrid, fmtTime,
} from './closeParts';

const AGENT_OPTIONS: { value: SelectableAgent; label: string; note: string }[] = [
  { value: 'bank_reconciliation', label: 'Bank Reconciliation Agent', note: 'Matches statements to the ledger, proposes fee and interest journals' },
  { value: 'ar_intelligence', label: 'AR Intelligence Agent', note: 'Ageing, overdue follow-ups, AR control check' },
  { value: 'fpa', label: 'FP&A Agent', note: 'Budget vs actual and a 30/60/90-day cash forecast (uses AR)' },
];
const PHASE_B = ['AP Agent', 'IFRS Agent', 'Consolidation Agent'];
const POLL_MS = 2000;

export default function ExecutiveSummaryPage() {
  const { activeCompanyId, activeCompany, loading: companiesLoading, loadCompanies, setActiveCompany } = useCompany();
  const companyId = activeCompanyId ?? '';
  const currency = activeCompany?.base_currency || 'AED';
  const [run, setRun] = useState<CloseRun | null>(null);
  const [history, setHistory] = useState<CloseRunSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('');
  const [selected, setSelected] = useState<SelectableAgent[]>(AGENT_OPTIONS.map((a) => a.value));
  const [busy, setBusy] = useState<'' | 'start' | 'seed'>('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const active = run?.status === 'queued' || run?.status === 'running';

  const load = useCallback(async (id?: number) => {
    if (!companyId) return;
    try {
      const [next, runs] = await Promise.all([id ? aiCloseApi.run(companyId, id) : aiCloseApi.latest(companyId), aiCloseApi.runs(companyId)]);
      setRun(next);
      setHistory(runs);
      setPeriod((p) => p || next?.period || '');
    } catch (e) {
      setError(errorText(e, 'Failed to load the close'));
    } finally {
      setLoaded(true);
    }
  }, [companyId]);

  useEffect(() => {
    setRun(null);
    setHistory([]);
    setPeriod('');
    setLoaded(false);
    void load();
  }, [load]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (active && run) timer.current = setTimeout(() => void load(run.id), POLL_MS);
    return () => clearTimeout(timer.current);
  }, [active, run, load]);

  const start = async () => {
    setBusy('start');
    setError('');
    try {
      const created = await aiCloseApi.start(companyId, { period: period || undefined, agents: selected });
      setRun(created);
      await load(created.id);
    } catch (e) {
      setError(errorText(e, 'Could not start the close'));
    } finally {
      setBusy('');
    }
  };

  const seedDemo = async () => {
    if (!window.confirm('Create (or rebuild) the synthetic demo company in this workspace? Your real companies are not changed.')) return;
    setBusy('seed');
    setError('');
    try {
      const res = await aiCfoApi.seedDemo(companyId);
      await loadCompanies();
      setActiveCompany(res.company_id);
    } catch (e) {
      setError(errorText(e, 'Could not create the demo company'));
    } finally {
      setBusy('');
    }
  };

  if (!companyId) {
    return (
      <div className="p-6">
        <div className="rounded-xl border-2 border-dashed border-slate-300 py-16 text-center text-sm text-slate-500">
          {companiesLoading ? 'Loading companies…' : 'Select a company in the top banner to open the month-end close.'}
        </div>
      </div>
    );
  }

  const isDemo = activeCompany?.company_name?.includes('(synthetic data)');
  const fresh = run?.freshness_json;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="px-6 py-5" style={{ background: NAVY }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${GOLD}26` }}>
              <Bot className="h-5 w-5" style={{ color: GOLD }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">AI Finance Executive Summary</h1>
              <p className="text-xs text-slate-300">
                {activeCompany?.company_name} · month-end close orchestrated by NEXUS · every figure comes from a recorded agent run
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/ai-cfo" className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">AI CFO Command Centre</Link>
            <button onClick={() => void load(run?.id)} aria-label="Refresh" className="rounded-md border border-white/20 p-2 text-slate-200 hover:bg-white/10">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-6">
        {isDemo && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            <span className="font-semibold">Synthetic demo company.</span> Ledger, bank statements and invoices are generated sample data; the agents running on them are the real ones.
          </div>
        )}
        <ErrorBanner message={error} />

        <Card title="Run Month-End Close">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {AGENT_OPTIONS.map((a) => (
                  <label key={a.value} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50" title={a.note}>
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected.includes(a.value)}
                      onChange={(e) => setSelected((s) => (e.target.checked ? [...s, a.value] : s.filter((x) => x !== a.value)))}
                    />
                    <span><span className="font-medium text-slate-800">{a.label}</span><span className="block text-xs text-slate-500">{a.note}</span></span>
                  </label>
                ))}
                <span className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Close Manager Agent always runs last</span>
              </div>
              <p className="text-xs text-slate-400">Coming in phase B, not run: {PHASE_B.join(', ')}.</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-600">
                Period
                <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
              <button
                onClick={() => void start()}
                disabled={busy !== '' || active || selected.length === 0}
                className="flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50"
                style={{ background: GOLD }}
              >
                <Play className="h-4 w-4" /> {active ? 'Close running…' : busy === 'start' ? 'Starting…' : 'Run Month-End Close'}
              </button>
            </div>
          </div>
          {!isDemo && (
            <p className="mt-3 text-xs text-slate-500">
              No data yet?{' '}
              <button onClick={() => void seedDemo()} disabled={busy !== ''} className="font-medium text-slate-700 underline disabled:opacity-50">
                {busy === 'seed' ? 'Building demo…' : 'Load the synthetic demo company'}
              </button>{' '}
              (seven months of ledger, bank statements and invoices with planted issues).
            </p>
          )}
        </Card>

        {loaded && !run && <p className="text-sm text-slate-500">No close has been run for this company yet.</p>}

        {run && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
              <span className="text-sm font-semibold text-slate-900">Close run #{run.id} · {run.period}</span>
              <StatusPill value={run.status} />
              <span>Requested by {run.requested_by ?? '—'} · started {fmtTime(run.started_at)} · finished {fmtTime(run.finished_at)}</span>
              {fresh && (
                <span title={`Captured ${fmtTime(fresh.captured_at)}`}>
                  Data as of: journals {fresh.last_posted_journal ?? 'none'} · bank statement {fresh.last_bank_statement ?? 'none'} · invoices {fresh.last_sales_invoice ?? 'none'}
                </span>
              )}
              {history.length > 1 && (
                <select value={run.id} onChange={(e) => void load(Number(e.target.value))} aria-label="Close run" className="ml-auto rounded border border-slate-300 px-2 py-1">
                  {history.map((h) => <option key={h.id} value={h.id}>#{h.id} · {h.period} · {h.status.replace(/_/g, ' ')}</option>)}
                </select>
              )}
            </div>
            {run.error && <ErrorBanner message={`Run failed: ${run.error}`} />}

            <KpiGrid kpis={run.kpis} />

            <Card title="Execution sequence">
              <ExecutionSequence run={run} />
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {run.tasks.map((t) => <AgentCard key={`${run.id}-${t.id}-${t.status}`} task={t} companyId={companyId} runId={run.id} />)}
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card title={`Journal Approval Centre (${run.proposals.filter((p) => p.status === 'pending_approval').length} pending)`}>
                <JournalApprovalCentre proposals={run.proposals} companyId={companyId} currency={currency} onChange={() => void load(run.id)} onError={setError} />
              </Card>
              <CloseApproval run={run} companyId={companyId} onChange={() => void load(run.id)} onError={setError} />
            </div>

            <Card title="Deliverables">
              <Deliverables run={run} companyId={companyId} onError={setError} />
            </Card>

            <Card title="Exceptions">
              <ExceptionsTable run={run} currency={currency} />
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
