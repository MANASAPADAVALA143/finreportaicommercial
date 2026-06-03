/**
 * India Sales Invoices — GST (CGST/SGST/IGST), supply type, HSN/SAC
 */
import { useEffect, useState } from 'react';
import { Receipt, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import * as svc from '../../services/indiaAccounting.service';
import type { IndiaSalesInvoice } from '../../services/indiaAccounting.service';

const STATUS_STYLE: Record<string, string> = {
  draft:     'border-gray-600 text-gray-400',
  posted:    'border-blue-700 text-blue-400 bg-blue-900/20',
  paid:      'border-emerald-700 text-emerald-400 bg-emerald-900/20',
  cancelled: 'border-red-700 text-red-400',
};

const INR = (v: number) => `₹${v.toLocaleString('en-IN')}`;

export default function IndiaSalesInvoices() {
  const [invoices, setInvoices] = useState<IndiaSalesInvoice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [posting, setPosting]   = useState('');
  const [error, setError]       = useState('');
  const [msg, setMsg]           = useState('');
  const [tab, setTab]           = useState<'invoices' | 'summary'>('invoices');

  const load = () => {
    setLoading(true);
    svc.listSalesInvoices()
      .then(d => setInvoices(d.invoices))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handlePost = async (id: string) => {
    setPosting(id); setError(''); setMsg('');
    try {
      await svc.postSalesInvoice(id);
      setMsg('Invoice posted — journal entry created, CGST/SGST/IGST recorded');
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPosting('');
    }
  };

  const totalRevenue = invoices.filter(i => i.status === 'posted').reduce((s, i) => s + i.subtotal, 0);
  const totalGST     = invoices.filter(i => i.status === 'posted').reduce((s, i) => s + i.cgst_amount + i.sgst_amount + i.igst_amount, 0);
  const totalAR      = invoices.reduce((s, i) => s + i.outstanding, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Sales Invoices</h1>
          <p className="text-gray-400 text-sm mt-1">GST invoicing — CGST/SGST (intra-state) · IGST (inter-state)</p>
        </div>
        <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg"><RefreshCw size={14} /></button>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-emerald-900/40 text-emerald-300 border border-emerald-700'}`}>
          {error || msg}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Revenue (excl. GST)', value: INR(totalRevenue), color: 'text-emerald-400' },
          { label: 'GST Output',          value: INR(totalGST),     color: 'text-purple-400' },
          { label: 'AR Outstanding',      value: INR(totalAR),      color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-lg font-bold ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* GST Note */}
      <div className="bg-purple-900/20 border border-purple-800/40 rounded-xl p-4 mb-6 flex flex-wrap gap-4">
        {[
          { label: 'Intra-state', value: 'CGST + SGST (half each)' },
          { label: 'Inter-state', value: 'IGST (full rate)' },
          { label: 'GST Rates',   value: '0% / 5% / 12% / 18% / 28%' },
          { label: 'E-Invoice',   value: 'IRN generated for B2B > ₹5Cr' },
        ].map(b => (
          <div key={b.label} className="bg-gray-900/60 rounded-lg px-3 py-2">
            <p className="text-xs text-gray-500">{b.label}</p>
            <p className="text-sm font-bold text-purple-400">{b.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80">
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Invoice #</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Date</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Type</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Taxable</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">CGST</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">SGST</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">IGST</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Total</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Outstanding</th>
              <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  {Array.from({ length: 11 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-700 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-gray-500">
                  No invoices. Create a customer and add sales invoices.
                </td>
              </tr>
            ) : (
              invoices.map(inv => (
                <tr key={inv.id} className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-orange-400 text-xs">{inv.invoice_number}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{inv.invoice_date}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${inv.supply_type === 'inter' ? 'border-blue-700 text-blue-400 bg-blue-900/20' : 'border-purple-700 text-purple-400 bg-purple-900/20'}`}>
                      {inv.supply_type === 'inter' ? 'IGST' : 'CGST+SGST'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-white text-xs">{INR(inv.subtotal)}</td>
                  <td className="px-4 py-3 text-right text-purple-300 text-xs">{INR(inv.cgst_amount)}</td>
                  <td className="px-4 py-3 text-right text-purple-300 text-xs">{INR(inv.sgst_amount)}</td>
                  <td className="px-4 py-3 text-right text-blue-300 text-xs">{INR(inv.igst_amount)}</td>
                  <td className="px-4 py-3 text-right text-white font-medium text-xs">{INR(inv.total_amount)}</td>
                  <td className="px-4 py-3 text-right text-amber-400 text-xs">{INR(inv.outstanding)}</td>
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
                        className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-2 py-1 rounded text-white"
                      >
                        {posting === inv.id ? '…' : 'Post'}
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
