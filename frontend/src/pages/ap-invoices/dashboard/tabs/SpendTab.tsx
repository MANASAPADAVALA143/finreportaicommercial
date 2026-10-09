import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { isInvoiceOpenForPayment } from '@/lib/ap-invoice/paymentStatus';
import type { DashboardCtx } from '../types';
import {
  avgProcessingSeconds,
  categoryOf,
  computeAging,
  daysBetween,
  groupSpend,
  monthKeyOf,
  monthLabel,
  monthlySeries,
  sumAmount,
  sumTax,
} from '../metrics';
import { AgingPanel, CurrencyNote, MonthlyAmountsPanel } from '../widgets';
import { BarRow, COLORS, EmptyState, Panel, SERIES, STATUS_COLOR, STATUS_LABEL, Stat, axisNumber, chartAxis, chartTooltipStyle } from '../ui';

export function SpendTab({ ctx }: { ctx: DashboardCtx }) {
  const total = useMemo(() => sumAmount(ctx.period), [ctx.period]);
  const tax = useMemo(() => sumTax(ctx.period), [ctx.period]);
  const aging = useMemo(() => computeAging(ctx.all, ctx.today), [ctx.all, ctx.today]);
  const categories = useMemo(() => groupSpend(ctx.period, categoryOf), [ctx.period]);
  const series = useMemo(() => monthlySeries(ctx.period, ctx.monthKeys.keys), [ctx.period, ctx.monthKeys.keys]);

  const performance = useMemo(() => {
    const timing = avgProcessingSeconds(ctx.period);
    const cycles = ctx.period
      .filter((i) => i.approved_at && (i.submitted_for_approval_at || i.created_at))
      .map((i) =>
        daysBetween(String(i.submitted_for_approval_at || i.created_at).slice(0, 10), String(i.approved_at).slice(0, 10)),
      )
      .filter((d) => d >= 0);
    const byMonth = ctx.monthKeys.keys.map((k) => {
      const inMonth = ctx.period.filter((i) => monthKeyOf(i) === k);
      const t = avgProcessingSeconds(inMonth);
      return { key: k, seconds: t.samples ? t.avg : null };
    });
    return {
      timing,
      approvalCycle: cycles.length ? cycles.reduce((s, d) => s + d, 0) / cycles.length : null,
      approvalSamples: cycles.length,
      byMonth,
    };
  }, [ctx.period, ctx.monthKeys.keys]);

  const outstandingByStatus = useMemo(() => {
    const open = ctx.all.filter(isInvoiceOpenForPayment);
    const map: Record<string, { amount: number; count: number }> = {};
    for (const inv of open) {
      const s = inv.status || 'Unknown';
      map[s] ??= { amount: 0, count: 0 };
      map[s].amount += Number(inv.total_amount) || 0;
      map[s].count += 1;
    }
    const rows = Object.entries(map)
      .map(([status, v]) => ({ status, ...v }))
      .sort((a, b) => b.amount - a.amount);
    return { rows, total: rows.reduce((s, r) => s + r.amount, 0), count: open.length };
  }, [ctx.all]);

  const topCats = categories.rows.slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Spend in period" value={ctx.fmt(total)} sub={ctx.range.label} tone="primary" />
        <Stat label="Tax in period" value={ctx.fmt(tax)} />
        <Stat label="Invoices" value={ctx.period.length} />
        <Stat label="Average invoice" value={ctx.period.length ? ctx.fmt(total / ctx.period.length) : '—'} />
        <Stat label="Outstanding now" value={ctx.fmt(outstandingByStatus.total)} sub={`${outstandingByStatus.count} open invoices`} tone="amber" />
      </div>
      <CurrencyNote ctx={ctx} invoices={ctx.period} />

      <div className="grid gap-4 xl:grid-cols-3">
        <MonthlyAmountsPanel ctx={ctx} className="xl:col-span-2" />
        <Panel title="Spend by Category" subtitle="Business category, falling back to IFRS category" scope="period">
          {topCats.length === 0 ? (
            <EmptyState>No categorised spend in the selected period.</EmptyState>
          ) : (
            <div className="space-y-2.5">
              {topCats.map((c, i) => (
                <BarRow
                  key={c.key}
                  label={c.name}
                  value={c.amount}
                  max={topCats[0].amount}
                  color={SERIES[i % SERIES.length]}
                  right={ctx.fmt(c.amount)}
                />
              ))}
              {categories.unassigned.count > 0 && (
                <p className="text-[11px] text-slate-500">
                  {categories.unassigned.count} uncategorised ({ctx.fmt(categories.unassigned.amount)})
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Monthly Trend — Amount & Invoice Count" subtitle="By invoice date" scope="period">
        {series.length === 0 ? (
          <EmptyState>No invoices in the selected period.</EmptyState>
        ) : (
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="label" tick={chartAxis} tickLine={false} axisLine={false} />
                <YAxis yAxisId="amt" tick={chartAxis} tickLine={false} axisLine={false} width={44} tickFormatter={axisNumber} />
                <YAxis yAxisId="cnt" orientation="right" tick={chartAxis} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <Tooltip
                  {...chartTooltipStyle}
                  formatter={(v: number, name: string) => (name === 'Invoices' ? [v, name] : [ctx.fmt(v), name])}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                <Bar yAxisId="amt" dataKey="amount" name="Amount" fill={COLORS.primary} radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar yAxisId="amt" dataKey="tax" name="Tax" fill={COLORS.purple} radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Line yAxisId="cnt" type="monotone" dataKey="count" name="Invoices" stroke={COLORS.gold} strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <AgingPanel ctx={ctx} />

        <Panel title="Outstanding Balances" subtitle="Open invoices by workflow status" scope="current">
          {outstandingByStatus.rows.length === 0 ? (
            <EmptyState>No outstanding invoices.</EmptyState>
          ) : (
            <div className="space-y-2.5">
              {outstandingByStatus.rows.map((r) => (
                <BarRow
                  key={r.status}
                  label={STATUS_LABEL[r.status] ?? r.status}
                  value={r.amount}
                  max={outstandingByStatus.rows[0].amount}
                  color={STATUS_COLOR[r.status] ?? COLORS.slate}
                  right={
                    <>
                      {ctx.fmt(r.amount)} <span className="text-slate-400">· {r.count}</span>
                    </>
                  }
                />
              ))}
              <p className="text-[11px] text-slate-500">
                Includes invoices without a due date; AP aging covers {aging.openCount} dated invoices ({ctx.fmt(aging.totalOutstanding)}).
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Processing Performance" scope="period" className="lg:col-span-2 xl:col-span-1">
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Avg processing time"
              value={performance.timing.samples ? `${performance.timing.avg}s` : '—'}
              sub={performance.timing.samples ? `${performance.timing.samples} invoices` : 'Not recorded'}
              tone="primary"
            />
            <Stat
              label="Avg approval cycle"
              value={performance.approvalCycle != null ? `${performance.approvalCycle.toFixed(1)}d` : '—'}
              sub={performance.approvalSamples ? `${performance.approvalSamples} approved` : 'No approvals yet'}
              tone="teal"
            />
          </div>
          {performance.byMonth.some((m) => m.seconds != null) && (
            <div className="mt-3 space-y-1.5">
              {performance.byMonth
                .filter((m) => m.seconds != null)
                .slice(-6)
                .map((m) => (
                  <BarRow
                    key={m.key}
                    label={monthLabel(m.key)}
                    value={m.seconds ?? 0}
                    max={Math.max(...performance.byMonth.map((x) => x.seconds ?? 0), 1)}
                    color={COLORS.teal}
                    right={`${m.seconds}s`}
                  />
                ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
