/**
 * APActionQueue.tsx â€” Today's Action Queue
 * Shows invoices needing urgent attention, CFO approval, review, etc.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, X, RefreshCw, Bell, TrendingUp } from 'lucide-react';
import { apSupabase, type APInvoice } from '../../lib/apSupabase';

function fmt(n: number, cur = 'AED') {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
}

type ActionItem = {
  invoice: APInvoice;
  actionType: 'urgent' | 'review' | 'cfo_approval' | 'overdue';
  reason: string;
  action: string;
};

export default function APActionQueue() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<APInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const load = async () => {
    setLoading(true);
    const { data } = await apSupabase
      .from('invoices')
      .select('*')
      .in('status', ['Processing', 'On Hold', 'Queried'])
      .order('created_at', { ascending: false })
      .limit(200);
    setInvoices((data ?? []) as APInvoice[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Classify each invoice into action items
  const actionItems: ActionItem[] = [];
  for (const inv of invoices) {
    if (dismissed.has(inv.id)) continue;
    const dueDate = inv.due_date ? new Date(inv.due_date) : null;
    const isOverdue = dueDate && dueDate < today && inv.status !== 'Paid';
    const noPO = !inv.po_number;
    const highRisk = inv.risk_score === 'high';
    const largeTx = inv.total_amount > 100000;
    const pendingApproval = inv.approval_status === 'pending';

    if (isOverdue) {
      actionItems.push({ invoice: inv, actionType: 'overdue', reason: `Due ${inv.due_date}`, action: 'Process payment immediately' });
    } else if (highRisk) {
      actionItems.push({ invoice: inv, actionType: 'urgent', reason: 'High risk score flagged', action: 'Review risk flags and approve or reject' });
    } else if (largeTx && pendingApproval) {
      actionItems.push({ invoice: inv, actionType: 'cfo_approval', reason: `Large transaction: ${fmt(inv.total_amount, inv.currency)}`, action: 'CFO sign-off required' });
    } else if (noPO && pendingApproval) {
      actionItems.push({ invoice: inv, actionType: 'review', reason: 'No PO number', action: 'Get PO raised first, then re-approve' });
    } else if (pendingApproval) {
      actionItems.push({ invoice: inv, actionType: 'review', reason: 'Pending approval', action: 'Review and approve or reject' });
    }
  }

  const groups = {
    urgent:       actionItems.filter(a => a.actionType === 'urgent'),
    overdue:      actionItems.filter(a => a.actionType === 'overdue'),
    cfo_approval: actionItems.filter(a => a.actionType === 'cfo_approval'),
    review:       actionItems.filter(a => a.actionType === 'review'),
  };

  const total = actionItems.length;
  const urgent = groups.urgent.length + groups.overdue.length;

  const sectionConfig = [
    { key: 'urgent'      , label: 'ðŸ”´ URGENT',             color: 'border-red-700 bg-red-900/10',     dot: 'bg-red-500', items: groups.urgent },
    { key: 'overdue'     , label: 'ðŸŸ  OVERDUE',            color: 'border-orange-700 bg-orange-900/10', dot: 'bg-orange-500', items: groups.overdue },
    { key: 'cfo_approval', label: 'ðŸŸ¢ PENDING CFO APPROVAL', color: 'border-green-700 bg-green-900/10', dot: 'bg-green-500', items: groups.cfo_approval },
    { key: 'review'      , label: 'ðŸŸ¡ REVIEW',             color: 'border-yellow-700 bg-yellow-900/10', dot: 'bg-yellow-500', items: groups.review },
  ];

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Today's Action Queue</h1>
          <p className="text-slate-400 text-sm mt-0.5">{todayStr} â€” {total > 0 ? `${total} invoice${total !== 1 ? 's' : ''} need your attention` : 'No items need attention'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={() => navigate('/ap-invoices/list')}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium">
            View All Invoices â†’
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Urgent / Overdue', value: urgent, color: 'text-red-400', icon: AlertTriangle },
          { label: 'CFO Approval', value: groups.cfo_approval.length, color: 'text-green-400', icon: CheckCircle2 },
          { label: 'Needs Review', value: groups.review.length, color: 'text-yellow-400', icon: Clock },
          { label: 'Total Action Items', value: total, color: 'text-blue-400', icon: Bell },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-slate-800 ${color}`}><Icon className="w-4 h-4" /></div>
            <div>
              <p className="text-xs text-slate-400">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin mr-2" /> Loading action queueâ€¦
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mb-4" />
          <h2 className="text-xl font-bold text-white">All clear!</h2>
          <p className="text-slate-400 mt-2">No invoices need your attention right now.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {sectionConfig.map(({ key, label, color, items }) =>
            items.length === 0 ? null : (
              <div key={key} className={`border rounded-xl p-5 ${color}`}>
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">{label}</h2>
                  <span className="px-2 py-0.5 rounded-full bg-slate-700 text-slate-200 text-xs font-bold">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="space-y-3">
                  {items.map(({ invoice: inv, reason, action }, i) => (
                    <div key={inv.id}
                      className="bg-slate-900/80 border border-slate-700 rounded-xl p-4 flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold text-white">{i + 1}.</span>
                          <span className="font-mono text-blue-400 font-bold text-sm">{inv.invoice_number}</span>
                          <span className="px-2 py-0.5 rounded-full bg-yellow-900 text-yellow-300 text-[10px] font-semibold border border-yellow-700">
                            {inv.status}
                          </span>
                          {inv.risk_score === 'high' && (
                            <span className="px-2 py-0.5 rounded-full bg-red-900 text-red-300 text-[10px] font-bold border border-red-700 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block animate-pulse" /> HIGH RISK
                            </span>
                          )}
                        </div>
                        <p className="text-white font-medium text-sm">{inv.vendor_name} â€” <span className="text-slate-300">{fmt(inv.total_amount, inv.currency)}</span></p>
                        <div className="flex items-center gap-1.5 mt-1.5 text-xs text-red-400">
                          <X className="w-3.5 h-3.5" /> {reason}
                        </div>
                        <p className="text-xs text-slate-400 mt-1"><span className="font-semibold text-slate-300">Action:</span> {action}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => navigate('/ap-invoices/list')}
                          className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-medium">
                          Open
                        </button>
                        <button
                          onClick={() => setDismissed(d => new Set([...d, inv.id]))}
                          className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Summary footer */}
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-semibold text-white">Summary</span>
            </div>
            <p className="text-sm text-slate-400">
              {urgent} urgent Â· {groups.review.length} review Â· {groups.cfo_approval.length} CFO pending
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

