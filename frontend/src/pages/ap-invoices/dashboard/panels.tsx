import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { CheckCircle2, ChevronDown, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { supabase, type AuditLog, type Invoice } from '@/lib/ap-invoice/supabase';
import { generateAPInsights, type APSummary, type InsightCard } from '@/services/apInsights.service';
import {
  complianceChecks,
  computeAging,
  consistencyChecks,
  pipelineBottleneck,
  pipelineStages,
  pipelineState,
  type ExceptionReason,
} from './metrics';
import type { DashboardCtx, TabId } from './types';
import { COLORS, EmptyState, Panel, Pill, type Tone } from './ui';

// ── Processing pipeline ──────────────────────────────────────────────────────

type ScanState =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'finished'; saved: number; total: number; failed: number; unreadable: number; lastError: string | null };

function RiskScanNote({ ctx, invoices }: { ctx: DashboardCtx; invoices: Invoice[] }) {
  const unscored = useMemo(() => invoices.filter((i) => pipelineState(i, 'risk') !== 'done'), [invoices]);
  const [scan, setScan] = useState<ScanState>({ kind: 'idle' });

  const run = async () => {
    const ids = unscored.map((i) => i.id);
    setScan({ kind: 'running', done: 0, total: ids.length });
    try {
      const { scanInvoicesAnomaliesBatch } = await import('@/lib/ap-invoice/anomalyService');
      const r = await scanInvoicesAnomaliesBatch(ids, 'dashboard-risk-scan', (done, total) =>
        setScan({ kind: 'running', done, total }),
      );
      setScan({ kind: 'finished', saved: r.scanned, total: ids.length, failed: r.failed, unreadable: r.unreadable, lastError: r.lastError });
    } catch (e) {
      console.error('[AP Dashboard] risk scan failed:', e);
      setScan({ kind: 'finished', saved: 0, total: ids.length, failed: ids.length, unreadable: 0, lastError: e instanceof Error ? e.message : String(e) });
    }
    ctx.reload();
  };

  if (!unscored.length && scan.kind !== 'finished') return null;

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-1.5 text-[11px] text-[#92400E]">
      <span className="min-w-0">
        {scan.kind === 'finished' ? (
          scan.saved === scan.total ? (
            <>Risk scores saved for all {scan.total} invoices.</>
          ) : (
            <>
              Risk scores saved for {scan.saved} of {scan.total} invoices.
              {scan.unreadable > 0 && ` ${scan.unreadable} could not be read with your current session.`}
              {scan.failed > 0 && ` ${scan.failed} could not be saved${scan.lastError ? ` (${scan.lastError})` : ''}.`}
            </>
          )
        ) : (
          <>
            <span className="font-medium">{unscored.length}</span> invoice{unscored.length === 1 ? ' has' : 's have'} no saved risk score.
            They are shown as not scored, not as low risk.
          </>
        )}
      </span>
      {unscored.length > 0 && (
        <button
          type="button"
          onClick={() => void run()}
          disabled={scan.kind === 'running'}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#FCD34D] bg-white px-2 py-0.5 font-medium text-[#92400E] hover:bg-[#FEF3C7] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B]/40"
        >
          <RefreshCw className={`h-3 w-3 ${scan.kind === 'running' ? 'animate-spin' : ''}`} aria-hidden />
          {scan.kind === 'running' ? `Scanning ${scan.done}/${scan.total}…` : scan.kind === 'finished' ? 'Retry risk scan' : 'Run risk scan'}
        </button>
      )}
    </div>
  );
}

