import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, type Invoice, type ApAlert } from '@/lib/ap-invoice/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/utils/currency';
import {
  approveBankChangeAlert,
  listOpenApAlerts,
  rejectBankChangeAlert,
} from '@/lib/ap-invoice/vendorMasterService';
import { listBankGuarantees, daysUntilExpiry } from '@/lib/ap-invoice/bankGuaranteeService';
import { listInvoiceAnomalies } from '@/lib/ap-invoice/anomalyService';
import { getInvoiceflowWorkEmail } from '@/lib/ap-invoice/auditService';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { useMarket } from '@/contexts/MarketContext';
import { useCompany } from '@/context/CompanyContext';
import type { BankGuarantee, InvoiceAnomaly } from '@/lib/ap-invoice/supabase';

type Priority = 'critical' | 'high' | 'medium' | 'info';

type QueueItem = {
  id: string;
  priority: Priority;
  severityLabel: string;
  title: string;
  subtitle: string;
  amountAed?: number;
  daysSince: number;
  flags: string[];
  action: string;
  kind: 'alert' | 'invoice' | 'bg' | 'anomaly';
  alert?: ApAlert;
  invoice?: Invoice;
  anomaly?: InvoiceAnomaly;
  bg?: BankGuarantee;
};

const priorityConfig: Record<
  Priority,
  { label: string; bg: string; border: string; badge: string; order: number }
> = {
  critical: { label: '🔴 CRITICAL', bg: 'bg-red-950/30', border: 'border-red-800', badge: 'bg-red-900 text-red-200', order: 0 },
  high: { label: '🟠 HIGH', bg: 'bg-orange-950/30', border: 'border-orange-800', badge: 'bg-orange-900 text-orange-200', order: 1 },
  medium: { label: '🟡 MEDIUM', bg: 'bg-yellow-950/20', border: 'border-yellow-800', badge: 'bg-yellow-900 text-yellow-200', order: 2 },
  info: { label: '🔵 INFO', bg: 'bg-slate-900/50', border: 'border-slate-700', badge: 'bg-slate-800 text-slate-300', order: 3 },
};

