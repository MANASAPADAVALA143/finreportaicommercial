

import { useCallback, useEffect, useState } from "react";
import { Link } from 'react-router-dom';
import {
  fetchGulfTaxTransactions,
  fetchVatPeriods,
  fetchVatReconHistory,
  runVatRecon,
  syncGulfTaxPeriod,
  type GulfTaxTransaction,
  type VatPeriodOption,
  type VatReconHistoryItem,
  type VatReconRunResult,
} from '../../services/gulfTaxApi';
import { useCompany } from '../../context/CompanyContext';

interface MismatchRow {
  invoice_number?: string;
  invoice?: string;
  issue: string;
  transaction_amount?: number;
  return_amount?: number;
  difference?: number;
}

function fmtAed(n: number | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function currentQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

export default function ReconPage() {
  const { activeCompanyId } = useCompany();
  const [taxPeriod, setTaxPeriod] = useState(currentQuarter());
  const [periodOptions, setPeriodOptions] = useState<VatPeriodOption[]>([]);
  const [txRows, setTxRows] = useState<GulfTaxTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VatReconRunResult | null>(null);
  const [history, setHistory] = useState<VatReconHistoryItem[]>([]);

  const loadPeriods = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const res = await fetchVatPeriods(activeCompanyId);
      setPeriodOptions(res.periods || []);
      if (res.periods?.length && !res.periods.some((p) => p.tax_period === taxPeriod)) {
        setTaxPeriod(res.periods[0].tax_period);
      }
    } catch {
      setPeriodOptions([]);
    }
  }, [activeCompanyId, taxPeriod]);

  const loadHistory = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const res = await fetchVatReconHistory(activeCompanyId);
      setHistory(res.items || []);
    } catch {
      setHistory([]);
    }
  }, [activeCompanyId]);

  const loadTransactions = useCallback(async () => {
    if (!activeCompanyId) return;
    setTxLoading(true);
    try {
      const res = await fetchGulfTaxTransactions(taxPeriod, activeCompanyId);
      setTxRows(res.items || []);
    } catch {
      setTxRows([]);
    } finally {
      setTxLoading(false);
    }
  }, [taxPeriod, activeCompanyId]);

  useEffect(() => {
    void loadPeriods();
    void loadHistory();
  }, [loadPeriods, loadHistory]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    const onSync = () => {
      void loadTransactions();
      void loadPeriods();
    };
    window.addEventListener('gulftax:transaction_added', onSync);
    return () => window.removeEventListener('gulftax:transaction_added', onSync);
  }, [loadTransactions, loadPeriods]);

  const handleSyncPeriod = async () => {
    if (!activeCompanyId) return;
    setSyncMsg(null);
    try {
      const r = await syncGulfTaxPeriod(taxPeriod, activeCompanyId);
      setSyncMsg(`Synced ${r.synced} invoice(s), skipped ${r.skipped} already in GulfTax.`);
      await loadTransactions();
      await loadPeriods();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : 'Sync failed');
    }
  };

  const handleReconcile = async () => {
    if (!activeCompanyId || !taxPeriod.trim()) {
      setError("Select a tax period.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await runVatRecon(taxPeriod, activeCompanyId);
      setResult(data);
      await loadHistory();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Reconciliation failed");
    } finally {
      setLoading(false);
    }
  };

  const rows: MismatchRow[] = result?.mismatches || [];

  const exportCsv = () => {
    const header = ["Invoice / ref", "Issue", "Transaction amount", "Return amount", "Difference"];
    const lines = [header.join(",")];
    for (const m of rows) {
      const inv = (m.invoice_number ?? m.invoice ?? "").toString().replace(/"/g, '""');
      const issue = (m.issue ?? "").replace(/"/g, '""');
      lines.push(
        [
          `"${inv}"`,
          `"${issue}"`,
          m.transaction_amount ?? "",
          m.return_amount ?? "",
          m.difference ?? "",
        ].join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reconciliation_${taxPeriod || "export"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="mb-7">
        <div className="font-mono text-[11px] text-gold uppercase tracking-[0.1em] mb-1.5">
          // Recon Bot
        </div>
        <h2 className="font-playfair text-[26px] font-bold">VAT return reconciliation</h2>
        <p className="text-[13px] text-muted mt-1">
          Compare GulfTax transactions against filed VAT returns for each tax period.
        </p>
      </div>

      <div className="bg-gradient-to-br from-card to-[#071228] border border-teal-500/20 rounded-2xl p-6 mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-teal-300">AP → GulfTax transactions</h3>
            <p className="text-xs text-muted mt-1">Live rows from gulftax_transactions for this tax period</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={taxPeriod}
              onChange={(e) => setTaxPeriod(e.target.value)}
              className="rounded-[8px] bg-[rgba(4,12,30,0.85)] border border-border px-3 py-2 text-white text-sm min-w-[7rem]"
            >
              {periodOptions.length === 0 && (
                <option value={taxPeriod}>{taxPeriod}</option>
              )}
              {periodOptions.map((p) => (
                <option key={p.tax_period} value={p.tax_period}>
                  {p.tax_period} ({p.transaction_count})
                </option>
              ))}
            </select>
            <input
              value={taxPeriod}
              onChange={(e) => setTaxPeriod(e.target.value)}
              className="rounded-[8px] bg-[rgba(4,12,30,0.85)] border border-border px-3 py-2 text-white text-sm w-28"
              placeholder="2026-Q2"
            />
            <button
              type="button"
              onClick={() => void loadTransactions()}
              disabled={txLoading}
              className="px-3 py-2 rounded-[8px] text-xs border border-border text-muted hover:text-white"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleSyncPeriod()}
              className="px-4 py-2 rounded-[8px] text-xs font-semibold bg-teal-600/30 text-teal-200 border border-teal-500/40"
            >
              Sync AP Invoices
            </button>
          </div>
        </div>
        {syncMsg && <p className="text-xs text-teal-300 mb-3">{syncMsg}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted2 border-b border-border text-[11px] uppercase">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Invoice #</th>
                <th className="py-2 pr-3">Vendor</th>
                <th className="py-2 pr-3">FTA Box</th>
                <th className="py-2 pr-3 text-right">Gross</th>
                <th className="py-2 pr-3 text-right">VAT</th>
                <th className="py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {txRows.length === 0 && !txLoading && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted text-xs">
                    No transactions for {taxPeriod}. Approve AP invoices or click Sync AP Invoices.
                  </td>
                </tr>
              )}
              {txRows.map((row) => (
                <tr key={row.id} className="border-b border-border/50">
                  <td className="py-2 pr-3 font-mono text-xs">{row.transaction_date}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{row.invoice_number || '—'}</td>
                  <td className="py-2 pr-3">{row.vendor_name || '—'}</td>
                  <td className="py-2 pr-3 uppercase text-xs">{row.fta_box || '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmtAed(row.gross_amount)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmtAed(row.vat_amount)}</td>
                  <td className="py-2">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        row.source === 'ap_invoiceflow'
                          ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                          : 'bg-white/5 text-muted border border-border'
                      }`}
                    >
                      {row.source === 'ap_invoiceflow' ? 'AP InvoiceFlow' : row.source || 'Manual'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-gradient-to-br from-card to-[#071228] border border-border rounded-2xl p-8 mb-6 space-y-5">
        <div>
          <label className="block text-[12px] text-muted2 uppercase tracking-wide mb-2">
            Tax period to reconcile
          </label>
          <p className="text-xs text-muted mb-3">
            Periods are loaded from <code className="text-gold-lt">gulftax_transactions</code>.
            {' '}
            <button type="button" onClick={() => void loadPeriods()} className="text-gold-lt underline">
              Refresh periods
            </button>
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleReconcile()}
            disabled={loading || !taxPeriod.trim() || !activeCompanyId}
            className="px-6 py-2.5 rounded-[10px] text-sm font-medium bg-gradient-to-br from-gold to-gold-lt text-deep shadow-[0_4px_18px_rgba(201,168,76,0.38)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Running…" : "Run reconciliation"}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="px-5 py-2.5 rounded-[10px] text-sm font-medium border border-border text-muted hover:border-border-g hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Export CSV
          </button>
        </div>

        {periodOptions.length === 0 && (
          <p className="text-[12px] text-muted2">
            No periods in GulfTax yet. Sync AP invoices or add transactions, then run recon from{" "}
            <Link to="/gulftax/vat-return" className="text-gold-lt underline">
              VAT Return
            </Link>
            .
          </p>
        )}

        {error && (
          <div className="rounded-[10px] border border-red/40 bg-[rgba(255,107,107,0.1)] px-4 py-3 text-sm text-red">
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="space-y-4 mb-8">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-muted2 uppercase text-[11px]">Status</span>
              <div className="font-mono text-gold-lt">{result.status}</div>
            </div>
            <div>
              <span className="text-muted2 uppercase text-[11px]">Total difference</span>
              <div className="font-mono text-white">{fmtAed(result.difference_aed ?? 0)}</div>
            </div>
            <div>
              <span className="text-muted2 uppercase text-[11px]">Transactions</span>
              <div className="font-mono text-white">{result.transaction_count}</div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-[rgba(4,12,30,0.95)] text-muted2 uppercase text-[11px]">
                <tr>
                  <th className="px-4 py-3">Invoice / ref</th>
                  <th className="px-4 py-3">Issue</th>
                  <th className="px-4 py-3 text-right">Difference</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-muted text-center">
                      {result.status === 'no_return'
                        ? 'No filed VAT return for this period — computed boxes saved for reference.'
                        : 'No mismatches above threshold — return aligns with GulfTax transactions.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((m, i) => (
                    <tr key={i} className="border-t border-border text-muted">
                      <td className="px-4 py-3 font-mono text-white">
                        {m.invoice_number ?? m.invoice ?? "—"}
                      </td>
                      <td className="px-4 py-3">{m.issue}</td>
                      <td className="px-4 py-3 text-right font-mono text-amber">
                        {fmtAed(m.difference)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {result.recommendation && (
            <div className="rounded-xl border border-border bg-[rgba(4,12,30,0.5)] px-5 py-4">
              <div className="text-[11px] text-muted2 uppercase mb-2">Recommendation</div>
              <p className="text-[13px] text-muted leading-relaxed whitespace-pre-wrap">
                {result.recommendation}
              </p>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-[rgba(4,12,30,0.5)]">
            <h3 className="text-sm font-semibold text-white">Reconciliation history</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="text-muted2 text-[11px] uppercase">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Period</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Diff</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-border/50">
                  <td className="px-4 py-2 font-mono text-xs text-muted">
                    {h.created_at ? new Date(h.created_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 font-mono">{h.tax_period ?? '—'}</td>
                  <td className="px-4 py-2">{h.status}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmtAed(h.difference_aed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
