import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import toast from 'react-hot-toast';
import { useClient } from '../context/ClientContext';
import { postCfoAgentRun } from '../services/cfoAgents';

const API_URL =
  (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) ||
  'http://localhost:8000';

type WorkspaceRow = {
  id: number;
  workspace_name: string;
  period_start: string;
  period_end: string;
  recon_type: string;
  status: string;
  assigned_preparer_id: string | null;
  due_date: string | null;
  completion_percent: number;
  days_until_due: number | null;
  variance: number;
  is_overdue: boolean;
};

type MatchGroup = {
  id: number;
  match_type: string;
  confidence_score: number;
  status: string;
  ai_reasoning: string | null;
  book_transactions: Array<{
    id: number;
    txn_date: string;
    amount: number;
    description: string | null;
    reference: string | null;
    gl_account: string | null;
  }>;
  bank_transactions: Array<{
    id: number;
    txn_date: string;
    amount: number;
    description: string | null;
    bank_reference: string | null;
  }>;
};

function statusBadgeStyle(status: string, overdue?: boolean) {
  if (overdue) return { bg: '#FEE2E2', color: '#991B1B', label: 'Overdue' };
  const m: Record<string, { bg: string; color: string }> = {
    open: { bg: '#F1F5F9', color: '#475569' },
    in_progress: { bg: '#DBB8EA', color: '#5b21b6' },
    pending_review: { bg: '#FEF3C7', color: '#92400E' },
    approved: { bg: '#D1FAE5', color: '#065F46' },
    locked: { bg: '#E0E7FF', color: '#3730A3' },
  };
  const s = m[status] || m.open;
  return { bg: s.bg, color: s.color, label: status.replace(/_/g, ' ') };
}

function confidenceStyle(score: number) {
  if (score >= 0.95) return { bg: '#D1FAE5', color: '#166534' };
  if (score >= 0.7) return { bg: '#FEF3C7', color: '#92400E' };
  return { bg: '#FEE2E2', color: '#991B1B' };
}

export function BankReconciliationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { activeClient } = useClient();
  const tenantId = activeClient?.companyId || 'default';

  const tenantQs = useMemo(() => `tenant_id=${encodeURIComponent(tenantId)}`, [tenantId]);

  const isAnalytics = location.pathname.includes('/bank-recon/analytics');
  const wsNumericId = workspaceId ? parseInt(workspaceId, 10) : null;

  if (isAnalytics) {
    return <AnalyticsSection tenantQs={tenantQs} onBack={() => navigate('/bank-recon')} />;
  }
  if (wsNumericId && !Number.isNaN(wsNumericId)) {
    return (
      <WorkspaceDetailSection
        workspaceId={wsNumericId}
        tenantId={tenantId}
        tenantQs={tenantQs}
        currency={activeClient?.currency || 'USD'}
        onBack={() => navigate('/bank-recon')}
      />
    );
  }
  return (
    <WorkspaceDashboardSection tenantQs={tenantQs} onOpenAnalytics={() => navigate('/bank-recon/analytics')} />
  );
}