function daysSinceCreated(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function classifyAlert(alert: ApAlert): QueueItem | null {
  if (alert.alert_type === 'VENDOR_BANK_CHANGE') {
    return {
      id: alert.id,
      priority: 'critical',
      severityLabel: 'CRITICAL',
      title: alert.title,
      subtitle: alert.vendor_name ?? '',
      daysSince: daysSinceCreated(alert.created_at),
      flags: ['Vendor bank change — payments frozen'],
      action: 'Verify with vendor → AP + CFO dual approve',
      kind: 'alert',
      alert,
    };
  }
  if (alert.alert_type === 'BG_EXPIRED' || alert.alert_type === 'BG_EXPIRING') {
    const meta = (alert.metadata ?? {}) as { days_remaining?: number; amount_aed?: number };
    const days = meta.days_remaining ?? 0;
    const priority: Priority = days <= 0 || days <= 7 ? 'critical' : days <= 15 ? 'high' : 'medium';
    return {
      id: alert.id,
      priority,
      severityLabel: priority.toUpperCase(),
      title: alert.title,
      subtitle: alert.vendor_name ?? '',
      amountAed: Number(meta.amount_aed ?? 0),
      daysSince: daysSinceCreated(alert.created_at),
      flags: [`BG expiry — ${days} days remaining`],
      action: days <= 7 ? 'Renew BG immediately — legal exposure' : 'Schedule BG renewal',
      kind: 'alert',
      alert,
    };
  }
  return null;
}

function classifyInvoice(inv: Invoice, anomalies: InvoiceAnomaly[]): QueueItem | null {
  const flags: string[] = [];
  let priorityRank = 99;
  let action = 'Review and approve or reject';
  const setPriority = (p: Priority) => {
    const r = priorityConfig[p].order;
    if (r < priorityRank) priorityRank = r;
  };
  const riskScore = typeof inv.risk_score === 'number' ? inv.risk_score : Number(inv.risk_score ?? 0);
  const isFrozen = inv.payment_status === 'frozen';
  const invAnomalies = anomalies.filter((a) => a.invoice_id === inv.id && a.status === 'open');
  const maxAnomalyScore = Math.max(0, ...invAnomalies.map((a) => Number(a.risk_score ?? 0)));

  if (isFrozen) {
    flags.push('Payment FROZEN — vendor bank change');
    setPriority('critical');
    action = 'Resolve bank change alert before payment';
  }
  if (maxAnomalyScore > 80) {
    flags.push(`Anomaly score ${maxAnomalyScore} — critical risk`);
    setPriority('critical');
    action = 'Investigate anomalies → escalate to CFO if confirmed';
  }
  if (invAnomalies.some((a) => a.flag_code === 'SPLIT_INVOICE')) {
    flags.push('Split invoice detected');
    setPriority('high');
    action = 'Verify invoice splitting — confirm legitimate billing';
  }
  if (invAnomalies.some((a) => a.flag_code === 'NEW_VENDOR_HIGH_AMOUNT')) {
    flags.push('New vendor + high amount');
    setPriority('high');
    action = 'Enhanced due diligence required';
  }
  if (maxAnomalyScore >= 50 && maxAnomalyScore <= 80) {
    flags.push(`Anomaly score ${maxAnomalyScore}`);
    setPriority('medium');
  }
  if (inv.duplicate_flag) {
    flags.push('Duplicate detected');
    setPriority('high');
  }
  if (riskScore >= 70) {
    flags.push(`High risk score: ${riskScore}`);
    setPriority('high');
  }

  const isPending = inv.status === 'Processing' || inv.status === 'On Hold' || inv.status === 'Queried';
  const isApprovedFrozen = inv.status === 'Approved' && isFrozen;
  if ((!isPending && !isApprovedFrozen) || flags.length === 0 || priorityRank === 99) return null;

  const priority = (Object.entries(priorityConfig).find(([, v]) => v.order === priorityRank)?.[0] ??
    'medium') as Priority;

  return {
    id: inv.id,
    priority,
    severityLabel: priority.toUpperCase(),
    title: inv.invoice_number,
    subtitle: inv.vendor_name,
    amountAed: Number(inv.total_amount ?? 0),
    daysSince: daysSinceCreated(inv.created_at),
    flags,
    action,
    kind: 'invoice',
    invoice: inv,
    anomaly: invAnomalies[0],
  };
}

function classifyBg(bg: BankGuarantee): QueueItem | null {
  if (bg.status !== 'active') return null;
  const days = daysUntilExpiry(bg.expiry_date);
  if (days > 30) return null;
  const priority: Priority = days <= 0 || days <= 7 ? 'critical' : days <= 15 ? 'high' : 'medium';
  return {
    id: `bg-${bg.id}`,
    priority,
    severityLabel: priority.toUpperCase(),
    title: bg.bg_number,
    subtitle: bg.issuing_bank ?? 'Bank Guarantee',
    amountAed: Number(bg.amount_aed ?? 0),
    daysSince: 0,
    flags: [`Expires in ${days} days`],
    action: days <= 7 ? 'Renew BG — URGENT' : 'Plan BG renewal',
    kind: 'bg',
    bg,
  };
}

function isUnpaidInvoice(inv: Invoice): boolean {
  const ps = (inv.payment_status ?? '').trim().toLowerCase();
  if (ps === 'paid' || ps === 'cancelled') return false;
  if (inv.status === 'Paid' || inv.status === 'Rejected') return false;
  return true;
}

/** Fallback when ap_alerts / migrations not yet loaded — scan live invoice data. */
function classifyFallbackInvoice(inv: Invoice): QueueItem | null {
  if (!isUnpaidInvoice(inv)) return null;

  const today = new Date().toISOString().split('T')[0];
  const flags: string[] = [];
  let priorityRank = 99;
  let action = 'Review invoice';

  const setPriority = (p: Priority) => {
    const r = priorityConfig[p].order;
    if (r < priorityRank) priorityRank = r;
  };

  if (inv.due_date && inv.due_date < today) {
    flags.push('OVERDUE — past due date');
    setPriority('high');
    action = 'Schedule payment or follow up with vendor';
  }
  if (inv.duplicate_flag === true) {
    flags.push('DUPLICATE invoice flagged');
    setPriority('high');
    action = 'Confirm duplicate or clear flag before paying';
  }
  const rl = (inv.risk_level ?? '').toLowerCase();
  if (rl === 'critical') {
    flags.push('CRITICAL risk vendor');
    setPriority('critical');
    action = 'Enhanced review required before payment';
  } else if (rl === 'high') {
    flags.push('HIGH RISK vendor');
    setPriority('high');
    action = 'Review risk flags before approving payment';
  }

  if (flags.length === 0 || priorityRank === 99) return null;

  const priority = (Object.entries(priorityConfig).find(([, v]) => v.order === priorityRank)?.[0] ??
    'high') as Priority;

  return {
    id: `fallback-${inv.id}`,
    priority,
    severityLabel: priority.toUpperCase(),
    title: inv.invoice_number,
    subtitle: inv.vendor_name,
    amountAed: Number(inv.total_amount ?? 0),
    daysSince: daysSinceCreated(inv.created_at),
    flags,
    action,
    kind: 'invoice',
    invoice: inv,
  };
}

export function ActionQueue() {
  const navigate = useNavigate();
  const { baseCurrency: settingsCurrency } = useCompanySettings();
  const { isUAE } = useMarket();
  const { activeCompanyId } = useCompany();
  const baseCurrency = isUAE ? 'AED' : (settingsCurrency ?? 'INR');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const actor = getInvoiceflowWorkEmail();

  async function load() {
    setLoading(true);
    const [invRes, allInvRes, alerts, bgs, anomalies] = await Promise.all([
      (() => {
        let q = supabase
          .from('invoices')
          .select('*')
          .or('status.in.(Processing,On Hold,Queried,Approved),payment_status.eq.frozen')
          .order('created_at', { ascending: false });
        if (activeCompanyId) q = q.eq('company_id', activeCompanyId);
        return q;
      })(),
      (() => {
        let q = supabase.from('invoices').select('*').order('created_at', { ascending: false });
        if (activeCompanyId) q = q.eq('company_id', activeCompanyId);
        return q;
      })(),
      listOpenApAlerts(),
      listBankGuarantees().catch(() => []),
      listInvoiceAnomalies({ status: 'open' }).catch(() => []),
    ]);

    const alertItems = alerts.map(classifyAlert).filter(Boolean) as QueueItem[];
    const invoiceItems = (invRes.data ?? [])
      .map((inv) => classifyInvoice(inv as Invoice, anomalies))
      .filter(Boolean) as QueueItem[];
    const bgItems = bgs.map(classifyBg).filter(Boolean) as QueueItem[];

    const seenIds = new Set([...alertItems, ...invoiceItems, ...bgItems].map((i) => i.invoice?.id ?? i.id));

    let fallbackItems: QueueItem[] = [];
    if (alerts.length === 0) {
      for (const inv of allInvRes.data ?? []) {
        const item = classifyFallbackInvoice(inv as Invoice);
        if (!item) continue;
        const invId = item.invoice?.id;
        if (invId && seenIds.has(invId)) continue;
        fallbackItems.push(item);
        if (invId) seenIds.add(invId);
      }
    }

    const merged: QueueItem[] = [...alertItems, ...invoiceItems, ...bgItems, ...fallbackItems];

    merged.sort((a, b) => priorityConfig[a.priority].order - priorityConfig[b.priority].order);
    setItems(merged);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompanyId]);

  const byPriority = (p: Priority) => items.filter((i) => i.priority === p);
  const today = new Date().toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6 rounded-xl bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 text-slate-100 -m-6 lg:-m-8 min-h-[calc(100vh-8rem)]">
      <div>
        <h1 className="text-2xl font-bold text-white">Today&apos;s Action Queue</h1>
        <p className="mt-1 text-sm text-slate-400">
          {today} — {items.length} item{items.length !== 1 ? 's' : ''} prioritized by severity
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-7 w-7 animate-spin rounded-full border-4 border-slate-600 border-t-sky-400" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <Card className="border-slate-700 bg-slate-900/90">
          <CardContent className="py-16 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-lg font-semibold text-slate-200">All clear — no action items today</p>
          </CardContent>
        </Card>
      )}

      {(['critical', 'high', 'medium', 'info'] as Priority[]).map((priority) => {
        const group = byPriority(priority);
        if (!group.length) return null;
        const cfg = priorityConfig[priority];
        return (
          <div key={priority} className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-200">{cfg.label}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.badge}`}>
                {group.length}
              </span>
            </div>
            <div className="space-y-2">
              {group.map((item) => (
                <Card key={item.id} className={`border ${cfg.border} ${cfg.bg}`}>
                  <CardContent className="py-4 px-5">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-mono font-semibold text-white">{item.title}</span>
                          <Badge variant="outline" className={`text-xs ${cfg.badge} border-0`}>
                            {item.severityLabel}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-300">{item.subtitle}</p>
                        {item.amountAed != null && item.amountAed > 0 && (
                          <p className="text-sm font-semibold text-sky-300">
                            {formatCurrency(item.amountAed, baseCurrency)}
                          </p>
                        )}
                        {item.flags.map((f, fi) => (
                          <p key={fi} className="text-xs text-red-300 font-medium">❌ {f}</p>
                        ))}
                        <p className="text-xs text-slate-400">
                          <span className="font-semibold text-slate-300">Action: </span>
                          {item.action}
                        </p>
                        <p className="text-xs text-slate-500">{item.daysSince}d since created</p>
                        {item.kind === 'alert' && item.alert?.alert_type === 'VENDOR_BANK_CHANGE' && (
                          <div className="flex flex-wrap gap-2 pt-2">
                            <Button size="sm" variant="outline" className="border-slate-600" onClick={() => void approveBankChangeAlert(item.alert!.id, 'ap', actor || 'ap@company.com').then(load)}>
                              Approve (AP)
                            </Button>
                            <Button size="sm" variant="outline" className="border-slate-600" onClick={() => void approveBankChangeAlert(item.alert!.id, 'cfo', actor || 'cfo@company.com').then(load)}>
                              Approve (CFO)
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => void rejectBankChangeAlert(item.alert!.id, actor || 'user').then(load)}>
                              Reject
                            </Button>
                          </div>
                        )}
                        {(item.kind === 'invoice' || item.kind === 'anomaly') && (
                          <div className="flex flex-wrap gap-2 pt-2">
                            <Button size="sm" variant="outline" className="border-slate-600" onClick={() => navigate(`/ap-invoices/list?open=${item.invoice?.id ?? item.anomaly?.invoice_id}`)}>
                              Investigate
                            </Button>
                            <Button size="sm" variant="ghost" className="text-slate-400" onClick={() => navigate('/ap-invoices/list?tab=anomalies')}>
                              Dismiss
                            </Button>
                          </div>
                        )}
                        {item.kind === 'bg' && (
                          <Button size="sm" variant="outline" className="mt-2 border-slate-600" onClick={() => navigate('/ap-invoices/bank-guarantees')}>
                            View BG →
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
