import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Invoice } from '@/lib/ap-invoice/supabase';
import { buildCashFlowWeeks } from '@/lib/ap-invoice/paymentStatus';
import {
  AGING_BUCKETS,
  computeAging,
  costCenterOf,
  currencyMix,
  glCodeOf,
  glNameOf,
  groupSpend,
  groupTrend,
  ifrsSummary,
  matchSummary,
  monthlySeries,
  riskSummary,
  statusDistribution,
  vendorBreakdown,
  vendorKey,
  type Severity,
} from './metrics';
import type { DashboardCtx } from './types';
import {
  BarRow,
  COLORS,
  EmptyState,
  Note,
  Panel,
  PanelLink,
  Pill,
  SERIES,
  STATUS_COLOR,
  STATUS_LABEL,
  Stat,
  chartAxis,
  chartTooltipStyle,
  axisNumber,
  pct,
  type Scope,
} from './ui';

const AGING_COLOR: Record<string, string> = {
  current: COLORS.teal,
  '1_30': COLORS.gold,
  '31_60': COLORS.amber,
  '61_90': '#EA580C',
  '90_plus': COLORS.red,
};

export const SEVERITY_TONE: Record<Severity, 'red' | 'amber' | 'gold' | 'slate'> = {
  critical: 'red',
  high: 'amber',
  medium: 'gold',
  low: 'slate',
};

export function listLink(params: Record<string, string>) {
  return `/ap-invoices/list?${new URLSearchParams(params).toString()}`;
}

export function CurrencyNote({ ctx, invoices }: { ctx: DashboardCtx; invoices: Invoice[] }) {
  const mix = useMemo(() => currencyMix(invoices, ctx.baseCurrency), [invoices, ctx.baseCurrency]);
  if (!mix.mixed) return null;
  return (
    <Note tone="amber">
      Amounts include {mix.foreignCount} invoice{mix.foreignCount === 1 ? '' : 's'} in{' '}
      {mix.foreign.map((f) => f.currency).join(', ')} shown at face value (not converted to {ctx.baseCurrency}).
    </Note>
  );
}

export function MonthlyAmountsPanel({ ctx, title = 'Monthly Invoice Amounts', className = '' }: { ctx: DashboardCtx; title?: string; className?: string }) {
  const data = useMemo(() => monthlySeries(ctx.period, ctx.monthKeys.keys), [ctx.period, ctx.monthKeys.keys]);
  return (
    <Panel
      title={title}
      subtitle={`By invoice date · ${ctx.baseCurrency}`}
      scope="period"
      className={className}
    >
      {data.length === 0 ? (
        <EmptyState>No invoices in the selected period.</EmptyState>
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="label" tick={chartAxis} tickLine={false} axisLine={false} />
                <YAxis tick={chartAxis} tickLine={false} axisLine={false} width={44} tickFormatter={axisNumber} />
                <Tooltip
                  {...chartTooltipStyle}
                  formatter={(v: number, name: string) => [name === 'amount' ? ctx.fmt(v) : v, name === 'amount' ? 'Amount' : 'Invoices']}
                />
                <Bar dataKey="amount" fill={COLORS.primary} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {ctx.monthKeys.truncated && (
            <p className="mt-2 text-[11px] text-slate-500">Showing the latest {ctx.monthKeys.keys.length} months of the period.</p>
          )}
          <div className="mt-2">
            <CurrencyNote ctx={ctx} invoices={ctx.period} />
          </div>
        </>
      )}
    </Panel>
  );
}

