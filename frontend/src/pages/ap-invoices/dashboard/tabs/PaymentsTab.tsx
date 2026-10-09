import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@/utils/currency';
import { displayDate } from '@/utils/dateUtils';
import {
  fetchPaymentRunMonthlyStats,
  listPaymentRuns,
  type PaymentRun,
  type PaymentRunMonthlyStats,
} from '@/lib/ap-invoice/paymentRunService';
import type { DashboardCtx } from '../types';
import { daysBetween, paidInRange, paymentDayOf, paymentPosition, resolveRange } from '../metrics';
import { AgingPanel, CashFlowPanel } from '../widgets';
import { EmptyState, Note, Panel, PanelLink, Pill, Stat, type Tone } from '../ui';
import { InvoiceLink, PaymentPill } from './shared';

const RUN_TONE: Record<string, Tone> = {
  draft: 'slate',
  pending_approval: 'amber',
  approved: 'teal',
  executed: 'primary',
  rejected: 'red',
  cancelled: 'slate',
};

export function PaymentsTab({ ctx }: { ctx: DashboardCtx }) {
  const [stats, setStats] = useState<PaymentRunMonthlyStats | null>(null);
  const [runs, setRuns] = useState<PaymentRun[] | null>(null);
  const [runsError, setRunsError] = useState(false);

  useEffect(() => {
    let alive = true;
    setRunsError(false);
    Promise.all([fetchPaymentRunMonthlyStats(), listPaymentRuns()])
      .then(([s, r]) => {
        if (!alive) return;
        setStats(s);
        setRuns(r.runs ?? []);
      })
      .catch(() => {
        if (!alive) return;
        setRunsError(true);
        setRuns([]);
      });
    return () => {
      alive = false;
    };
  }, [ctx.companyId]);

  const position = useMemo(() => paymentPosition(ctx.all, ctx.today), [ctx.all, ctx.today]);
  const paidThisMonth = useMemo(() => paidInRange(ctx.all, resolveRange('this_month', new Date())), [ctx.all]);
  const paidPeriod = useMemo(() => paidInRange(ctx.all, ctx.range), [ctx.all, ctx.range]);

  return (
    <div className="space-y-4">
      {runsError && <Note tone="amber">Payment run service is unavailable — run figures are hidden; invoice payment records are still shown.</Note>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Payment runs this month" value={stats ? stats.runs_executed : '—'} sub="Executed runs" tone="primary" />
        <Stat
          label="Paid via runs this month"
          value={stats ? formatCurrency(Number(stats.total_paid_aed || 0), 'AED') : '—'}
          sub="From executed runs (AED)"
        />
        <Stat
          label="Invoices paid this month"
          value={ctx.fmt(paidThisMonth.amount)}
          sub={`${paidThisMonth.count} invoice records`}
          tone="teal"
        />
        <Stat label="Runs pending approval" value={stats ? stats.pending_approval : '—'} tone={stats?.pending_approval ? 'amber' : 'slate'} />
        <Stat label="Scheduled payments" value={ctx.fmt(position.scheduled.amount)} sub={`${position.scheduled.count} invoices`} tone="teal" />
        <Stat
          label="Overdue"
          value={ctx.fmt(position.overdue.amount)}
          sub={`${position.overdue.count} invoices`}
          tone={position.overdue.count ? 'red' : 'slate'}
        />
      </div>
      <p className="text-[11px] text-slate-500">
        Run totals come from payment runs; invoice totals come from invoices marked paid (including payments recorded outside a run), so the
        two can differ.
      </p>

      <div className="grid gap-4 xl:grid-cols-3">
        <CashFlowPanel ctx={ctx} className="xl:col-span-2" />
        <Panel title="Unpaid & Awaiting" scope="current">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Open balance" value={ctx.fmt(position.open.amount)} sub={`${position.open.count} invoices`} />
            <Stat
              label="Awaiting invoice approval"
              value={ctx.fmt(position.awaitingApproval.amount)}
              sub={`${position.awaitingApproval.count} invoices`}
              tone="amber"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <PanelLink to="/ap-invoices/payment-run/new">New payment run</PanelLink>
            <PanelLink to="/ap-invoices/calendar">Payment calendar</PanelLink>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Upcoming Payments" subtitle="Next 30 days by scheduled or due date" scope="current" className="xl:col-span-2">
          {position.upcoming.length === 0 ? (
            <EmptyState>No payments due in the next 30 days.</EmptyState>
          ) : (
            <div className="max-h-[340px] overflow-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">Invoice</th>
                    <th className="py-1.5 pr-3 font-medium">Pay date</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Amount</th>
                    <th className="py-1.5 font-medium">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {position.upcoming.slice(0, 40).map(({ invoice, payDay }) => (
                    <tr key={invoice.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-1.5 pr-3">
                        <InvoiceLink invoice={invoice} onOpen={ctx.openInvoice} />
                        <p className="truncate text-[11px] text-slate-500">{invoice.vendor_name}</p>
                      </td>
                      <td className="py-1.5 pr-3 text-slate-600">
                        {displayDate(payDay, ctx.dateFormat)}
                        <span className="ml-1 text-[11px] text-slate-400">in {daysBetween(ctx.today, payDay)}d</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {formatCurrency(Number(invoice.total_amount), invoice.currency || ctx.baseCurrency)}
                      </td>
                      <td className="py-1.5">
                        <PaymentPill invoice={invoice} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <AgingPanel ctx={ctx} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Overdue Invoices"
          subtitle="Past due date and still open"
          scope="current"
          accent={position.overdue.count ? 'red' : undefined}
          action={<PanelLink to="/ap-invoices/aging">AP Aging</PanelLink>}
        >
          {position.overdue.items.length === 0 ? (
            <EmptyState>No overdue invoices.</EmptyState>
          ) : (
            <ul className="max-h-[300px] divide-y divide-slate-100 overflow-auto">
              {[...position.overdue.items]
                .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
                .slice(0, 30)
                .map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                    <span className="min-w-0 truncate">
                      <InvoiceLink invoice={i} onOpen={ctx.openInvoice} />
                      <span className="text-slate-500"> · {i.vendor_name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums">{formatCurrency(Number(i.total_amount), i.currency || ctx.baseCurrency)}</span>
                      <Pill tone="red">{daysBetween(String(i.due_date).slice(0, 10), ctx.today)}d late</Pill>
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Payment Runs"
          subtitle="Most recent runs"
          scope="all"
          action={<PanelLink to="/ap-invoices/payment-run">Payment Runs</PanelLink>}
        >
          {runs === null ? (
            <div className="h-20 animate-pulse rounded bg-slate-100" aria-busy />
          ) : runs.length === 0 ? (
            <EmptyState>{runsError ? 'Payment runs could not be loaded.' : 'No payment runs yet.'}</EmptyState>
          ) : (
            <div className="max-h-[300px] overflow-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">Run</th>
                    <th className="py-1.5 pr-3 font-medium">Pay date</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Invoices</th>
                    <th className="py-1.5 text-right font-medium">Gross (AED)</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 15).map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-1.5 pr-3">
                        <Link to={`/ap-invoices/payment-run/${r.id}`} className="font-medium text-slate-900 hover:text-[#246BFD]">
                          {r.run_number}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3 text-slate-600">{r.payment_date ? displayDate(r.payment_date, ctx.dateFormat) : '—'}</td>
                      <td className="py-1.5 pr-3">
                        <Pill tone={RUN_TONE[r.status] ?? 'slate'}>{String(r.status).replace('_', ' ')}</Pill>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{r.invoice_count ?? r.total_invoices}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCurrency(Number(r.total_gross_aed || 0), 'AED')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Payment History"
        subtitle={`${paidPeriod.count} invoices paid · ${ctx.fmt(paidPeriod.amount)}`}
        scope="period"
        action={<PanelLink to="/ap-invoices/payment-log">Payment Log</PanelLink>}
      >
        {paidPeriod.items.length === 0 ? (
          <EmptyState>No invoices paid in the selected period.</EmptyState>
        ) : (
          <div className="max-h-[340px] overflow-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Invoice</th>
                  <th className="py-1.5 pr-3 font-medium">Paid on</th>
                  <th className="py-1.5 pr-3 font-medium">Method</th>
                  <th className="py-1.5 pr-3 font-medium">Reference</th>
                  <th className="py-1.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {paidPeriod.items.slice(0, 50).map((i) => {
                  const day = paymentDayOf(i);
                  return (
                    <tr key={i.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-1.5 pr-3">
                        <InvoiceLink invoice={i} onOpen={ctx.openInvoice} />
                        <p className="truncate text-[11px] text-slate-500">{i.vendor_name}</p>
                      </td>
                      <td className="py-1.5 pr-3 text-slate-600">{day ? displayDate(day, ctx.dateFormat) : 'Not recorded'}</td>
                      <td className="py-1.5 pr-3 text-slate-600">{i.payment_method || '—'}</td>
                      <td className="max-w-[160px] truncate py-1.5 pr-3 font-mono text-[11px] text-slate-600">
                        {i.utr_number || i.payment_reference || '—'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatCurrency(Number(i.total_amount), i.currency || ctx.baseCurrency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
