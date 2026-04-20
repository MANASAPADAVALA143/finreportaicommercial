import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  uploadTransactions,
  categorise,
  detectAnomalies,
  putClientProfile,
  type BookTxn,
} from '../../services/bookkeeping.service';

const API_BASE =
  (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) ||
  'http://localhost:8000';

type Company = { id: string; name: string };

const STAGES = ['Upload & parse', 'Categorise (rules + AI)', 'Detect anomalies'] as const;

export const BookkeepingUploadPage: React.FC = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [clientId, setClientId] = useState('');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [file, setFile] = useState<File | null>(null);
  const [weekendOps, setWeekendOps] = useState(false);
  const [receiptThreshold, setReceiptThreshold] = useState(100);
  const [stage, setStage] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [lastTx, setLastTx] = useState<BookTxn[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/companies`)
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setCompanies(list);
        setClientId((prev) => prev || (list[0]?.id ?? ''));
      })
      .catch(() => setCompanies([]));
  }, []);

  const progressPct = stage < 0 ? 0 : Math.round(((stage + 1) / STAGES.length) * 100);

  const runPipeline = async () => {
    if (!clientId) {
      toast.error('Select a client');
      return;
    }
    if (!file) {
      toast.error('Choose a CSV, Excel, or PDF bank file');
      return;
    }
    setBusy(true);
    setStage(0);
    try {
      await putClientProfile(clientId, {
        weekend_operations: weekendOps,
        receipt_threshold: receiptThreshold,
      });
      const up = await uploadTransactions(clientId, file, month, year);
      const ids = up.transactions.map((t) => t.id);
      setLastTx(up.transactions);
      sessionStorage.setItem('bp_last_client', clientId);
      sessionStorage.setItem('bp_last_tx_ids', JSON.stringify(ids));
      setStage(1);
      const cat = await categorise(clientId, ids, month, year);
      setLastTx(cat.transactions);
      setStage(2);
      const det = await detectAnomalies(clientId, ids);
      setLastTx(det.transactions);
      sessionStorage.setItem('bp_last_anomaly_report', JSON.stringify(det.anomaly_report));
      toast.success(`Processed ${ids.length} transactions`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Pipeline failed';
      toast.error(msg);
      setStage(-1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold text-white mb-2">Upload &amp; process</h1>
      <p className="text-slate-400 mb-8">
        Upload a bank statement as CSV, Excel, or PDF. PDF uses text extraction and works best on text-based statements; for image-only scans, export CSV/XLSX from your bank.
      </p>

      <div className="space-y-6 bg-slate-800/40 border border-slate-700 rounded-2xl p-6">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Client</label>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
          >
            <option value="">— Select —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Month</label>
            <input
              type="number"
              min={1}
              max={12}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Year</label>
            <input
              type="number"
              min={2020}
              max={2035}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="wk"
            type="checkbox"
            checked={weekendOps}
            onChange={(e) => setWeekendOps(e.target.checked)}
            className="rounded border-slate-600"
          />
          <label htmlFor="wk" className="text-sm text-slate-300">
            Business operates on weekends (disable weekend anomaly flags)
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Receipt threshold (flag missing receipt above)</label>
          <input
            type="number"
            min={0}
            value={receiptThreshold}
            onChange={(e) => setReceiptThreshold(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Bank file</label>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-slate-400"
          />
        </div>

        {stage >= 0 && (
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{STAGES[stage] ?? 'Done'}</span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={runPipeline}
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-semibold text-white"
        >
          {busy ? 'Processing…' : 'Run upload → categorise → anomalies'}
        </button>
      </div>

      {lastTx.length > 0 && (
        <div className="mt-8 text-sm text-slate-400">
          Last batch: {lastTx.length} rows. Open <strong className="text-slate-200">Transaction Review</strong> or{' '}
          <strong className="text-slate-200">Anomaly Report</strong> for details.
        </div>
      )}
    </div>
  );
};
