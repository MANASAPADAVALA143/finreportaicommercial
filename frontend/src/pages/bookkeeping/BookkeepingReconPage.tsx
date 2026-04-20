import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { reconcileBookkeeping, reconSignOff, monthlyReportPdfUrl } from '../../services/bookkeeping.service';
import { Download } from 'lucide-react';

type Summary = {
  matched: Array<Record<string, unknown>>;
  unmatched_bank_transaction_ids: number[];
  unmatched_journal_count: number;
  bank_total: number;
  matched_total: number;
  variance: number;
  escalated: boolean;
};

export const BookkeepingReconPage: React.FC = () => {
  const [clientId, setClientId] = useState(() => sessionStorage.getItem('bp_last_client') || '');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [signedBy, setSignedBy] = useState('CFO Reviewer');
  const [notes, setNotes] = useState('');

  const run = async () => {
    if (!clientId) {
      toast.error('Client ID required');
      return;
    }
    setBusy(true);
    try {
      const raw = sessionStorage.getItem('bp_last_tx_ids');
      const ids = raw ? (JSON.parse(raw) as number[]) : undefined;
      const res = await reconcileBookkeeping(clientId, ids?.length ? ids : undefined);
      setSummary(res.reconciliation_summary as Summary);
      sessionStorage.setItem('bp_last_recon', JSON.stringify(res.reconciliation_summary));
      toast.success('Reconciliation run complete');
    } catch {
      toast.error('Reconcile failed — ensure GL journal history exists for this company');
    } finally {
      setBusy(false);
    }
  };

  const signOff = async () => {
    if (!clientId || !summary) return;
    try {
      await reconSignOff(clientId, month, year, signedBy, summary.variance, notes || undefined);
      toast.success('Period signed off');
    } catch {
      toast.error('Sign-off failed');
    }
  };

  const pdfUrl = clientId ? monthlyReportPdfUrl(clientId, month, year) : '';

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Reconciliation (autopilot)</h1>
      <p className="text-slate-400 mb-6">
        Matches bank lines to journal_history for the same company id. For full enterprise workspaces, use{' '}
        <Link to="/bank-recon" className="text-emerald-400 hover:underline">
          Bank Reconciliation
        </Link>
        .
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-6 space-y-4">
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client / company id"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
          />
          <button
            type="button"
            disabled={busy}
            onClick={run}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold"
          >
            {busy ? 'Running' : 'Run match to GL'}
          </button>
          {summary && (
            <div className="text-sm space-y-2 text-slate-300">
              <p>
                Matched: <strong className="text-white">{summary.matched?.length ?? 0}</strong>
              </p>
              <p>Unmatched bank tx ids: {(summary.unmatched_bank_transaction_ids ?? []).length}</p>
              <p>Unmatched journal rows (approx): {summary.unmatched_journal_count}</p>
              <p>
                Bank total: <span className="font-mono">{summary.bank_total}</span>
              </p>
              <p>
                Matched total: <span className="font-mono">{summary.matched_total}</span>
              </p>
              <p className={summary.escalated ? 'text-red-400 font-semibold' : 'text-emerald-300'}>
                Variance: {summary.variance}{' '}
                {summary.escalated ? '(escalated: over $500 or over 1%)' : ''}
              </p>
            </div>
          )}
        </div>

        <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Sign-off and export</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">Month</label>
              <input
                type="number"
                min={1}
                max={12}
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Year</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white"
              />
            </div>
          </div>
          <input
            value={signedBy}
            onChange={(e) => setSignedBy(e.target.value)}
            placeholder="Signed by"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full min-h-[80px] bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
          />
          <button
            type="button"
            onClick={signOff}
            disabled={!summary}
            className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium"
          >
            Sign off period
          </button>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-700/50 text-sm"
          >
            <Download className="w-4 h-4" />
            Export monthly PDF (summary)
          </a>
        </div>
      </div>
    </div>
  );
};
