import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Invoice } from '@/lib/ap-invoice/supabase';
import type { DashboardCtx } from '../types';
import { costCenterOf, glCodeOf, glNameOf, groupSpend, groupTrend, sumAmount } from '../metrics';
import { CostCenterPanel, CurrencyNote, GlSpendPanel } from '../widgets';
import { BarRow, COLORS, EmptyState, Panel, PanelLink, Pill, SERIES, Stat, chartAxis, chartTooltipStyle,
  axisNumber, pct } from '../ui';
import { InvoiceLink } from './shared';

type CodingIssue = 'missing_gl' | 'missing_cc' | 'unconfirmed';

const ISSUE_LABEL: Record<CodingIssue, string> = {
  missing_gl: 'No GL code',
  missing_cc: 'No cost centre',
  unconfirmed: 'AI suggestion not confirmed',
};

function codingIssues(inv: Invoice): CodingIssue[] {
  const out: CodingIssue[] = [];
  if (!glCodeOf(inv)) out.push('missing_gl');
  if (!costCenterOf(inv)) out.push('missing_cc');
  if (glCodeOf(inv) && inv.gl_auto_suggested && inv.gl_confirmed !== true) out.push('unconfirmed');
  return out;
}

export function CostCenterGlTab({ ctx }: { ctx: DashboardCtx }) {
  const total = useMemo(() => sumAmount(ctx.period), [ctx.period]);
  const gl = useMemo(() => groupSpend(ctx.period, glCodeOf, glNameOf), [ctx.period]);
  const cc = useMemo(() => groupSpend(ctx.period, costCenterOf), [ctx.period]);
  const glTypes = useMemo(() => {
    const map = new Map<string, string>();
    for (const inv of ctx.period) {
      const code = glCodeOf(inv);
      const type = inv.gl_account_type || inv.gl_category;
      if (code && type && !map.has(code)) map.set(code, type);
    }
    return map;
  }, [ctx.period]);

  const trend = useMemo(() => {
    const codes = gl.rows.slice(0, 4).map((r) => r.key);
    return { codes, data: groupTrend(ctx.period, ctx.monthKeys.keys, codes, glCodeOf) };
  }, [gl.rows, ctx.period, ctx.monthKeys.keys]);

  const [issueFilter, setIssueFilter] = useState<CodingIssue | 'all'>('all');
  const issues = useMemo(
    () => ctx.period.map((invoice) => ({ invoice, issues: codingIssues(invoice) })).filter((r) => r.issues.length),
    [ctx.period],
  );
  const issueCounts = useMemo(() => {
    const c: Record<CodingIssue, number> = { missing_gl: 0, missing_cc: 0, unconfirmed: 0 };
    for (const r of issues) for (const i of r.issues) c[i] += 1;
    return c;
  }, [issues]);
  const shownIssues = issueFilter === 'all' ? issues : issues.filter((r) => r.issues.includes(issueFilter));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="GL accounts used" value={gl.rows.length} sub={ctx.range.label} />
        <Stat label={`${ctx.costCenterLabel}s used`} value={cc.rows.length} />
        <Stat label="GL coverage" value={ctx.period.length ? pct((ctx.period.length - gl.unassigned.count) / ctx.period.length) : '—'} tone="teal" />
        <Stat label="Uncoded invoices" value={gl.unassigned.count} sub={ctx.fmt(gl.unassigned.amount)} tone={gl.unassigned.count ? 'amber' : 'slate'} />
        <Stat label={`No ${ctx.costCenterLabel.toLowerCase()}`} value={cc.unassigned.count} sub={ctx.fmt(cc.unassigned.amount)} tone={cc.unassigned.count ? 'amber' : 'slate'} />
      </div>
      <CurrencyNote ctx={ctx} invoices={ctx.period} />

      <div className="grid gap-4 xl:grid-cols-3">
        <CostCenterPanel ctx={ctx} limit={8} />
        <Panel title={`${ctx.costCenterLabel} Invoice Count`} scope="period">
          {cc.rows.length === 0 ? (
            <EmptyState>No {ctx.costCenterLabel.toLowerCase()}-tagged invoices.</EmptyState>
          ) : (
            <div className="space-y-2.5">
              {[...cc.rows]
                .sort((a, b) => b.count - a.count)
                .slice(0, 8)
                .map((r, _i, arr) => (
                  <BarRow key={r.key} label={r.name} value={r.count} max={arr[0].count} color={COLORS.gold} right={`${r.count} inv`} />
                ))}
            </div>
          )}
        </Panel>
        <GlSpendPanel ctx={ctx} limit={8} />
      </div>

      <Panel title="GL Spend Trend" subtitle={`Top ${trend.codes.length} accounts by month`} scope="period">
        {trend.codes.length === 0 || trend.data.length === 0 ? (
          <EmptyState>No GL-coded spend in the selected period.</EmptyState>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="label" tick={chartAxis} tickLine={false} axisLine={false} />
                <YAxis tick={chartAxis} tickLine={false} axisLine={false} width={44} tickFormatter={axisNumber} />
                <Tooltip {...chartTooltipStyle} formatter={(v: number, code: string) => [ctx.fmt(v), `${code} ${gl.rows.find((r) => r.key === code)?.name ?? ''}`]} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                {trend.codes.map((c, i) => (
                  <Line key={c} type="monotone" dataKey={c} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={{ r: 2 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="GL Codes & Descriptions"
          scope="period"
          action={<PanelLink to="/ap-invoices/gl-accounts">Chart of accounts</PanelLink>}
        >
          {gl.rows.length === 0 ? (
            <EmptyState>No GL-coded invoices in the selected period.</EmptyState>
          ) : (
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">Code</th>
                    <th className="py-1.5 pr-3 font-medium">Description</th>
                    <th className="py-1.5 pr-3 font-medium">Type</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Invoices</th>
                    <th className="py-1.5 text-right font-medium">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {gl.rows.map((r) => (
                    <tr key={r.key} className="border-b border-slate-50 last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-[11.5px] text-slate-700">{r.key}</td>
                      <td className="max-w-[200px] truncate py-1.5 pr-3 text-slate-800">{r.name !== r.key ? r.name : '—'}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{glTypes.get(r.key) ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{r.count}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {ctx.fmt(r.amount)} <span className="text-slate-400">· {pct(total ? r.amount / total : 0)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Coding Exceptions" subtitle={`${issues.length} invoices need coding attention`} scope="period" accent={issues.length ? 'amber' : undefined}>
          <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter coding exceptions">
            {(['all', 'missing_gl', 'missing_cc', 'unconfirmed'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={issueFilter === k}
                onClick={() => setIssueFilter(k)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40 ${
                  issueFilter === k ? 'bg-[#246BFD] text-white ring-[#246BFD]' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {k === 'all' ? `All (${issues.length})` : `${ISSUE_LABEL[k]} (${issueCounts[k]})`}
              </button>
            ))}
          </div>
          {shownIssues.length === 0 ? (
            <EmptyState>No coding exceptions.</EmptyState>
          ) : (
            <ul className="max-h-[300px] divide-y divide-slate-100 overflow-auto">
              {shownIssues.slice(0, 40).map(({ invoice, issues: its }) => (
                <li key={invoice.id} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                  <span className="min-w-0 truncate">
                    <InvoiceLink invoice={invoice} onOpen={ctx.openInvoice} />
                    <span className="text-slate-500"> · {invoice.vendor_name}</span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {its.map((i) => (
                      <Pill key={i} tone={i === 'unconfirmed' ? 'gold' : 'amber'}>
                        {ISSUE_LABEL[i]}
                      </Pill>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
