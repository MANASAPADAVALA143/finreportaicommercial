/**
 * APAgingReport.tsx — AP Aging Report
 * Groups outstanding invoices into aging buckets: Current, 1-30, 31-60, 61-90, 90+ days
 */
import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Clock, TrendingUp, AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { apSupabase, type APInvoice } from '../../lib/apSupabase';
import * as XLSX from 'xlsx';

function fmt(n: number, cur = 'AED') {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

type AgingBucket = { label: string; days: string; invoices: APInvoice[]; total: number; color: string };

function getAgingBucket(inv: APInvoice): string {
  if (!inv.due_date || inv.status === 'Paid') return 'current';
  const days = Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000);
  if (days <= 0)  return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

function getDaysOverdue(inv: APInvoice): number {
  if (!inv.due_date) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000));
}

export default function APAgingReport() {
  const [invoices, setInvoices] = useState<APInvoice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState<string>('all');

  const load = async () => {
    setLoading(true);
    const { data } = await apSupabase
      .from('invoices')
      .select('*')
      .not('status', 'eq', 'Paid')
      .order('due_date', { ascending: true })
      .limit(500);
    setInvoices((data ?? []) as APInvoice[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const buckets: AgingBucket[] = useMemo(() => {
    const groups: Record<string, APInvoice[]> = { current: [], '1-30': [], '31-60': [], '61-90': [], '90+': [] };
    invoices.forEach(inv => groups[getAgingBucket(inv)].push(inv));
    return [
      { label: 'Current',   days: 'Not yet due',  invoices: groups['current'], total: groups['current'].reduce((s,i) => s+i.total_amount, 0), color: '#22c55e' },
      { label: '1–30 Days', days: '1–30 days',    invoices: groups['1-30'],   total: groups['1-30'].reduce((s,i) => s+i.total_amount, 0),   color: '#facc15' },
      { label: '31–60 Days',days: '31–60 days',   invoices: groups['31-60'],  total: groups['31-60'].reduce((s,i) => s+i.total_amount, 0),  color: '#fb923c' },
      { label: '61–90 Days',days: '61–90 days',   invoices: groups['61-90'],  total: groups['61-90'].reduce((s,i) => s+i.total_amount, 0),  color: '#f97316' },
      { label: '90+ Days',  days: 'Over 90 days', invoices: groups['90+'],    total: groups['90+'].reduce((s,i) => s+i.total_amount, 0),    color: '#ef4444' },
    ];
  }, [invoices]);

  const totalOutstanding = buckets.reduce((s, b) => s + b.total, 0);
  const totalOverdue = buckets.slice(1).reduce((s, b) => s + b.total, 0);

  const chartData = buckets.map(b => ({ name: b.label, amount: b.total, count: b.invoices.length }));

  const displayBucket = activeTab === 'all' ? null : buckets.find(b => b.label === activeTab);
  const displayInvoices = displayBucket ? displayBucket.invoices : invoices;

  const exportXLSX = () => {
    const rows = invoices.map(inv => ({
      'Invoice #': inv.invoice_number,
      'Vendor': inv.vendor_name,
      'Amount': inv.total_amount,
      'Currency': inv.currency,
      'Due Date': inv.due_date ?? '',
      'Days Overdue': getDaysOverdue(inv),
      'Aging Bucket': getAgingBucket(inv),
      'Status': inv.status,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'AP Aging');
    XLSX.writeFile(wb, `ap_aging_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-orange-400" /> AP Aging Report
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">Outstanding invoices grouped by days overdue</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={exportXLSX} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">Total Outstanding</p>
          <p className="text-lg font-bold text-white mt-1">{fmt(totalOutstanding)}</p>
        </div>
        <div className="bg-slate-900 border border-red-800/40 rounded-xl p-4">
          <p className="text-xs text-red-400">Total Overdue</p>
          <p className="text-lg font-bold text-red-400 mt-1">{fmt(totalOverdue)}</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">Invoices Outstanding</p>
          <p className="text-lg font-bold text-white mt-1">{invoices.length}</p>
        </div>
        <div className="bg-slate-900 border border-orange-800/40 rounded-xl p-4">
          <p className="text-xs text-orange-400">90+ Days</p>
          <p className="text-lg font-bold text-orange-400 mt-1">{fmt(buckets[4].total)}</p>
        </div>
      </div>

      {/* Bar chart */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
        <p className="text-sm font-semibold text-white mb-4">Aging Distribution</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} barSize={48}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => `${(v/1000).toFixed(0)}k`} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
              formatter={(v: number) => [fmt(v), 'Amount']}
            />
            <Bar dataKey="amount" radius={[4,4,0,0]}>
              {chartData.map((_, i) => <Cell key={i} fill={buckets[i].color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Bucket tabs */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setActiveTab('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
          All ({invoices.length})
        </button>
        {buckets.map(b => (
          <button key={b.label} onClick={() => setActiveTab(b.label)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === b.label ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
            {b.label} ({b.invoices.length})
          </button>
        ))}
      </div>

      {/* Invoice table */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/50">
                {['Invoice #', 'Vendor', 'Amount', 'Due Date', 'Days Overdue', 'Aging Bucket', 'Status'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">Loading aging report…</td></tr>
              ) : displayInvoices.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">No invoices in this bucket</td></tr>
              ) : (
                displayInvoices.map(inv => {
                  const bucket = getAgingBucket(inv);
                  const days = getDaysOverdue(inv);
                  const b = buckets.find(x => x.label.toLowerCase().startsWith(bucket === 'current' ? 'current' : bucket.replace('1-30','1').replace('31-60','31').replace('61-90','61').replace('90+','90'))) || buckets[0];
                  return (
                    <tr key={inv.id} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 font-mono text-blue-400 text-xs">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-white font-medium">{inv.vendor_name}</td>
                      <td className="px-4 py-3 text-white font-semibold">{fmt(inv.total_amount, inv.currency)}</td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{fmtDate(inv.due_date)}</td>
                      <td className="px-4 py-3">
                        {days > 0 ? (
                          <span className="flex items-center gap-1 text-xs font-bold" style={{ color: b.color }}>
                            <AlertTriangle className="w-3 h-3" /> {days} days
                          </span>
                        ) : <span className="text-green-400 text-xs font-medium">Current</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: b.color + '22', color: b.color, border: `1px solid ${b.color}44` }}>
                          {bucket === 'current' ? 'Current' : `${bucket} days`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{inv.status}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-700">
          <p className="text-xs text-slate-500">Total outstanding: <span className="text-white font-semibold">{fmt(totalOutstanding)}</span></p>
        </div>
      </div>
    </div>
  );
}
