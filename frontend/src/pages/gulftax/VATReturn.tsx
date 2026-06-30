import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { fetchVatReturnAllBoxes, fetchVatReturnSummary, recordVatPayment, type VatReturnSummary } from '../../services/gulfTaxApi';
import { useCompany } from '../../context/CompanyContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { getStoredWorkspaceId } from '../../services/workspaceService';
import { getPendingBadDebtTotal } from '../../services/vatAdvanced.service';

function currentQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

type AllBoxes = {
  box1_standard_rated_sales_net: number;
  box1_standard_rated_sales_vat: number;
  box2_tourist_refunds: number;
  box2_advance_payment_vat?: number;
  box3_reverse_charge_supplies_net: number;
  box3_reverse_charge_supplies_vat: number;
  box4_zero_rated_supplies: number;
  box5_exempt_supplies: number;
  box6_imports_vat: number;
  box7_output_adjustments: number;
  box8_total_output_vat: number;
  box9_standard_rated_expenses: number;
  box10_reverse_charge_expenses: number;
  box11_total_input_vat: number;
  box12_net_vat_payable_or_refundable: number;
  payable: boolean;
  sales_invoice_count: number;
  purchase_entry_count: number;
  advance_payment_count?: number;
  advance_payments_included?: Array<{
    invoice_number?: string;
    customer?: string;
    advance_amount?: number;
    vat_included?: number;
    delivery_expected?: string;
  }>;
  ap_invoiceflow_count?: number;
  source?: string;
  entries: Array<Record<string, unknown>>;
};

const OUTPUT_BOXES = [
  { key: 'box1_standard_rated_sales_net', label: 'Box 1 — Standard rated sales (net)', box: 1 },
  { key: 'box1_standard_rated_sales_vat', label: 'Box 1 — Standard rated sales (VAT)', box: 1 },
  { key: 'box2_tourist_refunds', label: 'Box 2 — Tax refunds to tourists', box: 2 },
  { key: 'box2_advance_payment_vat', label: 'Box 2 — Advance payment VAT (output)', box: 2 },
  { key: 'box3_reverse_charge_supplies_net', label: 'Box 3 — Reverse charge supplies (net)', box: 3 },
  { key: 'box3_reverse_charge_supplies_vat', label: 'Box 3 — Reverse charge supplies (VAT)', box: 3 },
  { key: 'box4_zero_rated_supplies', label: 'Box 4 — Zero-rated supplies', box: 4 },
  { key: 'box5_exempt_supplies', label: 'Box 5 — Exempt supplies', box: 5 },
  { key: 'box6_imports_vat', label: 'Box 6 — Goods imported (VAT)', box: 6 },
  { key: 'box7_output_adjustments', label: 'Box 7 — Adjustments to output tax', box: 7 },
  { key: 'box8_total_output_vat', label: 'Box 8 — Total output tax', box: 8 },
] as const;

const INPUT_BOXES = [
  { key: 'box9_standard_rated_expenses', label: 'Box 9 — Standard rated expenses', box: 9 },
  { key: 'box10_reverse_charge_expenses', label: 'Box 10 — Reverse charge (purchases)', box: 10 },
  { key: 'box11_total_input_vat', label: 'Box 11 — Total input tax', box: 11 },
] as const;

type FilingOverrideKey =
  | 'box1_gross'
  | 'box1_vat'
  | 'box3_gross'
  | 'box5_gross'
  | 'box9_gross'
  | 'box9_vat'
  | 'box10_gross';

const FILING_OVERRIDE_FIELDS: { key: FilingOverrideKey; label: string }[] = [
  { key: 'box1_gross', label: 'Box 1 — Standard rated supplies (net)' },
  { key: 'box1_vat', label: 'Box 1 — Standard rated supplies (VAT)' },
  { key: 'box3_gross', label: 'Box 3 — Zero-rated supplies' },
  { key: 'box5_gross', label: 'Box 5 — Exempt supplies' },
  { key: 'box9_gross', label: 'Box 9 — Standard rated purchases (net)' },
  { key: 'box9_vat', label: 'Box 9 — Input VAT recoverable' },
  { key: 'box10_gross', label: 'Box 10 — Zero-rated purchases' },
];