function WorkspaceDashboardSection({
  tenantQs,
  onOpenAnalytics,
}: {
  tenantQs: string;
  onOpenAnalytics: () => void;
}) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** null = unknown; false = list fetch failed (usually API down) */
  const [enterpriseApiOk, setEnterpriseApiOk] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    workspace_name: '',
    period_start: '',
    period_end: '',
    currency: 'USD',
    due_date: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/recon/workspaces?${tenantQs}`);
      if (!r.ok) throw new Error('Backend not available');
      const data = await r.json();
      setRows(Array.isArray(data) ? data : []);
      setEnterpriseApiOk(true);
    } catch (e) {
      console.warn('Bank recon: enterprise API unavailable — using empty workspace list', e);
      setRows([]);
      setEnterpriseApiOk(false);
    } finally {
      setLoading(false);
    }
  }, [tenantQs]);

  useEffect(() => {
    load();
  }, [load]);

  const createWorkspace = async () => {
    if (!form.workspace_name || !form.period_start || !form.period_end) {
      toast.error('Name and period required');
      return;
    }
    setCreating(true);
    try {
      const r = await fetch(`${API_URL}/api/recon/workspace?${tenantQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_name: form.workspace_name,
          period_start: form.period_start,
          period_end: form.period_end,
          currency: form.currency,
          due_date: form.due_date || null,
          recon_type: 'bank_to_gl',
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const ws = await r.json();
      toast.success('Workspace created');
      navigate(`/bank-recon/workspace/${ws.id}`);
    } catch (e) {
      toast.error(
        'Could not create workspace. Start the API (e.g. uvicorn app.main:app --port 8000 --reload).'
      );
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/r2r')}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">Bank reconciliation</h1>
            <p className="text-xs text-slate-500">Workspaces and portfolio view</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            to="/bookkeeping/reconciliation"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm font-medium hover:bg-emerald-100"
          >
            Bookkeeping Autopilot GL match
          </Link>
          <button
            type="button"
            onClick={onOpenAnalytics}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50"
          >
            <BarChart3 className="w-4 h-4" /> Analytics
          </button>
          <button
            type="button"
            onClick={() => window.open(`${API_URL}/api/recon/analytics?${tenantQs}`, '_blank')}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50"
          >
            <Download className="w-4 h-4" /> Export JSON
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pt-4 space-y-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
          <p className="font-semibold text-slate-900 mb-1">Two ways to reconcile</p>
          <ul className="list-disc list-inside space-y-1 text-slate-600">
            <li>
              <strong>Enterprise bank recon</strong> (below) — workspaces, matching engine, audit trail. Requires{' '}
              <code className="text-xs bg-slate-100 px-1 rounded">VITE_API_URL</code> / backend on port 8000.
            </li>
            <li>
              <strong>Quick / offline GL match</strong> — use{' '}
              <Link to="/bookkeeping/reconciliation" className="text-blue-700 font-medium hover:underline">
                Bookkeeping Autopilot → Reconciliation
              </Link>{' '}
              (no enterprise API required).
            </li>
          </ul>
        </div>
        {enterpriseApiOk === false && (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            role="status"
          >
            <strong className="font-semibold">Start backend to create reconciliation workspaces.</strong>{' '}
            Enterprise list uses <code className="text-xs bg-amber-100 px-1 rounded">GET /api/recon/workspaces</code>.
            When the API is running at {API_URL}, refresh this page.
          </div>
        )}
      </div>

      <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Plus className="w-4 h-4" /> New reconciliation
            </h2>
            <div className="space-y-2 text-sm">
              <input
                className="w-full border rounded-md px-2 py-1.5"
                placeholder="Workspace name"
                value={form.workspace_name}
                onChange={(e) => setForm((f) => ({ ...f, workspace_name: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  className="border rounded-md px-2 py-1.5"
                  value={form.period_start}
                  onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
                />
                <input
                  type="date"
                  className="border rounded-md px-2 py-1.5"
                  value={form.period_end}
                  onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="border rounded-md px-2 py-1.5"
                  placeholder="Currency"
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                />
                <input
                  type="date"
                  className="border rounded-md px-2 py-1.5"
                  value={form.due_date}
                  onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                />
              </div>
              <button
                type="button"
                disabled={creating}
                onClick={createWorkspace}
                className="w-full py-2 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create workspace'}
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 flex justify-center text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-slate-600">
              <p className="font-medium text-slate-800 mb-2">No enterprise workspaces yet</p>
              <p className="text-sm max-w-md mx-auto">
                {enterpriseApiOk === false
                  ? 'Start backend to create reconciliation workspaces, or use Bookkeeping Autopilot for offline GL matching.'
                  : 'Create a workspace with the form on the left, or start the API if the list fails to load.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600 uppercase">
                <tr>
                  <th className="px-4 py-3">Workspace</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Match %</th>
                  <th className="px-4 py-3">Variance</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => {
                  const st = statusBadgeStyle(w.status, w.is_overdue);
                  return (
                    <tr key={w.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-medium">{w.workspace_name}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {w.period_start} → {w.period_end}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{w.due_date || '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ background: st.bg, color: st.color }}
                        >
                          {w.is_overdue ? 'Overdue' : st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">{w.completion_percent.toFixed(1)}%</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {w.variance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="text-blue-700 hover:underline text-xs font-medium"
                          onClick={() => navigate(`/bank-recon/workspace/${w.id}`)}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceDetailSection({
  workspaceId,
  tenantId,
  tenantQs,
  currency,
  onBack,
}: {
  workspaceId: number;
  tenantId: string;
  tenantQs: string;
  currency: string;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<
    'overview' | 'matches' | 'unmatched' | 'adjustments' | 'audit'
  >('overview');
  const [detail, setDetail] = useState<any>(null);
  const [matchData, setMatchData] = useState<any>(null);
  const [unmatched, setUnmatched] = useState<any>(null);
  const [auditFilter, setAuditFilter] = useState('');
  const [matchFilter, setMatchFilter] = useState<'all' | string>('all');
  const [selectedMatch, setSelectedMatch] = useState<MatchGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [adjForm, setAdjForm] = useState({
    adjustment_type: 'bank_charges',
    description: '',
    amount: '',
    affects_side: 'book',
    journal_entry_required: false,
  });

  const loadAll = useCallback(async () => {
    try {
      const [d, m, u] = await Promise.all([
        fetch(`${API_URL}/api/recon/workspace/${workspaceId}?${tenantQs}`),
        fetch(`${API_URL}/api/recon/workspace/${workspaceId}/match-results?${tenantQs}`),
        fetch(`${API_URL}/api/recon/workspace/${workspaceId}/unmatched?${tenantQs}`),
      ]);
      if (d.ok) setDetail(await d.json());
      if (m.ok) setMatchData(await m.json());
      if (u.ok) setUnmatched(await u.json());
    } catch (e) {
      console.error(e);
    }
  }, [workspaceId, tenantQs]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const runMatching = async () => {
    setBusy(true);
    try {
      const r = await fetch(
        `${API_URL}/api/recon/workspace/${workspaceId}/run-matching?${tenantQs}`,
        { method: 'POST' }
      );
      if (!r.ok) throw new Error(await r.text());
      toast.success('Matching job started — refresh in a few seconds');
      setTimeout(loadAll, 2500);
    } catch (e) {
      toast.error('Run matching failed');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (side: 'book' | 'bank', file: File | null) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      const r = await fetch(
        `${API_URL}/api/recon/workspace/${workspaceId}/upload/${side}?${tenantQs}`,
        { method: 'POST', body: fd }
      );
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      toast.success(`Imported ${j.lines_imported} lines`);
      void postCfoAgentRun(
        'recon',
        {
          workspace_id: workspaceId,
          side,
          lines_imported: j.lines_imported,
          period: detail?.workspace?.period_start
            ? `${detail.workspace.period_start}–${detail.workspace.period_end}`
            : null,
          company_id: tenantId,
        },
        tenantId
      ).catch(() => {});
      loadAll();
    } catch (e) {
      toast.error('Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const confirmMatch = async (id: number) => {
    await fetch(`${API_URL}/api/recon/match/${id}/confirm?${tenantQs}`, { method: 'PATCH' });
    toast.success('Confirmed');
    loadAll();
  };

  const rejectMatch = async (id: number) => {
    await fetch(`${API_URL}/api/recon/match/${id}/reject?${tenantQs}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'User rejected' }),
    });
    toast.success('Rejected');
    loadAll();
    setSelectedMatch(null);
  };

  const addAdjustment = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/recon/workspace/${workspaceId}/adjustment?${tenantQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustment_type: adjForm.adjustment_type,
          description: adjForm.description,
          amount: parseFloat(adjForm.amount || '0'),
          affects_side: adjForm.affects_side,
          journal_entry_required: adjForm.journal_entry_required,
        }),
      });
      if (!r.ok) throw new Error();
      toast.success('Adjustment added');
      setAdjForm((f) => ({ ...f, description: '', amount: '' }));
      loadAll();
    } catch {
      toast.error('Failed');
    } finally {
      setBusy(false);
    }
  };

  const preparerSign = async () => {
    const r = await fetch(
      `${API_URL}/api/recon/workspace/${workspaceId}/preparer-signoff?${tenantQs}`,
      { method: 'POST' }
    );
    if (!r.ok) toast.error(await r.text());
    else toast.success('Preparer sign-off recorded');
    loadAll();
  };

  const reviewerSign = async () => {
    const r = await fetch(
      `${API_URL}/api/recon/workspace/${workspaceId}/reviewer-signoff?${tenantQs}`,
      { method: 'POST' }
    );
    if (!r.ok) toast.error(await r.text());
    else toast.success('Workspace locked');
    loadAll();
  };

  const ws = detail?.workspace;
  const progress = detail?.progress;
  const tiers = detail?.tier_breakdown || {};
  const stmt = ws
    ? {
        bank: ws.total_bank_balance,
        dep: ws.outstanding_deposits,
        chq: ws.outstanding_cheques,
        adjBank: ws.adjusted_bank_balance,
        book: ws.total_book_balance,
        adjBook: ws.adjusted_book_balance,
        var: ws.variance,
      }
    : null;

  const allMatches: MatchGroup[] = useMemo(() => {
    if (!matchData?.matches_by_status) return [];
    const { matches_by_status: mb } = matchData;
    return [
      ...(mb.auto_confirmed || []),
      ...(mb.pending_review || []),
      ...(mb.disputed || []),
      ...(mb.confirmed || []),
      ...(mb.rejected || []),
    ];
  }, [matchData]);

  const filteredMatches = useMemo(() => {
    if (matchFilter === 'all') return allMatches;
    return allMatches.filter((m) => m.status === matchFilter);
  }, [allMatches, matchFilter]);

  const stats = matchData?.stats;
  const matchRate = detail?.match_rate_pct ?? stats?.match_rate ?? 0;
  const variance = ws?.variance ?? 0;
  const crit = detail?.critical_exceptions ?? 0;
  const showSignoff = matchRate > 95 && Math.abs(Number(variance)) < 0.01 && crit === 0;
  const daysUntilDue =
    ws?.due_date != null
      ? Math.ceil((new Date(ws.due_date).getTime() - Date.now()) / 86400000)
      : null;
  const autoConfirmedCount = matchData?.matches_by_status?.auto_confirmed?.length ?? 0;

  const fmt = (n: number) =>
    `${n < 0 ? '-' : ''}${currency} ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <header className="border-b bg-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base font-semibold">{ws?.workspace_name || 'Workspace'}</h1>
            <p className="text-xs text-slate-500">
              {ws?.period_start} — {ws?.period_end} · {ws?.currency}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-xs flex items-center gap-1 cursor-pointer border rounded-lg px-2 py-1 bg-white">
            <FileSpreadsheet className="w-3 h-3" /> GL
            <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={(e) => upload('book', e.target.files?.[0] || null)} />
          </label>
          <label className="text-xs flex items-center gap-1 cursor-pointer border rounded-lg px-2 py-1 bg-white">
            <FileSpreadsheet className="w-3 h-3" /> Bank
            <input type="file" className="hidden" accept=".csv,.xlsx,.xls,.ofx,.qfx,.pdf" onChange={(e) => upload('bank', e.target.files?.[0] || null)} />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={runMatching}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Run matching
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4">
        <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
          {(
            [
              ['overview', 'Overview'],
              ['matches', 'Match review'],
              ['unmatched', 'Unmatched'],
              ['adjustments', 'Adjustments & exceptions'],
              ['audit', 'Audit trail'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
                tab === k ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="space-y-4">
            {stmt && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm font-mono text-sm max-w-xl">
                <div className="font-sans text-xs text-slate-500 mb-2">Reconciliation statement</div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span>Bank statement balance</span>
                  <span>{fmt(stmt.bank)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span>+ Deposits in transit</span>
                  <span>{fmt(stmt.dep)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span>− Outstanding cheques</span>
                  <span>({fmt(stmt.chq)})</span>
                </div>
                <div className="flex justify-between py-1 font-semibold border-b border-slate-200">
                  <span>Adjusted bank</span>
                  <span>{fmt(stmt.adjBank)}</span>
                </div>
                <div className="flex justify-between py-1 mt-2">
                  <span>GL book balance</span>
                  <span>{fmt(stmt.book)}</span>
                </div>
                <div className="flex justify-between py-1 font-semibold border-t border-slate-200 pt-1">
                  <span>Adjusted book</span>
                  <span>{fmt(stmt.adjBook)}</span>
                </div>
                <div
                  className="flex justify-between py-2 mt-2 rounded-lg px-2 font-semibold"
                  style={{
                    background: Math.abs(stmt.var) < 0.01 ? '#D1FAE5' : '#FEE2E2',
                    color: Math.abs(stmt.var) < 0.01 ? '#166534' : '#991B1B',
                  }}
                >
                  <span>Variance</span>
                  <span>{fmt(stmt.var)}</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {[
                ['Match rate', `${matchRate.toFixed(1)}%`],
                ['Auto-confirmed', String(autoConfirmedCount)],
                ['Pending review', String(matchData?.matches_by_status?.pending_review?.length ?? 0)],
                ['Exceptions', String(detail?.exceptions_open ?? 0)],
                ['Days to due', daysUntilDue !== null ? String(daysUntilDue) : '—'],
              ].map(([a, b]) => (
                <div key={a} className="rounded-lg border bg-white p-3 text-center">
                  <div className="text-lg font-semibold text-blue-800">{b}</div>
                  <div className="text-[10px] text-slate-500 uppercase">{a}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="text-xs text-slate-500 mb-1">Progress</div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{
                    width: `${progress?.total ? (progress.matched / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="text-xs text-slate-600 mt-1">
                {progress?.matched ?? 0} / {progress?.total ?? 0} matched
              </div>
            </div>

            <div className="text-sm text-slate-700">
              <span className="font-medium">Tier breakdown:</span> exact {tiers.exact || 0} · fuzzy{' '}
              {tiers.fuzzy || 0} · composite {(tiers.one_to_many || 0) + (tiers.many_to_one || 0)} · AI{' '}
              {tiers.ai_suggested || 0}
            </div>
          </div>
        )}

        {tab === 'matches' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 min-h-[420px]">
            <div className="md:col-span-4 rounded-xl border bg-white p-3 flex flex-col">
              <input
                placeholder="Search description…"
                className="border rounded-md px-2 py-1 text-xs mb-2"
                onChange={() => {}}
              />
              <div className="flex gap-1 flex-wrap mb-2">
                {['all', 'pending_review', 'auto_confirmed', 'disputed'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setMatchFilter(f)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      matchFilter === f ? 'bg-slate-900 text-white' : 'bg-slate-50'
                    }`}
                  >
                    {f.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 max-h-[480px]">
                {filteredMatches.map((m) => {
                  const book = m.book_transactions?.[0];
                  const cs = confidenceStyle(m.confidence_score);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedMatch(m)}
                      className={`w-full text-left p-2 rounded-lg border text-xs ${
                        selectedMatch?.id === m.id ? 'border-blue-500 bg-blue-50' : 'border-slate-100 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <span className="font-mono">{book ? fmt(book.amount) : '—'}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: cs.bg, color: cs.color }}>
                          {(m.confidence_score * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-slate-600 truncate">{book?.description || m.match_type}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="md:col-span-8 rounded-xl border bg-white p-4">
              {selectedMatch ? (
                <div className="space-y-4">
                  <div className="text-xs text-slate-500">
                    Match #{selectedMatch.id} · {selectedMatch.match_type} · {selectedMatch.status}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs font-semibold text-slate-500 mb-2">Book</div>
                      {(selectedMatch.book_transactions || []).map((b) => (
                        <div key={b.id} className="text-sm space-y-1 mb-2">
                          <div>Date: {b.txn_date}</div>
                          <div>Amount: {fmt(b.amount)}</div>
                          <div>{b.description}</div>
                          <div className="text-xs text-slate-500">Ref: {b.reference || '—'} · GL {b.gl_account || '—'}</div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs font-semibold text-slate-500 mb-2">Bank</div>
                      {selectedMatch.bank_transactions.map((b) => (
                        <div key={b.id} className="text-sm space-y-1 mb-2">
                          <div>Date: {b.txn_date}</div>
                          <div>Amount: {fmt(b.amount)}</div>
                          <div>{b.description}</div>
                          <div className="text-xs text-slate-500">Bank ref: {b.bank_reference || '—'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {selectedMatch.ai_reasoning && (
                    <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-amber-950">
                      <div className="text-xs font-semibold mb-1">AI reasoning</div>
                      {selectedMatch.ai_reasoning}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => confirmMatch(selectedMatch.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-sm"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectMatch(selectedMatch.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-800 text-sm"
                    >
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Select a match to review.</p>
              )}
            </div>
          </div>
        )}

        {tab === 'unmatched' && unmatched && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {['unmatched_bank', 'unmatched_book'].map((side) => (
              <div key={side} className="rounded-xl border bg-white p-3">
                <h3 className="text-sm font-semibold mb-2 capitalize">{side.replace(/_/g, ' ')}</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto text-xs">
                  {(unmatched[side] as any[]).map((row: any) => (
                    <div key={row.id} className="border border-slate-100 rounded-lg p-2">
                      <div className="font-mono font-medium">{fmt(row.amount)}</div>
                      <div className="text-slate-600">{row.description}</div>
                      <div className="text-slate-400">{row.txn_date} · age {row.age_days}d</div>
                    </div>
                  ))}
                  {(unmatched[side] as any[]).length === 0 && (
                    <p className="text-slate-400">None</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'adjustments' && (
          <div className="space-y-4">
            <div className="rounded-xl border bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2 text-sm">
                <select
                  className="w-full border rounded-md p-1"
                  value={adjForm.adjustment_type}
                  onChange={(e) => setAdjForm((f) => ({ ...f, adjustment_type: e.target.value }))}
                >
                  {['bank_charges', 'timing_deposit_in_transit', 'timing_outstanding_cheque', 'interest_income', 'other'].map(
                    (t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    )
                  )}
                </select>
                <input
                  className="w-full border rounded-md p-1"
                  placeholder="Description"
                  value={adjForm.description}
                  onChange={(e) => setAdjForm((f) => ({ ...f, description: e.target.value }))}
                />
                <input
                  className="w-full border rounded-md p-1"
                  placeholder="Amount"
                  value={adjForm.amount}
                  onChange={(e) => setAdjForm((f) => ({ ...f, amount: e.target.value }))}
                />
                <select
                  className="w-full border rounded-md p-1"
                  value={adjForm.affects_side}
                  onChange={(e) => setAdjForm((f) => ({ ...f, affects_side: e.target.value }))}
                >
                  <option value="bank">bank</option>
                  <option value="book">book</option>
                  <option value="both">both</option>
                </select>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={adjForm.journal_entry_required}
                    onChange={(e) => setAdjForm((f) => ({ ...f, journal_entry_required: e.target.checked }))}
                  />
                  JE required
                </label>
                <button type="button" onClick={addAdjustment} className="px-3 py-1.5 bg-blue-700 text-white rounded-lg text-xs">
                  Add adjustment
                </button>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-2">Open exceptions</div>
                <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
                  {(detail?.exceptions || []).map((e: any) => (
                    <li key={e.id} className="border rounded p-1">
                      {e.exception_type} · {e.severity}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {tab === 'audit' && (
          <div className="rounded-xl border bg-white p-4">
            <input
              className="border rounded-md px-2 py-1 text-xs mb-3 w-full max-w-xs"
              placeholder="Filter action…"
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
            />
            <div className="space-y-2">
              {(detail?.audit_trail || [])
                .filter(
                  (a: any) =>
                    !auditFilter || String(a.action).toLowerCase().includes(auditFilter.toLowerCase())
                )
                .map((a: any) => (
                  <div key={a.id} className="flex gap-3 text-xs border-b border-slate-50 pb-2">
                    <span className="text-slate-400 w-36 shrink-0">{a.performed_at}</span>
                    <span className="font-medium w-40 shrink-0">{a.action}</span>
                    <span className="text-slate-600 truncate">{JSON.stringify(a.details || {})}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {showSignoff && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-emerald-200 bg-emerald-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2 shadow-lg">
          <div className="flex items-center gap-2 text-sm">
            <Shield className="w-5 h-5 text-emerald-800" />
            <span>
              Ready for sign-off — variance {fmt(Number(variance))} · match rate {matchRate.toFixed(1)}% · {crit} critical
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={preparerSign}
              className="px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-900 text-sm font-medium"
            >
              Preparer sign-off
            </button>
            <button
              type="button"
              onClick={reviewerSign}
              className="px-3 py-1.5 rounded-lg bg-emerald-800 text-white text-sm font-medium"
            >
              Reviewer sign-off
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AnalyticsSection({ tenantQs, onBack }: { tenantQs: string; onBack: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API_URL}/api/recon/analytics?${tenantQs}`);
        if (!r.ok) throw new Error('Backend not available');
        const j = await r.json();
        if (!cancelled) setData(j);
      } catch (e) {
        console.warn('Bank recon analytics: API unavailable', e);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantQs]);

  const trend = data?.match_trend || [];
  const exTypes = Object.entries(data?.exceptions_by_type || {}).map(([name, value]) => ({
    name,
    value: value as number,
  }));

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-lg mx-auto mt-16 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-950">
          <button type="button" onClick={onBack} className="mb-4 p-2 rounded-lg hover:bg-amber-100 border border-amber-300">
            <ArrowLeft className="w-5 h-5 inline" /> Back
          </button>
          <h1 className="text-lg font-semibold mb-2">Analytics need the enterprise API</h1>
          <p className="text-sm">
            Start backend to load <code className="text-xs bg-amber-100 px-1 rounded">/api/recon/analytics</code>, or
            return when the server at {API_URL} is running.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="p-2 rounded-lg hover:bg-white border">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-semibold">Reconciliation analytics</h1>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Avg match rate', `${data?.avg_match_rate ?? 0}%`],
            ['Avg days to close', data?.avg_days_to_close ?? 0],
            ['Exceptions (MTD)', data?.exceptions_this_month ?? 0],
            ['Auto-confirm rate', `${data?.auto_confirm_rate ?? 0}%`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="text-2xl font-semibold text-blue-800">{v}</div>
              <div className="text-xs text-slate-500">{k}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-xl border bg-white p-4 h-72">
            <div className="text-sm font-medium mb-2">Match rate trend</div>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period_end" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="match_rate" stroke="#185FA5" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border bg-white p-4 h-72">
            <div className="text-sm font-medium mb-2">Exceptions by type</div>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={exTypes}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#A32D2D" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 overflow-x-auto">
          <div className="text-sm font-medium mb-2">Preparer leaderboard</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2">Preparer</th>
                <th>Workspaces</th>
                <th>Avg match %</th>
                <th>Avg days</th>
              </tr>
            </thead>
            <tbody>
              {(data?.preparer_leaderboard || []).map((row: any, i: number) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-2">{row.preparer}</td>
                  <td>{row.workspaces}</td>
                  <td>{row.avg_match_rate}</td>
                  <td>{row.avg_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
