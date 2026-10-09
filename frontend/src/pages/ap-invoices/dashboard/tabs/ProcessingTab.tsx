import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Upload } from 'lucide-react';
import { supabase, type EmailIntakeLog } from '@/lib/ap-invoice/supabase';
import { getEffectiveExtractionScore } from '@/utils/extractionConfidence';
import { displayDate } from '@/utils/dateUtils';
import type { DashboardCtx } from '../types';
import { avgProcessingSeconds, extractionQuality, sourceBreakdown, sumAmount } from '../metrics';
import { PipelinePanel } from '../panels';
import { MatchPanel, StatusDistributionPanel } from '../widgets';
import { BarRow, COLORS, EmptyState, Panel, PanelLink, Pill, Stat, pct } from '../ui';
import { StatusPill } from './shared';

const SOURCE_LABEL: Record<string, string> = {
  upload: 'Manual upload',
  email: 'Email',
  email_n8n: 'Email (automation)',
  excel: 'Excel import',
  excel_vba: 'Excel (VBA)',
  vendor_portal: 'Vendor portal',
  manual: 'Manual entry',
  whatsapp: 'WhatsApp',
  camera: 'Camera',
};

export function ProcessingTab({ ctx }: { ctx: DashboardCtx }) {
  const quality = useMemo(() => extractionQuality(ctx.period), [ctx.period]);
  const timing = useMemo(() => avgProcessingSeconds(ctx.period), [ctx.period]);
  const sources = useMemo(() => sourceBreakdown(ctx.period), [ctx.period]);
  const duplicates = useMemo(() => ctx.period.filter((i) => i.duplicate_flag === true), [ctx.period]);
  const recent = useMemo(
    () => [...ctx.all].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8),
    [ctx.all],
  );

  const [failedJobs, setFailedJobs] = useState<EmailIntakeLog[] | null>(null);
  useEffect(() => {
    if (!ctx.companyId) {
      setFailedJobs([]);
      return;
    }
    let alive = true;
    void supabase
      .from('email_intake_log')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('status', 'failed')
      .order('received_at', { ascending: false })
      .limit(5)
      .then(({ data, error }) => {
        if (alive) setFailedJobs(error ? [] : ((data || []) as EmailIntakeLog[]));
      });
    return () => {
      alive = false;
    };
  }, [ctx.companyId]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Invoices in period" value={ctx.period.length} sub={ctx.range.label} />
        <Stat
          label="Avg processing time"
          value={timing.samples ? `${timing.avg}s` : '—'}
          sub={timing.samples ? `${timing.samples} timed invoices` : 'No timing recorded'}
          tone="primary"
        />
        <Stat label="Avg extraction confidence" value={ctx.period.length ? `${quality.avgScore.toFixed(1)}%` : '—'} tone="teal" />
        <Stat
          label="Needs manual review"
          value={quality.needsReview.length}
          sub="Confidence below 70%"
          tone={quality.needsReview.length ? 'amber' : 'slate'}
        />
      </div>

      <PipelinePanel ctx={ctx} invoices={ctx.period} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Upload & Batch Queue"
          subtitle="Most recently received invoices"
          scope="current"
          className="lg:col-span-2"
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
            <EmptyState>No invoices uploaded yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
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
                    return (
                      <tr key={inv.id} className="border-b border-slate-50 last:border-0">
                        <td className="py-1.5 pr-3">
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
                        <td className="py-1.5 pr-3 text-slate-600">{displayDate(String(inv.created_at).slice(0, 10), ctx.dateFormat)}</td>
                        <td className="py-1.5 pr-3">
                          <Pill tone={score >= 85 ? 'teal' : score >= 70 ? 'gold' : 'amber'}>{score.toFixed(0)}%</Pill>
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

        <Panel title="Intake Sources" scope="period">
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
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
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
              Overall confidence {ctx.period.length ? `${quality.avgScore.toFixed(1)}%` : '—'}; field-level scores appear once the
              extractor returns them.
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
            <EmptyState>No invoices flagged as possible duplicates.</EmptyState>
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Failed Jobs & Retry"
          subtitle="Email intake runs that did not create invoices"
          scope="current"
          action={<PanelLink to="/ap-invoices/email-invoices">Email Invoices</PanelLink>}
        >
          {failedJobs === null ? (
            <div className="h-16 animate-pulse rounded bg-slate-100" aria-busy />
          ) : failedJobs.length === 0 ? (
            <EmptyState>No failed intake jobs.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {failedJobs.map((j) => (
                <li key={j.id} className="py-1.5 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-slate-800">{j.subject || '(no subject)'}</span>
                    <time className="shrink-0 text-[11px] text-slate-400">{format(new Date(j.received_at), 'MMM d, HH:mm')}</time>
                  </div>
                  <p className="truncate text-[11px] text-[#B91C1C]">{j.error_message || 'Processing failed'}</p>
                </li>
              ))}
            </ul>
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

        <StatusDistributionPanel ctx={ctx} invoices={ctx.period} />
      </div>
    </div>
  );
}
