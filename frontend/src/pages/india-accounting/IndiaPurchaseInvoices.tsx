/**
 * India Purchase Invoices — ITC (Input Tax Credit), TDS on purchase
 */
import { useEffect, useState } from 'react';
import { IndianRupee, RefreshCw } from 'lucide-react';
import * as svc from '../../services/indiaAccounting.service';
import type { IndiaPurchaseInvoice } from '../../services/indiaAccounting.service';

const INR = (v: number) => `₹${v.toLocaleString('en-IN')}`;

const STATUS_STYLE: Record<string, string> = {
  draft:  'border-gray-600 text-gray-400',
  posted: 'border-blue-700 text-blue-400 bg-blue-900/20',
};

export default function IndiaPurchaseInvoices() {
  const [invoices, setInvoices] = useState<IndiaPurchaseInvoice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [posting, setPosting]   = useState('');
  const [error, setError]       = useState('');
  const [msg, setMsg]           = useState('');

  const load = () => {
    setLoading(true);
    svc.listPurchaseInvoices()
      .then(d => setInvoices(d.invoices))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handlePost = async (id: string) => {
    setPosting(id); setError(''); setMsg('');
    try {
      const r = await svc.postPurchaseInvoice(id);
      setMsg(`Invoice posted — ITC claimed ₹${r.itc_claimed.toLocaleString('en-IN')}`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPosting('');
    }
  };

  const totalPurchase = invoices.filter(i => i.status === 'posted').reduce((s, i) => s + i.subtotal, 0);
  const totalITC      = invoices.filter(i => i.status === 'posted' && i.itc_eligible).reduce((s, i) => s + i.itc_claimed, 0);
  const totalTDS      = invoices.reduce((s, i) => s + i.tds_deducted, 0);
  const totalAP       = invoices.reduce((s, i) => s + i.outstanding, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Purchase Invoices</h1>
          <p className="text-gray-400 text-sm mt-1">ITC (Input Tax Credit) · TDS on vendor payments</p>
        </div>
        <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg"><RefreshCw size={14} /></button>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-emerald-900/40 text-emerald-300 border border-emerald-700'}`}>
          {error || msg}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Purchases',  value: INR(totalPurchase), color: 'text-white' },
          { label: 'ITC Claimed',      value: INR(totalITC),      color: 'text-emerald-400' },
          { label: 'TDS Deducted',     value: INR(totalTDS),      color: 'text-red-400' },
          { label: 'AP Outstanding',   value: INR(totalAP),       color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-lg font-bold ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ITC info */}
      <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-xl p-4 mb-6">
        <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Input Tax Credit (ITC) — GST Act</p>
        <div className="flex flex-wrap gap-4 text-xs text-gray-400">
          <span>✓ CGST paid can be set off against CGST/IGST liability</span>
          <span>✓ SGST paid can be set off against SGST/IGST liability</span>
          <span>✓ IGST paid can be set off against IGST/CGST/SGST liability</span>
          <span>✗ Blocked credit: motor vehicles, personal use, Section 17(5)</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80">
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Invoice #</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Date</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Supply</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Taxable</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">GST Input</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">ITC Eligible</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">TDS</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Total</th>
              <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  {Array.from({ length: 10 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-700 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                  No purchase invoices yet.
                </td>
              </tr>
            ) : (
              invoices.map(inv => (
                <tr key={inv.id} className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-orange-400 text-xs">{inv.invoice_number}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{inv.invoice_date}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${inv.supply_type === 'inter' ? 'border-blue-700 text-blue-400' : 'border-purple-700 text-purple-400'}`}>
                      {inv.supply_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-white text-xs">{INR(inv.subtotal)}</td>
                  <td className="px-4 py-3 text-right text-purple-300 text-xs">
                    {INR(inv.cgst_amount + inv.sgst_amount + inv.igst_amount)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs">
                    {inv.itc_eligible
                      ? <span className="text-emerald-400">{INR(inv.itc_claimed)}</span>
                      : <span className="text-gray-600">Blocked</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-red-400 text-xs">
                    {inv.tds_deducted > 0 ? INR(inv.tds_deducted) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-white font-medium text-xs">{INR(inv.total_amount)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[inv.status] || 'border-gray-600 text-gray-400'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {inv.status === 'draft' && (
                      <button
                        onClick={() => handlePost(inv.id)}
                        disabled={!!posting}
                        className="text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 px-2 py-1 rounded text-white"
                      >
                        {posting === inv.id ? '…' : 'Post+ITC'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
