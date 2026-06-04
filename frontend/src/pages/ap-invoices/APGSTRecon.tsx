/**
 * APGSTRecon.tsx â€” GST / VAT Reconciliation
 * Reconciles input tax credit claimed on invoices vs filed GST returns
 */
import { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Receipt, CheckCircle, AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { apSupabase, type APInvoice } from '../../lib/apSupabase';
import * as XLSX from 'xlsx';

function fmt(n: number, cur = 'AED') {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(d: string | null | undefined) {
  if (!d) return 'â€”';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

type ReconciliationStatus = 'matched' | 'variance' | 'missing_gstin' | 'no_tax';

function getReconStatus(inv: APInvoice): ReconciliationStatus {
  if (!inv.tax_amount || inv.tax_amount === 0) return 'no_tax';
  if (!inv.tax_rate) return 'missing_gstin';
  // Verify: tax_amount â‰ˆ total_amount * tax_rate / 100
  const expected = (inv.subtotal_amount ?? inv.total_amount - (inv.tax_amount ?? 0)) * (inv.tax_rate / 100);
  if (Math.abs(expected - (inv.tax_amount ?? 0)) < 1) return 'matched';
  return 'variance';
}

export default function APGSTRecon() {
  const [invoices, setInvoices] = useState<APInvoice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<ReconciliationStatus | 'all'>('all');
  const [period, setPeriod]     = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await apSupabase.from('invoices').select('*').order('invoice_date', { ascending: false }).limit(500);
    setInvoices((data ?? []) as APInvoice[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const withStatus = useMemo(() => invoices.map(inv => ({ inv, status: getReconStatus(inv) })), [invoices]);

  const filtered = useMemo(() => {
    let rows = withStatus;
    if (tab !== 'all') rows = rows.filter(r => r.status === tab);
    if (period) rows = rows.filter(r => (r.inv.invoice_date ?? '').startsWith(period));
    return rows;
  }, [withStatus, tab, period]);

  const totalTax = invoices.reduce((s, i) => s + (i.tax_amount ?? 0), 0);
  const matchedTax = withStatus.filter(r => r.status === 'matched').reduce((s, r) => s + (r.inv.tax_amount ?? 0), 0);
  const varianceTax = withStatus.filter(r => r.status === 'variance').reduce((s, r) => s + (r.inv.tax_amount ?? 0), 0);
  const counts = {
    matched: withStatus.filter(r => r.status === 'matched').length,
    variance: withStatus.filter(r => r.status === 'variance').length,
    missing_gstin: withStatus.filter(r => r.status === 'missing_gstin').length,
    no_tax: withStatus.filter(r => r.status === 'no_tax').length,
  };

  const pieData = [
    { name: 'Matched', value: counts.matched, color: '#22c55e' },
    { name: 'Variance', value: counts.variance, color: '#f97316' },
    { name: 'Missing Tax Rate', value: counts.missing_gstin, color: '#facc15' },
    { name: 'No Tax', value: counts.no_tax, color: '#475569' },
  ].filter(d => d.value > 0);

  const statusLabel: Record<ReconciliationStatus, { text: string; cls: string }> = {
    matched:      { text: 'âœ… Matched',       cls: 'bg-green-900 text-green-300 border-green-700' },
    variance:     { text: 'âš ï¸ Variance',      cls: 'bg-orange-900 text-orange-300 border-orange-700' },
    missing_gstin:{ text: 'ðŸ”· Missing Rate',  cls: 'bg-yellow-900 text-yellow-300 border-yellow-700' },
    no_tax:       { text: 'â€” No Tax',         cls: 'bg-slate-700 text-slate-400 border-slate-600' },
  };

  const exportXLSX = () => {
    const rows = withStatus.map(({ inv, status }) => ({
      'Invoice #': inv.invoice_number,
      'Vendor': inv.vendor_name,
      'Invoice Date': inv.invoice_date ?? '',
      'Total Amount': inv.total_amount,
      'Tax Amount': inv.tax_amount ?? 0,
      'Tax Rate %': inv.tax_rate ?? '',
      'Subtotal': inv.subtotal_amount ?? '',
      'Recon Status': status,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'GST Recon');
    XLSX.writeFile(wb, `gst_recon_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  // Unique periods (YYYY-MM)
  const periods = [...new Set(invoices.map(i => (i.invoice_date ?? '').slice(0, 7)).filter(Boolean))].sort().reverse();

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Receipt className="w-5 h-5 text-green-400" /> GST / VAT Reconciliation
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">Reconcile input tax claims on invoices against filed returns</p>
        </div>
        <div className="flex gap-2">
          <select value={period} onChange={e => setPeriod(e.target.value)}
            className="bg-slate-800 border border-slate-600 text-slate-200 px-3 py-1.5 rounded-lg text-sm">
            <option value="">All Periods</option>
            {periods.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={exportXLSX} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* KPIs + pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 grid grid-cols-2 gap-4">
          {[
            { label: 'Total Tax Claimed',  value: fmt(totalTax),    color: 'text-white' },
            { label: 'Matched Tax',        value: fmt(matchedTax),  color: 'text-green-400' },
            { label: 'Variance Amount',    value: fmt(varianceTax), color: 'text-orange-400' },
            { label: 'Match Rate',         value: invoices.length ? `${Math.round((counts.matched / invoices.length) * 100)}%` : 'â€”', color: 'text-blue-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-slate-900 border border-slate-700 rounded-xl p-4">
              <p className="text-xs text-slate-400">{label}</p>
              <p className={`text-xl font-bold mt-1 ${color}`}>{value}</p>
            </div>
          ))}
          <div className="col-span-2 grid grid-cols-4 gap-3">
            {[
              { label: 'Matched', count: counts.matched, color: 'text-green-400', icon: CheckCircle },
              { label: 'Variance', count: counts.variance, color: 'text-orange-400', icon: AlertTriangle },
              { label: 'Missing Rate', count: counts.missing_gstin, color: 'text-yellow-400', icon: AlertTriangle },
              { label: 'No Tax', count: counts.no_tax, color: 'text-slate-500', icon: Receipt },
            ].map(({ label, count, color, icon: Icon }) => (
              <div key={label} className="bg-slate-900 border border-slate-700 rounded-xl p-3 flex items-center gap-2">
                <Icon className={`w-4 h-4 ${color}`} />
                <div>
                  <p className="text-[10px] text-slate-400">{label}</p>
                  <p className={`text-lg font-bold ${color}`}>{count}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Distribution</p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} innerRadius={30}>
                {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 justify-center mt-1">
            {pieData.map(d => (
              <span key={d.name} className="flex items-center gap-1 text-[10px] text-slate-400">
                <span className="w-2 h-2 rounded-full" style={{ background: d.color }} /> {d.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {(['all','matched','variance','missing_gstin','no_tax'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
            {t === 'all' ? `All (${invoices.length})` : t === 'missing_gstin' ? `Missing Rate (${counts.missing_gstin})` : `${t.charAt(0).toUpperCase()+t.slice(1)} (${counts[t as ReconciliationStatus]})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/50">
                {['Invoice #','Vendor','Date','Total','Tax Amount','Tax Rate','Subtotal','Recon Status'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500">Loading GST reconciliationâ€¦</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500">No records found</td></tr>
              ) : (
                filtered.map(({ inv, status }) => (
                  <tr key={inv.id} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-blue-400 text-xs">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-white font-medium">{inv.vendor_name}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{fmtDate(inv.invoice_date)}</td>
                    <td className="px-4 py-3 text-white font-semibold">{fmt(inv.total_amount, inv.currency)}</td>
                    <td className="px-4 py-3 text-slate-200">{inv.tax_amount != null ? fmt(inv.tax_amount, inv.currency) : 'â€”'}</td>
                    <td className="px-4 py-3 text-slate-300">{inv.tax_rate != null ? `${inv.tax_rate}%` : 'â€”'}</td>
                    <td className="px-4 py-3 text-slate-300">{inv.subtotal_amount != null ? fmt(inv.subtotal_amount, inv.currency) : 'â€”'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusLabel[status].cls}`}>
                        {statusLabel[status].text}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-700 text-xs text-slate-500">
          Showing {filtered.length} of {invoices.length} invoices Â· Total tax: {fmt(totalTax)}
        </div>
      </div>
    </div>
  );
}

