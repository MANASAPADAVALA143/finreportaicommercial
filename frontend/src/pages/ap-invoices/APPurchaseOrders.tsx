/**
 * APPurchaseOrders.tsx â€” Purchase Orders with Add PO dialog + 3-way match status.
 */
import { useEffect, useState, useMemo, useRef } from 'react';
import { Search, Plus, Trash2, RefreshCw, FileSpreadsheet, ScanLine, X, ChevronDown } from 'lucide-react';
import { apSupabase, apAgentUrl, type PurchaseOrder } from '../../lib/apSupabase';
import * as XLSX from 'xlsx';

const inputCls = 'w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:border-blue-500';
const labelCls = 'block text-xs font-medium text-gray-400 mb-1';

function fmtAmt(n: number, cur = 'USD') {
  return `$${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PO_STATUSES = ['Open', 'Partially Received', 'Fully Received', 'Closed', 'Cancelled'];

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    'Open':               'bg-blue-500/20 text-blue-300 border-blue-700/40',
    'Partially Received': 'bg-amber-500/20 text-amber-300 border-amber-700/40',
    'Fully Received':     'bg-green-500/20 text-green-300 border-green-700/40',
    'Closed':             'bg-gray-600/40 text-gray-400 border-gray-600/40',
    'Cancelled':          'bg-red-500/20 text-red-300 border-red-700/40',
  };
  return `text-[10px] px-2 py-0.5 rounded-full border font-medium ${map[s] || 'bg-gray-700 text-gray-300 border-gray-600'}`;
};

type LineItem = { description: string; quantity: number; unit_price: number; total: number };
const emptyLine = (): LineItem => ({ description: '', quantity: 1, unit_price: 0, total: 0 });

function AddPODialog({ vendors, onSaved, onClose }: { vendors: string[]; onSaved: () => void; onClose: () => void }) {
  const [form, setForm] = useState({
    po_number: '', vendor_name: '', po_amount: '',
    po_date: new Date().toISOString().slice(0, 10), delivery_date: '',
    status: 'Open' as PurchaseOrder['status'], description: '', notes: '',
  });
  const [lines, setLines]  = useState<LineItem[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const f = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  const updateLine = (i: number, key: keyof LineItem, val: string) => {
    setLines(prev => {
      const next = [...prev];
      const l = { ...next[i], [key]: key === 'description' ? val : parseFloat(val) || 0 };
      l.total = l.quantity * l.unit_price;
      next[i] = l;
      return next;
    });
  };

  const autoTotal = lines.reduce((s, l) => s + l.total, 0);

  const save = async () => {
    if (!form.vendor_name || !form.po_number) { setError('PO number and vendor are required.'); return; }
    setSaving(true); setError('');
    try {
      const { error: err } = await apSupabase.from('purchase_orders').insert({
        po_number:     form.po_number,
        vendor_name:   form.vendor_name,
        po_amount:     parseFloat(form.po_amount) || autoTotal,
        po_date:       form.po_date,
        delivery_date: form.delivery_date || null,
        status:        form.status,
        description:   form.description || null,
        notes:         form.notes || null,
        line_items:    lines.filter(l => l.description),
        created_at:    new Date().toISOString(),
        updated_at:    new Date().toISOString(),
      });
      if (err) throw err;
      onSaved(); onClose();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-base font-bold text-white">Add Purchase Order</h2>
          <button onClick={onClose}><X size={16} className="text-gray-400 hover:text-white" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>PO Number *</label>
              <input value={form.po_number} onChange={e => f('po_number', e.target.value)} placeholder="PO-2025-001" className={inputCls} /></div>
            <div>
              <label className={labelCls}>Vendor Name *</label>
              <input value={form.vendor_name} onChange={e => f('vendor_name', e.target.value)}
                list="vendor-list" placeholder="Select or type vendor" className={inputCls} />
              <datalist id="vendor-list">{vendors.map(v => <option key={v} value={v} />)}</datalist>
            </div>
            <div><label className={labelCls}>PO Amount</label>
              <input type="number" step="0.01" value={form.po_amount} onChange={e => f('po_amount', e.target.value)}
                placeholder={autoTotal > 0 ? String(autoTotal) : '0.00'} className={inputCls} /></div>
            <div><label className={labelCls}>Status</label>
              <select value={form.status} onChange={e => f('status', e.target.value as PurchaseOrder['status'])} className={inputCls}>
                {PO_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select></div>
            <div><label className={labelCls}>PO Date</label>
              <input type="date" value={form.po_date} onChange={e => f('po_date', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Delivery Date</label>
              <input type="date" value={form.delivery_date} onChange={e => f('delivery_date', e.target.value)} className={inputCls} /></div>
          </div>
          <div><label className={labelCls}>Description</label>
            <textarea value={form.description} onChange={e => f('description', e.target.value)}
              rows={2} className={inputCls} placeholder="PO descriptionâ€¦" /></div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Line Items</p>
              <button onClick={() => setLines(p => [...p, emptyLine()])} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                <Plus size={11} /> Add Line
              </button>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-1.5 pr-2 font-normal">Description</th>
                <th className="text-right py-1.5 pr-2 font-normal w-14">Qty</th>
                <th className="text-right py-1.5 pr-2 font-normal w-24">Unit Price</th>
                <th className="text-right py-1.5 pr-2 font-normal w-24">Total</th>
                <th className="w-5" />
              </tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-gray-800">
                    <td className="py-1 pr-2"><input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)}
                      placeholder="Item" className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs" /></td>
                    <td className="py-1 pr-2"><input type="number" value={l.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs text-right" /></td>
                    <td className="py-1 pr-2"><input type="number" step="0.01" value={l.unit_price} onChange={e => updateLine(i, 'unit_price', e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs text-right" /></td>
                    <td className="py-1 pr-2 text-right text-white">{l.total.toLocaleString()}</td>
                    <td className="py-1"><button onClick={() => setLines(p => p.filter((_, j) => j !== i))}><Trash2 size={11} className="text-gray-500 hover:text-red-400" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <p className="text-xs text-red-300 bg-red-900/20 rounded px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-xl text-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium">
              {saving ? 'Savingâ€¦' : 'Create PO'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function APPurchaseOrders() {
  const [pos, setPOs]           = useState<PurchaseOrder[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [showAdd, setShowAdd]   = useState(false);
  const [vendors, setVendors]   = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: poData }, { data: grnData }] = await Promise.all([
      apSupabase.from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(500),
      apSupabase.from('goods_receipts').select('po_id, grn_number, received_date, status').limit(500),
    ]);
    const grns = (grnData || []) as Array<{ po_id: string; grn_number: string; received_date: string; status: string }>;
    const rows = ((poData || []) as PurchaseOrder[]).map(po => {
      const matched = grns.filter(g => g.po_id === po.id);
      return { ...po, grn_number: matched[0]?.grn_number || null, match_status: matched.length ? 'Matched' : null };
    });
    setPOs(rows);
    setVendors([...new Set(rows.map(p => p.vendor_name))]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return pos;
    const q = search.toLowerCase();
    return pos.filter(p => p.po_number.toLowerCase().includes(q) || p.vendor_name.toLowerCase().includes(q));
  }, [pos, search]);

  const importFromXlsx = (f: File) => {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];
        const mapped = rows.map(r => ({
          po_number: String(r.po_number || r['PO Number'] || `PO-${Date.now()}`),
          vendor_name: String(r.vendor_name || r['Vendor'] || 'Unknown'),
          po_amount: parseFloat(String(r.po_amount || r['Amount'] || 0)),
          po_date: String(r.po_date || r['PO Date'] || new Date().toISOString().slice(0, 10)),
          status: 'Open' as const, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          description: null, delivery_date: null, notes: null,
        }));
        await apSupabase.from('purchase_orders').upsert(mapped, { onConflict: 'po_number' });
        void load();
      } catch { alert('Failed to import. Check file format.'); }
    };
    reader.readAsBinaryString(f);
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['po_number', 'vendor_name', 'po_amount', 'po_date', 'delivery_date', 'description'],
      ['PO-2025-001', 'Vendor Co.', 50000, '2025-01-15', '2025-02-15', 'Software services']]);
    XLSX.utils.book_append_sheet(wb, ws, 'POs');
    XLSX.writeFile(wb, 'po_import_template.xlsx');
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Purchase Orders</h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage purchase orders for 3-way matching</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => alert('Scan PO PDF â€” AI extraction requires InvoiceFlow agent running')}
            className="flex items-center gap-1.5 border border-gray-600 hover:border-gray-500 px-3 py-2 rounded-lg text-xs text-gray-300">
            <ScanLine size={13} /> Scan PO PDF
          </button>
          <button onClick={downloadTemplate}
            className="flex items-center gap-1.5 border border-gray-600 hover:border-gray-500 px-3 py-2 rounded-lg text-xs text-gray-300">
            <FileSpreadsheet size={13} /> Download template
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 border border-gray-600 hover:border-blue-500 px-3 py-2 rounded-lg text-xs text-gray-300">
            <FileSpreadsheet size={13} /> Upload CSV/Excel
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importFromXlsx(f); }} />
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded-lg text-xs text-white font-medium">
            <Plus size={13} /> Add Purchase Order
          </button>
          <button onClick={load} disabled={loading} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by PO number or vendor nameâ€¦"
          className="w-full bg-gray-800 border border-gray-700 text-white pl-8 pr-3 py-2 rounded-lg text-sm" />
      </div>

      {/* Table */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-white">All Purchase Orders</h3>
          <span className="text-xs text-gray-400">{filtered.length} POs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/80 text-gray-400 text-xs font-semibold">
                {['PO Number', 'Vendor', 'Amount', 'PO Date', 'Delivery', 'Status', 'GRN', 'Invoice Match', 'Created', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-700/50">
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-700 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                  {pos.length === 0 ? 'No purchase orders yet. Click "Add Purchase Order" to create one.' : 'No POs match your search.'}
                </td></tr>
              ) : (
                filtered.map(po => (
                  <tr key={po.id} className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors">
                    <td className="px-4 py-3 text-blue-400 font-mono text-xs font-medium">{po.po_number}</td>
                    <td className="px-4 py-3 text-white text-xs max-w-[160px] truncate">{po.vendor_name}</td>
                    <td className="px-4 py-3 text-white text-xs font-medium whitespace-nowrap">{fmtAmt(po.po_amount, po.currency || 'USD')}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{po.po_date}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{po.delivery_date || 'â€”'}</td>
                    <td className="px-4 py-3"><span className={statusBadge(po.status)}>{po.status}</span></td>
                    <td className="px-4 py-3 text-blue-400 text-xs font-mono">{po.grn_number || 'â€”'}</td>
                    <td className="px-4 py-3">
                      {po.match_status
                        ? <span className="text-xs text-green-400 font-medium">âœ… {po.match_status}</span>
                        : <span className="text-xs text-gray-500">â€”</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{po.created_at?.slice(0, 10)}</td>
                    <td className="px-4 py-3">
                      <a href="/ap-invoices/grn" className="text-xs text-blue-400 hover:text-blue-300 border border-blue-700/40 rounded px-2 py-1">
                        Create GRN
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddPODialog vendors={vendors} onSaved={load} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

