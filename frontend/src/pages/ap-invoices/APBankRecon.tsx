/**
 * APBankRecon.tsx — Bank Reconciliation for AP
 * Matches bank transactions against posted invoices/payments
 */
import { useState, useEffect } from 'react';
import { Landmark, CheckCircle, AlertTriangle, XCircle, Upload, RefreshCw, Download, Plus } from 'lucide-react';
import { apSupabase, type APInvoice } from '../../lib/apSupabase';
import * as XLSX from 'xlsx';

function fmt(n: number, cur = 'AED') {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

type BankTx = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  reference?: string;
  matchedInvoiceId?: string | null;
  matchStatus: 'matched' | 'unmatched' | 'suggested';
};

// Synthetic bank transactions derived from paid/approved invoices
function buildBankTxFromInvoices(invoices: APInvoice[]): BankTx[] {
  return invoices.slice(0, 30).map((inv, i) => ({
    id: `TX-${i + 1000}`,
    date: inv.invoice_date || inv.created_at.slice(0, 10),
    description: `Payment to ${inv.vendor_name}`.slice(0, 60),
    amount: inv.total_amount,
    type: 'debit' as const,
    reference: inv.invoice_number,
    matchedInvoiceId: inv.id,
    matchStatus: inv.status === 'Paid' ? 'matched' : inv.status === 'Approved' ? 'suggested' : 'unmatched',
  }));
}

export default function APBankRecon() {
  const [invoices, setInvoices] = useState<APInvoice[]>([]);
  const [bankTxs, setBankTxs]   = useState<BankTx[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<'all' | 'matched' | 'unmatched' | 'suggested'>('all');
  const fileRef = { current: null as HTMLInputElement | null };

  const load = async () => {
    setLoading(true);
    const { data } = await apSupabase.from('invoices').select('*').order('created_at', { ascending: false }).limit(200);
    const invs = (data ?? []) as APInvoice[];
    setInvoices(invs);
    setBankTxs(buildBankTxFromInvoices(invs));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleImportBank = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    const imported: BankTx[] = rows.map((r, i) => ({
      id: `IMPORT-${i}`,
      date: String(r['Date'] ?? r['date'] ?? ''),
      description: String(r['Description'] ?? r['description'] ?? ''),
      amount: Number(r['Amount'] ?? r['amount'] ?? 0),
      type: (String(r['Type'] ?? 'debit').toLowerCase() === 'credit' ? 'credit' : 'debit') as 'debit' | 'credit',
      reference: String(r['Reference'] ?? r['reference'] ?? ''),
      matchStatus: 'unmatched' as const,
    }));
    // Auto-match by invoice number
    const matched = imported.map(tx => {
      const inv = invoices.find(i => i.invoice_number === tx.reference || Math.abs(i.total_amount - tx.amount) < 0.01);
      if (inv) return { ...tx, matchedInvoiceId: inv.id, matchStatus: (Math.abs(inv.total_amount - tx.amount) < 0.01 ? 'matched' : 'suggested') as 'matched' | 'suggested' };
      return tx;
    });
    setBankTxs(matched);
    e.target.value = '';
  };

  const filtered = bankTxs.filter(t => tab === 'all' || t.matchStatus === tab);
  const matched = bankTxs.filter(t => t.matchStatus === 'matched').length;
  const unmatched = bankTxs.filter(t => t.matchStatus === 'unmatched').length;
  const suggested = bankTxs.filter(t => t.matchStatus === 'suggested').length;
  const matchRate = bankTxs.length ? Math.round((matched / bankTxs.length) * 100) : 0;

  const confirmMatch = (txId: string) => {
    setBankTxs(prev => prev.map(t => t.id === txId ? { ...t, matchStatus: 'matched' } : t));
  };

  const exportXLSX = () => {
    const rows = bankTxs.map(t => ({
      'Transaction ID': t.id,
      'Date': t.date,
      'Description': t.description,
      'Amount': t.amount,
      'Type': t.type,
      'Reference': t.reference ?? '',
      'Match Status': t.matchStatus,
      'Matched Invoice ID': t.matchedInvoiceId ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bank Recon');
    XLSX.writeFile(wb, `bank_recon_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const statusIcon = (s: string) => {
    if (s === 'matched')   return <CheckCircle className="w-4 h-4 text-green-400" />;
    if (s === 'suggested') return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    return <XCircle className="w-4 h-4 text-red-400" />;
  };
  const statusStyle = (s: string) => {
    if (s === 'matched')   return 'bg-green-900 text-green-300 border-green-700';
    if (s === 'suggested') return 'bg-yellow-900 text-yellow-300 border-yellow-700';
    return 'bg-red-900 text-red-300 border-red-700';
  };

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Landmark className="w-5 h-5 text-blue-400" /> Bank Reconciliation
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">Match bank transactions to AP invoices and payments</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> Import Bank Statement
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportBank} />
          </label>
          <button onClick={exportXLSX}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Match Rate',       value: `${matchRate}%`,  color: matchRate > 80 ? 'text-green-400' : 'text-yellow-400' },
          { label: 'Matched',          value: matched,           color: 'text-green-400' },
          { label: 'Suggested Matches',value: suggested,         color: 'text-yellow-400' },
          { label: 'Unmatched',        value: unmatched,         color: 'text-red-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-900 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-400">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(['all','matched','suggested','unmatched'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
            {t} {t === 'all' ? `(${bankTxs.length})` : t === 'matched' ? `(${matched})` : t === 'suggested' ? `(${suggested})` : `(${unmatched})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/50">
                {['TX ID','Date','Description','Amount','Reference','Match Status','Matched Invoice','Action'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500">Loading bank transactions…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500">No transactions in this category</td></tr>
              ) : (
                filtered.map(tx => {
                  const matchedInv = tx.matchedInvoiceId ? invoices.find(i => i.id === tx.matchedInvoiceId) : null;
                  return (
                    <tr key={tx.id} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 font-mono text-blue-400 text-xs">{tx.id}</td>
                      <td className="px-4 py-3 text-slate-300 text-xs whitespace-nowrap">{fmtDate(tx.date)}</td>
                      <td className="px-4 py-3 text-slate-200 max-w-[200px] truncate">{tx.description}</td>
                      <td className="px-4 py-3 font-semibold text-white">{fmt(tx.amount)}</td>
                      <td className="px-4 py-3 font-mono text-slate-400 text-xs">{tx.reference || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {statusIcon(tx.matchStatus)}
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border capitalize ${statusStyle(tx.matchStatus)}`}>
                            {tx.matchStatus}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {matchedInv ? (
                          <div>
                            <p className="font-mono text-blue-400">{matchedInv.invoice_number}</p>
                            <p className="text-slate-500">{matchedInv.vendor_name}</p>
                          </div>
                        ) : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {tx.matchStatus === 'suggested' && (
                          <button onClick={() => confirmMatch(tx.id)}
                            className="px-2 py-1 rounded bg-green-700 hover:bg-green-600 text-white text-xs font-medium flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Confirm
                          </button>
                        )}
                        {tx.matchStatus === 'unmatched' && (
                          <button className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium flex items-center gap-1">
                            <Plus className="w-3 h-3" /> Match
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-700 flex items-center justify-between text-xs text-slate-500">
          <span>Showing {filtered.length} of {bankTxs.length} transactions</span>
          <span>Data auto-generated from InvoiceFlow invoices · Import actual bank statement via CSV/Excel</span>
        </div>
      </div>
    </div>
  );
}
