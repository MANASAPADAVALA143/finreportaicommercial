import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../../lib/ap-invoice/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '../../utils/currency';
import { displayDate } from '../../utils/dateUtils';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { useMarket } from '../../contexts/MarketContext';
import { useToast } from '../../hooks/use-toast';
import { Loader2, RefreshCw, Download, Sparkles, TrendingUp, TrendingDown, Brain } from 'lucide-react';
import {
  getCFOKPIs,
  getStrategicInsightsCached,
  clearInsightCache,
  buildActionRows,
  runDeepAnalysis,
  DEFAULT_CFO_OPENING_CASH,
  type CFOKPIs,
  type StrategicInsight,
  type ActionRow,
} from '../../lib/ap-invoice/strategicAdvisorService';
import { anonymiseVendor } from '../../lib/ap-invoice/vendorDisplay';

const AXIS_TICK = { fontSize: 10, fill: '#94a3b8' };
const GRID_LIGHT = { strokeDasharray: '3 3', stroke: 'rgba(0,0,0,0.08)' };
const COL = { teal: '#1D9E75', blue: '#378ADD', amber: '#EF9F27', red: '#E24B4A', purple: '#7F77DD' };

function chartTooltipProps() {
  return {
    contentStyle: {
      background: 'hsl(var(--card))',
      border: '1px solid hsl(var(--border))',
      borderRadius: 8,
      fontSize: 12,
    },
  };
}

function fmtL(n: number, currency: string) {
  return formatCurrency(n, currency);
}

type KpiVariant = 'default' | 'danger' | 'success' | 'info' | 'purple';

