import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, type Invoice } from '../../lib/ap-invoice/supabase';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { formatCurrency } from '../../utils/currency';

type ActionItem = {
  invoice: Invoice;
  urgency: 'red' | 'yellow' | 'green';
  flags: string[];
  action: string;
};

function classifyInvoice(inv: Invoice): ActionItem | null {
  const flags: string[] = [];
  let urgency: 'red' | 'yellow' | 'green' = 'yellow';
  let action = 'Review and approve or reject';

  const riskScore = typeof inv.risk_score === 'number' ? inv.risk_score : Number(inv.risk_score ?? 0);
  const matchStatus = (inv as any).three_way_match_status ?? '';
  const isDuplicate = (inv as any).duplicate_flag === true;
  const isNewVendor = (inv as any).is_new_vendor === true;
  const poVariancePct = (inv as any).po_variance_pct ?? null;
  const hasPO = !!inv.po_number;

  if (isDuplicate) {
    flags.push('Duplicate detected');
    urgency = 'red';
    action = 'Confirm if duplicate â†’ reject OR approve with reason';
  }
  if (poVariancePct !== null && Math.abs(Number(poVariancePct)) > 20) {
    flags.push(`${Math.abs(Number(poVariancePct)).toFixed(1)}% above PO â€” HARD HOLD`);
    urgency = 'red';
    action = 'Review with vendor â†’ approve variance OR reject invoice';
  }
  if (!hasPO && isNewVendor) {
    flags.push('No PO â€” New vendor â€” KYC missing');
    urgency = 'red';
    action = 'Complete KYC â†’ raise PO â†’ then approve';
  }
  if (riskScore >= 70 && urgency !== 'red') {
    flags.push(`High risk score: ${riskScore}`);
    urgency = 'red';
    action = 'Review risk flags before approving';
  }

  if (urgency !== 'red') {
    if (poVariancePct !== null && Math.abs(Number(poVariancePct)) > 2 && Math.abs(Number(poVariancePct)) <= 20) {
      flags.push(`${Math.abs(Number(poVariancePct)).toFixed(1)}% variance from PO`);
      action = 'Accept variance â†’ approve OR send back to vendor';
    }
    if (matchStatus === 'splitting') {
      flags.push('Invoice splitting pattern detected');
      action = 'Verify with PO â€” confirm legitimate billing in parts â†’ approve all OR hold';
    }
    if (!hasPO && !isNewVendor) {
      flags.push('No PO number');
      action = 'Get PO raised first, then re-approve';
    }
  }

  const isPending = inv.status === 'Processing' || inv.status === 'On Hold' || inv.status === 'Queried';
  if (!isPending || flags.length === 0) return null;

  // CFO pending
  const cfoPending = inv.approval_level === 'cfo' && inv.status === 'Processing';
  if (cfoPending) urgency = 'green';

  return { invoice: inv, urgency, flags, action };
}

const urgencyConfig = {
  red: { label: 'ðŸ”´ URGENT', bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-800' },
  yellow: { label: 'ðŸŸ¡ REVIEW', bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-800' },
  green: { label: 'ðŸŸ¢ PENDING CFO APPROVAL', bg: 'bg-green-50', border: 'border-green-200', badge: 'bg-green-100 text-green-800' },
};

export function ActionQueue() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('invoices')
        .select('*')
        .in('status', ['Processing', 'On Hold', 'Queried'])
        .order('created_at', { ascending: false });

      const classified = (data ?? [])
        .map(classifyInvoice)
        .filter(Boolean) as ActionItem[];

      // Sort: red â†’ yellow â†’ green
      const order = { red: 0, yellow: 1, green: 2 };
      classified.sort((a, b) => order[a.urgency] - order[b.urgency]);
      setItems(classified);
      setLoading(false);
    })();
  }, []);

  const byUrgency = (u: 'red' | 'yellow' | 'green') => items.filter((i) => i.urgency === u);

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Today's Action Queue</h1>
        <p className="mt-1 text-sm text-gray-500">{today} â€” {items.length} invoice{items.length !== 1 ? 's' : ''} need your attention</p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-7 w-7 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-4xl mb-3">âœ…</p>
            <p className="text-lg font-semibold text-gray-700">All clear â€” no action items today</p>
            <p className="text-sm text-gray-500 mt-1">All invoices are approved, paid, or do not require review.</p>
          </CardContent>
        </Card>
      )}

      {(['red', 'yellow', 'green'] as const).map((urgency) => {
        const group = byUrgency(urgency);
        if (group.length === 0) return null;
        const cfg = urgencyConfig[urgency];
        return (
          <div key={urgency} className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-gray-800">{cfg.label}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.badge}`}>{group.length} item{group.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-2">
              {group.map(({ invoice, flags, action }, idx) => (
                <Card key={invoice.id} className={`border ${cfg.border} ${cfg.bg}`}>
                  <CardContent className="py-4 px-5">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-mono font-semibold text-gray-900">
                            {idx + 1}. {invoice.invoice_number}
                          </span>
                          <Badge variant="outline" className={`text-xs ${
                            invoice.status === 'On Hold' ? 'bg-orange-100 text-orange-800 border-orange-300' :
                            invoice.status === 'Queried' ? 'bg-purple-100 text-purple-800 border-purple-300' :
                            'bg-yellow-100 text-yellow-800 border-yellow-300'
                          }`}>
                            {invoice.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-700">
                          <span className="font-medium">{invoice.vendor_name}</span>
                          {' â€” '}
                          <span className="font-semibold">{formatCurrency(invoice.total_amount, invoice.currency)}</span>
                        </p>
                        <div className="space-y-0.5">
                          {flags.map((f, fi) => (
                            <p key={fi} className="text-xs text-red-700 font-medium">âŒ {f}</p>
                          ))}
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          <span className="font-semibold">Action: </span>{action}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 border-gray-300"
                        onClick={() => navigate(`/invoices?open=${invoice.id}`)}
                      >
                        Open Invoice â†’
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      {!loading && items.length > 0 && (
        <Card className="bg-slate-50 border-slate-200">
          <CardContent className="py-4 px-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-700">Summary</p>
              <p className="text-xs text-slate-500">
                {byUrgency('red').length} urgent Â· {byUrgency('yellow').length} review Â· {byUrgency('green').length} CFO pending
              </p>
            </div>
            <Button size="sm" onClick={() => navigate('/invoices')}>
              View All Invoices
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

