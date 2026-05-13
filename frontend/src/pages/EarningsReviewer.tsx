import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Loader2,
  Copy,
  Pencil,
  Download,
  Lock,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { backendOrigin } from '../utils/backendOrigin';

type TabKey = 'prior' | 'budget' | 'consensus';

interface CheckRow {
  id: string;
  name: string;
  group: string;
  status: string;
  result_summary: string;
  details?: Record<string, unknown>;
}

interface StatusRes {
  review_id: string;
  status: string;
  quality_score: number | null;
  headline_verdict: string | null;
  variances: {
    group_a?: CheckRow[];
    group_b?: CheckRow[];
    group_c?: CheckRow[];
    revenue_yoy_pct?: number;
    current?: Record<string, number>;
    prior?: Record<string, number>;
    budget?: Record<string, number> | null;
    surprise_score_pct?: number | null;
    quality_band?: string;
  };
  commentary?: { source?: string; full_text?: string; paragraphs?: string[] };
  flags?: { severity: string; metric: string; finding: string; recommendation: string }[];
  snapshot?: { budget?: Record<string, unknown> | null; consensus?: Record<string, unknown> | null };
}

function scoreColor(score: number) {
  if (score >= 85) return 'text-emerald-400';
  if (score >= 70) return 'text-amber-300';
  if (score >= 50) return 'text-orange-400';
  return 'text-red-400';
}

