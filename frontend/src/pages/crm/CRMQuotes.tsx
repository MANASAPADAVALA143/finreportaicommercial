import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, FileText } from 'lucide-react';
import { convertQuoteToInvoice, createQuote, listQuotes, type CRMQuote } from '../../services/crmService';

function emptyLine() {
  return { description: '', qty: 1, unit_price: 0, vat_rate: 5 };
}

export default function CRMQuotes() {
  const [quotes, setQuotes] = useState<CRMQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [lines, setLines] = useState([emptyLine()]);
  const [converting, setConverting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listQuotes();
      setQuotes(res.quotes);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const vat = lines.reduce((s, l) => s + l.qty * l.unit_price * (l.vat_rate / 100), 0);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!lines.some((l) => l.description && l.unit_price > 0)) {
      toast.error('Add at least one line item');
      return;
    }
    try {
      await createQuote(lines.filter((l) => l.description));
      toast.success('Quote created');
      setShowCreate(false);
      setLines([emptyLine()]);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function handleConvert(q: CRMQuote) {
    if (q.status !== 'Accepted' && q.status !== 'Sent' && q.status !== 'Draft') return;
    setConverting(q.id);
    try {
      const res = await convertQuoteToInvoice(q.id);
      toast.success(`Invoice ${res.invoice_number} created — deal marked Won`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Convert failed');
    } finally {
      setConverting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-teal-700 px-4 py-2 rounded-lg text-sm">
          <Plus size={14} /> Create Quote
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : quotes.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <FileText className="mx-auto h-12 w-12 text-gray-600 mb-3" />
          <p>No quotes yet — create your first quote</p>
        </div>
      ) : (
        <div className="overflow-x-auto w-full rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/80 text-gray-400 text-left">
              <tr>
                <th className="p-3">Quote #</th>
                <th className="p-3">Status</th>
                <th className="p-3">Total AED</th>
                <th className="p-3">Valid until</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id} className="border-t border-gray-800">
                  <td className="p-3 font-medium">{q.quote_number}</td>
                  <td className="p-3"><span className="px-2 py-0.5 rounded bg-gray-800 text-xs">{q.status}</span></td>
                  <td className="p-3">AED {q.total_aed.toLocaleString()}</td>
                  <td className="p-3 text-gray-400">{q.valid_until || '—'}</td>
                  <td className="p-3">
                    {!q.ar_invoice_id && (
                      <button
                        type="button"
                        disabled={converting === q.id}
                        onClick={() => void handleConvert(q)}
                        className="text-xs bg-green-800 hover:bg-green-700 px-3 py-1 rounded disabled:opacity-50"
                      >
                        {converting === q.id ? 'Converting…' : 'Convert to Invoice'}
                      </button>
                    )}
                    {q.ar_invoice_id && <span className="text-xs text-green-400">Invoiced</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <form onSubmit={(e) => void handleCreate(e)} className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg p-6 space-y-3 my-8">
            <h3 className="text-lg font-semibold">New Quote</h3>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-4 gap-2">
                <input className="col-span-2 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm" placeholder="Description" value={l.description} onChange={(e) => { const n = [...lines]; n[i] = { ...l, description: e.target.value }; setLines(n); }} />
                <input className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm" type="number" placeholder="Qty" value={l.qty} onChange={(e) => { const n = [...lines]; n[i] = { ...l, qty: parseFloat(e.target.value) || 0 }; setLines(n); }} />
                <input className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm" type="number" placeholder="Price" value={l.unit_price || ''} onChange={(e) => { const n = [...lines]; n[i] = { ...l, unit_price: parseFloat(e.target.value) || 0 }; setLines(n); }} />
              </div>
            ))}
            <button type="button" onClick={() => setLines([...lines, emptyLine()])} className="text-xs text-teal-400">+ Line</button>
            <p className="text-sm text-gray-400">Total: AED {(subtotal + vat).toLocaleString()} (incl. VAT)</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="text-gray-400 text-sm">Cancel</button>
              <button type="submit" className="bg-teal-700 px-4 py-2 rounded-lg text-sm">Save Quote</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
