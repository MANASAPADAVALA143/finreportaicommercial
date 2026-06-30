

import { useCallback, useEffect, useState } from "react";
import { Link } from 'react-router-dom';
import { apiClient } from '../../services/gulfTaxClient';
import {
  fetchGulfTaxTransactions,
  syncGulfTaxPeriod,
  type GulfTaxTransaction,
} from '../../services/gulfTaxApi';
import { useCompany } from '../../context/CompanyContext';

const STORAGE_RETURNS = "gulftax_vat_returns";

interface StoredReturn {
  return_id: number;
  period_start: string;
  period_end: string;
}

interface MismatchRow {
  invoice_number?: string;
  invoice?: string;
  issue: string;
  transaction_amount?: number;
  return_amount?: number;
  difference?: number;
}

interface ReconcileResult {
  status: string;
  difference_aed: number;
  mismatches: MismatchRow[];
  recommendation: string;
}

function loadReturns(): StoredReturn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_RETURNS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
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
  const [txRows, setTxRows] = useState<GulfTaxTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [options, setOptions] = useState<StoredReturn[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [manualId, setManualId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReconcileResult | null>(null);

  const refreshOptions = useCallback(() => {
    setOptions(loadReturns());
  }, []);

  useEffect(() => {
    refreshOptions();
    const onFocus = () => refreshOptions();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshOptions]);

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
    void loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    const onSync = () => { void loadTransactions(); };
    window.addEventListener('gulftax:transaction_added', onSync);
    return () => window.removeEventListener('gulftax:transaction_added', onSync);
  }, [loadTransactions]);

  const handleSyncPeriod = async () => {
    if (!activeCompanyId) return;
    setSyncMsg(null);
    try {
      const r = await syncGulfTaxPeriod(taxPeriod, activeCompanyId);
      setSyncMsg(`Synced ${r.synced} invoice(s), skipped ${r.skipped} already in GulfTax.`);
      await loadTransactions();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : 'Sync failed');
    }
  };

  const effectiveReturnId = selectedId || manualId.trim();

  const handleReconcile = async () => {
    const id = parseInt(effectiveReturnId, 10);
    if (!Number.isFinite(id) || id < 1) {
      setError("Select a VAT return from the list or enter a valid return ID.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await apiClient.post<ReconcileResult>(
        `/api/vat/reconcile/${id}`
      );
      setResult(data);
    } catch (e: unknown) {
      const err = e as Error & { response?: { data?: { detail?: string } } };
      const msg = err.response?.data?.detail || err.message || "Reconciliation failed";
      setError(typeof msg === "string" ? msg : "Reconciliation failed");
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
    a.download = `reconciliation_${effectiveReturnId || "export"}.csv`;
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
          Returns generated in this browser are listed below; you can also enter a return ID from
          the API.
        </p>
      </div>

      <div className="bg-gradient-to-br from-card to-[#071228] border border-teal-500/20 rounded-2xl p-6 mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-teal-300">AP → GulfTax transactions</h3>
            <p className="text-xs text-muted mt-1">Live rows from approved AP invoices for this tax period</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
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
                      {row.source === 'ap_invoiceflow' ? 'AP InvoiceFlow' : 'Manual'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-gradient-to-br from-card to-[#071228] border border-border rounded-2xl p-8 mb-6 space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-[12px] text-muted2 uppercase tracking-wide mb-2">
              VAT return
            </label>
            <select
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                if (e.target.value) setManualId("");
              }}
              className="w-full rounded-[10px] bg-[rgba(4,12,30,0.85)] border border-border px-4 py-2.5 text-white text-sm focus:border-border-g focus:outline-none"
            >
              <option value="">— Select —</option>
              {options.map((o) => (
                <option key={o.return_id} value={String(o.return_id)}>
                  #{o.return_id} · {o.period_start} → {o.period_end}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-muted2 uppercase tracking-wide mb-2">
              Or return ID
            </label>
            <input
              value={manualId}
              onChange={(e) => {
                setManualId(e.target.value);
                if (e.target.value) setSelectedId("");
              }}
              placeholder="e.g. 12"
              className="w-full rounded-[10px] bg-[rgba(4,12,30,0.85)] border border-border px-4 py-2.5 text-white text-sm font-mono focus:border-border-g focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleReconcile}
            disabled={loading || !effectiveReturnId}
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
          <button
            type="button"
            onClick={refreshOptions}
            className="px-4 py-2.5 rounded-[10px] text-sm text-muted border border-border hover:border-border-g"
          >
            Refresh list
          </button>
        </div>

        {options.length === 0 && (
          <p className="text-[12px] text-muted2">
            No returns in memory yet. Generate one on{" "}
            <Link to="/gulftax/vat-return" className="text-gold-lt underline">
              VAT Return
            </Link>{" "}
            or type a return ID.
          </p>
        )}

        {error && (
          <div className="rounded-[10px] border border-red/40 bg-[rgba(255,107,107,0.1)] px-4 py-3 text-sm text-red">
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-muted2 uppercase text-[11px]">Status</span>
              <div className="font-mono text-gold-lt">{result.status}</div>
            </div>
            <div>
              <span className="text-muted2 uppercase text-[11px]">Total difference</span>
              <div className="font-mono text-white">{fmtAed(result.difference_aed)}</div>
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
                      No mismatches above threshold — return aligns with invoices.
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

          <div className="rounded-xl border border-border bg-[rgba(4,12,30,0.5)] px-5 py-4">
            <div className="text-[11px] text-muted2 uppercase mb-2">Recommendation</div>
            <p className="text-[13px] text-muted leading-relaxed whitespace-pre-wrap">
              {result.recommendation}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
