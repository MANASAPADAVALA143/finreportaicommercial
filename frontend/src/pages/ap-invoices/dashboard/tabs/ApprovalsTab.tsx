import { useMemo, useState } from 'react';
import { formatCurrency } from '@/utils/currency';
import { GstReconSummaryCard } from '@/components/dashboard/GstReconSummaryCard';
import { AnomalyDashboardCard } from '@/components/dashboard/AnomalyDashboardCard';
import type { DashboardCtx } from '../types';
import { approvalLevels, approvalQueue, isIfrsClassified, isMatchException, vatReconStatus } from '../metrics';
import { MatchPanel, RiskFlagsPanel } from '../widgets';
import { BarRow, COLORS, EmptyState, Panel, PanelLink, Pill, Stat } from '../ui';
import { InvoiceLink, RiskPill, StatusPill } from './shared';

const LEVEL_LABEL: Record<string, string> = { cfo: 'CFO', manager: 'Manager', unassigned: 'No level set' };

function ageTone(days: number) {
  if (days > 30) return 'red' as const;
  if (days > 7) return 'amber' as const;
  return 'slate' as const;
}

export function ApprovalsTab({ ctx }: { ctx: DashboardCtx }) {
  const queue = useMemo(() => approvalQueue(ctx.all, ctx.today), [ctx.all, ctx.today]);
  const levels = useMemo(() => approvalLevels(queue), [queue]);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const shown = levelFilter === 'all' ? queue : queue.filter((q) => q.level === levelFilter);

  const onHold = useMemo(() => ctx.all.filter((i) => i.status === 'On Hold' || i.status === 'Queried'), [ctx.all]);
  const unclassified = useMemo(() => ctx.all.filter((i) => !isIfrsClassified(i)), [ctx.all]);
  const matchExceptions = useMemo(() => ctx.all.filter(isMatchException), [ctx.all]);
  const vat = useMemo(() => vatReconStatus(ctx.all), [ctx.all]);
  const vatExceptions = useMemo(() => ctx.all.filter((i) => i.gst_recon_status === 'mismatch'), [ctx.all]);
  const oldest = queue[0]?.daysPending ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Pending approvals" value={ctx.kpis.pendingApprovals} tone="amber" />
        <Stat label="Oldest pending" value={queue.length ? `${oldest} days` : '—'} tone={ageTone(oldest)} />
        <Stat label="CFO approvals" value={levels.rows.find((r) => r.level === 'cfo')?.count ?? 0} />
        <Stat label="Manager approvals" value={levels.rows.find((r) => r.level === 'manager')?.count ?? 0} />
        <Stat label="On hold / queried" value={onHold.length} tone={onHold.length ? 'gold' : 'slate'} />
        <Stat label="3-way exceptions" value={matchExceptions.length} tone={matchExceptions.length ? 'red' : 'slate'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="Approval Queue"
          subtitle="Oldest first · open an invoice to approve, reject or query it"
          scope="current"
          className="xl:col-span-2"
          action={<PanelLink to="/ap-invoices/approvals">My Approvals</PanelLink>}
        >
          <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter by approval level">
            {['all', ...levels.rows.map((r) => r.level)].map((lv) => (
              <button
                key={lv}
                type="button"
                aria-pressed={levelFilter === lv}
                onClick={() => setLevelFilter(lv)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40 ${
                  levelFilter === lv ? 'bg-[#246BFD] text-white ring-[#246BFD]' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {lv === 'all' ? `All (${queue.length})` : `${LEVEL_LABEL[lv] ?? lv} (${levels.rows.find((r) => r.level === lv)?.count ?? 0})`}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <EmptyState>Nothing waiting for approval.</EmptyState>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">Invoice</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Amount</th>
                    <th className="py-1.5 pr-3 font-medium">Level</th>
                    <th className="py-1.5 pr-3 font-medium">Pending</th>
                    <th className="py-1.5 pr-3 font-medium">Risk</th>
                    <th className="py-1.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 50).map(({ invoice, daysPending, level }) => (
                    <tr key={invoice.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-1.5 pr-3">
                        <InvoiceLink invoice={invoice} onOpen={ctx.openInvoice} />
                        <p className="truncate text-[11px] text-slate-500">{invoice.vendor_name}</p>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-900">
                        {formatCurrency(Number(invoice.total_amount), invoice.currency || ctx.baseCurrency)}
                      </td>
                      <td className="py-1.5 pr-3 text-slate-600">{LEVEL_LABEL[level] ?? level}</td>
                      <td className="py-1.5 pr-3">
                        <Pill tone={ageTone(daysPending)}>{daysPending}d</Pill>
                      </td>
                      <td className="py-1.5 pr-3">
                        <RiskPill invoice={invoice} />
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => ctx.openInvoice(invoice)}
                          className="rounded-md border border-[#246BFD]/30 px-2 py-0.5 text-[11px] font-medium text-[#246BFD] hover:bg-[#246BFD]/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > 50 && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Showing 50 of {shown.length}. <PanelLink to="/ap-invoices/approvals">See all</PanelLink>
                </p>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Approval Bottleneck" subtitle="Pending invoices by approver level" scope="current">
          {levels.rows.length === 0 ? (
            <EmptyState>No approval backlog.</EmptyState>
          ) : (
            <div className="space-y-3">
              {levels.rows.map((r) => (
                <div key={r.level}>
                  <BarRow
                    label={LEVEL_LABEL[r.level] ?? r.level}
                    value={r.count}
                    max={queue.length}
                    color={levels.bottleneck?.level === r.level ? COLORS.amber : COLORS.primary}
                    right={`${r.count} inv`}
                  />
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {ctx.fmt(r.amount)} · avg {r.avgDays.toFixed(1)}d · oldest {r.oldest}d
                  </p>
                </div>
              ))}
              {levels.bottleneck && (
                <p className="rounded-md bg-[#FFFBEB] px-2.5 py-1.5 text-[11px] text-[#92400E]">
                  Bottleneck: {LEVEL_LABEL[levels.bottleneck.level] ?? levels.bottleneck.level} holds {levels.bottleneck.count} of{' '}
                  {queue.length} pending invoices.
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <RiskFlagsPanel invoices={ctx.all} scope="current" />
        <MatchPanel invoices={ctx.all} scope="current" />
        <Panel
          title="3-Way Match Exceptions"
          subtitle={`${matchExceptions.filter((i) => i.match_status === 'mismatch').length} mismatch · ${matchExceptions.filter((i) => i.match_status === 'no_po').length} no PO`}
          scope="current"
          accent={matchExceptions.length ? 'red' : undefined}
          action={<PanelLink to="/ap-invoices/list?filter=match_issues">Resolve</PanelLink>}
        >
          {matchExceptions.length === 0 ? (
            <EmptyState>No 3-way match exceptions.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {matchExceptions.slice(0, 6).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                  <span className="min-w-0 truncate">
                    <InvoiceLink invoice={i} onOpen={ctx.openInvoice} />
                    <span className="text-slate-500"> · {i.vendor_name}</span>
                  </span>
                  <Pill tone={i.match_status === 'mismatch' ? 'red' : 'amber'}>
                    {i.match_status === 'mismatch'
                      ? i.match_difference != null
                        ? `Δ ${ctx.fmt(Number(i.match_difference))}`
                        : 'Mismatch'
                      : 'No PO'}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Panel
          title="Pending IFRS Classification"
          scope="current"
          accent={unclassified.length ? 'purple' : undefined}
          action={<PanelLink to="/ap-invoices/list?filter=unclassified">Classify</PanelLink>}
        >
          {unclassified.length === 0 ? (
            <EmptyState>All invoices are classified.</EmptyState>
          ) : (
            <>
              <p className="text-2xl font-semibold text-[#7C3AED]">{unclassified.length}</p>
              <ul className="mt-2 space-y-1">
                {unclassified.slice(0, 4).map((i) => (
                  <li key={i.id} className="truncate text-[12px] text-slate-600">
                    <InvoiceLink invoice={i} onOpen={ctx.openInvoice} /> · {i.vendor_name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel
          title={ctx.isUAE ? 'VAT Exceptions' : 'GST Exceptions'}
          subtitle={`${vat.matched} matched · ${vat.unmatched} unmatched · ${vat.notRun} not reconciled`}
          scope="current"
          accent={vatExceptions.length ? 'purple' : undefined}
          action={<PanelLink to="/ap-invoices/gst-recon">Reconcile</PanelLink>}
        >
          {vatExceptions.length === 0 ? (
            <EmptyState>No invoices with a {ctx.isUAE ? 'VAT' : 'GST'} reconciliation mismatch.</EmptyState>
          ) : (
            <ul className="space-y-1">
              {vatExceptions.slice(0, 5).map((i) => (
                <li key={i.id} className="truncate text-[12px] text-slate-600">
                  <InvoiceLink invoice={i} onOpen={ctx.openInvoice} /> · {i.vendor_name}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="On Hold & Queried" scope="current" accent={onHold.length ? 'gold' : undefined}>
          {onHold.length === 0 ? (
            <EmptyState>No invoices on hold or queried.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {onHold.slice(0, 6).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                  <span className="min-w-0 truncate">
                    <InvoiceLink invoice={i} onOpen={ctx.openInvoice} />
                    <span className="text-slate-500"> · {i.vendor_name}</span>
                  </span>
                  <StatusPill status={i.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="grid gap-4">
          <GstReconSummaryCard />
          <AnomalyDashboardCard />
        </div>
      </div>
    </div>
  );
}
