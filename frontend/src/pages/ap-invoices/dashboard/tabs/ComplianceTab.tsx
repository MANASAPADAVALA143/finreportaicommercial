import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GstReconSummaryCard } from '@/components/dashboard/GstReconSummaryCard';
import { displayDate } from '@/utils/dateUtils';
import type { DashboardCtx } from '../types';
import {
  EXCEPTION_LABEL,
  complianceChecks,
  complianceTrend,
  exceptionReasons,
  ifrsSummary,
  invoiceDay,
  vatReconStatus,
  type ExceptionReason,
} from '../metrics';
import { IfrsPanel } from '../widgets';
import { BarRow, COLORS, EmptyState, Panel, PanelLink, Pill, Stat, chartAxis, chartTooltipStyle, pct } from '../ui';
import { InvoiceLink } from './shared';

const REASON_TONE: Record<ExceptionReason, 'red' | 'amber' | 'purple' | 'gold'> = {
  unclassified: 'purple',
  extraction_review: 'amber',
  duplicate: 'red',
  match_exception: 'red',
  vat_mismatch: 'purple',
  missing_gl: 'gold',
  high_risk: 'red',
};

export function ComplianceTab({ ctx }: { ctx: DashboardCtx }) {
  const ifrs = useMemo(() => ifrsSummary(ctx.period), [ctx.period]);
  const checks = useMemo(() => complianceChecks(ctx.period), [ctx.period]);
  const vat = useMemo(() => vatReconStatus(ctx.period), [ctx.period]);
  const trend = useMemo(() => complianceTrend(ctx.period, ctx.monthKeys.keys), [ctx.period, ctx.monthKeys.keys]);
  const [drill, setDrill] = useState<ExceptionReason | null>(null);

  const exceptions = useMemo(
    () =>
      ctx.period
        .map((invoice) => ({ invoice, reasons: exceptionReasons(invoice) }))
        .filter((r) => r.reasons.length && (!drill || r.reasons.includes(drill)))
        .sort((a, b) => invoiceDay(b.invoice).localeCompare(invoiceDay(a.invoice))),
    [ctx.period, drill],
  );
  const vatTotal = vat.matched + vat.mismatch + vat.unmatched + vat.ignored;
  const taxName = ctx.isUAE ? 'VAT' : 'GST';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Clean invoices" value={pct(checks.cleanRate)} sub="No open compliance exception" tone="teal" />
        <Stat label="IFRS classified" value={pct(ifrs.rate)} sub={`${ifrs.classified} of ${ifrs.total}`} tone="purple" />
        <Stat label="IFRS needs review" value={ifrs.needsReview} tone={ifrs.needsReview ? 'amber' : 'slate'} />
        <Stat label="Manual IFRS overrides" value={ifrs.manualOverrides} />
        <Stat
          label={`${taxName} reconciled`}
          value={vatTotal ? pct(vat.matched / vatTotal) : '—'}
          sub={`${vat.notRun} not reconciled yet`}
          tone="purple"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <IfrsPanel ctx={ctx} limit={8} />

        <Panel title="Compliance Checks" subtitle="Select a check to drill down" scope="period">
          <ul className="space-y-1">
            {checks.checks.map((c) => {
              const active = drill === c.key;
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDrill(active ? null : c.key)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40 ${
                      active ? 'bg-[#246BFD]/5 ring-1 ring-[#246BFD]/30' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-slate-700">{c.label}</span>
                    {c.count === 0 ? <Pill tone="teal">Pass</Pill> : <Pill tone={REASON_TONE[c.key]}>{c.count}</Pill>}
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="grid gap-4">
          <Panel
            title={`${taxName} Reconciliation`}
            subtitle="Invoice-level reconciliation status"
            scope="period"
            action={<PanelLink to="/ap-invoices/gst-recon">Reconcile</PanelLink>}
          >
            {ctx.period.length === 0 ? (
              <EmptyState>No invoices in the selected period.</EmptyState>
            ) : (
              <div className="space-y-2">
                {[
                  { label: 'Matched', value: vat.matched, color: COLORS.teal },
                  { label: 'Mismatch', value: vat.mismatch, color: COLORS.red },
                  { label: 'Unmatched', value: vat.unmatched, color: COLORS.amber },
                  { label: 'Ignored', value: vat.ignored, color: COLORS.slate },
                  { label: 'Not reconciled', value: vat.notRun, color: '#CBD5E1' },
                ].map((r) => (
                  <BarRow key={r.label} label={r.label} value={r.value} max={ctx.period.length} color={r.color} right={r.value} />
                ))}
              </div>
            )}
          </Panel>
          <GstReconSummaryCard />
        </div>
      </div>

      <Panel title="Compliance Trend" subtitle="Invoices with any open exception, by invoice month" scope="period">
        {trend.length === 0 ? (
          <EmptyState>No invoices in the selected period.</EmptyState>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="label" tick={chartAxis} tickLine={false} axisLine={false} />
                <YAxis yAxisId="n" tick={chartAxis} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <YAxis yAxisId="p" orientation="right" domain={[0, 100]} unit="%" tick={chartAxis} tickLine={false} axisLine={false} width={40} />
                <Tooltip {...chartTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                <Bar yAxisId="n" dataKey="total" name="Invoices" fill="#CBD5E1" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar yAxisId="n" dataKey="exceptions" name="With exceptions" fill={COLORS.amber} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line yAxisId="p" type="monotone" dataKey="cleanPct" name="Clean %" stroke={COLORS.teal} strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel
        title={drill ? `Exceptions — ${EXCEPTION_LABEL[drill]}` : 'Recent Exceptions'}
        subtitle={`${exceptions.length} invoices`}
        scope="period"
        action={
          drill ? (
            <button type="button" onClick={() => setDrill(null)} className="text-[12px] font-medium text-[#246BFD] hover:underline">
              Clear filter
            </button>
          ) : undefined
        }
      >
        {exceptions.length === 0 ? (
          <EmptyState>No exceptions{drill ? ' for this check' : ''} in the selected period.</EmptyState>
        ) : (
          <div className="max-h-[380px] overflow-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Invoice</th>
                  <th className="py-1.5 pr-3 font-medium">Date</th>
                  <th className="py-1.5 pr-3 font-medium">Issues</th>
                  <th className="py-1.5 text-right font-medium">Resolve</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.slice(0, 50).map(({ invoice, reasons }) => (
                  <tr key={invoice.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-1.5 pr-3">
                      <InvoiceLink invoice={invoice} onOpen={ctx.openInvoice} />
                      <p className="truncate text-[11px] text-slate-500">{invoice.vendor_name}</p>
                    </td>
                    <td className="py-1.5 pr-3 text-slate-600">{displayDate(invoiceDay(invoice), ctx.dateFormat)}</td>
                    <td className="py-1.5 pr-3">
                      <span className="flex flex-wrap gap-1">
                        {reasons.map((r) => (
                          <Pill key={r} tone={REASON_TONE[r]}>
                            {EXCEPTION_LABEL[r]}
                          </Pill>
                        ))}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      <Link
                        to={checks.checks.find((c) => c.key === (drill ?? reasons[0]))?.route ?? '/ap-invoices/list'}
                        className="text-[11px] font-medium text-[#246BFD] hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {exceptions.length > 50 && <p className="mt-2 text-[11px] text-slate-500">Showing the 50 most recent.</p>}
          </div>
        )}
      </Panel>
    </div>
  );
}
