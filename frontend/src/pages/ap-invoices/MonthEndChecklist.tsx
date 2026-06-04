/**
 * Month-end close checklist page.
 * Queries live Supabase data to determine the status of each close task.
 * URL: /month-end
 */
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/ap-invoice/supabase';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useMarket } from '../../contexts/MarketContext';

interface CheckItem {
  id: string;
  label: string;
  description: string;
  status: 'loading' | 'ok' | 'warning' | 'error';
  detail: string;
  action?: { label: string; href: string };
}

const INDIA_ITEMS: CheckItem[] = [
  { id: 'pending_approvals', label: 'No Pending Approvals', description: 'All submitted invoices have been approved or rejected.', status: 'loading', detail: '' },
  { id: 'all_paid', label: 'All Approved Invoices Paid', description: 'Every approved invoice has payment_status = paid.', status: 'loading', detail: '' },
  { id: 'tally_sync', label: 'Tally Sync Complete', description: 'All approved invoices are synced to TallyPrime.', status: 'loading', detail: '', action: { label: 'Go to Settings â†’ Tally', href: '/settings' } },
  { id: 'bank_recon', label: 'Bank Reconciliation Done', description: 'All paid invoices are matched to bank lines.', status: 'loading', detail: '', action: { label: 'Go to Bank Recon', href: '/bank-recon' } },
  { id: 'gst_recon', label: 'GST Reconciliation Done', description: 'All eligible invoices are reconciled with GSTR-2B.', status: 'loading', detail: '', action: { label: 'Go to GST Recon', href: '/gst-recon' } },
  { id: 'no_overdue', label: 'No Overdue Invoices', description: 'No approved unpaid invoices past their due date.', status: 'loading', detail: '' },
  { id: 'proof_captured', label: 'Payment Proofs Captured', description: 'Paid invoices have payment proof uploaded.', status: 'loading', detail: '' },
];

const UAE_ITEMS: CheckItem[] = [
  { id: 'pending_approvals', label: 'No Pending Approvals', description: 'All submitted invoices have been approved or rejected.', status: 'loading', detail: '' },
  { id: 'all_paid', label: 'All Approved Invoices Paid', description: 'Every approved invoice has payment_status = paid.', status: 'loading', detail: '' },
  { id: 'gst_recon', label: 'FTA VAT Return Matched', description: 'All eligible invoices are reconciled with FTA VAT return.', status: 'loading', detail: '', action: { label: 'Go to VAT Recon', href: '/gst-recon' } },
  { id: 'bank_recon', label: 'Bank Reconciliation Done', description: 'All paid invoices are matched to bank lines.', status: 'loading', detail: '', action: { label: 'Go to Bank Recon', href: '/bank-recon' } },
  { id: 'trn_check', label: 'Missing TRN Invoices', description: 'All vendor invoices have a valid TRN (15 digits starting with 1).', status: 'loading', detail: '' },
  { id: 'reverse_charge', label: 'Reverse Charge Applied', description: 'Reverse charge mechanism applied correctly on applicable invoices.', status: 'loading', detail: '' },
  { id: 'no_overdue', label: 'No Overdue Invoices', description: 'No approved unpaid invoices past their due date.', status: 'loading', detail: '' },
];

function StatusIcon({ status }: { status: CheckItem['status'] }) {
  if (status === 'loading') return <span className="text-gray-400 text-lg">â³</span>;
  if (status === 'ok') return <span className="text-green-600 text-lg">âœ…</span>;
  if (status === 'warning') return <span className="text-amber-500 text-lg">âš ï¸</span>;
  return <span className="text-red-500 text-lg">âŒ</span>;
}

