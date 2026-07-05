/**
 * AR Recurring Invoices — templates and auto-generation
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Plus, RefreshCw, Play, Pause, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCompany } from '../../context/CompanyContext';
import { listCustomers } from '../../services/uaeFullAccounting.service';
import type { Customer } from '../../services/uaeFullAccounting.service';
import * as arSvc from '../../services/arService';
import type { ARGeneratedInvoice, ARRecurringTemplate } from '../../services/arService';

type Tab = 'templates' | 'generated';

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-900/40 text-green-400 border-green-700',
  paused: 'bg-amber-900/40 text-amber-400 border-amber-700',
  cancelled: 'bg-gray-800 text-gray-400 border-gray-600',
};

const RECURRENCE_TYPES = ['weekly', 'monthly', 'quarterly', 'annually'] as const;

function fmtAED(n: number): string {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ARRecurringInvoices() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId ?? '';

  const [tab, setTab] = useState<Tab>('templates');
  const [templates, setTemplates] = useState<ARRecurringTemplate[]>([]);
  const [generated, setGenerated] = useState<ARGeneratedInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const [form, setForm] = useState({
    customer_id: '',
    description: '',
    amount: '',
    vat_rate: '5',
    recurrence_type: 'monthly' as (typeof RECURRENCE_TYPES)[number],
    interval: '1',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: '',
  });

  const loadTemplates = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await arSvc.listARRecurringTemplates();
      setTemplates(res.templates);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const loadGenerated = useCallback(async () => {
    if (!companyId || templates.length === 0) {
      setGenerated([]);
      return;
    }
    try {
      const results = await Promise.all(
        templates.map((t) => arSvc.getARRecurringGenerated(t.id).catch(() => ({ invoices: [] }))),
      );
      const flat = results.flatMap((r, i) =>
        (r.invoices || []).map((inv) => ({
          ...inv,
          template_id: templates[i]?.id,
          customer_name: templates[i]?.customer_name,
        })),
      );
      setGenerated(flat as ARGeneratedInvoice[]);
    } catch {
      setGenerated([]);
    }
  }, [companyId, templates]);

  useEffect(() => {
    void loadTemplates();
    listCustomers()
      .then((r) => setCustomers(r.customers))
      .catch(() => setCustomers([]));
  }, [loadTemplates]);

  useEffect(() => {
    if (tab === 'generated') void loadGenerated();
  }, [tab, loadGenerated]);

  const handleCreate = async () => {
    if (!companyId || !form.customer_id || !form.description || !form.amount) {
      toast.error('Customer, description, and amount are required');
      return;
    }
    try {
      await arSvc.createARRecurringTemplate({
        company_id: companyId,
        customer_id: form.customer_id,
        description: form.description,
        amount: Number(form.amount),
        vat_rate: Number(form.vat_rate),
        recurrence_type: form.recurrence_type,
        interval: Number(form.interval) || 1,
        start_date: form.start_date,
        end_date: form.end_date || undefined,
      });
      toast.success('Recurring template created');
      setShowCreate(false);
      void loadTemplates();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    }
  };

  const handleGenerateDue = async () => {
    if (!companyId) return;
    setGenerating(true);
    try {
      const res = await arSvc.generateDueARRecurring(companyId);
      setLastRun(`Generated ${res.generated_count} invoice(s) as of ${res.as_of}`);
      toast.success(`Generated ${res.generated_count} draft invoice(s)`);
      void loadTemplates();
      if (tab === 'generated') void loadGenerated();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setGenerating(false);
    }
  };

  const statusAction = async (tpl: ARRecurringTemplate, action: 'pause' | 'resume' | 'cancel') => {
    try {
      if (action === 'pause') await arSvc.pauseARRecurringTemplate(tpl.id);
      else if (action === 'resume') await arSvc.resumeARRecurringTemplate(tpl.id);
      else await arSvc.cancelARRecurringTemplate(tpl.id);
      toast.success(`Template ${action}d`);
      void loadTemplates();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    }
  };

  if (!companyId) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-6 flex items-center justify-center">
        <p className="text-gray-400">Select a company to manage recurring invoices.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <CalendarClock size={22} className="text-blue-400" /> Recurring Invoices
          </h1>
          <p className="text-gray-400 text-sm mt-1">Scheduled templates — generates draft invoices for approval</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => void loadTemplates()} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg">
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            disabled={generating}
            onClick={() => void handleGenerateDue()}
            className="flex items-center gap-2 bg-blue-800 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            <Play size={14} /> {generating ? 'Generating…' : 'Generate Due'}
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-green-700 hover:bg-green-600 px-4 py-2 rounded-lg text-sm"
          >
            <Plus size={14} /> New Template
          </button>
        </div>
      </div>

      {lastRun && (
        <div className="mb-4 text-sm bg-blue-950/40 border border-blue-800 rounded-lg px-4 py-2 text-blue-200">
          {lastRun}
        </div>
      )}

      <div className="flex gap-1 bg-gray-800/60 p-1 rounded-xl w-fit mb-4">
        {(['templates', 'generated'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${
              tab === t ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'templates' && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/80 border-b border-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">Customer</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">Description</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">Recurrence</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">Next Due</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
              ) : templates.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No recurring templates yet.</td></tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.id} className="border-b border-gray-800/60 hover:bg-gray-900/40">
                    <td className="px-4 py-3">{t.customer_name}</td>
                    <td className="px-4 py-3 text-gray-300">{t.description}</td>
                    <td className="px-4 py-3">{fmtAED(t.amount)}</td>
                    <td className="px-4 py-3 capitalize">{t.recurrence_type} / {t.interval}</td>
                    <td className="px-4 py-3">{t.next_due_date}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded border text-xs ${STATUS_BADGE[t.status] ?? STATUS_BADGE.active}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {t.status === 'active' && (
                          <button type="button" onClick={() => void statusAction(t, 'pause')} className="text-amber-400 hover:text-amber-300" title="Pause">
                            <Pause size={14} />
                          </button>
                        )}
                        {t.status === 'paused' && (
                          <button type="button" onClick={() => void statusAction(t, 'resume')} className="text-green-400 hover:text-green-300" title="Resume">
                            <Play size={14} />
                          </button>
                        )}
                        {t.status !== 'cancelled' && (
                          <button type="button" onClick={() => void statusAction(t, 'cancel')} className="text-red-400 hover:text-red-300" title="Cancel">
                            <XCircle size={14} />
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

      {tab === 'generated' && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/80 border-b border-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">Invoice</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">Total</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">Link</th>
              </tr>
            </thead>
            <tbody>
              {generated.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No generated invoices yet.</td></tr>
              ) : (
                generated.map((inv) => (
                  <tr key={inv.invoice_id} className="border-b border-gray-800/60">
                    <td className="px-4 py-3 font-mono">{inv.invoice_number}</td>
                    <td className="px-4 py-3">{inv.invoice_date}</td>
                    <td className="px-4 py-3">{fmtAED(inv.total)}</td>
                    <td className="px-4 py-3 capitalize">{inv.status}</td>
                    <td className="px-4 py-3">
                      <Link to="/uae-full/ar" className="text-blue-400 hover:underline text-xs">
                        View in AR →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">New Recurring Template</h2>
            <div className="space-y-3">
              <select
                value={form.customer_id}
                onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input
                placeholder="Description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  placeholder="Amount (ex VAT)"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  placeholder="VAT %"
                  value={form.vat_rate}
                  onChange={(e) => setForm((f) => ({ ...f, vat_rate: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={form.recurrence_type}
                  onChange={(e) => setForm((f) => ({ ...f, recurrence_type: e.target.value as typeof form.recurrence_type }))}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                >
                  {RECURRENCE_TYPES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  placeholder="Every N"
                  value={form.interval}
                  onChange={(e) => setForm((f) => ({ ...f, interval: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="date"
                  placeholder="End date (optional)"
                  value={form.end_date}
                  onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-400">Cancel</button>
              <button type="button" onClick={() => void handleCreate()} className="px-4 py-2 bg-green-700 rounded-lg text-sm">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