export function StatusDistributionPanel({
  ctx,
  invoices,
  scope = 'period',
  className = '',
}: {
  ctx: DashboardCtx;
  invoices: Invoice[];
  scope?: Scope;
  className?: string;
}) {
  const rows = useMemo(() => statusDistribution(invoices), [invoices]);
  const total = invoices.length;
  return (
    <Panel title="Invoice Status Distribution" subtitle={`${total} invoices`} scope={scope} className={className}>
      {total === 0 ? (
        <EmptyState>No invoices to show.</EmptyState>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="h-40 w-full sm:w-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rows} dataKey="count" nameKey="status" innerRadius="58%" outerRadius="92%" paddingAngle={1} stroke="none">
                  {rows.map((r) => (
                    <Cell key={r.status} fill={STATUS_COLOR[r.status] ?? COLORS.slate} />
                  ))}
                </Pie>
                <Tooltip {...chartTooltipStyle} formatter={(v: number, n: string) => [`${v} invoices`, STATUS_LABEL[n] ?? n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {rows.map((r) => (
              <li key={r.status}>
                <Link
                  to={listLink({ status: r.status })}
                  className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40"
                >
                  <span className="flex items-center gap-2 text-slate-700">
                    <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[r.status] ?? COLORS.slate }} aria-hidden />
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  <span className="tabular-nums text-slate-900">
                    {r.count} <span className="text-slate-400">· {pct(r.count / total)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export function CashFlowPanel({ ctx, className = '' }: { ctx: DashboardCtx; className?: string }) {
  const weeks = useMemo(() => buildCashFlowWeeks(ctx.all), [ctx.all]);
  const total = weeks.reduce((s, w) => s + w.unpaid + w.scheduled, 0);
  return (
    <Panel
      title="Cash Flow — Next 30 Days"
      subtitle={`Open invoices by pay date · ${ctx.fmt(total)} due`}
      scope="current"
      className={className}
      action={<PanelLink to="/ap-invoices/calendar">Calendar</PanelLink>}
    >
      {total === 0 ? (
        <EmptyState>No payments due in the next 30 days.</EmptyState>
      ) : (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeks} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="label" tick={chartAxis} tickLine={false} axisLine={false} />
              <YAxis tick={chartAxis} tickLine={false} axisLine={false} width={44} tickFormatter={axisNumber} />
              <Tooltip {...chartTooltipStyle} formatter={(v: number) => ctx.fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
              <Bar dataKey="unpaid" stackId="pay" fill={COLORS.amber} name="Unpaid / overdue" maxBarSize={40} />
              <Bar dataKey="scheduled" stackId="pay" fill={COLORS.primary} name="Scheduled" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

export function AgingPanel({ ctx, className = '' }: { ctx: DashboardCtx; className?: string }) {
  const aging = useMemo(() => computeAging(ctx.all, ctx.today), [ctx.all, ctx.today]);
  return (
    <Panel
      title="AP Aging"
      subtitle={`Open balances by days past due · ${aging.openCount} invoices`}
      scope="current"
      className={className}
      action={<PanelLink to="/ap-invoices/aging">Full report</PanelLink>}
    >
      {aging.openCount === 0 ? (
        <EmptyState>No open invoices with a due date.</EmptyState>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-5 gap-1.5" role="list" aria-label="Aging buckets">
            {aging.buckets.map((b) => (
              <div key={b.key} role="listitem" className="flex flex-col items-center gap-1 text-center">
                <div className="flex h-16 w-full items-end overflow-hidden rounded bg-slate-100">
                  <div
                    className="w-full rounded-t"
                    style={{ height: `${b.amount > 0 ? Math.max(8, (b.amount / aging.maxAmount) * 100) : 0}%`, background: AGING_COLOR[b.key] }}
                  />
                </div>
                <p className="text-[11px] font-semibold tabular-nums text-slate-900">{ctx.fmtCompact(b.amount)}</p>
                <p className="text-[10px] leading-tight text-slate-500">
                  {b.label}
                  <br />
                  {b.count} inv
                </p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Total outstanding" value={ctx.fmt(aging.totalOutstanding)} />
            <Stat
              label="Overdue"
              value={ctx.fmt(aging.totalOverdue)}
              sub={`${aging.overdueCount} invoices`}
              tone={aging.totalOverdue > 0 ? 'amber' : 'teal'}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}

export function IfrsPanel({ ctx, className = '', limit = 6 }: { ctx: DashboardCtx; className?: string; limit?: number }) {
  const s = useMemo(() => ifrsSummary(ctx.period), [ctx.period]);
  const top = s.categories.slice(0, limit);
  return (
    <Panel
      title="IFRS Classification"
      scope="period"
      className={className}
      action={<PanelLink to="/ap-invoices/list?filter=unclassified">Review</PanelLink>}
    >
      {s.total === 0 ? (
        <EmptyState>No invoices in the selected period.</EmptyState>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Classified" value={s.classified} tone="teal" />
            <Stat label="Needs review" value={s.needsReview} tone={s.needsReview ? 'amber' : 'slate'} />
            <Stat label="Rate" value={pct(s.rate)} tone="purple" />
          </div>
          {top.length ? (
            <div className="space-y-2">
              {top.map((c) => (
                <BarRow
                  key={c.key}
                  label={c.name}
                  value={c.count}
                  max={top[0].count}
                  color={COLORS.purple}
                  right={
                    <>
                      {c.count} <span className="text-slate-400">· {pct(c.share)}</span>
                    </>
                  }
                />
              ))}
              {s.categories.length > limit && (
                <p className="text-[11px] text-slate-500">+{s.categories.length - limit} more categories</p>
              )}
            </div>
          ) : (
            <EmptyState>No invoices classified yet.</EmptyState>
          )}
        </div>
      )}
    </Panel>
  );
}

export function TopVendorsPanel({
  ctx,
  limit = 5,
  className = '',
  onSelect,
}: {
  ctx: DashboardCtx;
  limit?: number;
  className?: string;
  onSelect?: (vendor: string) => void;
}) {
  const vendors = useMemo(() => vendorBreakdown(ctx.period), [ctx.period]);
  const top = vendors.slice(0, limit);
  const total = vendors.reduce((s, v) => s + v.amount, 0);
  return (
    <Panel
      title="Top Vendors by Spend"
      subtitle={`${vendors.length} vendors · ${ctx.fmt(total)}`}
      scope="period"
      className={className}
      action={<PanelLink to="/ap-invoices/vendors">Vendors</PanelLink>}
    >
      {top.length === 0 ? (
        <EmptyState>No vendor spend in the selected period.</EmptyState>
      ) : (
        <ol className="space-y-2.5">
          {top.map((v, i) => (
            <li key={v.key}>
              <button
                type="button"
                className="w-full rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40"
                onClick={() => onSelect?.(v.name)}
                disabled={!onSelect}
              >
                <BarRow
                  label={
                    <>
                      <span className="mr-1.5 text-slate-400">{i + 1}.</span>
                      {v.name}
                    </>
                  }
                  value={v.amount}
                  max={top[0].amount}
                  color={i === 0 ? COLORS.gold : COLORS.primary}
                  right={
                    <>
                      {ctx.fmt(v.amount)} <span className="text-slate-400">· {v.count} inv</span>
                    </>
                  }
                />
              </button>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function VendorTrendPanel({ ctx, top = 3, className = '' }: { ctx: DashboardCtx; top?: number; className?: string }) {
  const { names, data } = useMemo(() => {
    const names = vendorBreakdown(ctx.period).slice(0, top).map((v) => v.key);
    return { names, data: groupTrend(ctx.period, ctx.monthKeys.keys, names, vendorKey) };
  }, [ctx.period, ctx.monthKeys.keys, top]);
  return (
    <Panel title="Vendor Spend Trend" subtitle={`Top ${names.length} vendors by month`} scope="period" className={className}>
      {names.length === 0 || data.length === 0 ? (
        <EmptyState>No vendor trend for the selected period.</EmptyState>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="label" tick={chartAxis} tickLine={false} axisLine={false} />
              <YAxis tick={chartAxis} tickLine={false} axisLine={false} width={44} tickFormatter={axisNumber} />
              <Tooltip {...chartTooltipStyle} formatter={(v: number) => ctx.fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
              {names.map((n, i) => (
                <Line key={n} type="monotone" dataKey={n} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={{ r: 2 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

export function GlSpendPanel({ ctx, limit = 5, className = '' }: { ctx: DashboardCtx; limit?: number; className?: string }) {
  const gl = useMemo(() => groupSpend(ctx.period, glCodeOf, glNameOf), [ctx.period]);
  const top = gl.rows.slice(0, limit);
  return (
    <Panel
      title="Spend by GL Account"
      subtitle={`${gl.rows.length} accounts`}
      scope="period"
      className={className}
      action={<PanelLink to="/ap-invoices/gl-accounts">GL Accounts</PanelLink>}
    >
      {top.length === 0 ? (
        <EmptyState>No GL-coded invoices in the selected period.</EmptyState>
      ) : (
        <div className="space-y-2.5">
          {top.map((r) => (
            <BarRow
              key={r.key}
              label={
                <>
                  <span className="font-mono text-[11px] text-slate-500">{r.key}</span> {r.name !== r.key ? r.name : ''}
                </>
              }
              value={r.amount}
              max={top[0].amount}
              color={COLORS.primary}
              right={
                <>
                  {ctx.fmt(r.amount)} <span className="text-slate-400">· {r.count} inv</span>
                </>
              }
            />
          ))}
          {gl.unassigned.count > 0 && (
            <p className="text-[11px] text-[#B45309]">
              {gl.unassigned.count} invoice{gl.unassigned.count === 1 ? '' : 's'} without a GL code ({ctx.fmt(gl.unassigned.amount)})
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

export function CostCenterPanel({ ctx, limit = 5, className = '' }: { ctx: DashboardCtx; limit?: number; className?: string }) {
  const cc = useMemo(() => groupSpend(ctx.period, costCenterOf), [ctx.period]);
  const top = cc.rows.slice(0, limit);
  return (
    <Panel
      title={`Spend by ${ctx.costCenterLabel}`}
      subtitle={`${cc.rows.length} ${ctx.costCenterLabel.toLowerCase()}${cc.rows.length === 1 ? '' : 's'}`}
      scope="period"
      className={className}
      action={<PanelLink to="/ap-invoices/settings/cost-centers">Manage</PanelLink>}
    >
      {top.length === 0 ? (
        <EmptyState>No {ctx.costCenterLabel.toLowerCase()}-tagged invoices in the selected period.</EmptyState>
      ) : (
        <div className="space-y-2.5">
          {top.map((r) => (
            <BarRow
              key={r.key}
              label={r.name}
              value={r.amount}
              max={top[0].amount}
              color={COLORS.teal}
              right={
                <>
                  {ctx.fmt(r.amount)} <span className="text-slate-400">· {r.count} inv</span>
                </>
              }
            />
          ))}
          {cc.unassigned.count > 0 && (
            <p className="text-[11px] text-[#B45309]">
              {cc.unassigned.count} unassigned ({ctx.fmt(cc.unassigned.amount)})
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

export function RiskFlagsPanel({ invoices, className = '', limit = 5, scope = 'period' }: { invoices: Invoice[]; className?: string; limit?: number; scope?: Scope }) {
  const r = useMemo(() => riskSummary(invoices), [invoices]);
  return (
    <Panel
      title="Top Risk Flags"
      subtitle={`${r.totalFlagged} of ${invoices.length} invoices carry a risk rating`}
      scope={scope}
      className={className}
      action={<PanelLink to="/ap-invoices/list?tab=anomalies">Investigate</PanelLink>}
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
          <Pill key={sev} tone={SEVERITY_TONE[sev]}>
            <span className="capitalize">{sev}</span> {r.severityCounts[sev]}
          </Pill>
        ))}
      </div>
      {r.topFlags.length === 0 ? (
        <EmptyState>No itemised risk flags.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {r.topFlags.slice(0, limit).map((f) => (
            <li key={f.message} className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
              <span className="min-w-0 truncate text-slate-700" title={f.message}>
                {f.message}
              </span>
              <Pill tone={SEVERITY_TONE[f.severity]}>{f.count}</Pill>
            </li>
          ))}
        </ul>
      )}
      {r.severityCounts.critical > 0 && (
        <p className="mt-2 text-[11px] font-medium text-[#B91C1C]">{r.severityCounts.critical} critical — review immediately</p>
      )}
    </Panel>
  );
}

export function MatchPanel({ invoices, className = '', scope = 'period' }: { invoices: Invoice[]; className?: string; scope?: Scope }) {
  const m = useMemo(() => matchSummary(invoices), [invoices]);
  const rows = [
    { label: 'Fully matched', value: m.full, color: COLORS.teal },
    { label: 'Partial match', value: m.partial, color: COLORS.gold },
    { label: 'Variance', value: m.variance, color: COLORS.red },
    { label: 'No PO', value: m.noPo, color: COLORS.amber },
  ];
  return (
    <Panel
      title="3-Way Match Performance"
      subtitle={`${m.total} matched attempts · ${m.notRun} not run`}
      scope={scope}
      className={className}
      action={<PanelLink to="/ap-invoices/list?filter=match_issues">Exceptions</PanelLink>}
    >
      {m.total === 0 ? (
        <EmptyState>No 3-way match results for invoices in this period.</EmptyState>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <BarRow
              key={r.label}
              label={r.label}
              value={r.value}
              max={m.total}
              color={r.color}
              right={
                <>
                  {r.value} <span className="text-slate-400">· {pct(r.value / m.total)}</span>
                </>
              }
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

export function AgingLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
      {AGING_BUCKETS.map((b) => (
        <span key={b.key} className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: AGING_COLOR[b.key] }} aria-hidden />
          {b.label}
        </span>
      ))}
    </div>
  );
}
