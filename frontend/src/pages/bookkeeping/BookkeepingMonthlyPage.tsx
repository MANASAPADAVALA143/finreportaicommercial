import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  getMonthlyReport,
  getAccuracy,
  monthlyReportPdfUrl,
} from '../../services/bookkeeping.service';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';

export const BookkeepingMonthlyPage: React.FC = () => {
  const [clientId, setClientId] = useState(() => sessionStorage.getItem('bp_last_client') || '');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [accRows, setAccRows] = useState<Array<{ month: number; year: number; accuracy_pct: number | null }>>([]);

  const load = async () => {
    if (!clientId) return;
    try {
      const [r, a] = await Promise.all([getMonthlyReport(clientId, month, year), getAccuracy(clientId)]);
      setReport(r as Record<string, unknown>);
      setAccRows(a);
    } catch {
      toast.error('Failed to load report');
    }
  };

  useEffect(() => {
    load();
  }, [clientId, month, year]);

  const chartData = accRows.map((row, i) => ({
    label: `${row.year}-${String(row.month).padStart(2, '0')}`,
    accuracy: row.accuracy_pct ?? 0,
    idx: i,
  }));

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Monthly report</h1>
      <p className="text-slate-400 mb-6">
        Targets: month 1 → <strong className="text-slate-200">85%</strong>, month 3 →{' '}
        <strong className="text-slate-200">92%</strong>, month 6 → <strong className="text-slate-200">97%</strong>{' '}
        auto-approval rate (indicative).
      </p>

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Client ID"
          className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
        />
        <input
          type="number"
          min={1}
          max={12}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="w-24 bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-white"
        />
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="w-28 bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-white"
        />
        <button
          type="button"
          onClick={load}
          className="px-4 py-2 bg-slate-700 rounded-lg text-white text-sm"
        >
          Refresh
        </button>
        <a
          href={clientId ? monthlyReportPdfUrl(clientId, month, year) : '#'}
          target="_blank"
          rel="noreferrer"
          className="px-4 py-2 bg-emerald-700 rounded-lg text-white text-sm font-medium inline-flex items-center"
        >
          Download PDF
        </a>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-4 h-72">
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Accuracy trend</h2>
          {chartData.length ? (
            <ResponsiveContainer width="100%" height="90%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569' }} />
                <ReferenceLine y={85} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: '85%', fill: '#fbbf24' }} />
                <ReferenceLine y={92} stroke="#34d399" strokeDasharray="4 4" label={{ value: '92%', fill: '#34d399' }} />
                <ReferenceLine y={97} stroke="#22c55e" strokeDasharray="4 4" label={{ value: '97%', fill: '#22c55e' }} />
                <Line type="monotone" dataKey="accuracy" stroke="#6ee7b7" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-600 text-sm p-4">No accuracy rows yet — run categorise to populate.</p>
          )}
        </div>

        <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-6 text-sm text-slate-300 space-y-2">
          <h2 className="text-lg font-semibold text-white mb-2">Period snapshot</h2>
          {report ? (
            <>
              <p>Transactions: {String(report.transaction_count ?? '—')}</p>
              <p>Receipt collection rate: {String(report.receipt_collection_rate_pct ?? '—')}%</p>
              <p>Anomaly flags (total): {String(report.anomaly_flags_total ?? '—')}</p>
              <p>Open missing receipts: {String(report.missing_receipts_open ?? '—')}</p>
              <p>Model accuracy field: {String(report.accuracy ?? '—')}%</p>
              <div className="mt-4">
                <p className="text-slate-400 text-xs mb-1">By category</p>
                <pre className="text-xs bg-slate-900/80 p-3 rounded-lg overflow-auto max-h-40 text-emerald-200/90">
                  {JSON.stringify(report.by_category ?? {}, null, 2)}
                </pre>
              </div>
            </>
          ) : (
            <p className="text-slate-600">No data</p>
          )}
        </div>
      </div>
    </div>
  );
};
