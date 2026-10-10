import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Upload } from 'lucide-react';
import { supabase, type EmailIntakeLog } from '@/lib/ap-invoice/supabase';
import { INVOICE_SOURCE_LABEL } from '@/lib/ap-invoice/invoiceLabels';
import { getEffectiveExtractionScore, getExtractionScoreSource } from '@/utils/extractionConfidence';
import { displayDate } from '@/utils/dateUtils';
import type { DashboardCtx } from '../types';
import { avgProcessingSeconds, extractionQuality, sourceBreakdown, sumAmount } from '../metrics';
import { PipelinePanel } from '../panels';
import { MatchPanel, StatusDistributionPanel } from '../widgets';
import { BarRow, COLORS, EmptyState, Panel, PanelLink, Pill, Stat, pct } from '../ui';
import { StatusPill } from './shared';

const SOURCE_LABEL = INVOICE_SOURCE_LABEL;
const QUEUE_ROWS = 10;

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

type FailedJobsState = { kind: 'loading' } | { kind: 'ready'; jobs: EmailIntakeLog[] } | { kind: 'error' };

export function ProcessingTab({ ctx }: { ctx: DashboardCtx }) {
  const quality = useMemo(() => extractionQuality(ctx.period), [ctx.period]);
  const timing = useMemo(() => avgProcessingSeconds(ctx.period), [ctx.period]);
  const sources = useMemo(() => sourceBreakdown(ctx.period), [ctx.period]);
  const duplicates = useMemo(() => ctx.period.filter((i) => i.duplicate_flag === true), [ctx.period]);
  const aiScored = useMemo(
    () => ctx.period.filter((i) => getExtractionScoreSource(i) !== 'completeness').length,
    [ctx.period],
  );
  const recent = useMemo(
    () => [...ctx.all].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, QUEUE_ROWS),
    [ctx.all],
  );

  const [failed, setFailed] = useState<FailedJobsState>({ kind: 'loading' });
  const [failedAttempt, setFailedAttempt] = useState(0);
  useEffect(() => {
    if (!ctx.companyId) {
      setFailed({ kind: 'ready', jobs: [] });
      return;
    }
    let alive = true;
    setFailed({ kind: 'loading' });
    void supabase
      .from('email_intake_log')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('status', 'failed')
      .order('received_at', { ascending: false })
      .limit(5)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          console.error('[AP Dashboard] email_intake_log query failed:', error);
          setFailed({ kind: 'error' });
          return;
        }
        setFailed({ kind: 'ready', jobs: (data || []) as EmailIntakeLog[] });
      });
    return () => {
      alive = false;
    };
  }, [ctx.companyId, failedAttempt]);

  const hasPeriod = ctx.period.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Invoices in period" value={ctx.period.length.toLocaleString()} sub={ctx.range.label} />
        <Stat
          label="Avg processing time"
          value={timing.samples ? formatDuration(timing.avg) : <span className="text-base text-slate-400">Not available</span>}
          sub={timing.samples ? `From ${timing.samples} timed invoice${timing.samples === 1 ? '' : 's'}` : 'No processing time recorded for these invoices'}
          tone="primary"
        />
        <Stat
          label="Avg extraction confidence"
          value={hasPeriod ? `${quality.avgScore.toFixed(1)}%` : <span className="text-base text-slate-400">Not available</span>}
          sub={
            hasPeriod
              ? aiScored === ctx.period.length
                ? 'All from AI extraction scores'
                : `${aiScored} AI-scored · ${ctx.period.length - aiScored} by field completeness`
              : 'No invoices in the selected period'
          }
          tone="teal"
        />
        <Stat
          label="Needs manual review"
          value={quality.needsReview.length.toLocaleString()}
          sub="Extraction confidence below 70%"
          tone={quality.needsReview.length ? 'amber' : 'slate'}
          onClick={quality.needsReview.length ? () => ctx.showStage('extracted', 'issue') : undefined}
        />
      </div>

      <PipelinePanel ctx={ctx} invoices={ctx.period} />

      <div className="grid gap-4 lg:grid-cols-10">
        <Panel
          title="Upload & Batch Queue"
          subtitle={`Latest ${Math.min(QUEUE_ROWS, recent.length)} invoices received`}
          scope="current"
          className="lg:col-span-7"
          action={
            <Link
              to="/ap-invoices/upload"
              className="inline-flex items-center gap-1.5 rounded-md bg-[#246BFD] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[#1F5FE0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden /> Upload invoices
            </Link>
          }
        >
          {recent.length === 0 ? (
            <EmptyState
              action={
                <Link to="/ap-invoices/upload" className="text-[12px] font-medium text-[#246BFD] hover:underline">
                  Upload your first invoice
                </Link>
              }
            >
              No invoices received yet.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[12px]">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">Invoice</th>
                    <th className="py-1.5 pr-3 font-medium">Source</th>
                    <th className="py-1.5 pr-3 font-medium">Received</th>
                    <th className="py-1.5 pr-3 font-medium">Confidence</th>
                    <th className="py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((inv) => {
                    const score = getEffectiveExtractionScore(inv);
                    const fromAi = getExtractionScoreSource(inv) !== 'completeness';
                    const received = inv.created_at ? String(inv.created_at).slice(0, 10) : '';
                    return (
                      <tr key={inv.id} className="border-b border-slate-50 last:border-0">
                        <td className="max-w-[220px] py-1.5 pr-3">
                          <button
                            type="button"
                            onClick={() => ctx.openInvoice(inv)}
                            className="text-left font-medium text-slate-900 hover:text-[#246BFD] focus:outline-none focus-visible:underline"
                          >
                            {inv.invoice_number}
                          </button>
                          <p className="truncate text-[11px] text-slate-500">{inv.vendor_name}</p>
                        </td>
                        <td className="py-1.5 pr-3 text-slate-600">{SOURCE_LABEL[inv.source || 'upload'] ?? inv.source}</td>
                        <td className="whitespace-nowrap py-1.5 pr-3 text-slate-600">
                          {received ? displayDate(received, ctx.dateFormat) : <span className="text-slate-400">Not available</span>}
                        </td>
                        <td className="py-1.5 pr-3">
                          {fromAi ? (
                            <Pill tone={score >= 85 ? 'teal' : score >= 70 ? 'gold' : 'amber'}>{score.toFixed(0)}%</Pill>
                          ) : (
                            <span title="No AI extraction score — based on required fields present" className="text-[11px] text-slate-500">
                              {score.toFixed(0)}% fields
                            </span>
                          )}
                        </td>
                        <td className="py-1.5">
                          <StatusPill status={inv.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
          <Panel title="Intake Sources" subtitle={hasPeriod ? `${ctx.period.length} invoices` : undefined} scope="period">
            {sources.length === 0 ? (
              <EmptyState>No invoices in the selected period.</EmptyState>
            ) : (
              <div className="space-y-2.5">
                {sources.map((s) => (
                  <BarRow
                    key={s.source}
                    label={SOURCE_LABEL[s.source] ?? s.source}
                    value={s.count}
                    max={sources[0].count}
                    right={
                      <>
                        {s.count} <span className="text-slate-400">· {pct(s.count / ctx.period.length)}</span>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Failed Jobs & Retry"
            subtitle="Email intake runs that did not create invoices"
            scope="current"
            accent={failed.kind === 'ready' && failed.jobs.length ? 'red' : undefined}
            action={<PanelLink to="/ap-invoices/email-invoices">Email Invoices</PanelLink>}
          >
            {failed.kind === 'loading' ? (
              <div className="h-16 animate-pulse rounded bg-slate-100" aria-busy />
            ) : failed.kind === 'error' ? (
              <EmptyState
                action={
                  <button
                    type="button"
                    onClick={() => setFailedAttempt((n) => n + 1)}
                    className="text-[12px] font-medium text-[#246BFD] hover:underline"
                  >
                    Try again
                  </button>
                }
              >
                Failed-job history could not be loaded.
              </EmptyState>
            ) : failed.jobs.length === 0 ? (
              <EmptyState>No failed email intake jobs.</EmptyState>
            ) : (
              <>
                <ul className="divide-y divide-slate-100">
                  {failed.jobs.map((j) => (
                    <li key={j.id} className="py-1.5 text-[12px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-slate-800">{j.subject || '(no subject)'}</span>
                        <time className="shrink-0 text-[11px] text-slate-400">{format(new Date(j.received_at), 'MMM d, HH:mm')}</time>
                      </div>
                      <p className="truncate text-[11px] text-[#B91C1C]">{j.error_message || 'Processing failed'}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-slate-500">
                  Re-run intake from{' '}
                  <Link to="/ap-invoices/email-invoices" className="font-medium text-[#246BFD] hover:underline">
                    Email Invoices
                  </Link>{' '}
                  after fixing the cause.
                </p>
              </>
            )}
            {quality.needsReview.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-600">
                {quality.needsReview.length} low-confidence extraction{quality.needsReview.length === 1 ? '' : 's'} waiting for manual
                review —{' '}
                <Link to="/ap-invoices/list?tab=needs-review" className="font-medium text-[#246BFD] hover:underline">
                  open review queue
                </Link>
              </p>
            )}
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Extraction Quality"
          subtitle={
            quality.withFieldScores
              ? `Per-field confidence from ${quality.withFieldScores} invoices`
              : 'Per-field scores are not available for these invoices'
          }
          scope="period"
          action={<PanelLink to="/ap-invoices/list?tab=needs-review">Review queue</PanelLink>}
        >
          {quality.fields.length === 0 ? (
            <EmptyState>
              {hasPeriod
                ? `Overall confidence ${quality.avgScore.toFixed(1)}%; field-level scores appear once the extractor returns them.`
                : 'No invoices in the selected period.'}
            </EmptyState>
          ) : (
            <div className="space-y-2.5">
              {quality.fields.slice(0, 7).map((f) => (
                <BarRow
                  key={f.field}
                  label={f.field.replace(/_/g, ' ')}
                  value={f.avg}
                  max={100}
                  color={f.avg >= 85 ? COLORS.teal : f.avg >= 70 ? COLORS.gold : COLORS.amber}
                  right={`${f.avg.toFixed(0)}%`}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Duplicate Detection"
          scope="period"
          accent={duplicates.length ? 'amber' : 'teal'}
          action={<PanelLink to="/ap-invoices/list?filter=duplicates">Review</PanelLink>}
        >
          {duplicates.length === 0 ? (
            <EmptyState>No invoices in this period are flagged as possible duplicates.</EmptyState>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Flagged" value={duplicates.length} tone="amber" />
                <Stat label="Value at risk" value={ctx.fmt(sumAmount(duplicates))} />
              </div>
              <ul className="mt-3 space-y-1">
                {duplicates.slice(0, 4).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-[12px]">
                    <button
                      type="button"
                      onClick={() => ctx.openInvoice(d)}
                      className="min-w-0 truncate text-left text-slate-700 hover:text-[#246BFD]"
                    >
                      {d.invoice_number} · {d.vendor_name}
                    </button>
                    <span className="shrink-0 text-[11px] text-slate-500" title={d.duplicate_reason ?? undefined}>
                      {d.duplicate_reason ? d.duplicate_reason.slice(0, 28) : 'Flagged'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <MatchPanel invoices={ctx.period} />
        <StatusDistributionPanel ctx={ctx} invoices={ctx.period} />
      </div>
    </div>
  );
}