export default function EarningsReviewer() {
  const base = backendOrigin();
  const [companyName, setCompanyName] = useState('Demo Co');
  const [period, setPeriod] = useState('Q1-2026');
  const [periodType, setPeriodType] = useState<'quarterly' | 'annual'>('quarterly');
  const [currency, setCurrency] = useState('INR');
  const [entityId, setEntityId] = useState('demo_entity');
  const [curFile, setCurFile] = useState<File | null>(null);
  const [priFile, setPriFile] = useState<File | null>(null);
  const [budFile, setBudFile] = useState<File | null>(null);
  const [anaFile, setAnaFile] = useState<File | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusRes | null>(null);
  const [tab, setTab] = useState<TabKey>('prior');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approver, setApprover] = useState('');
  const [editCommentary, setEditCommentary] = useState(false);
  const [commentaryDraft, setCommentaryDraft] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<unknown[]>([]);

  const fetchStatus = useCallback(async () => {
    if (!base || !reviewId) return;
    const r = await fetch(`${base}/api/earnings/status/${reviewId}`);
    if (!r.ok) return;
    const j = (await r.json()) as StatusRes;
    setStatus(j);
    const txt = j.commentary?.full_text || '';
    if (txt && !editCommentary) setCommentaryDraft(txt);
  }, [base, reviewId, editCommentary]);

  useEffect(() => {
    if (!reviewId || !base) return;
    const iv = setInterval(() => void fetchStatus(), 3000);
    void fetchStatus();
    return () => clearInterval(iv);
  }, [reviewId, base, fetchStatus]);

  const startOnly = async () => {
    setError(null);
    if (!base) {
      setError('Set VITE_API_URL (e.g. http://127.0.0.1:8000).');
      return;
    }
    if (!curFile || !priFile) {
      setError('Current and prior period P&L files are required.');
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('entity_id', entityId);
      fd.append('period', period);
      fd.append('period_type', periodType);
      fd.append('currency', currency);
      fd.append('company_name', companyName);
      fd.append('current_period_file', curFile);
      fd.append('prior_period_file', priFile);
      if (budFile) fd.append('budget_file', budFile);
      if (anaFile) fd.append('analyst_file', anaFile);
      const r = await fetch(`${base}/api/earnings/start`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setReviewId(j.review_id as string);
      setStatus({ review_id: j.review_id, status: 'started', variances: {}, quality_score: null, headline_verdict: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const runAnalysis = async () => {
    if (!base || !reviewId) {
      setError('Start a review first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${base}/api/earnings/run/${reviewId}`, { method: 'POST' });
      if (!r.ok) throw new Error(await r.text());
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const copyCommentary = () => {
    void navigator.clipboard.writeText(commentaryDraft || status?.commentary?.full_text || '');
  };

  const approve = async () => {
    if (!base || !reviewId) return;
    const r = await fetch(`${base}/api/earnings/approve/${reviewId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approver: approver || 'CFO' }),
    });
    if (r.ok) void fetchStatus();
  };

  const loadHistory = async () => {
    if (!base) return;
    const r = await fetch(`${base}/api/earnings/history?entity_id=${encodeURIComponent(entityId)}`);
    if (r.ok) {
      const j = await r.json();
      setHistory(j.reviews || []);
      setShowHistory(true);
    }
  };

  const v = status?.variances || {};
  const snap = status?.snapshot;
  const hasBudget = snap?.budget != null || v.budget != null;
  const consKeys = (v as { consensus_keys?: string[] }).consensus_keys;
  const hasConsensus = snap?.consensus != null || (consKeys != null && consKeys.length > 0);
  const qs = status?.quality_score ?? 0;
  const cur = v.current || {};
  const headline = status?.headline_verdict || '—';

  const cardsForTab = (): CheckRow[] => {
    if (tab === 'prior') return v.group_a || [];
    if (tab === 'budget') return v.group_b || [];
    return v.group_c || [];
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <TrendingUp className="h-7 w-7 text-violet-400" aria-hidden />
              Earnings reviewer
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              IFRS-oriented variance review vs prior period, budget, and analyst consensus — with earnings quality score and CFO commentary.
            </p>
          </div>
          <Link to="/fpa" className="text-sm text-violet-400 hover:underline self-start">
            ← FP&amp;A suite
          </Link>
        </header>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
        )}

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-6 space-y-4">
          <h2 className="text-lg font-medium">Setup</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm block">
              <span className="text-slate-400">Company name</span>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm block">
              <span className="text-slate-400">Entity ID</span>
              <input
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm block">
              <span className="text-slate-400">Period (e.g. Q1-2026)</span>
              <input
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm block">
              <span className="text-slate-400">Period type</span>
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value as 'quarterly' | 'annual')}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label className="text-sm block sm:col-span-2">
              <span className="text-slate-400">Reporting currency</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-3 py-3 text-sm">
              <span className="text-slate-400">Current period P&amp;L (required)</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="mt-1 text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1"
                onChange={(e) => setCurFile(e.target.files?.[0] || null)}
              />
              {curFile && <span className="text-xs text-emerald-400 mt-1">{curFile.name}</span>}
            </label>
            <label className="flex flex-col rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-3 py-3 text-sm">
              <span className="text-slate-400">Prior period P&amp;L (required)</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="mt-1 text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1"
                onChange={(e) => setPriFile(e.target.files?.[0] || null)}
              />
              {priFile && <span className="text-xs text-emerald-400 mt-1">{priFile.name}</span>}
            </label>
            <label className="flex flex-col rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-3 py-3 text-sm">
              <span className="text-slate-400">Budget / forecast (optional)</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="mt-1 text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1"
                onChange={(e) => setBudFile(e.target.files?.[0] || null)}
              />
              {budFile && <span className="text-xs text-emerald-400 mt-1">{budFile.name}</span>}
            </label>
            <label
              className="flex flex-col rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-3 py-3 text-sm"
              title="CSV columns: Metric, Consensus_Estimate, Unit"
            >
              <span className="text-slate-400">
                Analyst consensus CSV (optional){' '}
                <span className="text-slate-500">— Metric, Consensus_Estimate, Unit</span>
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="mt-1 text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1"
                onChange={(e) => setAnaFile(e.target.files?.[0] || null)}
              />
              {anaFile && <span className="text-xs text-emerald-400 mt-1">{anaFile.name}</span>}
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => void startOnly()}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium hover:bg-violet-500 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Start review
            </button>
            <button
              type="button"
              disabled={loading || !reviewId}
              onClick={() => void runAnalysis()}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-500/50 px-4 py-2.5 text-sm hover:bg-violet-950/50 disabled:opacity-40"
            >
              Run analysis
            </button>
            <button
              type="button"
              onClick={() => void fetchStatus()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>
        </section>

        {status?.status === 'complete' && (
          <>
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-6">
              <h2 className="text-lg font-medium mb-4">Earnings quality</h2>
              <div className="flex flex-col md:flex-row md:items-end gap-6">
                <div>
                  <p className="text-xs uppercase text-slate-500">Quality score</p>
                  <p className={`text-5xl font-bold tabular-nums ${scoreColor(qs)}`}>{qs.toFixed(0)}</p>
                  <p className="text-sm text-slate-400 mt-1">Band: {v.quality_band || '—'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500">Headline</p>
                  <p className="text-2xl font-semibold text-white">{headline}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-6">
                <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs">
                  Turnover YoY:{' '}
                  <strong className={v.revenue_yoy_pct != null && v.revenue_yoy_pct < 0 ? 'text-red-300' : 'text-emerald-300'}>
                    {v.revenue_yoy_pct != null ? `${v.revenue_yoy_pct.toFixed(1)}%` : '—'}
                  </strong>
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs">
                  EBITDA margin: <strong>{cur.ebitda_margin_pct != null ? `${cur.ebitda_margin_pct.toFixed(1)}%` : '—'}</strong>
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs">
                  Score: <strong>{qs.toFixed(0)}/100</strong>
                </span>
              </div>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-6">
              <h2 className="text-lg font-medium mb-3">Variance dashboard</h2>
              <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-2 mb-4">
                {(
                  [
                    ['prior', 'vs Prior'],
                    ['budget', 'vs Budget'],
                    ['consensus', 'vs Consensus'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTab(k)}
                    disabled={(k === 'budget' && !hasBudget) || (k === 'consensus' && !hasConsensus)}
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      tab === k ? 'bg-violet-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                    } ${(k === 'budget' && !hasBudget) || (k === 'consensus' && !hasConsensus) ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {label}
                    {k === 'budget' && !hasBudget ? ' (no file)' : ''}
                    {k === 'consensus' && !hasConsensus ? ' (no file)' : ''}
                  </button>
                ))}
              </div>
              <ul className="space-y-2">
                {cardsForTab().map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2"
                  >
                    <div>
                      <p className="font-medium text-slate-100">
                        {c.id} — {c.name}
                      </p>
                      <p className="text-sm text-slate-400 mt-1">{c.result_summary}</p>
                    </div>
                    <span
                      className={`shrink-0 text-xs px-2 py-0.5 rounded-full border ${
                        c.status === 'passed'
                          ? 'border-emerald-500/40 text-emerald-300'
                          : c.status === 'check_error'
                            ? 'border-violet-500/40 text-violet-200'
                            : 'border-amber-500/40 text-amber-200'
                      }`}
                    >
                      {c.status}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl border border-violet-900/40 bg-violet-950/20 p-4 md:p-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-medium text-violet-100">CFO commentary (AI-generated)</h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={copyCommentary}
                    className="inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-xs"
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditCommentary((e) => !e)}
                    className="inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-xs"
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-500">Source: {status.commentary?.source || '—'}</p>
              {editCommentary ? (
                <textarea
                  value={commentaryDraft}
                  onChange={(e) => setCommentaryDraft(e.target.value)}
                  rows={12}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                />
              ) : (
                <div className="prose prose-invert max-w-none text-sm text-slate-300 whitespace-pre-wrap">
                  {commentaryDraft || status.commentary?.full_text || '—'}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-6 space-y-4">
              <h2 className="text-lg font-medium flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
                Red flags &amp; actions
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-800">
                      <th className="py-2 pr-2">Severity</th>
                      <th className="py-2 pr-2">Metric</th>
                      <th className="py-2 pr-2">Finding</th>
                      <th className="py-2">Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(status.flags || []).map((f, i) => (
                      <tr key={i} className="border-b border-slate-800/80">
                        <td className="py-2 pr-2 capitalize">{f.severity}</td>
                        <td className="py-2 pr-2">{f.metric}</td>
                        <td className="py-2 pr-2">{f.finding}</td>
                        <td className="py-2">{f.recommendation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => reviewId && window.open(`${base}/api/earnings/report/${reviewId}/pdf`, '_blank')}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm"
                >
                  <Download className="h-4 w-4" />
                  Download earnings PDF
                </button>
                <input
                  placeholder="Approver"
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void approve()}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm"
                >
                  <Lock className="h-4 w-4" />
                  Approve &amp; sign off
                </button>
                <button type="button" onClick={() => void loadHistory()} className="text-sm text-violet-400 hover:underline">
                  View history
                </button>
              </div>
              {showHistory && history.length > 0 && (
                <ul className="text-xs text-slate-500 space-y-1 border-t border-slate-800 pt-3 max-h-40 overflow-y-auto">
                  {(history as { review_id: string; period: string; status: string; quality_score: number }[]).map((h) => (
                    <li key={h.review_id}>
                      {h.period} — {h.status} — score {h.quality_score ?? '—'}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {status?.status === 'error' && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            Analysis failed. Check API logs. {(status.variances as { error?: string })?.error}
          </div>
        )}

        {status && status.status !== 'complete' && status.status !== 'error' && reviewId && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            {status.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Status: {status.status} — run analysis or wait for refresh.
          </div>
        )}
      </div>
    </div>
  );
}
