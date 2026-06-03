/**
 * APDashboard.tsx
 * AP InvoiceFlow dashboard embedded inside FinReportAI.
 * Live data from InvoiceFlow Supabase project.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { FileText, Clock, DollarSign, CheckCircle, AlertTriangle, Zap, RefreshCw } from 'lucide-react';
import { apSupabase, type APInvoice } from '../../lib/apSupabase';

const PIE_COLORS = ['#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#8B5CF6'];

function fmtAED(n: number) {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

type Stats = {
  total: number;
  pending: number;
  totalValue: number;
  approvedCount: number;
  duplicateFlags: number;
  avgSeconds: number;
};

export default function APDashboard() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<APInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, totalValue: 0, approvedCount: 0, duplicateFlags: 0, avgSeconds: 0 });

  const load = async () => {
    setLoading(true);
    const { data } = await apSupabase
      .from('invoices')
      .select('id,invoice_number,invoice_date,vendor_name,total_amount,currency,status,risk_score,risk_flags,processing_time_seconds,created_at,ifrs_category,approval_status,match_status')
      .order('created_at', { ascending: false })
      .limit(200);
    const rows = (data || []) as APInvoice[];
    setInvoices(rows);

    const now = new Date();
    const monthRows = rows.filter(r => {
      if (!r.created_at) return false;
      const d = new Date(r.created_at);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });

    const dupFlags = rows.filter(r => {
      const flags = Array.isArray(r.risk_flags) ? r.risk_flags : [];
      return flags.some((f: { type?: string }) => f.type === 'duplicate');
    }).length;

    const times = rows.map(r => r.processing_time_seconds || 0).filter(t => t > 0);
    const avg = times.length ? times.reduce((s, t) => s + t, 0) / times.length : 0;

    setStats({
      total: monthRows.length,
      pending: rows.filter(r => r.status === 'Processing' || r.approval_status === 'pending').length,
      totalValue: monthRows.reduce((s, r) => s + (r.total_amount || 0), 0),
      approvedCount: rows.filter(r => r.approval_status === 'approved' || r.status === 'Approved').length,
      duplicateFlags: dupFlags,
      avgSeconds: Math.round(avg),
    });
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  // Monthly bar chart data (last 6 months)
  const barData = (() => {
    const months: Record<string, number> = {};
    invoices.forEach(inv => {
      if (!inv.created_at) return;
      const d = new Date(inv.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[key] = (months[key] || 0) + 1;
    });
    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, count]) => ({ month: month.slice(5), count }));
  })();

  // Pie chart — status distribution
  const statusCounts = ['Processing', 'Approved', 'Paid', 'Rejected', 'On Hold'].map(s => ({
    name: s,
    value: invoices.filter(i => i.status === s).length,
  })).filter(s => s.value > 0);

  const recent = invoices.slice(0, 10);

  const KPI = [
    { label: 'Invoices This Month', value: loading ? '—' : String(stats.total), icon: FileText,     color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-700/40' },
    { label: 'Pending Approvals',   value: loading ? '—' : String(stats.pending), icon: Clock,        color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-700/40', pulse: stats.pending > 0 },
    { label: 'Total AP Value',      value: loading ? '—' : fmtAED(stats.totalValue), icon: DollarSign,   color: 'text-emerald-400',bg: 'bg-emerald-500/10',border: 'border-emerald-700/40' },
    { label: 'Approved',            value: loading ? '—' : String(stats.approvedCount), icon: CheckCircle,  color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-700/40' },
    { label: 'Duplicate Flags',     value: loading ? '—' : String(stats.duplicateFlags), icon: AlertTriangle, color: 'text-red-400',  bg: 'bg-red-500/10',    border: 'border-red-700/40', pulse: stats.duplicateFlags > 0 },
    { label: 'Avg Processing (s)',  value: loading ? '—' : String(stats.avgSeconds), icon: Zap,          color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-700/40' },
  ];

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      Processing: 'bg-amber-500/20 text-amber-300 border-amber-700/40',
      Approved:   'bg-green-500/20 text-green-300 border-green-700/40',
      Paid:       'bg-blue-500/20 text-blue-300 border-blue-700/40',
      Rejected:   'bg-red-500/20 text-red-300 border-red-700/40',
      'On Hold':  'bg-orange-500/20 text-orange-300 border-orange-700/40',
    };
    return map[s] || 'bg-gray-700 text-gray-300 border-gray-600';
  };

  const riskBadge = (r: string | null) => {
    if (!r) return '';
    const map: Record<string, string> = { low: 'text-green-400', medium: 'text-amber-400', high: 'text-red-400' };
    return map[r] || 'text-gray-400';
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">AP Invoice Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Live from InvoiceFlow · all AP invoices, approvals, and risk signals</p>
        </div>
        <button onClick={load} disabled={loading} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {KPI.map(k => (
          <div key={k.label} className={`${k.bg} border ${k.border} rounded-xl p-4 relative`}>
            {k.pulse && (
              <span className="absolute top-3 right-3 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${k.color.replace('text-', 'bg-')}`} />
              </span>
            )}
            <k.icon size={16} className={`${k.color} mb-2`} />
            <p className="text-[11px] text-gray-400">{k.label}</p>
            <p className={`text-xl font-bold mt-1 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly volume */}
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-4">Monthly Invoice Volume</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#F9FAFB' }} />
              <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Status pie */}
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-4">Status Distribution</h3>
          {statusCounts.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={statusCounts} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value">
                    {statusCounts.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#F9FAFB' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {statusCounts.map((s, i) => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-gray-300">{s.name}</span>
                    <span className="text-white font-medium ml-auto">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-12">No data</p>
          )}
        </div>
      </div>

      {/* Recent invoices */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Recent Invoices</h3>
          <button onClick={() => navigate('/ap-invoices/list')} className="text-xs text-blue-400 hover:text-blue-300">
            View all →
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/80">
                {['Invoice #', 'Vendor', 'Date', 'Amount', 'Status', 'Risk'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-xs text-gray-400 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-700/50">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-700 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : recent.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">No invoices found. Upload your first invoice in InvoiceFlow.</td></tr>
              ) : (
                recent.map(inv => (
                  <tr
                    key={inv.id}
                    className="border-b border-gray-700/30 hover:bg-gray-700/20 cursor-pointer transition-colors"
                    onClick={() => navigate('/ap-invoices/list')}
                  >
                    <td className="px-4 py-3 text-blue-400 font-mono text-xs">{inv.invoice_number || '—'}</td>
                    <td className="px-4 py-3 text-white text-xs max-w-[160px] truncate">{inv.vendor_name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{inv.invoice_date || inv.created_at?.slice(0, 10) || '—'}</td>
                    <td className="px-4 py-3 text-white text-xs font-medium">{fmtAED(inv.total_amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${statusBadge(inv.status)}`}>{inv.status}</span>
                    </td>
                    <td className={`px-4 py-3 text-xs font-medium ${riskBadge(inv.risk_score)}`}>
                      {inv.risk_score ? inv.risk_score.toUpperCase() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