export function PipelinePanel({ ctx, invoices, className = '' }: { ctx: DashboardCtx; invoices: Invoice[]; className?: string }) {
  const stages = useMemo(() => pipelineStages(invoices), [invoices]);
  const bottleneck = useMemo(() => pipelineBottleneck(stages), [stages]);
  return (
    <Panel
      title="Processing Pipeline"
      subtitle={`Invoices that completed each step · ${ctx.range.label} · select a step to see its invoices`}
      scope="period"
      className={className}
    >
      {invoices.length === 0 ? (
        <EmptyState>No invoices in the selected period.</EmptyState>
      ) : (
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {stages.map((s, i) => {
            const isBottleneck = bottleneck?.key === s.key;
            const open = s.pending + s.issue;
            const color = s.rate === 1 ? COLORS.teal : isBottleneck ? COLORS.amber : COLORS.primary;
            const pctLabel = s.rate == null ? 'n/a' : `${Math.round(s.rate * 100)}%`;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => ctx.showStage(s.key, open > 0 ? 'open' : 'done')}
                  title={s.definition}
                  className={`block h-full w-full rounded-lg border px-2.5 py-2 text-left transition-colors hover:border-[#246BFD]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40 ${
                    isBottleneck ? 'border-[#FCD34D] bg-[#FFFBEB]/60' : 'border-[#E3E8EF] bg-white'
                  }`}
                  aria-label={`${s.label}: ${s.done} of ${s.applicable} applicable invoices done, ${s.pending} pending, ${s.issue} need attention${s.na ? `, ${s.na} not applicable` : ''}${isBottleneck ? ', bottleneck' : ''}`}
                >
                  <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-slate-500">
                    <span
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                      style={{ background: color }}
                      aria-hidden
                    >
                      {i + 1}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </div>
                  <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">
                    {s.done}
                    {s.key !== 'uploaded' && <span className="text-[11px] font-normal text-slate-400"> / {s.applicable}</span>}
                  </p>
                  <div className="mt-1 h-1 rounded-full bg-slate-100" aria-hidden>
                    <div className="h-1 rounded-full" style={{ width: `${Math.round((s.rate ?? 0) * 100)}%`, background: color }} />
                  </div>
                  <p className="mt-1 text-[10.5px] tabular-nums text-slate-500">{pctLabel}</p>
                  {(s.pending > 0 || s.issue > 0 || s.na > 0) && (
                    <ul className="mt-0.5 space-y-px text-[10px] leading-tight">
                      {s.pending > 0 && <li className="text-slate-500">{s.pending} {s.pendingLabel}</li>}
                      {s.issue > 0 && <li className="text-[#B45309]">{s.issue} {s.issueLabel}</li>}
                      {s.na > 0 && <li className="text-slate-400">{s.na} {s.naLabel}</li>}
                    </ul>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {bottleneck && (
        <p className="mt-2 text-[11px] text-[#92400E]">
          Bottleneck: <span className="font-medium">{bottleneck.label}</span> — {bottleneck.pending + bottleneck.issue} of{' '}
          {bottleneck.applicable} invoice{bottleneck.applicable === 1 ? '' : 's'} not through this step
          {bottleneck.issue > 0 ? ` (${bottleneck.issue} ${bottleneck.issueLabel})` : ''}.{' '}
          <button
            type="button"
            onClick={() => ctx.showStage(bottleneck.key, 'open')}
            className="font-medium text-[#246BFD] hover:underline focus:outline-none focus-visible:underline"
          >
            View invoices
          </button>
        </p>
      )}
      {invoices.length > 0 && <RiskScanNote ctx={ctx} invoices={invoices} />}
      {invoices.length > 0 && (
        <p className="mt-2 text-[10.5px] text-slate-400">
          Steps are checked independently — an invoice can be GL-coded before it is approved — so each rate is done ÷ invoices the step
          applies to.
        </p>
      )}
    </Panel>
  );
}

// ── Multi-agent AI live activity ─────────────────────────────────────────────

function agentBadge(action: string): { tone: Tone; label: string } {
  const a = (action || '').toLowerCase();
  if (a.includes('classification') || a.includes('ifrs')) return { tone: 'purple', label: 'Classification' };
  if (a.includes('risk')) return { tone: 'amber', label: 'Risk' };
  if (a.includes('match')) return { tone: 'teal', label: 'Matching' };
  if (a.includes('approv')) return { tone: 'primary', label: 'Approval' };
  return { tone: 'slate', label: 'Activity' };
}

const ACTIVITY_INVOICE_SAMPLE = 100;
const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

type ActivityState =
  | { kind: 'loading' }
  | { kind: 'ready'; logs: AuditLog[] }
  | { kind: 'restricted' }
  | { kind: 'error' };

export function ActivityPanel({ ctx, className = '' }: { ctx: DashboardCtx; className?: string }) {
  const [state, setState] = useState<ActivityState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const byId = useMemo(() => new Map(ctx.all.map((i) => [i.id, i])), [ctx.all]);
  const sampleIds = useMemo(
    () =>
      [...ctx.all]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, ACTIVITY_INVOICE_SAMPLE)
        .map((i) => i.id),
    [ctx.all],
  );

  useEffect(() => {
    if (!sampleIds.length || !ctx.companyId) {
      setState({ kind: 'ready', logs: [] });
      return;
    }
    let alive = true;
    setState({ kind: 'loading' });
    void (async () => {
      const [logsRes, visibleRes] = await Promise.all([
        supabase
          .from('audit_logs')
          .select('*')
          .in('invoice_id', sampleIds)
          .order('created_at', { ascending: false })
          .limit(6),
        // Row-level security returns an empty list (not an error) when this session cannot read the
        // organization's records, so check visibility before reporting "no activity".
        supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('company_id', ctx.companyId!),
      ]);
      if (!alive) return;
      if (logsRes.error) {
        console.error('[AP Dashboard] audit_logs query failed:', logsRes.error);
        setState({ kind: 'error' });
        return;
      }
      const logs = (logsRes.data || []) as AuditLog[];
      if (!logs.length && !visibleRes.error && (visibleRes.count ?? 0) === 0) {
        setState({ kind: 'restricted' });
        return;
      }
      setState({ kind: 'ready', logs });
    })();
    return () => {
      alive = false;
    };
  }, [sampleIds, ctx.companyId, attempt]);

  const logs = state.kind === 'ready' ? state.logs : [];
  const lastAt = logs[0]?.created_at ? new Date(logs[0].created_at) : null;
  const live = !!lastAt && Date.now() - lastAt.getTime() < LIVE_WINDOW_MS;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <span className="relative flex h-2 w-2" aria-hidden>
            {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00A884] opacity-60" />}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? 'bg-[#00A884]' : 'bg-slate-300'}`} />
          </span>
          Multi-Agent AI — Live Activity
        </span>
      }
      subtitle={
        state.kind === 'ready'
          ? lastAt
            ? `Last event ${formatDistanceToNow(lastAt, { addSuffix: true })}`
            : 'No events recorded yet'
          : undefined
      }
      scope="current"
      className={className}
      action={<Link to="/ap-invoices/audit-log" className="text-[12px] font-medium text-[#246BFD] hover:underline">Audit log</Link>}
    >
      {state.kind === 'loading' ? (
        <div className="space-y-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      ) : state.kind === 'error' ? (
        <EmptyState
          action={
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="text-[12px] font-medium text-[#246BFD] hover:underline">
              Try again
            </button>
          }
        >
          The activity log could not be loaded.
        </EmptyState>
      ) : state.kind === 'restricted' ? (
        <EmptyState>
          Activity can’t be shown: this session doesn’t have direct read access to the organization’s records. Sign out and back
          in, or open the audit log.
        </EmptyState>
      ) : logs.length === 0 ? (
        <EmptyState>
          No AI or workflow events have been recorded for this organization’s latest invoices. Events appear here when invoices
          are classified, risk-scored, matched or approved.
        </EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {logs.map((log) => {
            const b = agentBadge(log.action);
            const inv = byId.get(log.invoice_id);
            return (
              <li key={log.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Pill tone={b.tone}>{b.label}</Pill>
                  <button
                    type="button"
                    className="min-w-0 truncate text-left text-[12px] text-slate-700 hover:text-[#246BFD] focus:outline-none focus-visible:underline"
                    onClick={() => inv && ctx.openInvoice(inv)}
                    title={log.action}
                  >
                    {log.action}
                    {inv ? <span className="text-slate-400"> · {inv.invoice_number}</span> : null}
                  </button>
                </div>
                <time className="shrink-0 text-[11px] text-slate-400" dateTime={log.created_at}>
                  {format(new Date(log.created_at), 'MMM d, HH:mm')}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ── Key exceptions & actions ─────────────────────────────────────────────────

const REASON_TAB: Partial<Record<ExceptionReason, TabId>> = {
  unclassified: 'compliance',
  extraction_review: 'processing',
  high_risk: 'approvals',
  missing_gl: 'gl',
  vat_mismatch: 'compliance',
};

export function ExceptionsPanel({ ctx, className = '' }: { ctx: DashboardCtx; className?: string }) {
  const items = useMemo(() => {
    const checks = complianceChecks(ctx.all).checks;
    const aging = computeAging(ctx.all, ctx.today);
    const list: { key: string; label: string; count: number; tone: Tone; tab?: TabId; route?: string }[] = [
      { key: 'pending', label: 'Awaiting approval', count: ctx.kpis.pendingApprovals, tone: 'amber', tab: 'approvals' },
      { key: 'overdue', label: 'Overdue for payment', count: aging.overdueCount, tone: 'red', tab: 'payments' },
      ...checks.map((c) => ({
        key: c.key,
        label: c.label,
        count: c.count,
        tone: (c.key === 'high_risk' || c.key === 'duplicate' ? 'red' : c.key === 'unclassified' || c.key === 'vat_mismatch' ? 'purple' : 'amber') as Tone,
        tab: REASON_TAB[c.key],
        route: c.route,
      })),
    ];
    return list.filter((i) => i.count > 0);
  }, [ctx.all, ctx.today, ctx.kpis.pendingApprovals]);

  return (
    <Panel title="Key Exceptions & Actions" scope="current" className={className}>
      {items.length === 0 ? (
        <EmptyState>
          <span className="flex items-center gap-1.5 text-[#047857]">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> No open exceptions
          </span>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.key} className="flex items-center justify-between gap-3 py-1.5">
              <span className="flex min-w-0 items-center gap-2 text-[12px] text-slate-700">
                <Pill tone={i.tone}>{i.count}</Pill>
                <span className="truncate">{i.label}</span>
              </span>
              {i.tab ? (
                <button
                  type="button"
                  onClick={() => ctx.goTab(i.tab!)}
                  className="shrink-0 rounded text-[12px] font-medium text-[#246BFD] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40"
                >
                  Review
                </button>
              ) : (
                <Link to={i.route ?? '/ap-invoices/list'} className="shrink-0 text-[12px] font-medium text-[#246BFD] hover:underline">
                  Resolve
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Insights & recommendations ───────────────────────────────────────────────

type InsightGroup = 'compliance' | 'performance' | 'actionable';

const INSIGHT_GROUPS: { id: InsightGroup; label: string; match: (c: InsightCard) => boolean }[] = [
  { id: 'compliance', label: 'Compliance', match: (c) => c.icon === 'recon' || c.icon === 'alert' },
  { id: 'performance', label: 'AP Performance', match: (c) => c.icon === 'aging' || c.icon === 'vendor' },
  { id: 'actionable', label: 'Actionable', match: (c) => c.priority === 'HIGH' || c.priority === 'MEDIUM' },
];

const PRIORITY_TONE: Record<InsightCard['priority'], Tone> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'primary', INFO: 'slate' };

export function InsightsPanel({ ctx, className = '' }: { ctx: DashboardCtx; className?: string }) {
  const [group, setGroup] = useState<InsightGroup>('actionable');
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [summary, setSummary] = useState<APSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const data = await generateAPInsights(ctx.workspaceId, ctx.companyId);
      setInsights(data.insights ?? []);
      setSummary(data.summary ?? null);
      setMessage(data.message ?? '');
      setState(data.empty ? 'empty' : 'ready');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '');
      setState('error');
    }
  }, [ctx.workspaceId, ctx.companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = insights.filter(INSIGHT_GROUPS.find((g) => g.id === group)!.match).slice(0, 4);

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-[#C9A227]" aria-hidden />
          Insights & Recommendations
        </span>
      }
      subtitle="AI-generated from this organization's AP data"
      className={className}
      action={
        <button
          type="button"
          onClick={() => void load()}
          disabled={state === 'loading'}
          className="inline-flex items-center gap-1 rounded-md border border-[#E3E8EF] px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${state === 'loading' ? 'animate-spin' : ''}`} aria-hidden /> Refresh
        </button>
      }
    >
      <div role="tablist" aria-label="Insight categories" className="mb-3 inline-flex rounded-lg bg-slate-100 p-0.5">
        {INSIGHT_GROUPS.map((g) => {
          const count = insights.filter(g.match).length;
          const active = g.id === group;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setGroup(g.id)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40 ${
                active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {g.label}
              {state === 'ready' && <span className="ml-1 text-slate-400">{count}</span>}
            </button>
          );
        })}
      </div>

      {summary && state === 'ready' && (
        <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
          <Pill>Billed {ctx.fmtCompact(summary.total_billed)}</Pill>
          <Pill tone="teal">Paid {summary.payment_rate_pct.toFixed(0)}%</Pill>
          <Pill tone="primary">Open {ctx.fmtCompact(summary.open_balance)}</Pill>
          <Pill tone={summary.overdue_amount > 0 ? 'amber' : 'slate'}>Overdue {ctx.fmtCompact(summary.overdue_amount)}</Pill>
          <Pill tone="gold">DPO {summary.dpo.toFixed(0)}d</Pill>
        </div>
      )}

      {state === 'loading' && (
        <div className="grid gap-2 sm:grid-cols-2" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      )}
      {state === 'error' && (
        <EmptyState
          action={
            <button type="button" onClick={() => void load()} className="text-[12px] font-medium text-[#246BFD] hover:underline">
              Try again
            </button>
          }
        >
          Insights could not be generated right now.{message.includes('503') ? ' The AI service is not configured.' : ''}
        </EmptyState>
      )}
      {state === 'empty' && <EmptyState>{message || 'Upload invoices to see AP insights.'}</EmptyState>}
      {state === 'ready' &&
        (visible.length === 0 ? (
          <EmptyState>No {INSIGHT_GROUPS.find((g) => g.id === group)!.label.toLowerCase()} insights right now.</EmptyState>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {visible.map((card) => (
              <article key={card.id} className="rounded-lg border border-[#E3E8EF] bg-white p-3">
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <p className="text-[12.5px] font-medium leading-snug text-slate-900">{card.title}</p>
                  <Pill tone={PRIORITY_TONE[card.priority]}>{card.priority.toLowerCase()}</Pill>
                </div>
                <ul className="space-y-0.5 text-[11.5px] leading-relaxed text-slate-600">
                  {card.actions.slice(0, 3).map((a, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-slate-300" aria-hidden>
                        •
                      </span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ))}
    </Panel>
  );
}

// ── Data consistency ─────────────────────────────────────────────────────────

export function ConsistencyPanel({ ctx, className = '' }: { ctx: DashboardCtx; className?: string }) {
  const [open, setOpen] = useState(false);
  const checks = useMemo(
    () =>
      consistencyChecks({
        all: ctx.all,
        period: ctx.period,
        kpis: ctx.kpis,
        monthKeys: ctx.monthKeys,
        today: ctx.today,
        baseCurrency: ctx.baseCurrency,
      }),
    [ctx.all, ctx.period, ctx.kpis, ctx.monthKeys, ctx.today, ctx.baseCurrency],
  );
  const failing = checks.filter((c) => !c.ok).length;
  return (
    <section className={`rounded-xl border border-[#E3E8EF] bg-white ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40 rounded-xl"
      >
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-800">
          Data consistency checks
          {failing === 0 ? <Pill tone="teal">All {checks.length} passed</Pill> : <Pill tone="amber">{failing} to review</Pill>}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 px-4">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 py-2 text-[12px]">
              <span className="flex items-start gap-2 text-slate-700">
                {c.ok ? (
                  <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-[#00A884]" aria-label="Passed" />
                ) : (
                  <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-[#D97706]" aria-label="Needs review" />
                )}
                {c.label}
              </span>
              <span className="shrink-0 text-right text-[11px] text-slate-500">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
