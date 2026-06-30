import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  Building2,
  RefreshCw,
  Clock,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  generateAPInsights,
  type APSummary,
  type InsightCard,
} from '@/services/apInsights.service';

const PRIORITY_BORDER: Record<string, string> = {
  HIGH: '#EF4444',
  MEDIUM: '#F59E0B',
  LOW: '#3B82F6',
  INFO: '#6B7280',
};

function InsightIcon({ icon }: { icon: InsightCard['icon'] }) {
  const cls = 'h-4 w-4 shrink-0 text-slate-400';
  switch (icon) {
    case 'vendor':
      return <Building2 className={cls} />;
    case 'recon':
      return <RefreshCw className={cls} />;
    case 'aging':
      return <Clock className={cls} />;
    default:
      return <AlertTriangle className={cls} />;
  }
}

function formatAed(n: number) {
  return `AED ${n.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
}

function highlightAed(text: string) {
  const parts = text.split(/(AED\s?[\d,]+(?:\.\d+)?)/gi);
  return parts.map((part, i) =>
    /^AED/i.test(part) ? (
      <span key={i} className="font-medium text-slate-100">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function SummaryPills({ summary }: { summary: APSummary }) {
  const pills = [
    { label: 'Total Billed', value: formatAed(summary.total_billed) },
    {
      label: 'Paid',
      value: `${formatAed(summary.total_paid)} (${summary.payment_rate_pct.toFixed(1)}%)`,
    },
    { label: 'Open', value: formatAed(summary.open_balance) },
    { label: 'Overdue', value: formatAed(summary.overdue_amount) },
    { label: 'DPO', value: `${summary.dpo.toFixed(1)} days` },
  ];
  return (
    <div className="flex flex-wrap gap-2 mb-5">
      {pills.map((p) => (
        <div
          key={p.label}
          className="rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs"
        >
          <span className="text-slate-400">{p.label}: </span>
          <span className="font-medium text-slate-100">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function SkeletonCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-36 animate-pulse rounded-lg border border-slate-700 bg-slate-800/60"
        />
      ))}
    </div>
  );
}

interface APInsightsPanelProps {
  workspaceId: string;
  companyId: string | null;
  /** Compact mode for modal embedding */
  embedded?: boolean;
}

export default function APInsightsPanel({
  workspaceId,
  companyId,
  embedded = false,
}: APInsightsPanelProps) {
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [summary, setSummary] = useState<APSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [emptyMessage, setEmptyMessage] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [animateIn, setAnimateIn] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAnimateIn(false);
    try {
      const data = await generateAPInsights(workspaceId, companyId);
      setInsights(data.insights ?? []);
      setSummary(data.summary ?? null);
      setEmpty(Boolean(data.empty));
      setEmptyMessage(data.message ?? '');
      setLastRefreshed(new Date());
      requestAnimationFrame(() => setAnimateIn(true));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load insights';
      setError(msg);
      setInsights([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshedLabel = lastRefreshed
    ? formatDistanceToNow(lastRefreshed, { addSuffix: true })
    : null;

  return (
    <section
      className={`${embedded ? '' : 'mt-8'} rounded-xl border border-slate-700/80 bg-slate-900/40 p-5`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold tracking-wide text-slate-200 uppercase">
            Insights &amp; Recommended Actions
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {refreshedLabel && !loading && (
            <span className="text-xs text-slate-500">
              {error ? null : `Updated ${refreshedLabel}`}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="border-slate-600 text-slate-200 hover:bg-slate-800"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Insights
          </Button>
        </div>
      </div>

      {loading && <SkeletonCards />}

      {!loading && error && (
        <div className="rounded-lg border border-red-800/60 bg-red-950/30 p-4 text-sm text-red-200">
          <p className="font-medium">Could not generate insights</p>
          <p className="mt-1 text-xs text-red-300/80">
            {error.includes('ANTHROPIC') || error.includes('503')
              ? 'Check ANTHROPIC_API_KEY in backend .env'
              : error}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 border-red-700 text-red-200"
            onClick={() => void load()}
          >
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && empty && (
        <div
          className="rounded-lg border border-slate-700 bg-slate-800/50 p-8 text-center text-sm text-slate-300"
          style={{ borderLeftWidth: 4, borderLeftColor: '#6B7280' }}
        >
          <p className="text-lg mb-2">📊</p>
          <p className="font-medium text-slate-100">
            {emptyMessage || 'Upload your first invoice to see AI-powered AP insights'}
          </p>
        </div>
      )}

      {!loading && !error && !empty && summary && (
        <>
          <SummaryPills summary={summary} />
          <div
            className={`grid gap-4 sm:grid-cols-2 transition-all duration-500 ${
              animateIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
            }`}
          >
            {insights.map((card) => (
              <div
                key={card.id}
                className="rounded-lg p-4"
                style={{
                  background: 'var(--color-background-secondary, rgba(15,23,42,0.6))',
                  border: '0.5px solid var(--color-border-tertiary, rgba(71,85,105,0.5))',
                  borderLeft: `4px solid ${PRIORITY_BORDER[card.priority] ?? PRIORITY_BORDER.INFO}`,
                  borderRadius: 8,
                }}
              >
                <div className="flex items-start gap-2 mb-3">
                  <InsightIcon icon={card.icon} />
                  <p className="text-sm font-medium text-slate-100 leading-snug">{card.title}</p>
                </div>
                <ul className="space-y-1.5 text-xs text-slate-400 leading-relaxed">
                  {card.actions.map((action, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-slate-500 shrink-0">•</span>
                      <span>{highlightAed(action)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
