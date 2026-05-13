import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Clock,
  Download,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { backendOrigin } from '../utils/backendOrigin';

type CheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'flagged' | 'check_error';

interface CheckItem {
  id: string;
  name: string;
  description?: string;
  status: CheckStatus;
  result_summary: string;
  time_taken_sec?: number | null;
  details?: Record<string, unknown>;
}

interface StatusPayload {
  run_id: string;
  entity_id: string;
  period: string;
  status: string;
  currency: string;
  progress_pct: number;
  items: CheckItem[];
  integrity: Record<string, unknown>;
  total_seconds?: number | null;
}

function sym(currency: string) {
  return currency?.toUpperCase() === 'INR' ? '₹' : '$';
}

function fmt(n: unknown, currency: string) {
  const v = typeof n === 'number' ? n : Number(n);
  if (Number.isNaN(v)) return `${sym(currency)}0.00`;
  return `${sym(currency)}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Badge({ status }: { status: CheckStatus }) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border';
  switch (status) {
    case 'running':
      return (
        <span className={`${base} border-blue-500/60 bg-blue-500/15 text-blue-200`}>
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Running
        </span>
      );
    case 'passed':
      return (
        <span className={`${base} border-emerald-500/50 bg-emerald-500/10 text-emerald-200`}>
          <CheckCircle2 className="h-3 w-3" aria-hidden />
          Passed
        </span>
      );
    case 'flagged':
      return (
        <span className={`${base} border-amber-500/50 bg-amber-500/10 text-amber-200`}>
          <AlertTriangle className="h-3 w-3" aria-hidden />
          Flagged
        </span>
      );
    case 'failed':
      return (
        <span className={`${base} border-red-500/50 bg-red-500/10 text-red-200`}>
          <XCircle className="h-3 w-3" aria-hidden />
          Failed
        </span>
      );
    case 'check_error':
      return (
        <span className={`${base} border-violet-500/50 bg-violet-500/10 text-violet-200`}>
          <AlertTriangle className="h-3 w-3" aria-hidden />
          Check error
        </span>
      );
    default:
      return (
        <span className={`${base} border-slate-600 bg-slate-800/80 text-slate-300`}>
          <Clock className="h-3 w-3" aria-hidden />
          Pending
        </span>
      );
  }
}

export default function MonthEndClose() {
  const base = backendOrigin();
  const [entityId, setEntityId] = useState('gnanova_demo');
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [currency, setCurrency] = useState('INR');
  const [companyName, setCompanyName] = useState('Demo Entity');
  const [tbFile, setTbFile] = useState<File | null>(null);
  const [jeFile, setJeFile] = useState<File | null>(null);
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [priorFile, setPriorFile] = useState<File | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approver, setApprover] = useState('');
  const [history, setHistory] = useState<unknown[]>([]);

  const periods = useMemo(() => {
    const out: string[] = [];
    for (let y = 2025; y <= 2027; y++) {
      for (let m = 1; m <= 12; m++) {
        out.push(`${y}-${String(m).padStart(2, '0')}`);
      }
    }
    return out;
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!base || !runId) return;
    const r = await fetch(`${base}/api/close/status/${runId}`);
    if (!r.ok) return;
    const j = (await r.json()) as StatusPayload;
    setStatus(j);
  }, [base, runId]);

  useEffect(() => {
    if (!runId || !base) return;
    const t = setInterval(() => {
      void fetchStatus();
    }, 3000);
    void fetchStatus();
    return () => clearInterval(t);
  }, [runId, base, fetchStatus]);

  const loadHistory = async () => {
    if (!base) return;
    const r = await fetch(`${base}/api/close/history?entity_id=${encodeURIComponent(entityId)}`);
    if (r.ok) {
      const j = await r.json();
      setHistory(j.runs || []);
    }
  };

  const startClose = async () => {
    setError(null);
    if (!base) {
      setError('Set VITE_API_URL to your API origin (e.g. http://127.0.0.1:8000).');
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('entity_id', entityId);
      fd.append('period', period);
      fd.append('currency', currency);
      fd.append('company_name', companyName);
      if (tbFile) fd.append('trial_balance_file', tbFile);
      if (jeFile) fd.append('journal_entries_file', jeFile);
      if (bankFile) fd.append('bank_statement_file', bankFile);
      if (priorFile) fd.append('prior_financials_file', priorFile);

      const r = await fetch(`${base}/api/close/start`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      const id = j.run_id as string;
      setRunId(id);

      const r2 = await fetch(`${base}/api/close/run-checks/${id}`, { method: 'POST' });
      if (!r2.ok) throw new Error(await r2.text());
      await fetchStatus();
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const approve = async () => {
    if (!base || !runId) return;
    setError(null);
    try {
      const r = await fetch(`${base}/api/close/approve/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approver: approver || 'CFO' }),
      });
      if (!r.ok) throw new Error(await r.text());
      await fetchStatus();
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const downloadPdf = () => {
    if (!base || !runId) return;
    window.open(`${base}/api/close/report/${runId}/pdf`, '_blank', 'noopener,noreferrer');
  };

  const integ = status?.integrity || {};
  const cur = status?.currency || currency;
  const flaggedCount =
    status?.items?.filter((i) => i.status === 'flagged' || i.status === 'failed' || i.status === 'check_error')
      .length ?? 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Calendar className="h-7 w-7 text-sky-400" aria-hidden />
              Month-end close
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              IFRS-focused close checklist with live status, IAS 1 integrity bridges, and CFO PDF sign-off pack.
            </p>
          </div>
          <Link to="/r2r/pattern" className="text-sm text-sky-400 hover:underline self-start">
            ← Back to R2R
          </Link>
        </header>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Section A */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-6 space-y-4">
          <h2 className="text-lg font-medium text-white">Start close</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-slate-400">Period</span>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">Entity ID</span>
              <input
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">Reporting currency</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-slate-400">Entity / company display name</span>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-3 py-3 text-sm">
              <span className="text-slate-400 mb-1">Trial balance</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="text-xs text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-200"
                onChange={(e) => setTbFile(e.target.files?.[0] || null)}
              />
              {tbFile && <span className="mt-1 text-xs text-emerald-400">{tbFile.name}</span>}
            </label>
            <label className="flex flex-col rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-3 py-3 text-sm">
              <span className="text-slate-400 mb-1">Journal entries</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="text-xs text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-200"
                onChange={(e) => setJeFile(e.target.files?.[0] || null)}
              />
              {jeFile && <span className="mt-1 text-xs text-emerald-400">{jeFile.name}</span>}
            </label>
            <label className="flex flex-col rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-3 py-3 text-sm">
              <span className="text-slate-400 mb-1">Bank statement</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="text-xs text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-200"
                onChange={(e) => setBankFile(e.target.files?.[0] || null)}
              />
              {bankFile && <span className="mt-1 text-xs text-emerald-400">{bankFile.name}</span>}
            </label>
            <label className="flex flex-col rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-3 py-3 text-sm">
              <span className="text-slate-400 mb-1">Prior-period financials (TB)</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="text-xs text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-200"
                onChange={(e) => setPriorFile(e.target.files?.[0] || null)}
              />
              {priorFile && <span className="mt-1 text-xs text-emerald-400">{priorFile.name}</span>}
            </label>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void startClose()}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Start close & run checks
          </button>
        </section>

        {/* Section B */}
        {status && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-medium text-white">Live checklist</h2>
              <button
                type="button"
                onClick={() => void fetchStatus()}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
            </div>
            <p className="text-xs text-slate-500">Auto-refresh every 3s while this tab is open.</p>
            <ul className="space-y-3">
              {status.items?.map((it) => (
                <li
                  key={it.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 md:p-4 transition-shadow data-[run=running]:shadow-[0_0_0_1px_rgba(56,189,248,0.35)]"
                  data-run={it.status === 'running' ? 'running' : ''}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium text-slate-100">{it.name}</p>
                      {it.description && <p className="text-xs text-slate-500 mt-0.5">{it.description}</p>}
                      {it.result_summary && (
                        <p className="text-sm text-slate-300 mt-2 leading-relaxed">{it.result_summary}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-start gap-1 sm:items-end shrink-0">
                      <Badge status={it.status} />
                      {it.time_taken_sec != null && (
                        <span className="text-[11px] text-slate-500">{it.time_taken_sec}s</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Section C */}
        {status && Object.keys(integ).length > 0 && (
          <section className="rounded-xl border border-sky-900/50 bg-sky-950/20 p-4 md:p-6 space-y-4">
            <h2 className="text-lg font-medium text-sky-100">Three-statement integrity (IAS 1)</h2>
            <div className="grid gap-4 md:grid-cols-2 text-sm">
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-1">
                <p className="text-slate-400 text-xs uppercase tracking-wide">Profit or loss (PAT)</p>
                <p className="text-lg font-mono text-white">{fmt(integ.pl_net_income, cur)}</p>
                <p className="text-slate-400 text-xs mt-2">Retained earnings (closing)</p>
                <p className="font-mono text-slate-200">{fmt(integ.retained_earnings_closing, cur)}</p>
                <p className="text-xs mt-2">
                  RE bridge variance: {fmt(integ.re_bridge_variance, cur)}{' '}
                  <span className={integ.re_bridge_ok ? 'text-emerald-400' : 'text-amber-300'}>
                    {integ.re_bridge_ok ? 'Match' : 'Review'}
                  </span>
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-1">
                <p className="text-slate-400 text-xs uppercase tracking-wide">Cash roll-forward</p>
                <p className="text-slate-300">
                  Opening {fmt(integ.cash_opening, cur)} + movements {fmt(integ.cash_flow_net_increase, cur)} →
                  expected {fmt(integ.cash_expected_closing, cur)}
                </p>
                <p className="text-slate-300">BS cash {fmt(integ.cash_closing_bs, cur)}</p>
                <p className="text-xs mt-2">
                  Variance {fmt(integ.cash_bridge_variance, cur)}{' '}
                  <span className={integ.cash_bridge_ok ? 'text-emerald-400' : 'text-amber-300'}>
                    {integ.cash_bridge_ok ? 'Match' : 'Review'}
                  </span>
                </p>
              </div>
              <div className="md:col-span-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <p className="text-slate-400 text-xs uppercase tracking-wide">Statement of financial position</p>
                <p className="text-sm text-slate-200 mt-1">
                  Total assets {fmt(integ.total_assets, cur)} vs total liabilities + equity{' '}
                  {fmt(integ.total_liabilities_plus_equity, cur)} — variance {fmt(integ.balance_sheet_variance, cur)}
                </p>
                <p className={`text-sm mt-2 ${integ.balance_sheet_ok ? 'text-emerald-400' : 'text-amber-300'}`}>
                  {integ.balance_sheet_ok ? 'Balanced within rounding' : 'Out of balance — review mapping and TB'}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Section D */}
        {status && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-6 space-y-4">
            <h2 className="text-lg font-medium text-white">Summary &amp; actions</h2>
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-slate-400">
                <span>Progress</span>
                <span>{status.progress_pct ?? 0}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, status.progress_pct ?? 0)}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-slate-300">
                <span>Total time: {status.total_seconds ?? '—'}s</span>
                <span>Flagged / error checks: {flaggedCount}</span>
                <span>Run status: {status.status}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={downloadPdf}
                disabled={!runId}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-40"
              >
                <Download className="h-4 w-4" />
                Download close report PDF
              </button>
              <div className="flex flex-1 flex-col sm:flex-row gap-2 sm:items-center">
                <input
                  placeholder="Approver name"
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm flex-1 min-w-0"
                />
                <button
                  type="button"
                  onClick={() => void approve()}
                  disabled={!runId}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium hover:bg-emerald-600 disabled:opacity-40"
                >
                  <Lock className="h-4 w-4" />
                  Approve &amp; lock period
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="text-sm text-sky-400 hover:underline"
            >
              View close history
            </button>
            {history.length > 0 && (
              <ul className="text-xs text-slate-400 space-y-1 border-t border-slate-800 pt-3 max-h-40 overflow-y-auto">
                {(history as { run_id: string; period: string; status: string; total_seconds?: number }[]).map(
                  (h) => (
                    <li key={h.run_id}>
                      {h.period} — {h.status}
                      {h.total_seconds != null ? ` — ${h.total_seconds}s` : ''}
                    </li>
                  )
                )}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
