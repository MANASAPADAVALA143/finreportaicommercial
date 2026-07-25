import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GitMerge, Loader2 } from 'lucide-react';
import {
  fetchGulfTaxTransactions,
  fetchVatReconHistory,
  fetchVatReconStatus,
  fetchVatReturnAllBoxes,
  runVatRecon,
  type GulfTaxTransaction,
  type VatReconHistoryItem,
  type VatReconStatus,
} from '../../services/gulfTaxApi';
import { useCompany } from '../../context/CompanyContext';

function currentQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

function fmt(n: number) {
  return `AED ${Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
}

export default function ReconciliationSummaryPage() {
  const { activeCompanyId } = useCompany();
  const [period, setPeriod] = useState(currentQuarter());
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<VatReconStatus | null>(null);
  const [history, setHistory] = useState<VatReconHistoryItem[]>([]);
  const [txCount, setTxCount] = useState(0);
  const [inputVat, setInputVat] = useState(0);
  const [outputVat, setOutputVat] = useState(0);
  const [box8, setBox8] = useState<number | null>(null);
  const [box11, setBox11] = useState<number | null>(null);
  const [box12, setBox12] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      const [st, hist, txs, boxes] = await Promise.all([
        fetchVatReconStatus(period, activeCompanyId).catch(() => null),
        fetchVatReconHistory(activeCompanyId).catch(() => ({ items: [] as VatReconHistoryItem[] })),
        fetchGulfTaxTransactions(period, activeCompanyId).catch(() => ({ items: [] as GulfTaxTransaction[], count: 0 })),
        fetchVatReturnAllBoxes(period, activeCompanyId).catch(() => null),
      ]);
      setStatus(st);
      setHistory(hist.items || []);
      const items = txs.items || [];
      setTxCount(items.length);
      setInputVat(
        items
          .filter((t) => t.direction === 'input')
          .reduce((s, t) => s + Number(t.vat_amount || 0), 0),
      );
      setOutputVat(
        items
          .filter((t) => t.direction === 'output')
          .reduce((s, t) => s + Number(t.vat_amount || 0), 0),
      );
      if (boxes) {
        setBox8(
          typeof boxes.box8_total_output_vat === 'number' ? Number(boxes.box8_total_output_vat) : null,
        );
        setBox11(
          typeof boxes.box11_total_input_vat === 'number' ? Number(boxes.box11_total_input_vat) : null,
        );
        setBox12(
          typeof boxes.box12_net_vat_payable_or_refundable === 'number'
            ? Number(boxes.box12_net_vat_payable_or_refundable)
            : null,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load summary');
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    if (!activeCompanyId) return;
    setRunning(true);
    setError(null);
    try {
      await runVatRecon(period, activeCompanyId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recon run failed');
    } finally {
      setRunning(false);
    }
  };

  const statusColor =
    status?.status === 'matched'
      ? 'text-green-400'
      : status?.status === 'mismatch_found'
        ? 'text-amber-400'
        : 'text-gray-300';

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-amber-400" />
            Reconciliation Summary
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Executive view of VAT return vs transactions for filing readiness
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white w-32"
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="px-3 py-2 rounded-lg text-sm bg-white/5 text-gray-300 border border-white/10"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="px-3 py-2 rounded-lg text-sm bg-amber-500/20 text-amber-400 border border-amber-500/30"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Run recon'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase text-gray-500 font-mono">Status</div>
          <div className={`text-xl font-bold mt-1 capitalize ${statusColor}`}>
            {(status?.status || 'never_run').replace(/_/g, ' ')}
          </div>
          {status?.difference_aed != null && (
            <div className="text-xs text-gray-500 mt-1">Diff {fmt(status.difference_aed)}</div>
          )}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase text-gray-500 font-mono">Transactions</div>
          <div className="text-2xl font-bold text-white mt-1">{txCount}</div>
          <div className="text-xs text-gray-500 mt-1">
            Output VAT {fmt(outputVat)} · Input VAT {fmt(inputVat)}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase text-gray-500 font-mono">Box 8 / Box 11</div>
          <div className="text-lg font-bold text-white mt-1">
            {box8 != null ? fmt(box8) : '—'} / {box11 != null ? fmt(box11) : '—'}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase text-gray-500 font-mono">Box 12</div>
          <div
            className={`text-2xl font-bold mt-1 ${
              box12 != null && box12 > 0 ? 'text-red-400' : 'text-green-400'
            }`}
          >
            {box12 != null ? fmt(box12) : '—'}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 overflow-hidden mb-4">
        <div className="px-4 py-3 bg-white/[0.03] border-b border-white/10 flex items-center justify-between">
          <span className="text-sm font-semibold text-white">Recent recon runs</span>
          <Link to="/gulftax/reconciliation" className="text-xs text-teal-400 underline">
            Open Recon Bot →
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left px-4 py-2">Period</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-right px-4 py-2">Difference</th>
              <th className="text-left px-4 py-2">When</th>
            </tr>
          </thead>
          <tbody>
            {history.slice(0, 8).map((h) => (
              <tr key={h.id} className="border-t border-white/5 text-gray-300">
                <td className="px-4 py-2 font-mono">{h.tax_period || '—'}</td>
                <td className="px-4 py-2 capitalize">{String(h.status || '').replace(/_/g, ' ')}</td>
                <td className="px-4 py-2 text-right font-mono">{fmt(Number(h.difference_aed))}</td>
                <td className="px-4 py-2 text-gray-500">
                  {h.created_at ? new Date(h.created_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  No recon history yet — run recon for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <Link to="/gulftax/vat-return" className="text-teal-400 underline">
          VAT Return →
        </Link>
        <Link to="/gulftax/tax-compliance" className="text-teal-400 underline">
          Tax Compliance Report →
        </Link>
        <Link to="/gulftax/audit-exports" className="text-amber-400 underline">
          Audit pack →
        </Link>
      </div>
    </div>
  );
}