function apValueForOverride(summary: VatReturnSummary, key: FilingOverrideKey): number {
  if (key === 'box1_gross') return summary.box1.gross;
  if (key === 'box1_vat') return summary.box1.vat;
  if (key === 'box3_gross') return summary.box3.gross;
  if (key === 'box5_gross') return summary.box5.gross;
  if (key === 'box9_gross') return summary.box9.gross;
  if (key === 'box9_vat') return summary.box9.vat;
  if (key === 'box10_gross') return summary.box10.gross;
  return 0;
}

function overridesFromSummary(summary: VatReturnSummary): Record<FilingOverrideKey, string> {
  return {
    box1_gross: summary.box1.gross.toFixed(2),
    box1_vat: summary.box1.vat.toFixed(2),
    box3_gross: summary.box3.gross.toFixed(2),
    box5_gross: summary.box5.gross.toFixed(2),
    box9_gross: summary.box9.gross.toFixed(2),
    box9_vat: summary.box9.vat.toFixed(2),
    box10_gross: summary.box10.gross.toFixed(2),
  };
}

export default function VATReturn() {
  const { activeCompany, activeCompanyId } = useCompany();
  const { activeWorkspace } = useWorkspace();
  const workspaceId =
    localStorage.getItem('active_workspace_id') || getStoredWorkspaceId() || activeWorkspace?.id || '';

  const [period, setPeriod] = useState(currentQuarter());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AllBoxes | null>(null);
  const [pendingBadDebt, setPendingBadDebt] = useState(0);
  const [showPay, setShowPay] = useState(false);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payRef, setPayRef] = useState('');
  const [payBank, setPayBank] = useState('1100');
  const [payMsg, setPayMsg] = useState<string | null>(null);
  const [apSyncCount, setApSyncCount] = useState(0);
  const [apSummary, setApSummary] = useState<VatReturnSummary | null>(null);
  const [filingOverrides, setFilingOverrides] = useState<Record<FilingOverrideKey, string> | null>(null);

  const load = async () => {
    setLoading(true);
    setPayMsg(null);
    try {
      const [res, summary] = await Promise.all([
        fetchVatReturnAllBoxes(period, activeCompanyId || undefined),
        activeCompanyId
          ? fetchVatReturnSummary(period, activeCompanyId).catch(() => null)
          : Promise.resolve(null),
      ]);
      setData(res as unknown as AllBoxes);
      setApSummary(summary);
      setApSyncCount(
        Number(summary?.ap_invoiceflow_count ?? res.ap_invoiceflow_count ?? 0),
      );
      if (summary) {
        setFilingOverrides(overridesFromSummary(summary));
      } else {
        setFilingOverrides(null);
      }
    } catch {
      setData(null);
      setApSyncCount(0);
      setApSummary(null);
      setFilingOverrides(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const onSync = () => { void load(); };
    window.addEventListener('gulftax:transaction_added', onSync);
    return () => window.removeEventListener('gulftax:transaction_added', onSync);
  }, [period, activeCompanyId]);

  useEffect(() => {
    void load();
  }, [period, activeCompanyId]);

  useEffect(() => {
    if (!workspaceId) return;
    void getPendingBadDebtTotal(workspaceId).then(setPendingBadDebt);
  }, [workspaceId]);

  const fmt = (n: number) => `AED ${Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;

  const overrideDiff = (key: FilingOverrideKey): number | null => {
    if (!apSummary || !filingOverrides) return null;
    const apVal = apValueForOverride(apSummary, key);
    const manual = Number.parseFloat(filingOverrides[key]);
    if (!Number.isFinite(manual)) return null;
    const diff = Math.round((manual - apVal) * 100) / 100;
    return diff === 0 ? null : diff;
  };

  const hasOverrideDiffs = apSummary && filingOverrides
    ? FILING_OVERRIDE_FIELDS.some((f) => overrideDiff(f.key) !== null)
    : false;

  const recordPayment = async () => {
    if (!data || data.box12_net_vat_payable_or_refundable <= 0) return;
    try {
      const r = await recordVatPayment({
        workspace_id: workspaceId,
        company_id: activeCompanyId || undefined,
        payment_date: payDate,
        amount_aed: data.box12_net_vat_payable_or_refundable,
        bank_account_code: payBank,
        reference: payRef,
      });
      setPayMsg(`VAT payment posted — JE ${(r as { entry_number?: string }).entry_number || 'created'}`);
      setShowPay(false);
    } catch (e) {
      setPayMsg(e instanceof Error ? e.message : 'Payment failed');
    }
  };

  const renderSection = (title: string, boxes: typeof OUTPUT_BOXES | typeof INPUT_BOXES) => (
    <div className="mb-8">
      <h2 className="text-sm font-semibold text-amber-400 mb-3">{title}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {boxes.map((b) => (
          <div key={b.key} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="text-[10px] font-mono text-amber-500">{b.label}</div>
            <div className="text-lg font-mono text-white mt-1">
              {data ? fmt(Number(data[b.key as keyof AllBoxes] ?? 0)) : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <p className="text-[11px] font-mono uppercase tracking-widest text-amber-500 mb-1">VAT Return</p>
      <h1 className="text-2xl font-bold text-white mb-2">FTA Return — All Boxes</h1>
      <p className="text-sm text-gray-400 mb-6">
        Sales from UAE AR invoices · Purchases from approved AP entries
        {activeCompany?.company_name ? ` · ${activeCompany.company_name}` : ''}
      </p>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <span className="text-sm text-amber-100">
          Pending Bad Debt Relief:{' '}
          <strong className="font-mono">{fmt(pendingBadDebt)}</strong>
        </span>
        <Link
          to="/gulftax/bad-debt-relief"
          className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline"
        >
          Review claims →
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <label className="text-sm text-gray-400">Period</label>
        <input
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white w-32"
        />
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="px-3 py-2 rounded-lg text-sm bg-amber-500/20 text-amber-400 border border-amber-500/30"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refresh'}
        </button>
      </div>

      {apSyncCount > 0 && (
        <div className="mb-6 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30">
            Auto-filled from AP InvoiceFlow ({apSyncCount} transaction{apSyncCount === 1 ? '' : 's'})
          </span>
          <Link
            to={`/ap-invoices/list?period=${encodeURIComponent(period)}`}
            className="text-xs text-teal-400 hover:text-teal-300 underline"
          >
            View AP invoices →
          </Link>
        </div>
      )}

      {apSummary && filingOverrides && (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-white">FTA filing overrides</h2>
              <p className="text-xs text-gray-500 mt-1">
                Pre-filled from AP InvoiceFlow — edit before FTA submission if needed
              </p>
            </div>
            {hasOverrideDiffs && (
              <span className="text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-full">
                Manual adjustments differ from AP data
              </span>
            )}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {FILING_OVERRIDE_FIELDS.map((field) => {
              const diff = overrideDiff(field.key);
              const apVal = apValueForOverride(apSummary, field.key);
              return (
                <label key={field.key} className="block rounded-lg border border-white/10 bg-gray-950/50 p-3">
                  <span className="text-[10px] font-mono text-gray-500">{field.label}</span>
                  <input
                    type="number"
                    step="0.01"
                    value={filingOverrides[field.key]}
                    onChange={(e) =>
                      setFilingOverrides((prev) =>
                        prev ? { ...prev, [field.key]: e.target.value } : prev,
                      )
                    }
                    className="mt-1.5 w-full bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono"
                  />
                  <p className="text-[10px] text-gray-600 mt-1">AP: {fmt(apVal)}</p>
                  {diff !== null && (
                    <p className="text-[10px] text-amber-400 mt-1 font-semibold">
                      Differs from AP by {fmt(Math.abs(diff))} ({diff > 0 ? '+' : '−'})
                    </p>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {renderSection('Sales and Output Tax (Boxes 1–8)', OUTPUT_BOXES)}
      {renderSection('Purchases and Input Tax (Boxes 9–11)', INPUT_BOXES)}

      {data && (data.advance_payments_included?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 mb-6">
          <h2 className="text-sm font-semibold text-amber-400 mb-3">
            Advance Payments Included in This Return
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Output VAT on advance receipts in this period (FTA two-step rule) — {data.advance_payment_count} invoice(s)
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-white/10">
                  <th className="py-2 pr-4">Invoice #</th>
                  <th className="py-2 pr-4">Customer</th>
                  <th className="py-2 pr-4 text-right">Advance Amount</th>
                  <th className="py-2 pr-4 text-right">VAT Included</th>
                  <th className="py-2 text-right">Delivery Expected</th>
                </tr>
              </thead>
              <tbody>
                {data.advance_payments_included!.map((row, i) => (
                  <tr key={i} className="border-b border-white/5">
                    <td className="py-2 pr-4 font-mono">{row.invoice_number ?? '—'}</td>
                    <td className="py-2 pr-4">{row.customer ?? '—'}</td>
                    <td className="py-2 pr-4 text-right font-mono">{fmt(Number(row.advance_amount ?? 0))}</td>
                    <td className="py-2 pr-4 text-right font-mono text-amber-400">{fmt(Number(row.vat_included ?? 0))}</td>
                    <td className="py-2 text-right text-gray-400">
                      {row.delivery_expected
                        ? new Date(String(row.delivery_expected).slice(0, 10)).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/20 bg-white/[0.03] p-5 mb-6">
        <div className="text-[10px] font-mono text-amber-500 uppercase">Box 12 — Net VAT Payable / Refundable</div>
        <div className={`text-3xl font-black mt-2 ${data && data.box12_net_vat_payable_or_refundable > 0 ? 'text-red-400' : 'text-green-400'}`}>
          {data ? fmt(data.box12_net_vat_payable_or_refundable) : '—'}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {data?.payable ? 'Payable to FTA' : 'Refundable from FTA'}
          {data ? ` · ${data.sales_invoice_count} sales · ${data.purchase_entry_count} purchase entries` : ''}
        </p>
        {data && data.box12_net_vat_payable_or_refundable > 0 && (
          <button
            type="button"
            onClick={() => setShowPay(true)}
            className="mt-4 px-4 py-2 rounded-lg bg-amber-500 text-deep text-sm font-semibold"
          >
            Record VAT Payment
          </button>
        )}
      </div>

      {payMsg && <p className="text-xs text-amber-300 mb-4">{payMsg}</p>}

      {showPay && data && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 max-w-md w-full space-y-3">
            <h3 className="text-lg font-semibold text-white">Record VAT Payment</h3>
            <label className="block text-sm text-gray-400">
              Payment date
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1 w-full bg-gray-950 border border-white/10 rounded-lg px-3 py-2 text-white" />
            </label>
            <label className="block text-sm text-gray-400">
              GIBAN / reference
              <input value={payRef} onChange={(e) => setPayRef(e.target.value)} className="mt-1 w-full bg-gray-950 border border-white/10 rounded-lg px-3 py-2 text-white" />
            </label>
            <label className="block text-sm text-gray-400">
              Bank GL code
              <input value={payBank} onChange={(e) => setPayBank(e.target.value)} className="mt-1 w-full bg-gray-950 border border-white/10 rounded-lg px-3 py-2 text-white" />
            </label>
            <p className="text-sm text-amber-400 font-mono">{fmt(data.box12_net_vat_payable_or_refundable)}</p>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => void recordPayment()} className="flex-1 py-2 rounded-lg bg-amber-500 text-deep font-semibold text-sm">Confirm &amp; Post JE</button>
              <button type="button" onClick={() => setShowPay(false)} className="flex-1 py-2 rounded-lg border border-white/10 text-sm text-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {data && data.entries.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.04] text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Net</th>
                <th className="px-4 py-3">VAT</th>
                <th className="px-4 py-3">Box</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e, i) => (
                <tr key={i} className="border-t border-white/5 text-gray-300">
                  <td className="px-4 py-2">{String(e.transaction_id ?? '')}</td>
                  <td className="px-4 py-2">{String(e.vendor_name ?? '')}</td>
                  <td className="px-4 py-2 font-mono">{fmt(Number(e.net_amount ?? 0))}</td>
                  <td className="px-4 py-2 font-mono">{fmt(Number(e.vat_amount ?? 0))}</td>
                  <td className="px-4 py-2 font-mono">{String(e.box_number ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
