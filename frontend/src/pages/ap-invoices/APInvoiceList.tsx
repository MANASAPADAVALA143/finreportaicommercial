/**
 * APInvoiceList.tsx â€” Full replica of InvoiceFlow Invoice List in FinReportAI dark design.
 * Features: 8-step pipeline stepper, all filter tabs, all columns, invoice detail modal.
 */
import { useEffect, useState, useMemo } from 'react';
import { Search, X, RefreshCw, ChevronLeft, ChevronRight, Eye, CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import { apSupabase, type APInvoice, type APInvoiceLineItem } from '../../lib/apSupabase';

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const fmtAmt = (n: number, cur = 'AED') =>
  `${cur} ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PAGE_SIZE = 20;

// â”€â”€ stepper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const STEPS = [
  'Uploaded', 'AI Extracted', 'IFRS Classify', '3-Way Match',
  'Risk Score', 'Approval', 'GL Coded', 'Paid',
];

function getStepIndex(inv: APInvoice): number {
  if (inv.status === 'Paid') return 7;
  if (inv.ifrs_category && inv.approval_status === 'approved') return 6;
  if (inv.approval_status === 'approved' || inv.approved_at) return 5;
  if (inv.risk_score) return 4;
  if (inv.match_status && inv.match_status !== 'no_po') return 3;
  if (inv.ifrs_category) return 2;
  if (inv.ifrs_confidence) return 1;
  return 0;
}

function PipelineStepper({ invoices }: { invoices: APInvoice[] }) {
  // Use mode (most common step) for display
  const counts = new Array(8).fill(0);
  invoices.forEach(inv => { counts[getStepIndex(inv)]++; });
  const currentStep = counts.indexOf(Math.max(...counts));

  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-xl px-6 py-4 mb-5">
      <div className="flex items-center justify-between overflow-x-auto gap-0">
        {STEPS.map((step, i) => {
          const done    = i < currentStep;
          const active  = i === currentStep;
          return (
            <div key={step} className="flex items-center flex-shrink-0">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2
                  ${done   ? 'bg-green-600 border-green-500 text-white'
                  : active ? 'bg-blue-600 border-blue-400 text-white'
                           : 'bg-gray-700 border-gray-600 text-gray-400'}`}>
                  {done ? 'âœ“' : i + 1}
                </div>
                <span className={`text-[10px] whitespace-nowrap font-medium
                  ${done ? 'text-green-400' : active ? 'text-blue-400' : 'text-gray-500'}`}>
                  {step}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-0.5 w-8 mx-1 mb-4 ${i < currentStep ? 'bg-green-600' : 'bg-gray-600'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// â”€â”€ badges â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    Processing: 'bg-amber-500/20 text-amber-300 border-amber-700/40',
    Approved:   'bg-green-500/20 text-green-300 border-green-700/40',
    Paid:       'bg-blue-500/20 text-blue-300 border-blue-700/40',
    Rejected:   'bg-red-500/20 text-red-300 border-red-700/40',
    'On Hold':  'bg-orange-500/20 text-orange-300 border-orange-700/40',
    Queried:    'bg-purple-500/20 text-purple-300 border-purple-700/40',
  };
  return `text-[10px] px-2 py-0.5 rounded-full border font-medium ${map[s] || 'bg-gray-700/40 text-gray-300 border-gray-600/40'}`;
};

