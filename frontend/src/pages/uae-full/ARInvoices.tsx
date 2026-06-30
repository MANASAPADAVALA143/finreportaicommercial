/**
 * Sales Invoices (AR) — create, send, record payment, aging
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, addDays, parseISO, startOfWeek, endOfWeek, isWithinInterval, startOfMonth } from 'date-fns';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';
import {
  Plus, RefreshCw, Send, CreditCard, Eye, Download, X, Search, Zap, Mail, TrendingUp,
} from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import * as arSvc from '../../services/arService';
import type { ARInvoice, ARLineItem } from '../../services/arService';
import { listAccounts } from '../../services/uaeFullAccounting.service';
import PeriodSelector from '../../components/PeriodSelector';

const STATUS_STYLE: Record<string, string> = {
  draft:   'bg-gray-700/60 text-gray-300 border-gray-600',
  sent:    'bg-blue-900/40 text-blue-400 border-blue-700',
  paid:    'bg-green-900/40 text-green-400 border-green-700',
  partial: 'bg-amber-900/40 text-amber-400 border-amber-700',
  overdue: 'bg-red-900/40 text-red-400 border-red-700',
};

const TABS = ['all', 'draft', 'sent', 'overdue', 'paid'] as const;
type Tab = (typeof TABS)[number];

function fmtAED(n: number): string {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try {
    return format(parseISO(d), 'dd MMM yyyy');
  } catch {
    return d;
  }
}

function emptyLine(): ARLineItem {
  return { description: '', qty: 1, unit_price: 0, vat_rate: 5 };
}

export default function ARInvoices() {
  const { activeCompanyId } = useCompany();
  const { activeWorkspace } = useWorkspace();
  const companyId = activeCompanyId ?? '';
  const workspaceId = activeWorkspace?.id ?? localStorage.getItem('gnanova_workspace_id');

  const [invoices, setInvoices] = useState<ARInvoice[]>([]);
  const [aging, setAging] = useState<arSvc.ARAgingBucket[]>([]);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [bankAccounts, setBankAccounts] = useState<{ code: string; name: string }[]>([]);

  const [showNew, setShowNew] = useState(false);
  const [showSend, setShowSend] = useState<ARInvoice | null>(null);
  const [showPay, setShowPay] = useState<ARInvoice | null>(null);
  const [showDetail, setShowDetail] = useState<ARInvoice | null>(null);

  const [custName, setCustName] = useState('');
  const [custTrn, setCustTrn] = useState('');
  const [invDate, setInvDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [lines, setLines] = useState<ARLineItem[]>([emptyLine()]);
  const [sendEmail, setSendEmail] = useState('');
  const [payDate, setPayDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [payAmount, setPayAmount] = useState('');
  const [payBank, setPayBank] = useState('');
  const [payRef, setPayRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [periodRange, setPeriodRange] = useState<{ start: string; end: string } | null>(null);
  const [reviewInvoiceIds, setReviewInvoiceIds] = useState<Set<string>>(new Set());
  const [matchSummary, setMatchSummary] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<Record<string, arSvc.PaymentPrediction>>({});

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [invRes, agingRes] = await Promise.all([
        arSvc.listARInvoices(),
        arSvc.getARAging(),
      ]);
      setInvoices(invRes.invoices);
      setAging(agingRes.buckets);
      setTotalOutstanding(agingRes.total_outstanding);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load AR data');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load, periodRange]);

  useEffect(() => {
    listAccounts()
      .then(res => {
        const banks = res.accounts
          .filter(a => {
            const code = parseInt(a.account_code, 10);
            return code >= 1010 && code <= 1099;
          })
          .map(a => ({ code: a.account_code, name: a.account_name }));
        setBankAccounts(banks);
        if (banks.length && !payBank) setPayBank(banks[0].code);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (window.location.hash === '#aging') {
      document.getElementById('ar-aging')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [loading]);

  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
  const monthStart = startOfMonth(today);

  const summary = useMemo(() => {
    const unpaid = invoices.filter(i => i.status !== 'paid');
    const outstanding = unpaid.reduce((s, i) => s + (i.amount_due || i.total), 0);
    const overdue = unpaid.filter(i => i.is_overdue || i.status === 'overdue')
      .reduce((s, i) => s + (i.amount_due || i.total), 0);
    const dueThisWeek = unpaid.filter(i => {
      if (!i.due_date) return false;
      const d = parseISO(i.due_date);
      return isWithinInterval(d, { start: weekStart, end: weekEnd });
    }).reduce((s, i) => s + (i.amount_due || i.total), 0);
    const paidThisMonth = invoices.filter(i => {
      if (i.status !== 'paid') return false;
      const pd = i.paid_date ?? i.invoice_date;
      if (!pd) return false;
      return parseISO(pd) >= monthStart;
    }).reduce((s, i) => s + i.total, 0);
    return { outstanding, overdue, dueThisWeek, paidThisMonth };
  }, [invoices, weekStart, weekEnd, monthStart]);

  const filtered = useMemo(() => {
    let list = invoices;
    if (tab !== 'all') list = list.filter(i => i.status === tab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        i => i.customer_name.toLowerCase().includes(q) ||
          i.invoice_number.toLowerCase().includes(q),
      );
    }
    return list;
  }, [invoices, tab, search]);

  const lineTotals = useMemo(() => {
    const sub = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
    const vat = lines.reduce((s, l) => s + l.qty * l.unit_price * (l.vat_rate / 100), 0);
    return { sub, vat, total: sub + vat };
  }, [lines]);

  const handleCreate = async () => {
    if (!companyId) { toast.error('Select a company first'); return; }
    if (!custName.trim()) { toast.error('Customer name required'); return; }
    if (!lines.some(l => l.description && l.unit_price > 0)) {
      toast.error('Add at least one line item');
      return;
    }
    setSubmitting(true);
    try {
      const res = await arSvc.createARInvoice({
        customer_name: custName.trim(),
        customer_trn: custTrn || undefined,
        invoice_date: invDate,
        due_date: dueDate,
        line_items: lines.filter(l => l.description),
        company_id: companyId,
        workspace_id: workspaceId,
      });
      toast.success(`Invoice ${res.invoice_number} created`);
      setShowNew(false);
      setCustName(''); setCustTrn(''); setLines([emptyLine()]);
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSend = async () => {
    if (!showSend || !sendEmail.trim()) return;
    setSubmitting(true);
    try {
      const res = await arSvc.sendARInvoice(showSend.id, sendEmail.trim());
      if (res.warning) toast(res.warning, { icon: '⚠️' });
      else toast.success(`Invoice ${res.invoice_number} sent`);
      setShowSend(null);
      setSendEmail('');
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePay = async () => {
    if (!showPay || !companyId) return;
    setSubmitting(true);
    try {
      const res = await arSvc.recordARPayment({
        invoice_id: showPay.id,
        payment_date: payDate,
        bank_account_code: payBank,
        amount_received: parseFloat(payAmount) || showPay.total,
        reference: payRef || undefined,
        company_id: companyId,
        workspace_id: workspaceId,
      });
      toast.success(`Payment recorded — status: ${res.status}`);
      setShowPay(null);
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setSubmitting(false);
    }
  };

  const openPay = (inv: ARInvoice) => {
    setShowPay(inv);
    setPayAmount(String(inv.amount_due || inv.total));
    setPayDate(format(new Date(), 'yyyy-MM-dd'));
    setPayRef('');
  };

  const handleAutoMatch = async () => {
    if (!companyId) return;
    setSubmitting(true);
    try {
      const res = await arSvc.autoMatchPayments({ company_id: companyId, bank_account_code: payBank || '1010' });
      const reviewIds = new Set<string>();
      res.needs_review.forEach((r) => { if (r.invoice_id) reviewIds.add(r.invoice_id); });
      setReviewInvoiceIds(reviewIds);
      const unmatchedAmt = res.unmatched.reduce((s, u) => s + u.amount, 0);
      setMatchSummary(
        `Matched: ${res.matched_count} invoices (AED ${res.matched_total_aed.toLocaleString()}) · ` +
        `Needs review: ${res.needs_review_count} · ` +
        `Unmatched: ${res.unmatched_count}${unmatchedAmt > 0 ? ` (AED ${unmatchedAmt.toLocaleString()})` : ''}`,
      );
      toast.success('Auto-match complete');
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Auto-match failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunPredictions = async () => {
    if (!companyId) return;
    setSubmitting(true);
    try {
      const res = await arSvc.predictPayments({ company_id: companyId, workspace_id: workspaceId });
      const map: Record<string, arSvc.PaymentPrediction> = {};
      res.predictions.forEach((p) => { map[p.invoice_id] = p; });
      setPredictions(map);
      toast.success(`Updated forecasts for ${res.predictions.length} open invoice(s)`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Prediction failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunDunning = async () => {
    if (!companyId) return;
    setSubmitting(true);
    try {
      const res = await arSvc.runCollectionsDunning(companyId);
      if (res.sent_count === 0) toast('No dunning emails sent — ensure customers have email addresses', { icon: 'ℹ️' });
      else toast.success(`Sent ${res.sent_count} reminder email(s)`);
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Dunning failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!companyId) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-6 flex items-center justify-center">
        <p className="text-gray-400">Select a company to manage sales invoices.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Sales Invoices</h1>
          <p className="text-gray-400 text-sm mt-1">UAE VAT-compliant accounts receivable</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <PeriodSelector workspaceId={workspaceId} onPeriodChange={(start, end) => setPeriodRange({ start, end })} />
          <button onClick={() => void load()} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg">
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleAutoMatch()}
            className="flex items-center gap-2 bg-blue-800 hover:bg-blue-700 px-3 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            <Zap size={14} /> {submitting ? 'Matching…' : 'Auto-Match Payments'}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleRunPredictions()}
            className="flex items-center gap-2 bg-purple-800 hover:bg-purple-700 px-3 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            <TrendingUp size={14} /> Run Payment Predictions
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleRunDunning()}
            className="flex items-center gap-2 bg-amber-800 hover:bg-amber-700 px-3 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            <Mail size={14} /> Run Collections Chase
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 bg-green-700 hover:bg-green-600 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus size={14} /> New Invoice
          </button>
        </div>
      </div>

      {matchSummary && (
        <div className="mb-4 text-sm bg-blue-950/40 border border-blue-800 rounded-lg px-4 py-2 text-blue-200">
          {matchSummary}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Outstanding', value: summary.outstanding, color: 'text-white' },
          { label: 'Overdue', value: summary.overdue, color: 'text-red-400' },
          { label: 'Due This Week', value: summary.dueThisWeek, color: 'text-amber-400' },
          { label: 'Paid This Month', value: summary.paidThisMonth, color: 'text-green-400' },
        ].map(c => (
          <div key={c.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">{c.label}</p>
            <p className={`text-lg font-bold ${c.color}`}>{fmtAED(c.value)}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1 bg-gray-800/60 p-1 rounded-xl">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                tab === t ? 'bg-green-700 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Customer or invoice number…"
            className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500"
          />
        </div>
      </div>

      {/* Invoice table */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden mb-8">
        <div className="overflow-x-auto w-full">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80">
              {['Invoice No', 'Customer', 'Invoice Date', 'Due Date', 'Amount AED', 'VAT AED', 'Total AED', 'Payment Forecast', 'Status', 'Actions'].map(h => (
                <th key={h} className={`px-4 py-3 text-xs text-gray-400 font-semibold ${h.includes('AED') ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-500">No invoices found.</td></tr>
            ) : (
              filtered.map(inv => (
                <tr key={inv.id} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                  <td className="px-4 py-3 font-mono text-blue-400 text-xs">{inv.invoice_number}</td>
                  <td className="px-4 py-3 text-gray-300">{inv.customer_name}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(inv.invoice_date)}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(inv.due_date)}</td>
                  <td className="px-4 py-3 text-right text-white text-xs">{inv.subtotal.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-amber-400 text-xs">{inv.vat_amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-white font-medium text-xs">{inv.total.toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs">
                    {(() => {
                      const p = predictions[inv.id];
                      if (!p) return <span className="text-gray-500">—</span>;
                      const confCol = p.confidence === 'HIGH' ? 'text-green-400' : p.confidence === 'MEDIUM' ? 'text-amber-400' : 'text-gray-400';
                      return (
                        <span className={confCol}>
                          {fmtDate(p.predicted_payment_date)} · {p.confidence}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs border px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[inv.status] ?? STATUS_STYLE.draft}`}>
                      {inv.status}
                    </span>
                    {reviewInvoiceIds.has(inv.id) && (
                      <span className="ml-1 text-[10px] bg-amber-900/60 text-amber-300 border border-amber-700 px-1.5 py-0.5 rounded">
                        Review Match
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      {inv.status === 'draft' && (
                        <button
                          onClick={() => { setShowSend(inv); setSendEmail(''); }}
                          className="text-xs bg-blue-700 hover:bg-blue-600 px-2 py-1 rounded flex items-center gap-1"
                        >
                          <Send size={10} /> Send
                        </button>
                      )}
                      {(inv.status === 'sent' || inv.status === 'overdue' || inv.status === 'partial') && (
                        <button
                          onClick={() => openPay(inv)}
                          className="text-xs bg-green-700 hover:bg-green-600 px-2 py-1 rounded flex items-center gap-1"
                        >
                          <CreditCard size={10} /> Pay
                        </button>
                      )}
                      <button onClick={() => setShowDetail(inv)} className="p-1 text-gray-400 hover:text-white" title="View">
                        <Eye size={14} />
                      </button>
                      <button
                        onClick={() => void arSvc.downloadARPdf(inv.id, `${inv.invoice_number}.pdf`)}
                        className="p-1 text-gray-400 hover:text-white"
                        title="Download PDF"
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* AR Aging */}
      <div id="ar-aging" className="scroll-mt-6">
        <h2 className="text-lg font-semibold text-white mb-4">AR Aging</h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {aging.map(b => (
            <div key={b.bucket} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">{b.bucket}</p>
              <p className="text-lg font-bold text-white">{fmtAED(b.total_aed)}</p>
              <p className="text-xs text-gray-500 mt-1">{b.invoice_count} invoice{b.invoice_count !== 1 ? 's' : ''}</p>
              {b.customers.length > 0 && (
                <p className="text-xs text-gray-400 mt-2 line-clamp-3">{b.customers.join(', ')}</p>
              )}
            </div>
          ))}
        </div>
        {totalOutstanding > 0 && (
          <p className="text-sm text-gray-400 mt-4">
            Total outstanding: <span className="text-white font-semibold">{fmtAED(totalOutstanding)}</span>
          </p>
        )}
      </div>

      {/* New Invoice Modal */}
      {showNew && (
        <Modal title="New Sales Invoice" onClose={() => setShowNew(false)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Customer Name">
                <input value={custName} onChange={e => setCustName(e.target.value)}
                  className="input-dark w-full" />
              </Field>
              <Field label="Customer TRN (optional)">
                <input value={custTrn} onChange={e => setCustTrn(e.target.value)}
                  className="input-dark w-full" />
              </Field>
              <Field label="Invoice Date">
                <input type="date" value={invDate} onChange={e => setInvDate(e.target.value)}
                  className="input-dark w-full" />
              </Field>
              <Field label="Due Date">
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="input-dark w-full" />
              </Field>
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-400 uppercase tracking-wide">Line Items</span>
                <button
                  onClick={() => setLines(l => [...l, emptyLine()])}
                  className="text-xs text-green-400 hover:text-green-300"
                >+ Add row</button>
              </div>
              <div className="space-y-2">
                {lines.map((ln, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input placeholder="Description" value={ln.description}
                      onChange={e => setLines(ls => ls.map((l, i) => i === idx ? { ...l, description: e.target.value } : l))}
                      className="input-dark col-span-5" />
                    <input type="number" placeholder="Qty" value={ln.qty}
                      onChange={e => setLines(ls => ls.map((l, i) => i === idx ? { ...l, qty: parseFloat(e.target.value) || 0 } : l))}
                      className="input-dark col-span-2" />
                    <input type="number" placeholder="Unit Price" value={ln.unit_price || ''}
                      onChange={e => setLines(ls => ls.map((l, i) => i === idx ? { ...l, unit_price: parseFloat(e.target.value) || 0 } : l))}
                      className="input-dark col-span-2" />
                    <select value={ln.vat_rate}
                      onChange={e => setLines(ls => ls.map((l, i) => i === idx ? { ...l, vat_rate: parseFloat(e.target.value) } : l))}
                      className="input-dark col-span-2">
                      <option value={0}>0%</option>
                      <option value={5}>5%</option>
                    </select>
                    {lines.length > 1 && (
                      <button onClick={() => setLines(ls => ls.filter((_, i) => i !== idx))}
                        className="col-span-1 text-red-400 hover:text-red-300 text-xs">✕</button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 text-right text-sm text-gray-400 space-y-1">
                <div>Subtotal: <span className="text-white">{fmtAED(lineTotals.sub)}</span></div>
                <div>VAT: <span className="text-amber-400">{fmtAED(lineTotals.vat)}</span></div>
                <div className="font-semibold">Total: <span className="text-white">{fmtAED(lineTotals.total)}</span></div>
              </div>
            </div>
            <button
              onClick={() => void handleCreate()}
              disabled={submitting}
              className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-50 py-2 rounded-lg text-sm font-medium"
            >
              {submitting ? 'Creating…' : 'Create Invoice'}
            </button>
          </div>
        </Modal>
      )}

      {/* Send Modal */}
      {showSend && (
        <Modal title={`Send ${showSend.invoice_number}`} onClose={() => setShowSend(null)}>
          <Field label="Customer Email">
            <input type="email" value={sendEmail} onChange={e => setSendEmail(e.target.value)}
              className="input-dark w-full" placeholder="customer@example.com" />
          </Field>
          <button
            onClick={() => void handleSend()}
            disabled={submitting || !sendEmail.trim()}
            className="w-full mt-4 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
          >
            <Send size={14} /> {submitting ? 'Sending…' : 'Send Invoice'}
          </button>
        </Modal>
      )}

      {/* Payment Modal */}
      {showPay && (
        <Modal title={`Record Payment — ${showPay.invoice_number}`} onClose={() => setShowPay(null)}>
          <div className="space-y-3">
            <Field label="Payment Date">
              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="input-dark w-full" />
            </Field>
            <Field label="Amount Received (AED)">
              <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="input-dark w-full" />
            </Field>
            <Field label="Bank Account">
              <select value={payBank} onChange={e => setPayBank(e.target.value)} className="input-dark w-full">
                {bankAccounts.map(b => (
                  <option key={b.code} value={b.code}>{b.code} — {b.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Payment Reference">
              <input value={payRef} onChange={e => setPayRef(e.target.value)} className="input-dark w-full" placeholder="Bank ref / cheque no." />
            </Field>
            <button
              onClick={() => void handlePay()}
              disabled={submitting}
              className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-50 py-2 rounded-lg text-sm font-medium"
            >
              {submitting ? 'Processing…' : 'Confirm Payment'}
            </button>
          </div>
        </Modal>
      )}

      {/* Detail panel */}
      {showDetail && (
        <Modal title={showDetail.invoice_number} onClose={() => setShowDetail(null)}>
          <div className="space-y-2 text-sm">
            <Row label="Customer" value={showDetail.customer_name} />
            <Row label="TRN" value={showDetail.customer_trn ?? '—'} />
            <Row label="Invoice Date" value={fmtDate(showDetail.invoice_date)} />
            <Row label="Due Date" value={fmtDate(showDetail.due_date)} />
            <Row label="Status" value={showDetail.status} />
            <Row label="Total" value={fmtAED(showDetail.total)} />
            {showDetail.line_items?.length > 0 && (
              <div className="mt-3 border-t border-gray-700 pt-3">
                <p className="text-xs text-gray-400 mb-2">Line Items</p>
                {showDetail.line_items.map((l, i) => (
                  <div key={i} className="text-xs text-gray-300 py-1">
                    {l.description} — {l.qty} × {fmtAED(l.unit_price)} @ {l.vat_rate}% VAT
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      <style>{`
        .input-dark {
          background: #1f2937;
          border: 1px solid #374151;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: #f3f4f6;
        }
      `}</style>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h3 className="font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="text-white capitalize">{value}</span>
    </div>
  );
}
