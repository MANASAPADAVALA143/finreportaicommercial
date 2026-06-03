/**
 * APVendors.tsx
 * Vendor master — derived from invoices table (no separate vendors table required).
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, Building2, RefreshCw, X } from 'lucide-react';
import { apSupabase, type APInvoice } from '../../lib/apSupabase';

function fmtAED(n: number) {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 0 })}`;
}

type VendorRow = {
  name: string;
  totalInvoices: number;
  totalSpend: number;
  avgAmount: number;
  lastInvoice: string | null;
  statuses: Record<string, number>;
  riskCounts: Record<string, number>;
};

function VendorDrawer({ vendor, invoices, onClose }: { vendor: VendorRow; invoices: APInvoice[]; onClose: () => void }) {
  const mine = invoices.filter(i => i.vendor_name === vendor.name);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-gray-900 border-l border-gray-700 h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Building2 size={15} /> {vendor.name}
          </h2>
          <button onClick={onClose}><X size={16} className="text-gray-400 hover:text-white" /></button>
        </div>
        <div className="px-5 py-4 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Total Invoices', value: String(vendor.totalInvoices) },
              { label: 'Total Spend',    value: fmtAED(vendor.totalSpend) },
              { label: 'Avg Invoice',    value: fmtAED(vendor.avgAmount) },
              { label: 'Last Invoice',   value: vendor.lastInvoice || '—' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-800 rounded-lg p-3">
                <p className="text-[10px] text-gray-400">{label}</p>
                <p className="text-sm font-bold text-white mt-0.5">{value}</p>
              </div>
            ))}
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Invoice History</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {mine.slice(0, 20).map(inv => (
                <div key={inv.id} className="flex items-center justify-between text-xs border-b border-gray-800 pb-2">
                  <div>
                    <p className="text-white">#{inv.invoice_number}</p>
                    <p className="text-gray-500">{inv.invoice_date || inv.created_at?.slice(0, 10) || '—'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white">{fmtAED(inv.total_amount)}</p>
                    <p className={`text-[10px] ${inv.status === 'Approved' || inv.status === 'Paid' ? 'text-green-400' : inv.status === 'Rejected' ? 'text-red-400' : 'text-amber-400'}`}>
                      {inv.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function APVendors() {
  const [invoices, setInvoices] = useState<APInvoice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState<VendorRow | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await apSupabase
      .from('invoices')
      .select('id,invoice_number,invoice_date,vendor_name,total_amount,status,risk_score,created_at,approval_status')
      .order('created_at', { ascending: false })
      .limit(1000);
    setInvoices((data || []) as APInvoice[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const vendors = useMemo((): VendorRow[] => {
    const map = new Map<string, VendorRow>();
    for (const inv of invoices) {
      const name = inv.vendor_name || 'Unknown';
      if (!map.has(name)) {
        map.set(name, { name, totalInvoices: 0, totalSpend: 0, avgAmount: 0, lastInvoice: null, statuses: {}, riskCounts: {} });
      }
      const v = map.get(name)!;
      v.totalInvoices++;
      v.totalSpend += inv.total_amount || 0;
      v.statuses[inv.status] = (v.statuses[inv.status] || 0) + 1;
      if (inv.risk_score) v.riskCounts[inv.risk_score] = (v.riskCounts[inv.risk_score] || 0) + 1;
      const d = inv.invoice_date || inv.created_at?.slice(0, 10);
      if (d && (!v.lastInvoice || d > v.lastInvoice)) v.lastInvoice = d;
    }
    for (const v of map.values()) {
      v.avgAmount = v.totalInvoices > 0 ? v.totalSpend / v.totalInvoices : 0;
    }
    return Array.from(map.values()).sort((a, b) => b.totalSpend - a.totalSpend);
  }, [invoices]);

  const filtered = useMemo(() => {
    if (!search.trim()) return vendors;
    const q = search.toLowerCase();
    return vendors.filter(v => v.name.toLowerCase().includes(q));
  }, [vendors, search]);

  const riskColor = (v: VendorRow) => {
    if (v.riskCounts['high'] > 0) return 'text-red-400';
    if (v.riskCounts['medium'] > 0) return 'text-amber-400';
    return 'text-green-400';
  };

  const riskLabel = (v: VendorRow) => {
    if (v.riskCounts['high'] > 0) return 'High';
    if (v.riskCounts['medium'] > 0) return 'Medium';
    if (v.riskCounts['low'] > 0) return 'Low';
    return '—';
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Vendors</h1>
          <p className="text-gray-400 text-sm mt-1">{vendors.length} vendors · derived from invoice history</p>
        </div>
        <button onClick={load} disabled={loading} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor…" className="bg-gray-800 border border-gray-700 text-white pl-8 pr-3 py-2 rounded-lg text-sm w-72" />
      </div>

      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80">
              {['Vendor', 'Invoices', 'Total Spend', 'Avg Invoice', 'Last Invoice', 'Status Mix', 'Risk'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-700 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                {invoices.length === 0 ? 'No invoice data. Check InvoiceFlow Supabase connection.' : 'No vendors match search.'}
              </td></tr>
            ) : (
              filtered.map(v => (
                <tr
                  key={v.name}
                  className="border-b border-gray-700/30 hover:bg-gray-700/20 cursor-pointer transition-colors"
                  onClick={() => setSelected(v)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 size={14} className="text-gray-500" />
                      <span className="text-white text-xs font-medium max-w-[160px] truncate">{v.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{v.totalInvoices}</td>
                  <td className="px-4 py-3 text-white text-xs font-medium">{fmtAED(v.totalSpend)}</td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{fmtAED(v.avgAmount)}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{v.lastInvoice || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {Object.entries(v.statuses).slice(0, 3).map(([s, c]) => (
                        <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">{s} {c}</span>
                      ))}
                    </div>
                  </td>
                  <td className={`px-4 py-3 text-xs font-medium ${riskColor(v)}`}>{riskLabel(v)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && <VendorDrawer vendor={selected} invoices={invoices} onClose={() => setSelected(null)} />}
    </div>
  );
}
