import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  AlertTriangle,
  Activity,
  Calendar,
  FileEdit,
  Ghost,
  Loader2,
  Scissors,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/utils/currency';
import { displayDate } from '@/utils/dateUtils';
import { cn } from '@/lib/ap-invoice/utils';
import { supabase } from '@/lib/ap-invoice/supabase';
import type { InvoiceAnomaly } from '@/lib/ap-invoice/supabase';
import { resolveAnomaly, escalateAnomalyToCFO } from '@/lib/ap-invoice/anomalyService';
import { logApAudit } from '@/lib/ap-invoice/apAuditService';
import { useToast } from '@/hooks/use-toast';

// ─── Shared types (mirrors AnomalyIntelligence page) ─────────────────────────

export interface VendorProfileRow {
  id: string;
  vendor_name: string;
  mean_amount: number;
  std_deviation: number;
  min_amount: number;
  max_amount: number;
  median_amount: number;
  avg_invoices_per_month: number;
  historical_rejection_rate: number;
  is_recurring: boolean;
  is_splitting_vendor: boolean;
  splitting_threshold?: number | null;
  price_trend: 'stable' | 'increasing' | 'decreasing';
  price_trend_pct: number;
  training_invoice_count: number;
}

export interface VendorInvoiceRow {
  id: string;
  vendor_name: string;
  invoice_number?: string | null;
  total_amount: number;
  invoice_date: string;
  status: string;
}

export type AnomalyWithInvoice = InvoiceAnomaly & {
  invoices?: {
    id: string;
    invoice_number?: string | null;
    vendor_name?: string | null;
    total_amount?: number | null;
    invoice_date?: string | null;
  } | null;
};

type AnomalyFlag = {
  id: string;
  typeLabel: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
  invoiceIds: string[];
  invoiceNumbers: string[];
  anomalyId?: string;
  icon: typeof AlertTriangle;
};

const BENFORD_EXPECTED = [0, 30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6];
const APPROVAL_THRESHOLD = 10_000;

const severityStyles: Record<string, string> = {
  critical: 'border-red-700 text-red-400 bg-red-950/40',
  high: 'border-orange-700 text-orange-400 bg-orange-950/40',
  medium: 'border-amber-700 text-amber-400 bg-amber-950/40',
  low: 'border-slate-600 text-slate-400 bg-slate-800/60',
};

const FLAG_LABELS: Record<string, string> = {
  AMOUNT_HIGH_ZSCORE: 'Amount Anomaly',
  AMOUNT_LOW_ZSCORE: 'Amount Anomaly',
  JUST_BELOW_THRESHOLD: 'Just Below Threshold',
  NEW_VENDOR_HIGH_AMOUNT: 'Ghost Vendor',
  SPLIT_INVOICE: 'Split Invoice',
  FREQUENCY_ANOMALY: 'Frequency Anomaly',
  WEEKEND_INVOICE: 'Weekend Invoice',
  REVISED_INVOICE: 'Revised Invoice',
  PRICE_DRIFT: 'Price Drift',
  HIGH_REJECTION: 'High Rejection Rate',
  GHOST_VENDOR: 'Ghost Vendor',
};

function benfordScoreForInvoices(invoices: VendorInvoiceRow[]): number {
  const counts = Array(10).fill(0);
  for (const inv of invoices) {
    const first = String(Math.round(inv.total_amount)).replace(/^0+/, '')[0];
    if (first && parseInt(first, 10) >= 1) counts[parseInt(first, 10)]++;
  }
  const total = counts.reduce((s, v) => s + v, 0) || 1;
  let totalDev = 0;
  for (let i = 1; i <= 9; i++) {
    const actual = (counts[i] / total) * 100;
    totalDev += Math.abs(actual - BENFORD_EXPECTED[i]);
  }
  return Math.max(0, Math.round(100 - totalDev * 2));
}

function zScore(amount: number, mean: number, std: number): number {
  return std > 0 ? (amount - mean) / std : 0;
}

function weekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return start.toISOString().slice(0, 10);
}

