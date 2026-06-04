/**
 * APGoodsReceipts.tsx
 * Goods Receipts (GRN) management â€” embedded inside FinReportAI from InvoiceFlow data.
 * Queries: goods_receipts, purchase_orders
 */
import { useState, useEffect, useRef } from 'react';
import {
  Package, Plus, Upload, Search, X, ChevronDown,
  FileText, CheckCircle, AlertTriangle, Clock, Truck,
  Eye, Download, Camera, RefreshCw,
} from 'lucide-react';
import { apSupabase, type GoodsReceipt, type PurchaseOrder } from '../../lib/apSupabase';
import * as XLSX from 'xlsx';

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function fmt(n: number | null | undefined, cur = 'AED') {
  if (n == null) return 'â€”';
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return 'â€”';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_STYLES: Record<string, string> = {
  'received':          'bg-green-900 text-green-300 border border-green-700',
  'partial':           'bg-yellow-900 text-yellow-300 border border-yellow-700',
  'pending':           'bg-slate-700 text-slate-300 border border-slate-600',
  'rejected':          'bg-red-900 text-red-300 border border-red-700',
};

function StatusBadge({ s }: { s: string | null | undefined }) {
  const label = s ?? 'pending';
  const style = STATUS_STYLES[label.toLowerCase()] ?? 'bg-slate-700 text-slate-300 border border-slate-600';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${style}`}>
      {label}
    </span>
  );
}

// â”€â”€ line-item row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface LineItem { description: string; ordered_qty: number; received_qty: number; unit_price: number; }

function emptyLine(): LineItem { return { description: '', ordered_qty: 1, received_qty: 1, unit_price: 0 }; }

// â”€â”€ Create GRN form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface CreateGRNProps {
  pos: PurchaseOrder[];
  onSaved: () => void;
  onClose: () => void;
}

function CreateGRNPanel({ pos, onSaved, onClose }: CreateGRNProps) {
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [receivedBy, setReceivedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const selectPO = (poId: string) => {
    const po = pos.find(p => p.id === poId) ?? null;
    setSelectedPO(po);
    if (po && Array.isArray(po.line_items)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped = (po.line_items as any[]).map(li => ({
        description: li.description ?? '',
        ordered_qty: Number(li.quantity ?? li.ordered_qty ?? 1),
        received_qty: Number(li.quantity ?? li.ordered_qty ?? 1),
        unit_price: Number(li.unit_price ?? 0),
      }));
      setLines(mapped.length ? mapped : [emptyLine()]);
    }
  };

  const addLine = () => setLines(p => [...p, emptyLine()]);
  const removeLine = (i: number) => setLines(p => p.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof LineItem, val: string | number) =>
    setLines(p => p.map((r, idx) => idx === i ? { ...r, [field]: val } : r));

  const totalValue = lines.reduce((s, l) => s + l.received_qty * l.unit_price, 0);

  const grnNumber = `GRN-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

  // PDF scan via OCR placeholder
  const handleScanPDF = () => {
    alert('PDF scanning feature â€” connect to InvoiceFlow AI agent at /api/agent/extract-image');
  };

  const handleSave = async () => {
    if (!selectedPO) { setErr('Please select a PO.'); return; }
    setSaving(true); setErr('');
    try {
      const { error } = await apSupabase.from('goods_receipts').insert({
        grn_number: grnNumber,
        po_id: selectedPO.id,
        vendor_name: selectedPO.vendor_name,
        received_amount: totalValue,
        grn_amount: totalValue,
        received_date: receivedDate,
        description: notes || `GRN for ${selectedPO.po_number}`,
        status: 'received',
        received_by: receivedBy || null,
        notes: notes || null,
        invoice_number: invoiceNumber || null,
        grn_line_items: lines.map((l, idx) => ({
          id: String(idx + 1),
          description: l.description,
          ordered_qty: l.ordered_qty,
          received_qty: l.received_qty,
          unit_price: l.unit_price,
          total_value: l.received_qty * l.unit_price,
        })),
      });
      if (error) throw error;
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div>
            <h2 className="text-base font-bold text-white">Create Goods Receipt (GRN)</h2>
            <p className="text-xs text-slate-400 mt-0.5">Record received goods against a Purchase Order</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          {err && <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-2 text-red-300 text-sm">{err}</div>}

          {/* PO select */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Purchase Order *</label>
              <select
                value={selectedPO?.id ?? ''}
                onChange={e => selectPO(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">â€” Select PO â€”</option>
                {pos.map(p => (
                  <option key={p.id} value={p.id}>{p.po_number} Â· {p.vendor_name} Â· {fmt(p.po_amount, p.currency ?? 'AED')}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Received Date</label>
              <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Received By</label>
              <input placeholder="Name / initials" value={receivedBy} onChange={e => setReceivedBy(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Related Invoice # (optional)</label>
              <input placeholder="INV-XXXX" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Notes</label>
              <input placeholder="Optional notes" value={notes} onChange={e => setNotes(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          {/* Scan PDF button */}
          <div className="flex gap-2">
            <button onClick={handleScanPDF}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium">
              <Camera className="w-3.5 h-3.5" /> Scan Delivery Note / PDF
            </button>
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium">
              <Upload className="w-3.5 h-3.5" /> Attach File
            </button>
            <input ref={fileRef} type="file" className="hidden" />
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Line Items</span>
              <button onClick={addLine}
                className="flex items-center gap-1 px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-xs text-white">
                <Plus className="w-3 h-3" /> Add Row
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="text-left py-2 font-medium">Description</th>
                    <th className="text-right py-2 font-medium w-24">Ordered</th>
                    <th className="text-right py-2 font-medium w-24">Received</th>
                    <th className="text-right py-2 font-medium w-28">Unit Price</th>
                    <th className="text-right py-2 font-medium w-28">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-800">
                      <td className="py-1 pr-2">
                        <input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)}
                          placeholder="Item / service"
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="py-1 pr-2">
                        <input type="number" min={0} value={l.ordered_qty} onChange={e => updateLine(i, 'ordered_qty', Number(e.target.value))}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-right focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="py-1 pr-2">
                        <input type="number" min={0} value={l.received_qty} onChange={e => updateLine(i, 'received_qty', Number(e.target.value))}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-right focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="py-1 pr-2">
                        <input type="number" min={0} value={l.unit_price} onChange={e => updateLine(i, 'unit_price', Number(e.target.value))}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-right focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="py-1 text-right text-slate-300">{fmt(l.received_qty * l.unit_price)}</td>
                      <td className="py-1 pl-2">
                        {lines.length > 1 && (
                          <button onClick={() => removeLine(i)} className="text-slate-500 hover:text-red-400">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end mt-3">
              <span className="text-sm font-bold text-white">Total Received Value: {fmt(totalValue)}</span>
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-white">Cancel</button>
          <button onClick={handleSave} disabled={saving || !selectedPO}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-semibold text-white">
            {saving ? 'Savingâ€¦' : 'Save GRN'}
          </button>
        </div>
      </div>
    </div>
  );
}

// â”€â”€ GRN detail modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function GRNModal({ grn, onClose }: { grn: GoodsReceipt; onClose: () => void }) {
  const lineItems = Array.isArray(grn.grn_line_items) ? grn.grn_line_items : [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div>
            <h2 className="text-base font-bold text-white">{grn.grn_number}</h2>
            <p className="text-xs text-slate-400">{grn.vendor_name} Â· {fmtDate(grn.received_date)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5">
          {/* summary */}
          <div className="grid grid-cols-3 gap-4">
            {[
              ['Received Amount', fmt(grn.received_amount)],
              ['Status', grn.status ?? 'received'],
              ['Received By', grn.received_by ?? 'â€”'],
              ['PO ID', grn.po_id ?? 'â€”'],
              ['Invoice #', grn.invoice_number ?? 'â€”'],
              ['Notes', grn.notes ?? 'â€”'],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">{k}</p>
                <p className="text-sm text-white font-medium truncate">{v}</p>
              </div>
            ))}
          </div>

          {/* line items */}
          {lineItems.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Line Items</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="text-left py-2">Description</th>
                    <th className="text-right py-2">Ordered</th>
                    <th className="text-right py-2">Received</th>
                    <th className="text-right py-2">Unit Price</th>
                    <th className="text-right py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, i) => (
                    <tr key={i} className="border-b border-slate-800">
                      <td className="py-1.5 text-slate-200">{li.description}</td>
                      <td className="py-1.5 text-right text-slate-300">{li.ordered_qty}</td>
                      <td className="py-1.5 text-right text-slate-300">{li.received_qty}</td>
                      <td className="py-1.5 text-right text-slate-300">{fmt(li.unit_price)}</td>
                      <td className="py-1.5 text-right text-white font-medium">{fmt(li.total_value ?? li.received_qty * li.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// â”€â”€ Bulk import helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function bulkImportGRNs(file: File, pos: PurchaseOrder[]): Promise<{ imported: number; errors: string[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const errors: string[] = [];
  let imported = 0;

  for (const row of rows) {
    const poNumber = String(row['PO Number'] ?? row['po_number'] ?? '').trim();
    const po = pos.find(p => p.po_number === poNumber);
    const vendorName = String(row['Vendor'] ?? row['vendor_name'] ?? po?.vendor_name ?? '').trim();
    const receivedAmount = Number(row['Received Amount'] ?? row['received_amount'] ?? 0);
    const receivedDate = String(row['Received Date'] ?? row['received_date'] ?? new Date().toISOString().slice(0, 10)).trim();
    const grnNumber = String(row['GRN Number'] ?? row['grn_number'] ?? `GRN-${Date.now()}`).trim();

    if (!vendorName || !receivedDate) {
      errors.push(`Row ${imported + errors.length + 2}: missing vendor or date`);
      continue;
    }

    const { error } = await apSupabase.from('goods_receipts').upsert({
      grn_number: grnNumber,
      po_id: po?.id ?? null,
      vendor_name: vendorName,
      received_amount: receivedAmount,
      grn_amount: receivedAmount,
      received_date: receivedDate,
      description: String(row['Description'] ?? row['description'] ?? '').trim() || null,
      status: String(row['Status'] ?? 'received').trim().toLowerCase(),
      received_by: String(row['Received By'] ?? '').trim() || null,
      notes: String(row['Notes'] ?? '').trim() || null,
      invoice_number: String(row['Invoice Number'] ?? '').trim() || null,
    }, { onConflict: 'grn_number' });

    if (error) errors.push(`${grnNumber}: ${error.message}`);
    else imported++;
  }
  return { imported, errors };
}

// â”€â”€ Download template â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function downloadTemplate() {
  const ws = XLSX.utils.json_to_sheet([{
    'GRN Number': 'GRN-2025-0001',
    'PO Number': 'PO-2025-0001',
    'Vendor': 'Example Vendor LLC',
    'Received Amount': 5000,
    'Received Date': '2025-01-15',
    'Received By': 'John Doe',
    'Invoice Number': 'INV-001',
    'Description': 'Office supplies',
    'Status': 'received',
    'Notes': '',
  }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'GRNs');
  XLSX.writeFile(wb, 'grn_import_template.xlsx');
}

// â”€â”€ Main page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function APGoodsReceipts() {
  const [grns, setGrns] = useState<GoodsReceipt[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<GoodsReceipt | null>(null);
  const [bulkMsg, setBulkMsg] = useState('');
  const bulkRef = useRef<HTMLInputElement>(null);

  // stats
  const totalReceived = grns.reduce((s, g) => s + (g.received_amount ?? 0), 0);
  const thisMonth = grns.filter(g => {
    const d = new Date(g.received_date);
    const n = new Date();
    return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
  });

  const load = async () => {
    setLoading(true);
    const [{ data: grnData }, { data: poData }] = await Promise.all([
      apSupabase.from('goods_receipts').select('*').order('created_at', { ascending: false }).limit(200),
      apSupabase.from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(500),
    ]);
    setGrns((grnData ?? []) as GoodsReceipt[]);
    setPos((poData ?? []) as PurchaseOrder[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = grns.filter(g => {
    const q = search.toLowerCase();
    const matchQ = !q || g.grn_number.toLowerCase().includes(q) ||
      g.vendor_name.toLowerCase().includes(q) || (g.invoice_number ?? '').toLowerCase().includes(q);
    const matchS = statusFilter === 'all' || (g.status ?? 'received').toLowerCase() === statusFilter;
    return matchQ && matchS;
  });

  // get PO number for display
  const getPoNumber = (g: GoodsReceipt) =>
    pos.find(p => p.id === g.po_id)?.po_number ?? g.po_id ?? 'â€”';

  const handleBulkImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkMsg('Importingâ€¦');
    const { imported, errors } = await bulkImportGRNs(file, pos);
    setBulkMsg(errors.length ? `${imported} imported, ${errors.length} errors: ${errors.slice(0, 2).join('; ')}` : `âœ“ ${imported} GRNs imported`);
    await load();
    e.target.value = '';
  };

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-950">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-400" />
            Goods Receipts
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">Track received deliveries and match against Purchase Orders</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadTemplate}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium">
            <Download className="w-3.5 h-3.5" /> Template
          </button>
          <button onClick={() => bulkRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium">
            <Upload className="w-3.5 h-3.5" /> Bulk Import
          </button>
          <input ref={bulkRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleBulkImport} />
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">
            <Plus className="w-4 h-4" /> Create GRN
          </button>
        </div>
      </div>

      {bulkMsg && (
        <div className="bg-blue-900/30 border border-blue-700 rounded-lg px-4 py-2 text-blue-300 text-sm">
          {bulkMsg}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total GRNs', value: grns.length, icon: Package, color: 'text-blue-400' },
          { label: 'This Month', value: thisMonth.length, icon: Truck, color: 'text-green-400' },
          { label: 'Total Value Received', value: fmt(totalReceived), icon: CheckCircle, color: 'text-emerald-400' },
          { label: 'Pending / Partial', value: grns.filter(g => g.status === 'partial' || g.status === 'pending').length, icon: Clock, color: 'text-yellow-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-slate-900 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400">{label}</p>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <p className="text-lg font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search GRN #, vendor, invoiceâ€¦"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* status filter */}
        <div className="relative">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="appearance-none bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 pr-8 text-sm text-white focus:outline-none focus:border-blue-500">
            <option value="all">All Statuses</option>
            <option value="received">Received</option>
            <option value="partial">Partial</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>

        <button onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* table */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/50">
                {['GRN #', 'Date', 'PO #', 'Vendor', 'Total Value', 'Items', 'Invoice #', 'Received By', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="text-center py-16 text-slate-500">Loading goods receiptsâ€¦</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-20">
                    <Package className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                    <p className="text-slate-400 font-medium">No goods receipts found</p>
                    <p className="text-slate-600 text-xs mt-1">Create your first GRN by clicking "Create GRN" above</p>
                    <button onClick={() => setShowCreate(true)}
                      className="mt-4 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">
                      Create GRN
                    </button>
                  </td>
                </tr>
              ) : (
                filtered.map(g => {
                  const items = Array.isArray(g.grn_line_items) ? g.grn_line_items.length : 0;
                  return (
                    <tr key={g.id} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 font-mono text-xs text-blue-400">
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          {g.grn_number}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs whitespace-nowrap">{fmtDate(g.received_date)}</td>
                      <td className="px-4 py-3 text-slate-300 text-xs font-mono">{getPoNumber(g)}</td>
                      <td className="px-4 py-3 text-slate-200 font-medium">{g.vendor_name}</td>
                      <td className="px-4 py-3 text-slate-200 font-semibold">{fmt(g.received_amount)}</td>
                      <td className="px-4 py-3 text-center">
                        {items > 0 ? (
                          <span className="px-2 py-0.5 rounded-full bg-blue-900 text-blue-300 text-xs font-medium">{items} items</span>
                        ) : (
                          <span className="text-slate-600 text-xs">â€”</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs font-mono">{g.invoice_number ?? 'â€”'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{g.received_by ?? 'â€”'}</td>
                      <td className="px-4 py-3"><StatusBadge s={g.status} /></td>
                      <td className="px-4 py-3">
                        <button onClick={() => setSelected(g)}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs">
                          <Eye className="w-3.5 h-3.5" /> View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-700 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Showing {filtered.length} of {grns.length} goods receipts
            </span>
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
              All figures from InvoiceFlow Supabase
            </div>
          </div>
        )}
      </div>

      {/* dialogs */}
      {showCreate && (
        <CreateGRNPanel
          pos={pos}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}
      {selected && (
        <GRNModal grn={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

