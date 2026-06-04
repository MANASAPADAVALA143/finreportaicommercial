/**
 * Sales Invoices — UAE FTA-compliant VAT invoices + AR Aging
 */
import { useEffect, useState } from 'react';
import { FileText, AlertTriangle, RefreshCw, ChevronRight } from 'lucide-react';
import * as svc from '../../services/uaeFullAccounting.service';
import type { SalesInvoice } from '../../services/uaeFullAccounting.service';

const STATUS_STYLE: Record<string, string> = {
  draft:  'bg-gray-700 text-gray-300 border-gray-600',
  posted: 'bg-green-900/40 text-green-400 border-green-700',
  paid:   'bg-blue-900/40 text-blue-400 border-blue-700',
  overdue:'bg-red-900/40 text-red-400 border-red-700',
};

export default function SalesInvoices() {
  const [invoices, setInvoices]   = useState<SalesInvoice[]>([]);
  const [aging, setAging]         = useState<Record<string, number> | null>(null);
  const [tab, setTab]             = useState<'invoices' | 'aging'>('invoices');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [postingGL, setPostingGL] = useState<string>('');
  const [glCreated, setGLCreated] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    Promise.all([
      svc.listInvoices(),
      svc.getARaging(),
    ])
      .then(([inv, ar]) => {
        setInvoices(inv.invoices);
        setAging(ar.buckets);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handlePost = async (id: string) => {
    try {
      await svc.postInvoice(id);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handlePostToGL = async (inv: SalesInvoice) => {
    setPostingGL(inv.id);
    try {
      const res = await fetch('/api/uae/accounting/invoice-to-je', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: inv.invoice_number,
          invoice_type: 'AR',
          amount: inv.subtotal,
          vendor: inv.customer_id,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGLCreated(prev => ({ ...prev, [inv.id]: data.je_id ?? 'JE Created' }));
    } catch (e: any) {
      setError(`GL post failed: ${e.message}`);
    } finally {
      setPostingGL('');
    }
  };

  const arBuckets = aging
    ? [
        { label: 'Current',      value: aging.current,  color: 'text-green-400' },
        { label: '1–30 Days',    value: aging['1_30'],  color: 'text-amber-400' },
        { label: '31–60 Days',   value: aging['31_60'], color: 'text-orange-400' },
        { label: '61–90 Days',   value: aging['61_90'], color: 'text-red-400' },
        { label: '90+ Days',     value: aging['over_90'],color:'text-rose-400' },
      ]
    : [];

  const totalAR = arBuckets.reduce((s, b) => s + (b.value || 0), 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Sales Invoices</h1>
          <p className="text-gray-400 text-sm mt-1">UAE VAT-compliant AR — TRN required</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
            <RefreshCw size={14} />
          </button>
          <button className="flex items-center gap-2 bg-green-700 hover:bg-green-600 px-4 py-2 rounded-lg text-sm font-medium">
            <FileText size={14} /> New Invoice
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 mb-4 text-sm text-red-300">{error}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-800/60 p-1 rounded-xl w-fit">
        {(['invoices', 'aging'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
              tab === t ? 'bg-green-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {t === 'invoices' ? 'Invoices' : 'AR Aging'}
          </button>
        ))}
      </div>

      {tab === 'aging' && (
        <div>
          <div className="grid grid-cols-5 gap-4 mb-6">
            {arBuckets.map(b => (
              <div key={b.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">{b.label}</p>
                <p className={`text-lg font-bold ${b.color}`}>
                  AED {(b.value || 0).toLocaleString()}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {totalAR ? Math.round((b.value || 0) / totalAR * 100) : 0}%
                </p>
              </div>
            ))}
          </div>
          {totalAR > 0 && (
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle size={16} className="text-amber-400" />
              <span className="text-sm text-gray-300">
                Total AR Outstanding: <span className="text-white font-semibold">AED {totalAR.toLocaleString()}</span>
              </span>
            </div>
          )}
        </div>
      )}

      {tab === 'invoices' && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/80">
                <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Invoice #</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Customer</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Date</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Due</th>
                <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Subtotal</th>
                <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">VAT</th>
                <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Total</th>
                <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">Status</th>
                <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-700/50">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-gray-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                    No invoices yet. Click "New Invoice" to create one.
                  </td>
                </tr>
              ) : (
                invoices.map(inv => (
                  <tr key={inv.id} className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors">
                    <td className="px-4 py-3 font-mono text-blue-400 text-xs">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-gray-300 text-xs">{inv.customer_id.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{inv.invoice_date}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{inv.due_date}</td>
                    <td className="px-4 py-3 text-right text-white text-xs">{inv.subtotal.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-amber-400 text-xs">{inv.vat_amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-white font-medium text-xs">{inv.total_amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs border px-2 py-0.5 rounded-full ${STATUS_STYLE[inv.status] ?? STATUS_STYLE.draft}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        {inv.status === 'draft' && (
                          <button
                            onClick={() => handlePost(inv.id)}
                            className="text-xs bg-green-700 hover:bg-green-600 px-3 py-1 rounded text-white transition-colors"
                          >
                            Post
                          </button>
                        )}
                        {glCreated[inv.id] ? (
                          <span className="text-xs text-green-400 font-medium whitespace-nowrap">JE Created ✅</span>
                        ) : (
                          <button
                            onClick={() => handlePostToGL(inv)}
                            disabled={postingGL === inv.id}
                            className="text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 px-3 py-1 rounded text-white transition-colors whitespace-nowrap"
                          >
                            {postingGL === inv.id ? '…' : 'Post to GL →'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