function buildFlags(
  profile: VendorProfileRow,
  vendorInvoices: VendorInvoiceRow[],
  persisted: AnomalyWithInvoice[],
  currency: string,
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const mean = profile.mean_amount;
  const std = Math.max(profile.std_deviation, 1);
  const threshold = profile.splitting_threshold ?? APPROVAL_THRESHOLD;

  for (const a of persisted.filter((x) => x.status === 'open' || x.status === 'investigating')) {
    const inv = a.invoices;
    flags.push({
      id: `db-${a.id}`,
      typeLabel: FLAG_LABELS[a.flag_code ?? ''] ?? a.flag_code?.replace(/_/g, ' ') ?? 'Anomaly',
      severity: (a.severity as AnomalyFlag['severity']) ?? 'medium',
      explanation: a.flag_reason ?? 'Flagged by anomaly engine.',
      invoiceIds: inv?.id ? [inv.id] : a.invoice_id ? [a.invoice_id] : [],
      invoiceNumbers: inv?.invoice_number ? [inv.invoice_number] : [],
      anomalyId: a.id,
      icon: AlertTriangle,
    });
  }

  const anomalousInvs = vendorInvoices.filter(
    (i) => Math.abs(zScore(i.total_amount, mean, std)) > 3,
  );
  if (anomalousInvs.length && !flags.some((f) => f.typeLabel === 'Amount Anomaly')) {
    const worst = anomalousInvs.reduce((a, b) =>
      Math.abs(zScore(b.total_amount, mean, std)) > Math.abs(zScore(a.total_amount, mean, std)) ? b : a,
    );
    const z = zScore(worst.total_amount, mean, std);
    const direction = z > 0 ? 'above' : 'below';
    flags.push({
      id: 'amount-zscore',
      typeLabel: 'Amount Anomaly',
      severity: Math.abs(z) > 4 ? 'critical' : Math.abs(z) > 3 ? 'high' : 'medium',
      explanation: `Invoice ${formatCurrency(worst.total_amount, currency)} on ${displayDate(worst.invoice_date)} is ${Math.abs(z).toFixed(1)}σ ${direction} vendor average of ${formatCurrency(mean, currency)}.`,
      invoiceIds: anomalousInvs.map((i) => i.id),
      invoiceNumbers: anomalousInvs.map((i) => i.invoice_number ?? i.id.slice(0, 8)),
      icon: AlertTriangle,
    });
  }

  const nearThreshold = vendorInvoices.filter(
    (i) => i.total_amount >= threshold * 0.95 && i.total_amount < threshold,
  );
  if (nearThreshold.length && !flags.some((f) => f.typeLabel === 'Just Below Threshold')) {
    const byWeek: Record<string, VendorInvoiceRow[]> = {};
    for (const inv of nearThreshold) {
      const wk = weekKey(inv.invoice_date);
      (byWeek[wk] ??= []).push(inv);
    }
    const splitWeek = Object.entries(byWeek).find(([, invs]) => invs.length >= 2);
    const sample = nearThreshold[0];
    flags.push({
      id: 'just-below-threshold',
      typeLabel: 'Just Below Threshold',
      severity: splitWeek ? 'high' : 'medium',
      explanation: splitWeek
        ? `Invoice ${formatCurrency(sample.total_amount, currency)} on ${displayDate(sample.invoice_date)} is just below the ${formatCurrency(threshold, currency)} approval threshold. Combined with ${splitWeek[1].length} similar invoices in the same week — possible split to bypass approval.`
        : `Invoice ${formatCurrency(sample.total_amount, currency)} is within 5% of the ${formatCurrency(threshold, currency)} approval threshold — review recommended.`,
      invoiceIds: nearThreshold.map((i) => i.id),
      invoiceNumbers: nearThreshold.map((i) => i.invoice_number ?? '—'),
      icon: ShieldAlert,
    });
  }

  if (profile.is_splitting_vendor && !flags.some((f) => f.typeLabel === 'Split Invoice')) {
    flags.push({
      id: 'split-vendor',
      typeLabel: 'Split Invoice',
      severity: 'high',
      explanation: `Historical pattern detected: multiple invoices clustered just below ${formatCurrency(threshold, currency)} threshold — possible invoice splitting.`,
      invoiceIds: nearThreshold.map((i) => i.id),
      invoiceNumbers: nearThreshold.map((i) => i.invoice_number ?? '—'),
      icon: Scissors,
    });
  }

  if (profile.training_invoice_count === 1 && !profile.is_recurring && !flags.some((f) => f.typeLabel === 'Ghost Vendor')) {
    flags.push({
      id: 'ghost-vendor',
      typeLabel: 'Ghost Vendor',
      severity: profile.mean_amount > 100_000 ? 'critical' : 'medium',
      explanation: `Only ${profile.training_invoice_count} invoice in training history with no recurring pattern — verify vendor exists in approved master.`,
      invoiceIds: vendorInvoices.slice(0, 1).map((i) => i.id),
      invoiceNumbers: vendorInvoices.slice(0, 1).map((i) => i.invoice_number ?? '—'),
      icon: Ghost,
    });
  }

  if (profile.price_trend === 'increasing' && profile.price_trend_pct > 5 && !flags.some((f) => f.typeLabel === 'Price Drift')) {
    flags.push({
      id: 'price-drift',
      typeLabel: 'Price Drift',
      severity: profile.price_trend_pct > 15 ? 'high' : 'medium',
      explanation: `Upward price drift of +${profile.price_trend_pct.toFixed(1)}% detected via Mann-Kendall trend test — contract review recommended.`,
      invoiceIds: [],
      invoiceNumbers: [],
      icon: TrendingUp,
    });
  }

  if (profile.historical_rejection_rate > 0.1 && !flags.some((f) => f.typeLabel === 'High Rejection Rate')) {
    flags.push({
      id: 'high-rejection',
      typeLabel: 'High Rejection Rate',
      severity: 'medium',
      explanation: `Historical rejection rate of ${(profile.historical_rejection_rate * 100).toFixed(0)}% exceeds 10% baseline — quality review recommended.`,
      invoiceIds: [],
      invoiceNumbers: [],
      icon: Activity,
    });
  }

  const weekendInvs = vendorInvoices.filter((i) => {
    const day = new Date(i.invoice_date).getDay();
    return day === 0 || day === 6;
  });
  if (weekendInvs.length && !flags.some((f) => f.typeLabel === 'Weekend Invoice')) {
    flags.push({
      id: 'weekend-invoice',
      typeLabel: 'Weekend Invoice',
      severity: 'low',
      explanation: `${weekendInvs.length} invoice(s) dated on a weekend — unusual for B2B AP processing.`,
      invoiceIds: weekendInvs.map((i) => i.id),
      invoiceNumbers: weekendInvs.map((i) => i.invoice_number ?? '—'),
      icon: Calendar,
    });
  }

  const revisedInvs = vendorInvoices.filter((i) =>
    /revis|amend|correct/i.test(i.status ?? ''),
  );
  if (revisedInvs.length && !flags.some((f) => f.typeLabel === 'Revised Invoice')) {
    flags.push({
      id: 'revised-invoice',
      typeLabel: 'Revised Invoice',
      severity: 'medium',
      explanation: `${revisedInvs.length} revised/amended invoice(s) detected — verify original vs revised amounts.`,
      invoiceIds: revisedInvs.map((i) => i.id),
      invoiceNumbers: revisedInvs.map((i) => i.invoice_number ?? '—'),
      icon: FileEdit,
    });
  }

  return flags;
}

