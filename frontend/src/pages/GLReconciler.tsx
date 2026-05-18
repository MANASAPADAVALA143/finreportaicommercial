import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  GitMerge,
  Loader2,
  Download,
  Lock,
  RefreshCw,
  FileDown,
} from 'lucide-react';
import { backendOrigin } from '../utils/backendOrigin';

type MatchTab = 'exact' | 'near' | 'suggested';
type UnTab = 'gl' | 'bank';

interface Summary {
  reconciliation_status?: string;
  match_rate_pct?: number;
  matched_count?: number;
  matched_amount?: number;
  unmatched_gl_count?: number;
  unmatched_bank_count?: number;
  gl_total?: number;
  bank_net_change?: number;
  difference?: number;
}

interface MatchRow {
  layer?: number;
  confidence?: number;
  confidence_label?: string;
  gl_date?: string;
  gl_ref?: string;
  gl_desc?: string;
  bank_date?: string;
  bank_ref?: string;
  bank_desc?: string;
  amount?: number;
}

function fmtIn(n: number | undefined, inr: boolean) {
  const v = n ?? 0;
  if (!inr) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const s = Math.round(Math.abs(v)).toString();
  if (s.length <= 3) return `${v < 0 ? '-' : ''}₹${s}`;
  const tail = s.slice(-3);
  let head = s.slice(0, -3);
  const parts: string[] = [];
  while (head.length > 2) {
    parts.unshift(head.slice(-2));
    head = head.slice(0, -2);
  }
  if (head) parts.unshift(head);
  return `${v < 0 ? '-' : ''}₹${parts.join(',')},${tail}`;
}