const riskBadge = (r: string | null) => {
  if (!r) return null;
  const map: Record<string, string> = {
    low:    'bg-green-500/20 text-green-300 border-green-700/40',
    medium: 'bg-amber-500/20 text-amber-300 border-amber-700/40',
    high:   'bg-red-500/20 text-red-300 border-red-700/40',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${map[r] || 'bg-gray-700 text-gray-300 border-gray-600'}`}>
    {r === 'high' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 mr-1 animate-pulse" />}
    {r.toUpperCase()}
  </span>;
};

const matchBadge = (s: string | null) => {
  const labels: Record<string, { text: string; cls: string }> = {
    matched:           { text: 'âœ… Matched',   cls: 'text-green-400' },
    three_way_matched: { text: 'âœ… 3-Way',      cls: 'text-emerald-400 font-bold' },
    partial:           { text: 'âš ï¸ Partial',   cls: 'text-amber-400' },
    mismatch:          { text: 'âŒ Mismatch',  cls: 'text-red-400' },
    no_po:             { text: 'â€” No PO',      cls: 'text-gray-500' },
  };
  if (!s) return <span className="text-gray-500 text-xs">â€”</span>;
  const cfg = labels[s] || { text: s, cls: 'text-gray-400' };
  return <span className={`text-xs ${cfg.cls}`}>{cfg.text}</span>;
};

// â”€â”€ invoice detail modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function InvoiceModal({ inv, lineItems, onClose, onRefresh }: {
  inv: APInvoice;
  lineItems: APInvoiceLineItem[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [acting, setActing] = useState(false);
  const flags = Array.isArray(inv.risk_flags) ? inv.risk_flags : [];

  const approve = async () => {
    setActing(true);
    await apSupabase.from('invoices').update({
      status: 'Approved', approval_status: 'approved',
      approved_at: new Date().toISOString(),
    }).eq('id', inv.id);
    setActing(false); onRefresh(); onClose();
  };
  const reject = async () => {
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    setActing(true);
    await apSupabase.from('invoices').update({
      status: 'Rejected', approval_status: 'rejected', rejection_reason: reason,
    }).eq('id', inv.id);
    setActing(false); onRefresh(); onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div>
            <h2 className="text-base font-bold text-white">Invoice #{inv.invoice_number}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{inv.vendor_name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={statusBadge(inv.status)}>{inv.status}</span>
            <button onClick={onClose}><X size={16} className="text-gray-400 hover:text-white" /></button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Key details grid */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            {[
              ['Invoice Date', inv.invoice_date || 'â€”'],
              ['Due Date', inv.due_date || 'â€”'],
              ['Amount', fmtAmt(inv.total_amount, inv.currency)],
              ['Tax', inv.tax_amount ? fmtAmt(inv.tax_amount, inv.currency) : 'â€”'],
              ['PO Number', inv.po_number || 'No PO'],
              ['3-Way Match', inv.match_status || 'â€”'],
              ['IFRS Category', inv.ifrs_category || 'â€”'],
              ['Confidence', inv.ifrs_confidence ? `${inv.ifrs_confidence}%` : 'â€”'],
              ['Risk Score', inv.risk_score || 'â€”'],
              ['GL Account', (inv as any).gl_account || 'â€”'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-1 border-b border-gray-800">
                <span className="text-gray-400 text-xs">{k}</span>
                <span className="text-white text-xs font-medium">{v}</span>
              </div>
            ))}
          </div>

          {/* Line items */}
          {lineItems.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Line Items</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-1.5 pr-3">Description</th>
                    <th className="text-right py-1.5 pr-3">Qty</th>
                    <th className="text-right py-1.5 pr-3">Unit Price</th>
                    <th className="text-right py-1.5">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map(l => (
                    <tr key={l.id} className="border-b border-gray-800 text-gray-300">
                      <td className="py-1.5 pr-3">{l.description}</td>
                      <td className="py-1.5 pr-3 text-right">{l.quantity}</td>
                      <td className="py-1.5 pr-3 text-right">{fmtAmt(l.unit_price, inv.currency)}</td>
                      <td className="py-1.5 text-right">{fmtAmt(l.total, inv.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Risk flags */}
          {flags.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Risk Flags</p>
              <div className="space-y-1.5">
                {flags.map((f, i) => (
                  <div key={i} className="flex gap-2 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
                    <AlertTriangle size={12} className="text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300">{f.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Approval actions */}
          {(inv.status === 'Processing' || inv.approval_status === 'pending') && (
            <div className="flex gap-3 pt-1">
              <button onClick={approve} disabled={acting}
                className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium">
                <CheckCircle2 size={14} /> Approve
              </button>
              <button onClick={reject} disabled={acting}
                className="flex-1 flex items-center justify-center gap-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium">
                <X size={14} /> Reject
              </button>
            </div>
          )}

          {inv.rejection_reason && (
            <p className="text-xs text-red-300 bg-red-900/20 rounded-lg px-3 py-2">
              Rejection reason: {inv.rejection_reason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// â”€â”€ main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type ViewTab = 'all' | 'approvals' | 'duplicates' | 'review';
type TypeTab = 'all_types' | 'ap' | 'ar';

const IFRS_OPTIONS = ['All IFRS', 'Operating Expenses', 'Revenue', 'Research & Development',
  'Cost of Sales', 'Capital Expenditure', 'Finance Costs', 'Other'];
const MATCH_OPTIONS = ['All Match Status', 'matched', 'three_way_matched', 'partial', 'mismatch', 'no_po'];
const RISK_OPTIONS  = ['All Risk', 'low', 'medium', 'high'];
const STATUS_OPTIONS = ['All Statuses', 'Processing', 'Approved', 'Paid', 'Rejected', 'On Hold', 'Queried'];

export default function APInvoiceList() {
  const [invoices, setInvoices]     = useState<APInvoice[]>([]);
  const [loading, setLoading]       = useState(true);
  const [page, setPage]             = useState(1);
  const [selected, setSelected]     = useState<APInvoice | null>(null);
  const [lineItems, setLineItems]   = useState<APInvoiceLineItem[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);

  // filters
  const [viewTab, setViewTab]   = useState<ViewTab>('all');
  const [typeTab, setTypeTab]   = useState<TypeTab>('all_types');
  const [search, setSearch]     = useState('');
  const [statusF, setStatusF]   = useState('All Statuses');
  const [ifrsF, setIfrsF]       = useState('All IFRS');
  const [matchF, setMatchF]     = useState('All Match Status');
  const [riskF, setRiskF]       = useState('All Risk');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await apSupabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);
    setInvoices((data || []) as APInvoice[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const openInvoice = async (inv: APInvoice) => {
    setSelected(inv);
    setLoadingLines(true);
    const { data } = await apSupabase
      .from('invoice_line_items')
      .select('*')
      .eq('invoice_id', inv.id);
    setLineItems((data || []) as APInvoiceLineItem[]);
    setLoadingLines(false);
  };

  const filtered = useMemo(() => {
    let rows = invoices;
    // view tabs
    if (viewTab === 'approvals') rows = rows.filter(r => r.approval_status === 'pending' || r.status === 'Processing');
    if (viewTab === 'review')    rows = rows.filter(r => r.status === 'Queried' || r.status === 'On Hold');
    if (viewTab === 'duplicates') {
      const seen = new Map<string, number>();
      rows.forEach(r => { const k = `${r.vendor_name}|${r.total_amount}|${r.invoice_date}`; seen.set(k, (seen.get(k) || 0) + 1); });
      rows = rows.filter(r => { const k = `${r.vendor_name}|${r.total_amount}|${r.invoice_date}`; return (seen.get(k) || 0) > 1; });
    }
    // type tab (AP/AR based on source or ifrs_category heuristic)
    if (typeTab === 'ap') rows = rows.filter(r => !(r as any).is_ar);
    if (typeTab === 'ar') rows = rows.filter(r => !!(r as any).is_ar);
    // dropdowns
    if (statusF !== 'All Statuses')      rows = rows.filter(r => r.status === statusF);
    if (ifrsF   !== 'All IFRS')          rows = rows.filter(r => r.ifrs_category === ifrsF);
    if (matchF  !== 'All Match Status')  rows = rows.filter(r => r.match_status === matchF);
    if (riskF   !== 'All Risk')          rows = rows.filter(r => r.risk_score === riskF);
    // date range
    if (dateFrom) rows = rows.filter(r => r.invoice_date && r.invoice_date >= dateFrom);
    if (dateTo)   rows = rows.filter(r => r.invoice_date && r.invoice_date <= dateTo);
    // search
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.invoice_number?.toLowerCase().includes(q) ||
        r.vendor_name?.toLowerCase().includes(q) ||
        r.ifrs_category?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [invoices, viewTab, typeTab, search, statusF, ifrsF, matchF, riskF, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  if (page > totalPages && page > 1) setPage(1);

  const selCls   = 'bg-blue-600 text-white';
  const unselCls = 'bg-gray-800 text-gray-300 hover:bg-gray-700';

  return (
    <div className="p-5 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Invoice List</h1>
          <p className="text-gray-400 text-xs mt-0.5">Manage and review all invoices</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg text-xs text-white disabled:opacity-50">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg text-xs text-white">
            <Download size={12} /> Export
          </button>
        </div>
      </div>

      {/* 8-step pipeline stepper */}
      {invoices.length > 0 && <PipelineStepper invoices={invoices} />}

      {/* Filter tabs row 1 â€” view mode */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(['all','approvals','duplicates','review'] as ViewTab[]).map(t => (
          <button key={t} onClick={() => setViewTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${viewTab === t ? selCls : unselCls}`}>
            {t === 'all' ? 'All' : t === 'approvals' ? 'Approval queue' : t === 'duplicates' ? 'Duplicates' : 'Needs review'}
          </button>
        ))}
        <div className="ml-1 h-4 w-px bg-gray-600" />
        {(['all_types','ap','ar'] as TypeTab[]).map(t => (
          <button key={t} onClick={() => setTypeTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${typeTab === t ? selCls : unselCls}`}>
            {t === 'all_types' ? 'All types' : t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Filter row 2 â€” dropdowns + search + date range */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 mb-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by invoice # or vendor nameâ€¦"
              className="w-full bg-gray-700 border border-gray-600 text-white pl-8 pr-3 py-2 rounded-lg text-xs" />
          </div>
          {[
            { val: statusF, set: setStatusF, opts: STATUS_OPTIONS },
            { val: ifrsF,   set: setIfrsF,   opts: IFRS_OPTIONS },
            { val: matchF,  set: setMatchF,  opts: MATCH_OPTIONS },
            { val: riskF,   set: setRiskF,   opts: RISK_OPTIONS },
          ].map(({ val, set, opts }, i) => (
            <select key={i} value={val} onChange={e => set(e.target.value)}
              className="bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded-lg text-xs">
              {opts.map(o => <option key={o}>{o}</option>)}
            </select>
          ))}
        </div>
        {/* Date range */}
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="font-medium">Date Range:</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded-lg text-xs" />
          <span>â†’</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded-lg text-xs" />
          {(dateFrom || dateTo || search || statusF !== 'All Statuses' || matchF !== 'All Match Status' || riskF !== 'All Risk') && (
            <button onClick={() => { setSearch(''); setStatusF('All Statuses'); setIfrsF('All IFRS'); setMatchF('All Match Status'); setRiskF('All Risk'); setDateFrom(''); setDateTo(''); }}
              className="text-blue-400 hover:text-blue-300 underline">Clear filters</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-700 flex items-center justify-between">
          <span className="text-xs text-gray-400 font-medium">{filtered.length} Invoice{filtered.length !== 1 ? 's' : ''}</span>
          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                className="p-1 hover:text-white disabled:opacity-30"><ChevronLeft size={14} /></button>
              <span>Page {page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
                className="p-1 hover:text-white disabled:opacity-30"><ChevronRight size={14} /></button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/80 text-gray-400 font-semibold">
                <th className="px-3 py-2.5 text-left w-5"><input type="checkbox" className="opacity-40" /></th>
                <th className="px-3 py-2.5 text-left">Invoice #</th>
                <th className="px-3 py-2.5 text-left">Vendor</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
                <th className="px-3 py-2.5 text-left">Status</th>
                <th className="px-3 py-2.5 text-left">Payment</th>
                <th className="px-3 py-2.5 text-left">IFRS Category</th>
                <th className="px-3 py-2.5 text-center">Confidence</th>
                <th className="px-3 py-2.5 text-left">3-Way Match</th>
                <th className="px-3 py-2.5 text-left">GL Account</th>
                <th className="px-3 py-2.5 text-center">Risk</th>
                <th className="px-3 py-2.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-700/40">
                    {Array.from({ length: 12 }).map((_, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-3 bg-gray-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-gray-500">
                    {invoices.length === 0
                      ? 'No invoices found. Check your InvoiceFlow Supabase connection.'
                      : 'No invoices match the current filters.'}
                  </td>
                </tr>
              ) : (
                pageRows.map(inv => {
                  const gl = (inv as any).gl_account || (inv as any).gl_account_code || null;
                  const paymentStatus = inv.due_date && new Date(inv.due_date) < new Date() && inv.status !== 'Paid'
                    ? 'Overdue' : inv.status === 'Paid' ? 'Paid' : 'Pending';
                  return (
                    <tr key={inv.id}
                      className="border-b border-gray-700/30 hover:bg-gray-700/20 cursor-pointer transition-colors"
                      onClick={() => openInvoice(inv)}>
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="opacity-40" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-blue-400 font-mono font-medium">{inv.invoice_number || 'â€”'}</span>
                          {(inv as any).source && (
                            <span className="text-[9px] text-gray-500 capitalize">{(inv as any).source}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-white max-w-[140px] truncate">{inv.vendor_name}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-white whitespace-nowrap">
                        {fmtAmt(inv.total_amount, inv.currency)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={statusBadge(inv.status)}>{inv.status}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] font-medium ${paymentStatus === 'Overdue' ? 'text-red-400' : paymentStatus === 'Paid' ? 'text-green-400' : 'text-gray-400'}`}>
                          {paymentStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-300 max-w-[120px] truncate">
                        {inv.ifrs_category || 'â€”'}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {inv.ifrs_confidence
                          ? <span className="text-emerald-400 font-medium">{inv.ifrs_confidence}%</span>
                          : <span className="text-gray-600">â€”</span>}
                      </td>
                      <td className="px-3 py-2.5">{matchBadge(inv.match_status)}</td>
                      <td className="px-3 py-2.5">
                        {gl ? (
                          <span className="text-blue-400 font-mono text-[10px]">{gl}</span>
                        ) : <span className="text-gray-600">â€”</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">{riskBadge(inv.risk_score)}</td>
                      <td className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openInvoice(inv)}
                          className="p-1.5 hover:bg-gray-600 rounded-lg text-gray-400 hover:text-white">
                          <Eye size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {filtered.length > PAGE_SIZE && (
          <div className="px-4 py-3 border-t border-gray-700 flex items-center justify-between text-xs text-gray-400">
            <span>Showing {(page-1)*PAGE_SIZE + 1}â€“{Math.min(page*PAGE_SIZE, filtered.length)} of {filtered.length}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(1)} disabled={page===1} className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30">Â«</button>
              <button onClick={() => setPage(p => p-1)} disabled={page===1} className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30"><ChevronLeft size={12} /></button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(1, Math.min(page - 2 + i, totalPages - 4 + i));
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded ${p === page ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>
                    {p}
                  </button>
                );
              })}
              <button onClick={() => setPage(p => p+1)} disabled={page===totalPages} className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30"><ChevronRight size={12} /></button>
              <button onClick={() => setPage(totalPages)} disabled={page===totalPages} className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30">Â»</button>
            </div>
          </div>
        )}
      </div>

      {/* Invoice detail modal */}
      {selected && (
        <InvoiceModal
          inv={selected}
          lineItems={loadingLines ? [] : lineItems}
          onClose={() => setSelected(null)}
          onRefresh={load}
        />
      )}
    </div>
  );
}