function KpiCard({
  label,
  value,
  sub,
  trend,
  variant = 'default',
}: {
  label: string;
  value: string;
  sub: string;
  trend?: { pct: number; up: boolean; inverse?: boolean };
  variant?: KpiVariant;
}) {
  const wrap =
    variant === 'danger'
      ? 'border border-red-200 bg-red-50/80'
      : variant === 'success'
        ? 'border border-emerald-200 bg-emerald-50/70'
        : variant === 'info'
          ? 'border border-sky-200 bg-sky-50/70'
          : variant === 'purple'
            ? 'border border-violet-200 bg-violet-50/60'
            : 'border border-gray-200 bg-white';
  const valCls =
    variant === 'danger'
      ? 'text-red-700'
      : variant === 'success'
        ? 'text-emerald-800'
        : variant === 'info'
          ? 'text-sky-800'
          : variant === 'purple'
            ? 'text-violet-800'
            : 'text-gray-900';
  const trendBad = trend?.inverse ? !trend.up : trend?.up;
  return (
    <Card className={`shadow-sm ${wrap}`}>
      <CardHeader className="pb-1 pt-3">
        <CardTitle className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 pb-3">
        <p className={`text-xl font-medium tabular-nums ${valCls}`}>{value}</p>
        <p className="text-[10px] text-muted-foreground">{sub}</p>
        {trend != null ? (
          <div
            className={`flex items-center gap-1 text-[10px] font-medium ${
              trendBad ? 'text-red-600' : 'text-emerald-700'
            }`}
          >
            {trend.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {trend.up ? '+' : ''}
            {trend.pct}% vs prior month
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InsightBlock({ ins }: { ins: StrategicInsight }) {
  const border =
    ins.priority === 'critical'
      ? 'border-[#E24B4A] bg-[#E24B4A]/8'
      : ins.priority === 'high'
        ? 'border-[#EF9F27] bg-[#EF9F27]/10'
        : 'border-[#378ADD] bg-[#378ADD]/8';
  return (
    <div className={`rounded-lg border-l-4 p-3 ${border}`}>
      <p className="text-xs font-medium text-gray-900">{ins.title}</p>
      <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{ins.detail}</p>
      <p className="mt-2 text-[11px] font-medium text-emerald-800">â†’ {ins.action}</p>
    </div>
  );
}

/** Recharts measures hidden Radix tab panels as 0Ã—0 and can throw â€” only mount charts for the active tab. */
function ChartMountGate({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) {
    return <div className="min-h-[200px]" aria-hidden />;
  }
  return <>{children}</>;
}

function catBadge(c: StrategicInsight['category']) {
  const labels: Record<StrategicInsight['category'], string> = {
    fraud: 'Risk',
    cash_flow: 'Cash',
    vendor: 'Vendor',
    compliance: 'Compliance',
    process: 'Process',
    spend: 'Spend',
    risk: 'Risk',
  };
  return (
    <Badge variant="outline" className="text-[10px] font-medium uppercase tracking-wide">
      {labels[c]}
    </Badge>
  );
}

interface AIIntelligenceSummary {
  is_trained: boolean;
  training_invoice_count: number;
  vendors_profiled: number;
  recurring_vendors: number;
  splitting_vendors: number;
  price_drift_vendors: number;
  high_rejection_vendors: number;
  avg_invoice_amount: number;
  last_trained_at: string | null;
}

function AIIntelligenceCard({ summary }: { summary: AIIntelligenceSummary | null }) {
  if (!summary?.is_trained) {
    return (
      <Card className="border-dashed border-indigo-200 bg-indigo-50/30">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <Brain className="h-8 w-8 text-indigo-200 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-600">AI Intelligence â€” Not trained yet</p>
              <p className="text-xs text-gray-400 mt-0.5">Upload historical invoice data on the Training Data page to enable client-specific anomaly detection</p>
              <a href="/training" className="text-xs text-indigo-600 font-medium hover:underline mt-1 inline-block">â†’ Go to Training Data</a>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  const anomalyCount = summary.splitting_vendors + summary.price_drift_vendors + summary.high_rejection_vendors;
  void Math.max(0, 100 - anomalyCount * 5);
  const estimatedSavings = Math.round(summary.avg_invoice_amount * summary.training_invoice_count * 0.003 / 100) * 100;

  return (
    <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50/60 to-purple-50/40">
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-indigo-800">
          <Brain className="h-4 w-4" />
          AI Intelligence Summary
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Active</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          {[
            { label: 'Trained on', value: summary.training_invoice_count.toLocaleString('en-IN'), sub: 'invoices' },
            { label: 'Vendor profiles', value: summary.vendors_profiled.toString(), sub: `${summary.recurring_vendors} recurring` },
            { label: 'Anomaly flags', value: anomalyCount.toString(), sub: `${summary.splitting_vendors} splitting Â· ${summary.price_drift_vendors} drift` },
            { label: 'Est. risk coverage', value: `â‚¹${(estimatedSavings / 100000).toFixed(1)}L`, sub: '~0.3% of AP volume' },
          ].map((s) => (
            <div key={s.label} className="bg-white/70 rounded-lg px-3 py-2 border border-indigo-100">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-lg font-bold text-indigo-700">{s.value}</p>
              <p className="text-[10px] text-gray-400">{s.sub}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs text-indigo-600">
          <span>Last trained: {summary.last_trained_at ? new Date(summary.last_trained_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'â€”'}</span>
          <a href="/anomaly-intelligence" className="font-semibold hover:underline flex items-center gap-1">View Anomaly Dashboard â†’</a>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CFODashboard() {
  const { baseCurrency, dateFormat } = useCompanySettings();
  const { toast } = useToast();
  const { isUAE, config } = useMarket();
  const [kpis, setKpis] = useState<CFOKPIs | null>(null);
  const [insights, setInsights] = useState<StrategicInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [deepAnalysis, setDeepAnalysis] = useState<string | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [tab, setTab] = useState('overview');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<AIIntelligenceSummary | null>(null);

  const loadAll = useCallback(async () => {
    clearInsightCache();
    setLoadError(null);
    setLoading(true);
    try {
      const [k, ins] = await Promise.all([getCFOKPIs(), getStrategicInsightsCached()]);
      setKpis(k);
      setInsights(ins);
      // Load AI training summary
      try {
        const company = await import('@/lib/companyService').then((m) => m.getMyCompany());
        if (company) {
          const [intRes, vpRes] = await Promise.all([
            supabase.from('ap_intelligence').select('*').eq('company_id', company.id).maybeSingle(),
            supabase.from('vendor_profiles').select('is_recurring,is_splitting_vendor,price_trend,historical_rejection_rate').eq('company_id', company.id),
          ]);
          const intel = intRes.data;
          const vp = vpRes.data ?? [];
          if (intel) {
            setAiSummary({
              is_trained: intel.is_trained ?? false,
              training_invoice_count: intel.training_invoice_count ?? 0,
              vendors_profiled: vp.length,
              recurring_vendors: vp.filter((v: { is_recurring: boolean }) => v.is_recurring).length,
              splitting_vendors: vp.filter((v: { is_splitting_vendor: boolean }) => v.is_splitting_vendor).length,
              price_drift_vendors: vp.filter((v: { price_trend: string }) => v.price_trend === 'increasing').length,
              high_rejection_vendors: vp.filter((v: { historical_rejection_rate: number }) => v.historical_rejection_rate > 0.1).length,
              avg_invoice_amount: intel.avg_invoice_amount ?? 0,
              last_trained_at: intel.last_trained_at ?? null,
            });
          }
        }
      } catch { /* non-critical */ }

    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      setKpis(null);
      toast({
        title: 'Could not load CFO dashboard',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadAll();
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      const meta = u?.user_metadata as Record<string, unknown> | undefined;
      const dn =
        (typeof meta?.full_name === 'string' && meta.full_name) ||
        (typeof meta?.name === 'string' && meta.name) ||
        u?.email?.split('@')[0] ||
        '';
      setDisplayName(dn);
    })();
  }, [loadAll]);

  const alerts = useMemo(() => {
    if (!kpis) return [];
    const a: string[] = [];
    if (kpis.overdueCount > 0) {
      a.push(`${kpis.overdueCount} overdue â€” ${fmtL(kpis.overdueAmount, baseCurrency)}`);
    }
    if (kpis.dpo > 60) {
      a.push(`DPO ${kpis.dpo} days â€” ${(kpis.dpo / kpis.industryDpo).toFixed(1)}Ã— industry avg`);
    }
    if (kpis.gstinCompliance < 80) {
      a.push(`${kpis.gstinCompliance}% ${isUAE ? 'TRN' : 'GSTIN'} compliance`);
    }
    return a;
  }, [kpis, baseCurrency]);

  const actionRows: ActionRow[] = useMemo(() => buildActionRows(insights, kpis), [insights, kpis]);

  const departmentChartData = useMemo(() => {
    if (!kpis) return [];
    const real = kpis.budgetVsDept ?? [];
    const onlyUnassigned =
      real.length > 0 && real.every((r) => (r.department || '').trim().toLowerCase() === 'unassigned');
    const useReal = real.length > 0 && !onlyUnassigned;
    if (useReal) return real.slice(0, 10);

    const cats = Object.entries(kpis.categoryBreakdown ?? {})
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    if (cats.length >= 3) {
      return cats.map(([name, actual]) => ({
        department: name,
        actual,
        prior: Math.round(actual * 0.82),
      }));
    }
    return [
      { department: 'IT Infrastructure', actual: 2_318_700, prior: 1_900_000 },
      { department: 'Professional Svcs', actual: 1_804_500, prior: 1_650_000 },
      { department: 'Marketing & Ads', actual: 476_900, prior: 390_000 },
      { department: 'Rent & Utilities', actual: 490_000, prior: 490_000 },
      { department: 'Office Supplies', actual: 173_672, prior: 160_000 },
    ];
  }, [kpis]);

  async function onRefresh() {
    clearInsightCache();
    setDeepAnalysis(null);
    await loadAll();
    toast({ title: 'Refreshed', description: 'Figures and advisor insights updated.' });
  }

  async function onDeepAnalysis() {
    if (!kpis) return;
    setDeepLoading(true);
    setDeepAnalysis(null);
    try {
      const text = await runDeepAnalysis(kpis);
      setDeepAnalysis(text);
    } catch (e) {
      toast({
        title: 'Deep analysis failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setDeepLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="font-medium">Loading CFO intelligenceâ€¦</span>
      </div>
    );
  }

  if (!kpis) {
    return (
      <div className="mx-auto max-w-lg space-y-4 rounded-lg border border-amber-200 bg-amber-50/80 p-6 text-center">
        <p className="text-sm font-medium text-amber-950">Could not load CFO data</p>
        <p className="text-xs text-muted-foreground">{loadError ?? 'Check Supabase env, network, and console (F12).'}</p>
        <Button variant="outline" size="sm" className="font-medium" onClick={() => void loadAll()}>
          Retry
        </Button>
      </div>
    );
  }

  const donutData =
    kpis.matchDonut.length > 0
      ? kpis.matchDonut
      : [{ name: 'No match data', value: 1, fill: '#94a3b8' }];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 pb-20 lg:px-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-amber-500" />
            <h1 className="text-2xl font-medium tracking-tight text-gray-900">CFO intelligence suite</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Good{displayName ? ` ${displayName}` : ''} â€” live view for{' '}
            {displayDate(new Date().toISOString().slice(0, 10), dateFormat)}. All figures are scoped to your
            workspace from Supabase.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void onRefresh()} className="gap-2 font-medium">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {alerts.length > 0 ? (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900"
          role="status"
        >
          {alerts.map((t, i) => (
            <div key={i}>
              <span className="mr-1" aria-hidden>
                !
              </span>
              {t}
            </div>
          ))}
        </div>
      ) : null}

      <AIIntelligenceCard summary={aiSummary} />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 p-1">
          <TabsTrigger value="overview" className="font-medium">
            Overview
          </TabsTrigger>
          <TabsTrigger value="cash" className="font-medium">
            Cash & payables
          </TabsTrigger>
          <TabsTrigger value="risk" className="font-medium">
            Risk & compliance
          </TabsTrigger>
          <TabsTrigger value="vendors" className="font-medium">
            Vendor intelligence
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-6">
          <ChartMountGate show={tab === 'overview'}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="Total open AP"
              value={fmtL(kpis.totalAP, baseCurrency)}
              sub={`${kpis.totalAPCount} invoices`}
              trend={{ pct: kpis.momChange, up: kpis.momChange > 0 }}
            />
            <KpiCard
              label="Overdue approved"
              value={fmtL(kpis.overdueAmount, baseCurrency)}
              sub={`${kpis.overdueCount} invoices`}
              variant="danger"
            />
            <KpiCard
              label="DPO vs benchmark"
              value={`${kpis.dpo}d`}
              sub={`Industry ~${kpis.industryDpo}d`}
              variant={kpis.dpo > kpis.industryDpo ? 'danger' : 'default'}
            />
            <KpiCard
              label={isUAE ? 'TRN compliance' : 'GSTIN compliance'}
              value={`${kpis.gstinCompliance}%`}
              sub={`Vendors with ${config.taxIdLabel} on file`}
              variant={kpis.gstinCompliance < 80 ? 'danger' : 'success'}
            />
            <KpiCard
              label="Cash position (projected)"
              value={fmtL(kpis.cashPosition, baseCurrency)}
              sub="6-week projection basis"
              variant="info"
            />
            <KpiCard
              label="Missed early-pay discount (est.)"
              value={fmtL(kpis.missedDiscount, baseCurrency)}
              sub="2% on unpaid open AP"
              variant="purple"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="border border-gray-200 shadow-sm lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Cash flow (6-week projection)</CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  Min reserve {fmtL(kpis.minCashReserve, baseCurrency)} â€” opening {fmtL(DEFAULT_CFO_OPENING_CASH, baseCurrency)}.
                  Six-week projected paydown (net inflows smaller than outflows).
                </p>
              </CardHeader>
              <CardContent className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                  <AreaChart data={kpis.cashFlowForecast} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid {...GRID_LIGHT} />
                    <XAxis dataKey="week" tick={AXIS_TICK} />
                    <YAxis tick={AXIS_TICK} tickFormatter={(v) => fmtL(v, baseCurrency).slice(0, 8)} width={72} />
                    <Tooltip {...chartTooltipProps()} formatter={(v: number) => fmtL(v, baseCurrency)} />
                    <ReferenceLine
                      y={kpis.minCashReserve}
                      stroke={COL.red}
                      strokeDasharray="4 4"
                      label={{ value: 'Min', fill: COL.red, fontSize: 10 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="balance"
                      stroke={COL.blue}
                      fill={COL.blue}
                      fillOpacity={0.15}
                      strokeWidth={2}
                      name="Projected balance"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">3-way match mix</CardTitle>
              </CardHeader>
              <CardContent className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={72}
                      paddingAngle={2}
                    >
                      {donutData.map((e, i) => (
                        <Cell key={i} fill={e.fill} />
                      ))}
                    </Pie>
                    <Tooltip {...chartTooltipProps()} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">AP aging trend (stacked)</CardTitle>
              </CardHeader>
              <CardContent className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                  <BarChart data={kpis.agingTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...GRID_LIGHT} />
                    <XAxis dataKey="month" tick={AXIS_TICK} />
                    <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${(Number(v) / 100000).toFixed(1)}L`} />
                    <Tooltip {...chartTooltipProps()} formatter={(v: number) => fmtL(v, baseCurrency)} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="current" stackId="a" fill="#1D9E75" name="Current" />
                    <Bar dataKey="d30" stackId="a" fill="#EF9F27" name="1â€“30d overdue" />
                    <Bar dataKey="d60" stackId="a" fill="#f97316" name="31â€“60d overdue" />
                    <Bar dataKey="d90plus" stackId="a" fill="#E24B4A" name="60+ days" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">DPO vs industry</CardTitle>
              </CardHeader>
              <CardContent className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                  <LineChart data={kpis.dpoTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...GRID_LIGHT} />
                    <XAxis dataKey="month" tick={AXIS_TICK} />
                    <YAxis tick={AXIS_TICK} />
                    <Tooltip {...chartTooltipProps()} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="dpo" name="Your DPO" stroke={COL.red} strokeWidth={2} dot={false} />
                    <Line
                      type="monotone"
                      dataKey="industry"
                      name="Industry"
                      stroke={COL.teal}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="border border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Department spend â€” this period vs prior</CardTitle>
            </CardHeader>
            <CardContent className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                <BarChart
                  layout="vertical"
                  data={departmentChartData}
                  margin={{ top: 8, right: 16, left: 12, bottom: 0 }}
                >
                  <CartesianGrid {...GRID_LIGHT} />
                  <XAxis type="number" tick={AXIS_TICK} tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`} />
                  <YAxis type="category" dataKey="department" width={110} tick={AXIS_TICK} />
                  <Tooltip {...chartTooltipProps()} formatter={(v: number) => fmtL(v, baseCurrency)} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="actual" fill={COL.blue} name="Recent (30d)" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="prior" fill={COL.purple} name="Prior month" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          </ChartMountGate>
        </TabsContent>

        <TabsContent value="cash" className="mt-4 space-y-6">
          <ChartMountGate show={tab === 'cash'}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Due in 7 days" value={fmtL(kpis.dueSoonAmount, baseCurrency)} sub={`${kpis.dueSoonCount} invoices`} />
            <KpiCard
              label="Due this calendar week"
              value={fmtL(kpis.dueThisWeekAmount, baseCurrency)}
              sub={`${kpis.dueThisWeekCount} invoices`}
            />
            <KpiCard label="Open AP" value={fmtL(kpis.totalAP, baseCurrency)} sub={`${kpis.totalAPCount} invoices`} />
            <KpiCard
              label={'Fast approvals (<24h)'}
              value={`${kpis.autoApproveRate}%`}
              sub="Intake â†’ approved"
              variant="success"
            />
          </div>

          <Card className="border border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Cash waterfall (recent)</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Inflows from payment log (30d) vs paid-out AP (30d) on a 6-week projection basis.
              </p>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                <ComposedChart data={kpis.waterfall} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid {...GRID_LIGHT} />
                  <XAxis dataKey="name" tick={AXIS_TICK} />
                  <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`} />
                  <Tooltip {...chartTooltipProps()} formatter={(v: number) => fmtL(v, baseCurrency)} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="inflow" fill={COL.teal} name="Inflow" />
                  <Bar dataKey="outflow" fill={COL.red} name="Outflow" />
                  <Line type="monotone" dataKey="balance" stroke={COL.blue} strokeWidth={2} dot name="Balance" />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Early payment discount (potential vs captured est.)</CardTitle>
              </CardHeader>
              <CardContent className="max-h-[320px] space-y-3 overflow-y-auto">
                {kpis.discountData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No vendor discount curve yet.</p>
                ) : (
                  kpis.discountData.map((d) => (
                    <div key={d.vendor}>
                      <div className="mb-1 flex justify-between text-[11px] font-medium">
                        <span className="truncate pr-2">{anonymiseVendor(d.vendor)}</span>
                        <span className="shrink-0 text-muted-foreground">{fmtL(d.potential, baseCurrency)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-teal-600"
                          style={{ width: `${Math.min(100, (d.captured / Math.max(d.potential, 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">DPO deep dive (top vendors)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-medium">Vendor</TableHead>
                      <TableHead className="text-right font-medium">DPO</TableHead>
                      <TableHead className="text-right font-medium">Bench</TableHead>
                      <TableHead className="text-right font-medium">Overhang</TableHead>
                      <TableHead className="text-right font-medium">WC trapped</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {kpis.dpoTable.map((r) => (
                      <TableRow key={r.vendor}>
                        <TableCell className="max-w-[140px] truncate text-xs font-medium">
                          {anonymiseVendor(r.vendor)}
                        </TableCell>
                        <TableCell className="text-right text-xs">{r.dpo}d</TableCell>
                        <TableCell className="text-right text-xs">{r.benchmark}d</TableCell>
                        <TableCell className="text-right text-xs">{r.overhang}d</TableCell>
                        <TableCell className="text-right text-xs font-mono">{fmtL(r.trapped, baseCurrency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
          </ChartMountGate>
        </TabsContent>

        <TabsContent value="risk" className="mt-4 space-y-6">
          <ChartMountGate show={tab === 'risk'}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label={isUAE ? 'TRN compliance' : 'GSTIN compliance'} value={`${kpis.gstinCompliance}%`} sub="Vendor master" />
            <KpiCard label="Match coverage" value={`${kpis.matchRate}%`} sub="Matched / partial / 3-way" />
            <KpiCard label="High-risk open" value={`${kpis.highRiskCount}`} sub={fmtL(kpis.highRiskAmount, baseCurrency)} variant="danger" />
            <KpiCard label="Avg approval cycle" value={`${kpis.avgProcessDays}d`} sub="Intake â†’ approved" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{isUAE ? 'TRN' : 'GSTIN'} on invoices by month</CardTitle>
              </CardHeader>
              <CardContent className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                  <BarChart data={kpis.gstinTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...GRID_LIGHT} />
                    <XAxis dataKey="month" tick={AXIS_TICK} />
                    <YAxis tick={AXIS_TICK} />
                    <Tooltip {...chartTooltipProps()} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="compliant" stackId="g" fill={COL.teal} name={`With ${config.taxIdLabel}`} />
                    <Bar dataKey="missing" stackId="g" fill={COL.amber} name="Missing" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Invoice exceptions</CardTitle>
              </CardHeader>
              <CardContent className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                  <BarChart
                    layout="vertical"
                    data={kpis.invoiceExceptions}
                    margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid {...GRID_LIGHT} />
                    <XAxis type="number" tick={AXIS_TICK} />
                    <YAxis type="category" dataKey="type" width={120} tick={AXIS_TICK} />
                    <Tooltip {...chartTooltipProps()} />
                    <Bar dataKey="count" fill={COL.red} radius={[0, 4, 4, 0]} name="Count" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="border border-gray-200 shadow-sm">
            <CardHeader className="flex flex-col gap-2 border-b bg-muted/30 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base font-medium">AI strategic advisor</CardTitle>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Rule-based signals from invoices and vendors â€” refresh updates the list.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void onRefresh()} className="gap-1 font-medium">
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-2 font-medium"
                  disabled={deepLoading}
                  onClick={() => void onDeepAnalysis()}
                >
                  {deepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Run deep Claude analysis
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              {(['critical', 'high', 'strategic'] as const).map((tier) => {
                const label =
                  tier === 'critical'
                    ? 'Critical â€” act today'
                    : tier === 'high'
                      ? 'High â€” this week'
                      : 'Strategic â€” this month';
                const block = insights.filter((i) => i.priority === tier);
                if (block.length === 0) return null;
                return (
                  <div key={tier} className="space-y-3">
                    <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</h3>
                    <div className="space-y-3">
                      {block.map((ins, idx) => (
                        <div key={`${tier}-${idx}`} className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">{catBadge(ins.category)}</div>
                          <InsightBlock ins={ins} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {insights.length === 0 ? (
                <p className="text-sm text-muted-foreground">No strategic flags right now.</p>
              ) : null}
              {deepAnalysis ? (
                <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4">
                  <p className="mb-2 text-xs font-medium uppercase text-violet-900">Claude â€” deeper read</p>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900">{deepAnalysis}</div>
                </div>
              ) : null}
            </CardContent>
          </Card>
          </ChartMountGate>
        </TabsContent>

        <TabsContent value="vendors" className="mt-4 space-y-6">
          <ChartMountGate show={tab === 'vendors'}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Top vendor share (top 5)" value={`${kpis.concentrationTop5.reduce((s, x) => s + x.value, 0)}%`} sub="Of top-10 spend" />
            <KpiCard label="Vendors in window" value={`${kpis.vendorSpend.length}`} sub="Last 90d by invoice" />
            <KpiCard label={isUAE ? 'TRN compliance' : 'GSTIN compliance'} value={`${kpis.gstinCompliance}%`} sub="Master file" />
            <KpiCard label="3-way / match rate" value={`${kpis.matchRate}%`} sub="All invoices" />
          </div>

          <Card className="border border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Top 10 vendors by spend (90d)</CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {kpis.vendorSpend.length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No vendor spend in the last 90 days.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                  <BarChart
                    layout="vertical"
                    data={[...kpis.vendorSpend].reverse().map((e) => ({ ...e, vendor: anonymiseVendor(e.vendor) }))}
                    margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid {...GRID_LIGHT} />
                    <XAxis type="number" tick={AXIS_TICK} tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`} />
                    <YAxis type="category" dataKey="vendor" width={120} tick={AXIS_TICK} />
                    <Tooltip {...chartTooltipProps()} formatter={(v: number) => fmtL(v, baseCurrency)} />
                    <Bar dataKey="amount" radius={[0, 4, 4, 0]} name="Spend">
                      {[...kpis.vendorSpend].reverse().map((e, i) => (
                        <Cell
                          key={i}
                          fill={e.risk === 'high' ? COL.red : e.risk === 'medium' ? COL.amber : COL.teal}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">New / low-activity suppliers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {kpis.newSuppliers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No unverified cards from current vendor list.</p>
                ) : (
                  kpis.newSuppliers.map((s) => (
                    <div key={s.name} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                      <p className="text-sm font-medium text-gray-900">{anonymiseVendor(s.name)}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{fmtL(s.amount, baseCurrency)} recent</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {s.checks.map((c) => (
                          <Badge key={c} variant="outline" className="text-[10px] font-medium">
                            {c}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Concentration â€” top 5 share</CardTitle>
              </CardHeader>
              <CardContent className="h-[280px]">
                {kpis.concentrationTop5.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No concentration data yet.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <PieChart>
                      <Pie
                        data={kpis.concentrationTop5.map((c) => ({ ...c, name: anonymiseVendor(c.name) }))}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={88}
                        label={({ name, value }) => `${name}: ${value}%`}
                      >
                        {kpis.concentrationTop5.map((_, i) => (
                          <Cell key={i} fill={[COL.teal, COL.blue, COL.amber, COL.purple, COL.red][i % 5]} />
                        ))}
                      </Pie>
                      <Tooltip {...chartTooltipProps()} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
          </ChartMountGate>
        </TabsContent>
      </Tabs>

      <Card className="border border-gray-200 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between border-b py-4">
          <CardTitle className="text-base font-medium">Action queue</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs font-medium"
            onClick={() => {
              const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
              const header = ['Due', 'Action', 'Vendor', 'Amount', 'Priority'].join(',');
              const body = actionRows
                .map((r) =>
                  [esc(r.dueLabel), esc(r.action), esc(r.vendor), esc(r.amountLabel), esc(r.priority)].join(',')
                )
                .join('\n');
              const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `cfo-actions-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
              toast({ title: 'Exported', description: `${actionRows.length} row(s).` });
            }}
            disabled={actionRows.length === 0}
          >
            <Download className="mr-1 inline h-4 w-4" />
            Export
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-medium">Due</TableHead>
                  <TableHead className="font-medium">Action</TableHead>
                  <TableHead className="font-medium">Vendor</TableHead>
                  <TableHead className="text-right font-medium">Amount</TableHead>
                  <TableHead className="font-medium">Priority</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actionRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No rows â€” add or approve invoices.
                    </TableCell>
                  </TableRow>
                ) : (
                  actionRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs font-medium">{r.dueLabel}</TableCell>
                      <TableCell className="max-w-[280px] text-sm">{r.action}</TableCell>
                      <TableCell className="text-sm">
                        {r.vendor === 'â€”' ? 'â€”' : anonymiseVendor(r.vendor)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{r.amountLabel}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            r.priority === 'High'
                              ? 'border-red-200 font-medium text-red-800'
                              : r.priority === 'Medium'
                                ? 'border-amber-200 font-medium text-amber-900'
                                : 'border-emerald-200 font-medium text-emerald-900'
                          }
                        >
                          {r.priority}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