export function MonthEndChecklist() {
  const navigate = useNavigate();
  const { isUAE } = useMarket();
  const INITIAL_ITEMS = isUAE ? UAE_ITEMS : INDIA_ITEMS;
  const [items, setItems] = useState<CheckItem[]>(INITIAL_ITEMS);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  function updateItem(id: string, patch: Partial<CheckItem>) {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function runChecks() {
    setLoading(true);
    setItems(INITIAL_ITEMS);

    const [year, month] = period.split('-').map(Number);
    const start = new Date(year, month - 1, 1).toISOString().slice(0, 10);
    const end = new Date(year, month, 0).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    // 1. Pending approvals
    const { count: pendingCount } = await supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'pending')
      .gte('invoice_date', start).lte('invoice_date', end);
    updateItem('pending_approvals', {
      status: (pendingCount ?? 0) === 0 ? 'ok' : 'error',
      detail: (pendingCount ?? 0) === 0 ? 'All clear' : `${pendingCount} invoice(s) awaiting approval`,
    });

    // 2. All approved paid
    const { count: unpaidCount } = await supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Approved')
      .neq('payment_status', 'paid')
      .gte('invoice_date', start).lte('invoice_date', end);
    updateItem('all_paid', {
      status: (unpaidCount ?? 0) === 0 ? 'ok' : 'warning',
      detail: (unpaidCount ?? 0) === 0 ? 'All approved invoices are paid' : `${unpaidCount} approved invoice(s) not yet paid`,
    });

    // 3. Tally sync
    const { count: unsyncedCount } = await supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Approved')
      .or('tally_synced.is.null,tally_synced.eq.false')
      .gte('invoice_date', start).lte('invoice_date', end);
    updateItem('tally_sync', {
      status: (unsyncedCount ?? 0) === 0 ? 'ok' : 'warning',
      detail: (unsyncedCount ?? 0) === 0 ? 'All synced to Tally' : `${unsyncedCount} invoice(s) not synced`,
    });

    // 4. Bank reconciliation
    const { count: unreconciledPaid } = await supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Paid')
      .or('bank_reconciled.is.null,bank_reconciled.eq.false')
      .gte('invoice_date', start).lte('invoice_date', end);
    updateItem('bank_recon', {
      status: (unreconciledPaid ?? 0) === 0 ? 'ok' : 'warning',
      detail: (unreconciledPaid ?? 0) === 0 ? 'All paid invoices bank-reconciled' : `${unreconciledPaid} paid invoice(s) not yet matched`,
    });

    // 5. GST reconciliation
    const { count: gstUnmatched } = await supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('gst_recon_status', 'unmatched')
      .gte('invoice_date', start).lte('invoice_date', end);
    updateItem('gst_recon', {
      status: (gstUnmatched ?? 0) === 0 ? 'ok' : 'warning',
        detail: (gstUnmatched ?? 0) === 0 ? (isUAE ? 'FTA VAT return matched' : 'GST reconciliation complete') : `${gstUnmatched} invoice(s) unmatched`,
    });

    // 6. No overdue
    const { count: overdueCount } = await supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Approved')
      .neq('payment_status', 'paid')
      .lt('due_date', today);
    updateItem('no_overdue', {
      status: (overdueCount ?? 0) === 0 ? 'ok' : 'error',
      detail: (overdueCount ?? 0) === 0 ? 'No overdue invoices' : `${overdueCount} invoice(s) overdue`,
    });

    // 7. Payment proofs
    const { count: paidTotal } = await supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'Paid').gte('invoice_date', start).lte('invoice_date', end);
    const { count: paidWithProof } = await supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'Paid').not('payment_proof_url', 'is', null).gte('invoice_date', start).lte('invoice_date', end);
    const missing = (paidTotal ?? 0) - (paidWithProof ?? 0);
    updateItem('proof_captured', {
      status: missing === 0 ? 'ok' : 'warning',
      detail: missing === 0 ? `All ${paidTotal ?? 0} paid invoices have proof` : `${missing} of ${paidTotal ?? 0} paid invoices missing proof`,
    });

    setLoading(false);
  }

  useEffect(() => { void runChecks(); }, [period]);

  const okCount = items.filter((i) => i.status === 'ok').length;
  const totalCount = items.length;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isUAE ? 'Quarter-End Close Checklist' : 'Month-End Close Checklist'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">Real-time AP close status</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm"
          />
          <Button size="sm" variant="outline" onClick={() => void runChecks()} disabled={loading}>
            {loading ? 'Checkingâ€¦' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="rounded-xl border bg-white p-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="font-medium text-gray-700">Close progress</span>
          <span className="font-bold text-gray-900">{okCount} / {totalCount} complete</span>
        </div>
        <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-500"
            style={{ width: `${(okCount / totalCount) * 100}%` }}
          />
        </div>
        {okCount === totalCount && !loading && (
          <p className="mt-2 text-sm text-green-700 font-medium">ðŸŽ‰ Month-end close is complete!</p>
        )}
      </div>

      {/* Checklist items */}
      <div className="space-y-3">
        {items.map((item) => (
          <Card key={item.id} className={`transition-colors ${item.status === 'ok' ? 'border-green-200 bg-green-50/30' : item.status === 'error' ? 'border-red-200 bg-red-50/20' : item.status === 'warning' ? 'border-amber-200 bg-amber-50/20' : 'border-gray-200'}`}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start gap-3">
                <StatusIcon status={item.status} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 text-sm">{item.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{item.description}</div>
                  {item.detail && item.status !== 'loading' && (
                    <div className={`text-xs mt-1 font-medium ${item.status === 'ok' ? 'text-green-700' : item.status === 'error' ? 'text-red-700' : 'text-amber-700'}`}>
                      {item.detail}
                    </div>
                  )}
                </div>
                {item.action && item.status !== 'ok' && (
                  <button
                    onClick={() => navigate(item.action!.href)}
                    className="text-xs text-[#1a56db] underline whitespace-nowrap shrink-0"
                  >
                    {item.action.label}
                  </button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