function riskScore(flags: AnomalyFlag[]): number {
  if (!flags.length) return 0;
  const sevMap = { critical: 90, high: 70, medium: 45, low: 25 };
  const max = Math.max(...flags.map((f) => sevMap[f.severity] ?? 30));
  return Math.min(100, max + Math.min(25, (flags.length - 1) * 8));
}

function statusLabel(flagCount: number): { label: string; className: string } {
  if (flagCount === 0) return { label: 'Clean', className: 'border-emerald-700 text-emerald-400' };
  if (flagCount === 1) return { label: 'Watch', className: 'border-amber-700 text-amber-400' };
  return { label: 'Flag', className: 'border-red-700 text-red-400' };
}

type Props = {
  profile: VendorProfileRow | null;
  invoices: VendorInvoiceRow[];
  anomalies: AnomalyWithInvoice[];
  companyId: string | null;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAnomalyResolved?: () => void;
};

export function VendorAnomalyDetailPanel({
  profile,
  invoices,
  anomalies,
  companyId,
  currency,
  open,
  onOpenChange,
  onAnomalyResolved,
}: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [acting, setActing] = useState<string | null>(null);

  const vendorInvoices = useMemo(() => {
    if (!profile) return [];
    return invoices
      .filter((i) => i.vendor_name.toLowerCase() === profile.vendor_name.toLowerCase())
      .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));
  }, [profile, invoices]);

  const vendorAnomalies = useMemo(() => {
    if (!profile) return [];
    const invIds = new Set(vendorInvoices.map((i) => i.id));
    return anomalies.filter(
      (a) =>
        (a.invoice_id && invIds.has(a.invoice_id)) ||
        a.invoices?.vendor_name?.toLowerCase() === profile.vendor_name.toLowerCase(),
    );
  }, [profile, anomalies, vendorInvoices]);

  const flags = useMemo(
    () => (profile ? buildFlags(profile, vendorInvoices, vendorAnomalies, currency) : []),
    [profile, vendorInvoices, vendorAnomalies, currency],
  );

  const score = riskScore(flags);
  const status = statusLabel(flags.length);
  const bScore = benfordScoreForInvoices(vendorInvoices);

  const mean = profile?.mean_amount ?? 0;
  const std = Math.max(profile?.std_deviation ?? 1, 1);
  const ucl = mean + 3 * std;
  const lcl = Math.max(0, mean - 3 * std);
  const threshold = profile?.splitting_threshold ?? APPROVAL_THRESHOLD;

  const anomalyInvoiceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of flags) f.invoiceIds.forEach((id) => ids.add(id));
    for (const inv of vendorInvoices) {
      if (Math.abs(zScore(inv.total_amount, mean, std)) > 3) ids.add(inv.id);
      if (inv.total_amount >= threshold * 0.95 && inv.total_amount < threshold) ids.add(inv.id);
    }
    return ids;
  }, [flags, vendorInvoices, mean, std, threshold]);

  const chartData = vendorInvoices.map((inv) => ({
    label: inv.invoice_date.slice(5),
    date: inv.invoice_date,
    amount: inv.total_amount,
    anomalous: anomalyInvoiceIds.has(inv.id),
  }));

  const latestAnomalous = vendorInvoices.find((i) => anomalyInvoiceIds.has(i.id));
  const highlightInvoice = latestAnomalous ?? vendorInvoices[vendorInvoices.length - 1];
  const highlightZ = highlightInvoice ? zScore(highlightInvoice.total_amount, mean, std) : 0;

  async function getActor(): Promise<string> {
    const { data } = await supabase.auth.getUser();
    return data.user?.email ?? data.user?.id ?? 'system';
  }

  async function handleInvestigate(invoiceId?: string) {
    const id = invoiceId ?? flags.find((f) => f.invoiceIds.length)?.invoiceIds[0];
    if (!id) {
      toast({ title: 'No invoice linked', description: 'Open Invoice List and search by vendor name.', variant: 'destructive' });
      navigate('/invoices');
      return;
    }
    onOpenChange(false);
    navigate('/invoices', { state: { highlightInvoiceId: id } });
    toast({ title: 'Opening invoice list', description: 'Locate the flagged invoice for review.' });
  }

  async function handleEscalate() {
    if (!companyId || !profile) return;
    const openAnomaly = vendorAnomalies.find((a) => a.status === 'open');
    const inv = openAnomaly?.invoices;
    const invNum = inv?.invoice_number ?? flags[0]?.invoiceNumbers[0] ?? 'Unknown';
    const invId = openAnomaly?.invoice_id ?? flags[0]?.invoiceIds[0] ?? '';
    setActing('escalate');
    try {
      await escalateAnomalyToCFO({
        invoiceId: invId,
        invoiceNumber: invNum,
        vendorName: profile.vendor_name,
        flagReason: flags[0]?.explanation ?? 'Anomaly review required',
        actor: await getActor(),
        companyId,
      });
      toast({ title: 'Escalated to CFO', description: 'Added to Action Queue for review.' });
    } catch (e) {
      toast({ title: 'Escalation failed', description: String(e), variant: 'destructive' });
    } finally {
      setActing(null);
    }
  }

  async function handleFalsePositive() {
    const openOnes = vendorAnomalies.filter((a) => a.status === 'open' || a.status === 'investigating');
    if (!openOnes.length) {
      toast({ title: 'No open anomalies', description: 'All flags are profile-derived — no DB records to resolve.' });
      return;
    }
    setActing('false-positive');
    try {
      const actor = await getActor();
      await Promise.all(openOnes.map((a) => resolveAnomaly(a.id, 'false_positive', actor, 'Marked false positive from Anomaly Intelligence')));
      toast({ title: 'Marked as false positive', description: `${openOnes.length} anomaly record(s) updated.` });
      onAnomalyResolved?.();
    } catch (e) {
      toast({ title: 'Update failed', description: String(e), variant: 'destructive' });
    } finally {
      setActing(null);
    }
  }

  async function handleWatchlist() {
    if (!companyId || !profile) return;
    setActing('watchlist');
    try {
      await supabase.from('ap_alerts').insert({
        company_id: companyId,
        alert_type: 'VENDOR_WATCHLIST',
        priority: flags.some((f) => f.severity === 'critical') ? 'critical' : 'medium',
        title: `Watchlist: ${profile.vendor_name}`,
        message: `${flags.length} active anomaly flag(s). Risk score ${score}/100.`,
        metadata: { vendor_profile_id: profile.id, vendor_name: profile.vendor_name, risk_score: score },
        status: 'open',
      });
      logApAudit({
        entity_type: 'vendor',
        entity_id: profile.id,
        action: 'added_to_watchlist',
        action_by: await getActor(),
        notes: `${profile.vendor_name} — ${flags.length} flags`,
      });
      toast({ title: 'Added to watchlist', description: `${profile.vendor_name} will appear in Action Queue alerts.` });
    } catch (e) {
      toast({ title: 'Watchlist failed', description: String(e), variant: 'destructive' });
    } finally {
      setActing(null);
    }
  }

  if (!profile) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto bg-slate-950 border-slate-800 text-slate-100 p-0"
      >
        <div className="p-6 space-y-5">
          <SheetHeader className="text-left space-y-3">
            <div className="flex items-start justify-between gap-3 pr-8">
              <div>
                <SheetTitle className="text-white text-lg leading-tight">{profile.vendor_name}</SheetTitle>
                <SheetDescription className="text-slate-400 mt-1">
                  Vendor anomaly intelligence summary
                </SheetDescription>
              </div>
              <Badge variant="outline" className={cn('shrink-0 capitalize', status.className)}>
                {status.label}
              </Badge>
            </div>

            <div className="flex items-center gap-4 rounded-lg border border-slate-700 bg-slate-900/80 p-4">
              <span className="text-4xl font-bold tabular-nums text-sky-300">{score}</span>
              <div className="text-sm space-y-0.5">
                <p className="text-slate-300">Overall risk score</p>
                <p className="text-slate-400">
                  {vendorInvoices.length} invoices analysed · Avg {formatCurrency(mean, currency)}
                </p>
              </div>
            </div>
          </SheetHeader>

          {/* Section 1 — Active Flags */}
          <Card className="border-slate-700 bg-slate-900/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-200">Active Anomaly Flags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {flags.length === 0 ? (
                <p className="text-sm text-emerald-400 flex items-center gap-2">
                  <Activity className="h-4 w-4" /> No active flags — vendor looks clean.
                </p>
              ) : (
                flags.map((f) => {
                  const Icon = f.icon;
                  return (
                    <div key={f.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-amber-400 shrink-0" />
                          <span className="text-sm font-medium text-slate-200">{f.typeLabel}</span>
                        </div>
                        <Badge variant="outline" className={cn('text-[10px] capitalize', severityStyles[f.severity])}>
                          {f.severity}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">{f.explanation}</p>
                      {f.invoiceNumbers.length > 0 && (
                        <p className="text-[11px] text-slate-500">
                          Invoices: {f.invoiceNumbers.filter((n) => n !== '—').join(', ') || '—'}
                        </p>
                      )}
                      {f.invoiceIds[0] && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-slate-600 text-slate-300 hover:bg-slate-800"
                          onClick={() => void handleInvestigate(f.invoiceIds[0])}
                        >
                          Review invoice
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Section 2 — Invoice History Chart */}
          <Card className="border-slate-700 bg-slate-900/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-200">Invoice History</CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">No invoices found for this vendor.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData} margin={{ top: 10, right: 8, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => formatCurrency(v, currency)} width={72} />
                      <Tooltip
                        formatter={(v: number) => [formatCurrency(v, currency), 'Amount']}
                        labelFormatter={(_, payload) => {
                          const row = payload?.[0]?.payload as { date?: string } | undefined;
                          return row?.date ? displayDate(row.date) : '';
                        }}
                        contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                      />
                      <ReferenceLine y={mean} stroke="#6366f1" strokeDasharray="6 3" label={{ value: 'Mean', fontSize: 9, fill: '#818cf8' }} />
                      <ReferenceLine y={ucl} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'UCL', fontSize: 9, fill: '#f87171' }} />
                      <ReferenceLine y={lcl} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'LCL', fontSize: 9, fill: '#f87171' }} />
                      <Bar dataKey="amount" radius={[3, 3, 0, 0]}>
                        {chartData.map((d, i) => (
                          <Cell key={i} fill={d.anomalous ? '#ef4444' : '#22c55e'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex gap-3 mt-2 text-[10px] text-slate-500 flex-wrap">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-green-500 rounded-sm inline-block" />Normal</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-red-500 rounded-sm inline-block" />Anomalous</span>
                    <span className="flex items-center gap-1"><span className="w-5 border-t border-dashed border-indigo-400 inline-block" />Mean</span>
                    <span className="flex items-center gap-1"><span className="w-5 border-t border-dashed border-red-400 inline-block" />UCL/LCL (±3σ)</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Section 3 — Statistical Context */}
          <Card className="border-slate-700 bg-slate-900/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-200">Statistical Context</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded border border-slate-700 bg-slate-900/60 px-3 py-2">
                <p className="text-[10px] text-slate-500 uppercase">Vendor average</p>
                <p className="font-semibold text-slate-200 tabular-nums">{formatCurrency(mean, currency)}</p>
              </div>
              <div className="rounded border border-slate-700 bg-slate-900/60 px-3 py-2">
                <p className="text-[10px] text-slate-500 uppercase">Std deviation</p>
                <p className="font-semibold text-slate-200 tabular-nums">{formatCurrency(std, currency)}</p>
              </div>
              <div className="rounded border border-slate-700 bg-slate-900/60 px-3 py-2">
                <p className="text-[10px] text-slate-500 uppercase">Latest invoice</p>
                <p className="font-semibold text-slate-200 tabular-nums">
                  {highlightInvoice ? formatCurrency(highlightInvoice.total_amount, currency) : '—'}
                </p>
                {highlightInvoice && (
                  <p className="text-[10px] text-slate-500">{highlightZ.toFixed(1)}σ from mean</p>
                )}
              </div>
              <div className="rounded border border-slate-700 bg-slate-900/60 px-3 py-2">
                <p className="text-[10px] text-slate-500 uppercase">Benford score</p>
                <p className={cn('font-semibold tabular-nums', bScore >= 70 ? 'text-emerald-400' : bScore >= 50 ? 'text-amber-400' : 'text-red-400')}>
                  {bScore}/100
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Section 4 — Recommended Actions */}
          <Card className="border-slate-700 bg-slate-900/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-200">Recommended Actions</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                className="bg-indigo-600 hover:bg-indigo-500"
                onClick={() => void handleInvestigate()}
              >
                Investigate
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-orange-700 text-orange-400 hover:bg-orange-950/40"
                disabled={acting === 'escalate' || !flags.length}
                onClick={() => void handleEscalate()}
              >
                {acting === 'escalate' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Escalate to CFO'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-slate-600 text-slate-300 hover:bg-slate-800"
                disabled={acting === 'false-positive'}
                onClick={() => void handleFalsePositive()}
              >
                {acting === 'false-positive' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Mark False Positive'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-amber-700 text-amber-400 hover:bg-amber-950/40"
                disabled={acting === 'watchlist'}
                onClick={() => void handleWatchlist()}
              >
                {acting === 'watchlist' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add to Watchlist'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  );
}
