import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  listTransactions,
  learningFeedback,
  bulkApprove,
  type BookTxn,
} from '../../services/bookkeeping.service';

const COA = [
  'General expense',
  'Revenue',
  'Payroll',
  'Rent',
  'Utilities',
  'Travel',
  'Meals',
  'Software',
  'Bank fees',
  'Other',
];

function rowStyle(t: BookTxn) {
  const flags = t.anomaly_flags?.length ?? 0;
  if (flags > 0) return 'bg-red-950/40 border-l-4 border-red-500';
  if (t.auto_approved && (t.confidence ?? 0) > 0.95) return 'bg-emerald-950/30 border-l-4 border-emerald-500';
  if ((t.confidence ?? 0) >= 0.8 && (t.confidence ?? 0) < 0.95) return 'bg-amber-950/30 border-l-4 border-amber-500';
  return 'bg-slate-800/30 border-l-4 border-slate-600';
}

export const BookkeepingReviewPage: React.FC = () => {
  const [clientId, setClientId] = useState(() => sessionStorage.getItem('bp_last_client') || '');
  const [rows, setRows] = useState<BookTxn[]>([]);
  const [loading, setLoading] = useState(false);
  const [editCat, setEditCat] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const { transactions } = await listTransactions(clientId);
      setRows(transactions);
    } catch (e) {
      toast.error('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const yellowIds = useMemo(
    () =>
      rows
        .filter((t) => {
          const c = t.confidence ?? 0;
          return c >= 0.8 && c < 0.95;
        })
        .map((t) => t.id),
    [rows]
  );

  const saveCategory = async (t: BookTxn, category: string) => {
    if (!clientId || !category) return;
    try {
      await learningFeedback(clientId, t.id, category, t.vendor_name ?? undefined);
      toast.success('Saved — rule learned for vendor pattern');
      await load();
    } catch {
      toast.error('Save failed');
    }
  };

  const doBulkApprove = async () => {
    if (!clientId || !yellowIds.length) return;
    try {
      const r = await bulkApprove(clientId, yellowIds);
      toast.success(`Bulk approved ${r.approved_count} items`);
      await load();
    } catch {
      toast.error('Bulk approve failed');
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Transaction review</h1>
      <p className="text-slate-400 mb-6">
        Green: auto-approved (&gt;95%). Yellow: review band (80–95%). Red border: anomaly flags. Corrections update{' '}
        <code className="text-emerald-300">client_rules</code> for next run.
      </p>

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Client ID (company id)"
          className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white min-w-[240px]"
        />
        <button
          type="button"
          onClick={load}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={doBulkApprove}
          disabled={!yellowIds.length}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded-lg text-white text-sm font-medium"
        >
          Bulk approve yellow ({yellowIds.length})
        </button>
      </div>

      {loading && <p className="text-slate-500">Loading…</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Conf.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={`border-t border-slate-700/80 ${rowStyle(t)}`}>
                <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{t.date}</td>
                <td className="px-3 py-2 text-slate-200 max-w-[140px] truncate">{t.vendor_name}</td>
                <td className="px-3 py-2 text-slate-400 max-w-xs truncate">{t.description}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-200">{t.amount.toFixed(2)}</td>
                <td className="px-3 py-2">
                  <select
                    value={editCat[t.id] ?? t.category ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditCat((prev) => ({ ...prev, [t.id]: v }));
                      if (v && v !== (t.category ?? '')) void saveCategory(t, v);
                    }}
                    className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-xs max-w-[160px]"
                  >
                    <option value="">—</option>
                    {COA.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-slate-300">
                  {t.confidence != null ? `${Math.round(t.confidence * 100)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