export default function GLReconciler() {
  const base = backendOrigin();
  const inr = true;
  const [companyName, setCompanyName] = useState('Demo Co');
  const [entityId, setEntityId] = useState('demo_entity');
  const [period, setPeriod] = useState('2025-01');
  const [accountCode, setAccountCode] = useState('10100');
  const [accountName, setAccountName] = useState('Bank — operating');
  const [currency, setCurrency] = useState('INR');
  const [glFile, setGlFile] = useState<File | null>(null);
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [subFile, setSubFile] = useState<File | null>(null);
  const [reconId, setReconId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [unmatchedGl, setUnmatchedGl] = useState<Record<string, unknown>[]>([]);
  const [unmatchedBank, setUnmatchedBank] = useState<Record<string, unknown>[]>([]);
  const [jes, setJes] = useState<Record<string, unknown>[]>([]);
  const [matchTab, setMatchTab] = useState<MatchTab>('exact');
  const [unTab, setUnTab] = useState<UnTab>('gl');
  const [unCategory, setUnCategory] = useState('');
  const [matchPage, setMatchPage] = useState(1);
  const [matchTotal, setMatchTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approver, setApprover] = useState('');
  const [history, setHistory] = useState<unknown[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const confParam = useMemo(() => {
    if (matchTab === 'exact') return 'exact';
    if (matchTab === 'near') return 'near';
    return 'suggested';
  }, [matchTab]);

  const loadMatches = useCallback(async () => {
    if (!base || !reconId) return;
    const r = await fetch(
      `${base}/api/recon/gl/matches/${reconId}?page=${matchPage}&size=50&confidence=${confParam}`
    );
    if (!r.ok) return;
    const j = await r.json();
    setMatches(j.items || []);
    setMatchTotal(j.total ?? 0);
  }, [base, reconId, matchPage, confParam]);

  const loadUnmatched = useCallback(async () => {
    if (!base || !reconId) return;
    const src = unTab;
    const cat = unCategory ? `&category=${encodeURIComponent(unCategory)}` : '';
    const r = await fetch(`${base}/api/recon/gl/unmatched/${reconId}?source=${src}${cat}`);
    if (!r.ok) return;
    const j = await r.json();
    if (unTab === 'gl') setUnmatchedGl(j.items || []);
    else setUnmatchedBank(j.items || []);
  }, [base, reconId, unTab, unCategory]);

  const fetchFullStatus = useCallback(async () => {
    if (!base || !reconId) return;
    const r = await fetch(`${base}/api/recon/gl/status/${reconId}`);
    if (!r.ok) return;
    const j = await r.json();
    setStatus(j.status || '');
    setSummary((j.summary as Summary) || null);
    if (j.status === 'complete') {
      const rj = await fetch(`${base}/api/recon/gl/suggested-jes/${reconId}`);
      if (rj.ok) {
        const jj = await rj.json();
        setJes(jj.items || []);
      }
    }
  }, [base, reconId]);

  useEffect(() => {
    if (!reconId || !base) return;
    const iv = setInterval(() => void fetchFullStatus(), 3000);
    void fetchFullStatus();
    return () => clearInterval(iv);
  }, [reconId, base, fetchFullStatus]);

  useEffect(() => {
    if (status === 'complete') void loadMatches();
  }, [status, loadMatches, matchPage, confParam]);

  useEffect(() => {
    if (status === 'complete') void loadUnmatched();
  }, [status, loadUnmatched]);

  const startRecon = async () => {
    setError(null);
    if (!base) {
      setError('Set VITE_API_URL (e.g. http://127.0.0.1:8000).');
      return;
    }
    if (!glFile || !bankFile) {
      setError('GL extract and bank statement are required.');
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('entity_id', entityId);
      fd.append('period', period);
      fd.append('account_code', accountCode);
      fd.append('account_name', accountName);
      fd.append('currency', currency);
      fd.append('company_name', companyName);
      fd.append('gl_file', glFile);
      fd.append('bank_file', bankFile);
      if (subFile) fd.append('subledger_file', subFile);
      const r = await fetch(`${base}/api/recon/gl/start`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setReconId(j.recon_id);
      setStatus('started');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const runMatching = async () => {
    if (!base || !reconId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${base}/api/recon/gl/run/${reconId}`, { method: 'POST' });
      if (!r.ok) throw new Error(await r.text());
      await fetchFullStatus();
      await loadMatches();
      await loadUnmatched();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const markCleared = async (source: 'gl' | 'bank', rowId: string) => {
    if (!base || !reconId) return;
    await fetch(`${base}/api/recon/gl/clear/${reconId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, row_id: rowId }),
    });
    void loadUnmatched();
    void fetchFullStatus();
  };

  const jeAct = async (jeId: string, action: 'accept' | 'reject') => {
    if (!base || !reconId) return;
    await fetch(`${base}/api/recon/gl/je-action/${reconId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ je_id: jeId, action }),
    });
    const rj = await fetch(`${base}/api/recon/gl/suggested-jes/${reconId}`);
    if (rj.ok) {
      const jj = await rj.json();
      setJes(jj.items || []);
    }
  };

  const approve = async () => {
    if (!base || !reconId) return;
    await fetch(`${base}/api/recon/gl/approve/${reconId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approver: approver || 'Controller' }),
    });
    void fetchFullStatus();
  };

  const loadHistory = async () => {
    if (!base) return;
    const r = await fetch(`${base}/api/recon/gl/history?entity_id=${encodeURIComponent(entityId)}`);
    if (r.ok) {
      const j = await r.json();
      setHistory(j.recons || []);
      setShowHistory(true);
    }
  };

  const exportMatchesCsv = () => {
    const rows = [['gl_date', 'gl_ref', 'gl_desc', 'amount', 'bank_date', 'bank_ref', 'confidence']];
    for (const m of matches) {
      rows.push([
        String(m.gl_date || ''),
        String(m.gl_ref || ''),
        String(m.gl_desc || '').replace(/,/g, ';'),
        String(m.amount ?? ''),
        String(m.bank_date || ''),
        String(m.bank_ref || ''),
        String(m.confidence ?? ''),
      ]);
    }
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gl_matches_${reconId?.slice(0, 8) || 'export'}.csv`;
    a.click();
  };

  const st = summary?.reconciliation_status || '—';
  const matchRate = summary?.match_rate_pct ?? 0;
  const rateColor = matchRate >= 90 ? 'text-emerald-400' : matchRate >= 75 ? 'text-amber-300' : 'text-red-400';

  const unList = unTab === 'gl' ? unmatchedGl : unmatchedBank;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <GitMerge className="h-7 w-7 text-cyan-400" aria-hidden />
              GL reconciler
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Three-way GL ↔ bank ↔ subledger matching, break analysis, and suggested journal entries (pending review).
            </p>
          </div>
          <Link to="/r2r/pattern" className="text-sm text-cyan-400 hover:underline self-start">
            ← R2R
          </Link>
        </header>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
        )}

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-6 space-y-4">
          <h2 className="text-lg font-medium">Setup</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm block">
              <span className="text-slate-400">Company</span>
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
              <span className="text-slate-400">Period</span>
              <input
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm block">
              <span className="text-slate-400">GL account code</span>
              <input
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm block sm:col-span-2">
              <span className="text-slate-400">GL account name</span>
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm block">
              <span className="text-slate-400">Currency</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label
              className="flex flex-col rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-3 py-3 text-sm"
              title="Date, Reference, Description, Debit, Credit, Account_Code"
            >
              <span className="text-slate-400">GL extract (required)</span>
              <input type="file" accept=".csv,.xlsx,.xls" className="mt-1 text-xs" onChange={(e) => setGlFile(e.target.files?.[0] || null)} />
              {glFile && <span className="text-xs text-emerald-400 mt-1">{glFile.name}</span>}
            </label>
            <label
              className="flex flex-col rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-3 py-3 text-sm"
              title="Date, Description, Debit, Credit, Balance"
            >
              <span className="text-slate-400">Bank statement (required)</span>
              <input type="file" accept=".csv,.xlsx,.xls" className="mt-1 text-xs" onChange={(e) => setBankFile(e.target.files?.[0] || null)} />
              {bankFile && <span className="text-xs text-emerald-400 mt-1">{bankFile.name}</span>}
            </label>
            <label
              className="flex flex-col rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-3 py-3 text-sm"
              title="Date, Invoice_No, Vendor, Amount, Status"
            >
              <span className="text-slate-400">Subledger (optional)</span>
              <input type="file" accept=".csv,.xlsx,.xls" className="mt-1 text-xs" onChange={(e) => setSubFile(e.target.files?.[0] || null)} />
              {subFile && <span className="text-xs text-emerald-400 mt-1">{subFile.name}</span>}
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => void startRecon()}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium hover:bg-cyan-500 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Start reconciliation
            </button>
            <button
              type="button"
              disabled={loading || !reconId}
              onClick={() => void runMatching()}
              className="rounded-lg border border-cyan-500/50 px-4 py-2.5 text-sm hover:bg-cyan-950/40 disabled:opacity-40"
            >
              Run matching
            </button>
            <button type="button" onClick={() => void fetchFullStatus()} className="inline-flex items-center gap-1 rounded border border-slate-700 px-3 py-2 text-xs">
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>
        </section>

        {summary && status === 'complete' && (
          <>
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-6 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium border ${
                    st === 'CLEAN'
                      ? 'border-emerald-500/50 text-emerald-300'
                      : st === 'MATERIAL BREAK'
                        ? 'border-red-500/50 text-red-300'
                        : 'border-amber-500/50 text-amber-200'
                  }`}
                >
                  {st}
                </span>
                <span className="text-sm text-slate-400">Auto-refresh every 3s</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <p className="text-xs text-slate-500">Match rate</p>
                  <p className={`text-xl font-semibold ${rateColor}`}>{matchRate.toFixed(1)}%</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <p className="text-xs text-slate-500">Matched</p>
                  <p className="text-xl font-semibold text-slate-100">
                    {summary.matched_count ?? 0}{' '}
                    <span className="text-sm font-normal text-slate-400">{fmtIn(summary.matched_amount, inr)}</span>
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <p className="text-xs text-slate-500">Unmatched GL</p>
                  <p className="text-xl font-semibold text-slate-100">{summary.unmatched_gl_count ?? 0}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <p className="text-xs text-slate-500">Unmatched bank</p>
                  <p className="text-xl font-semibold text-slate-100">{summary.unmatched_bank_count ?? 0}</p>
                </div>
              </div>
              <div className="text-sm space-y-1 border-t border-slate-800 pt-3">
                <p>
                  GL total (signed): <span className="font-mono">{fmtIn(summary.gl_total, inr)}</span>
                </p>
                <p>
                  Bank net change: <span className="font-mono">{fmtIn(summary.bank_net_change, inr)}</span>
                </p>
                <p>
                  Difference:{' '}
                  <span className={`font-mono ${Math.abs(summary.difference ?? 0) < 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtIn(summary.difference, inr)}
                  </span>
                </p>
              </div>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-6 overflow-x-auto">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-lg font-medium">Matched transactions</h2>
                <button type="button" onClick={exportMatchesCsv} className="inline-flex items-center gap-1 text-xs border border-slate-600 rounded px-2 py-1">
                  <FileDown className="h-3 w-3" />
                  Export CSV (page)
                </button>
              </div>
              <div className="flex gap-1 mb-3">
                {(['exact', 'near', 'suggested'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setMatchTab(t);
                      setMatchPage(1);
                    }}
                    className={`rounded-lg px-3 py-1 text-sm capitalize ${matchTab === t ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
                  >
                    {t === 'exact' ? 'Exact' : t === 'near' ? 'Near' : 'Suggested'}
                  </button>
                ))}
              </div>
              <table className="w-full text-xs md:text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-800">
                    <th className="py-2 pr-2">GL date</th>
                    <th className="py-2 pr-2">Ref</th>
                    <th className="py-2 pr-2">Amount</th>
                    <th className="py-2 pr-2">Bank date</th>
                    <th className="py-2 pr-2">Ref</th>
                    <th className="py-2">Conf.</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m, i) => (
                    <tr key={i} className="border-b border-slate-800/80">
                      <td className="py-2 pr-2 whitespace-nowrap">{String(m.gl_date || '').slice(0, 10)}</td>
                      <td className="py-2 pr-2">{m.gl_ref}</td>
                      <td className="py-2 pr-2 font-mono">{fmtIn(m.amount, inr)}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{String(m.bank_date || '').slice(0, 10)}</td>
                      <td className="py-2 pr-2">{m.bank_ref}</td>
                      <td className="py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            m.confidence_label === 'exact' || m.confidence === 100
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : m.confidence_label === 'near'
                                ? 'bg-blue-500/20 text-blue-300'
                                : 'bg-amber-500/20 text-amber-200'
                          }`}
                        >
                          {m.confidence ?? '—'}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-between items-center mt-3 text-sm text-slate-400">
                <span>
                  Page {matchPage} — {matchTotal} total
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={matchPage <= 1}
                    onClick={() => setMatchPage((p) => Math.max(1, p - 1))}
                    className="px-2 py-1 rounded border border-slate-700 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={matchPage * 50 >= matchTotal}
                    onClick={() => setMatchPage((p) => p + 1)}
                    className="px-2 py-1 rounded border border-slate-700 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-6">
              <h2 className="text-lg font-medium mb-3">Unmatched</h2>
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setUnTab('gl')}
                  className={`rounded-lg px-3 py-1 text-sm ${unTab === 'gl' ? 'bg-slate-700' : 'text-slate-400'}`}
                >
                  Unmatched GL
                </button>
                <button
                  type="button"
                  onClick={() => setUnTab('bank')}
                  className={`rounded-lg px-3 py-1 text-sm ${unTab === 'bank' ? 'bg-slate-700' : 'text-slate-400'}`}
                >
                  Unmatched bank
                </button>
                <select
                  value={unCategory}
                  onChange={(e) => setUnCategory(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                >
                  <option value="">All categories</option>
                  <option value="missing_gl">missing_gl</option>
                  <option value="missing_bank">missing_bank</option>
                  <option value="duplicate">duplicate</option>
                  <option value="timing">timing</option>
                  <option value="mismatch">mismatch</option>
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-800">
                      <th className="py-2 pr-2">Date</th>
                      <th className="py-2 pr-2">Ref</th>
                      <th className="py-2 pr-2">Amount</th>
                      <th className="py-2 pr-2">Category</th>
                      <th className="py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unList.map((u, i) => (
                      <tr key={i} className="border-b border-slate-800/80">
                        <td className="py-2 pr-2">{String(u.date || '').slice(0, 10)}</td>
                        <td className="py-2 pr-2">{String(u.reference || '')}</td>
                        <td className="py-2 pr-2 font-mono">{fmtIn(Number(u.amount), inr)}</td>
                        <td className="py-2 pr-2 text-slate-400">{String(u.category || '')}</td>
                        <td className="py-2">
                          <button
                            type="button"
                            onClick={() => void markCleared(unTab, String(u.row_id))}
                            className="text-xs text-cyan-400 hover:underline"
                          >
                            Mark cleared
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-amber-900/40 bg-amber-950/10 p-4 md:p-6 space-y-3">
              <h2 className="text-lg font-medium text-amber-100">Suggested journal entries (pending review)</h2>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => jes.forEach((j) => j.id && void jeAct(String(j.id), 'accept'))}
                  className="text-xs border border-slate-600 rounded px-2 py-1"
                >
                  Accept all
                </button>
              </div>
              <ul className="space-y-3">
                {jes.map((je) => (
                  <li key={String(je.id)} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm">
                    <p className="font-medium text-slate-200">{String(je.description || '')}</p>
                    <p className="text-slate-400 mt-1">
                      DR {String(je.debit_account)} {fmtIn(Number(je.amount), inr)} / CR {String(je.credit_account)} — ref{' '}
                      {String(je.reference || '')}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">Confidence: {String(je.confidence || '')}</p>
                    <p className="text-xs text-violet-300 mt-1">User: {String(je.user_status || 'pending_review')}</p>
                    <div className="flex gap-2 mt-2">
                      <button type="button" onClick={() => void jeAct(String(je.id), 'accept')} className="text-xs text-emerald-400">
                        Accept
                      </button>
                      <button type="button" onClick={() => void jeAct(String(je.id), 'reject')} className="text-xs text-red-400">
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="flex flex-wrap gap-3 items-center">
              <button
                type="button"
                onClick={() => reconId && window.open(`${base}/api/recon/gl/report/${reconId}/pdf`, '_blank')}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm"
              >
                <Download className="h-4 w-4" />
                Download PDF pack
              </button>
              <input
                placeholder="Approver"
                value={approver}
                onChange={(e) => setApprover(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
              <button type="button" onClick={() => void approve()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm">
                <Lock className="h-4 w-4" />
                Approve &amp; lock
              </button>
              <button type="button" onClick={() => void loadHistory()} className="text-sm text-cyan-400 hover:underline">
                View history
              </button>
            </section>
            {showHistory && history.length > 0 && (
              <ul className="text-xs text-slate-500 space-y-1 max-h-32 overflow-y-auto">
                {(history as { recon_id: string; period: string; status: string; account_code?: string }[]).map((h) => (
                  <li key={h.recon_id}>
                    {h.period} — {h.account_code} — {h.status}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {status && status !== 'complete' && reconId && (
          <p className="text-sm text-slate-400">
            Status: {status}
            {status === 'matching' ? <Loader2 className="inline h-4 w-4 animate-spin ml-2" /> : null}
          </p>
        )}
      </div>
    </div>
  );
}
