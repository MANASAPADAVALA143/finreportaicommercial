import type React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Info } from 'lucide-react';

/** InvoiceFlow enterprise palette. Red is reserved for errors and critical items. */
export const COLORS = {
  navy: '#0B1D33',
  page: '#F3F6FA',
  border: '#E3E8EF',
  primary: '#246BFD',
  teal: '#00A884',
  gold: '#C9A227',
  amber: '#F59E0B',
  red: '#DC2626',
  purple: '#7C3AED',
  slate: '#64748B',
  ink: '#0F172A',
  grid: '#EEF2F7',
} as const;

export const SERIES = [COLORS.primary, COLORS.teal, COLORS.gold, COLORS.purple, '#0EA5E9', COLORS.slate];

export const STATUS_COLOR: Record<string, string> = {
  Processing: COLORS.amber,
  Approved: COLORS.teal,
  Paid: COLORS.primary,
  'On Hold': COLORS.gold,
  Queried: COLORS.purple,
  Rejected: COLORS.red,
};

export const STATUS_LABEL: Record<string, string> = {
  Processing: 'Pending approval',
};

export type Tone = 'primary' | 'teal' | 'gold' | 'amber' | 'red' | 'purple' | 'slate';

const TONE_TEXT: Record<Tone, string> = {
  primary: 'text-[#246BFD]',
  teal: 'text-[#00A884]',
  gold: 'text-[#9A7B14]',
  amber: 'text-[#B45309]',
  red: 'text-[#DC2626]',
  purple: 'text-[#7C3AED]',
  slate: 'text-slate-600',
};

const TONE_PILL: Record<Tone, string> = {
  primary: 'bg-[#246BFD]/10 text-[#1D4ED8] ring-[#246BFD]/20',
  teal: 'bg-[#00A884]/10 text-[#047857] ring-[#00A884]/25',
  gold: 'bg-[#C9A227]/12 text-[#8A6D0F] ring-[#C9A227]/30',
  amber: 'bg-[#FFFBEB] text-[#92400E] ring-[#FDE68A]',
  red: 'bg-[#FEF2F2] text-[#B91C1C] ring-[#FECACA]',
  purple: 'bg-[#7C3AED]/10 text-[#6D28D9] ring-[#7C3AED]/20',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
};

export const TONE_HEX: Record<Tone, string> = {
  primary: COLORS.primary,
  teal: COLORS.teal,
  gold: COLORS.gold,
  amber: COLORS.amber,
  red: COLORS.red,
  purple: COLORS.purple,
  slate: COLORS.slate,
};

export function toneText(t: Tone) {
  return TONE_TEXT[t];
}

export function Pill({ tone = 'slate', children, className = '' }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONE_PILL[tone]} ${className}`}>
      {children}
    </span>
  );
}

export type Scope = 'period' | 'current' | 'month' | 'all';

const SCOPE_TEXT: Record<Scope, string> = {
  period: 'Selected period',
  current: 'Current position',
  month: 'This month',
  all: 'All invoices',
};

export function ScopeTag({ scope }: { scope: Scope }) {
  return (
    <span
      className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-slate-500"
      title={scope === 'current' ? 'Live position — not filtered by the date range' : undefined}
    >
      {SCOPE_TEXT[scope]}
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  scope,
  action,
  accent,
  className = '',
  bodyClassName = '',
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  scope?: Scope;
  action?: React.ReactNode;
  accent?: Tone;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col rounded-xl border border-[#E3E8EF] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
      style={accent ? { borderTop: `3px solid ${TONE_HEX[accent]}` } : undefined}
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
            {scope && <ScopeTag scope={scope} />}
          </div>
          {subtitle && <p className="mt-0.5 text-[11.5px] text-slate-500">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className={`min-w-0 flex-1 px-4 pb-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function PanelLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded text-[12px] font-medium text-[#246BFD] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40"
    >
      {children}
      <ArrowRight className="h-3 w-3" aria-hidden />
    </Link>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'slate',
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone === 'slate' ? 'text-slate-900' : TONE_TEXT[tone]}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </>
  );
  const cls = 'rounded-lg border border-[#E3E8EF] bg-white px-3 py-2.5 text-left';
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${cls} transition-colors hover:border-[#246BFD]/40 hover:bg-[#246BFD]/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40`}
      >
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

export function BarRow({
  label,
  value,
  max,
  right,
  color = COLORS.primary,
  hint,
}: {
  label: React.ReactNode;
  value: number;
  max: number;
  right?: React.ReactNode;
  color?: string;
  hint?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div title={hint}>
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="min-w-0 truncate text-slate-700">{label}</span>
        <span className="shrink-0 tabular-nums text-slate-900">{right}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100" aria-hidden>
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-[12px] text-slate-500">
      <span>{children}</span>
      {action}
    </div>
  );
}

export function Note({ tone = 'slate', children }: { tone?: 'slate' | 'amber'; children: React.ReactNode }) {
  const cls =
    tone === 'amber'
      ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  const Icon = tone === 'amber' ? AlertTriangle : Info;
  return (
    <p className={`flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] ${cls}`}>
      <Icon className="mt-px h-3 w-3 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        {message}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-[#FCA5A5] bg-white px-3 py-1 text-xs font-medium text-[#B91C1C] hover:bg-[#FEE2E2]"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function SectionGrid({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={`grid gap-4 ${className}`}>{children}</div>;
}

export function pct(n: number, digits = 0) {
  return `${(n * 100).toFixed(digits)}%`;
}

export const chartAxis = { fontSize: 11, fill: COLORS.slate };

const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Axis ticks: compact number without currency (the panel subtitle names the currency). */
export function axisNumber(v: number) {
  return compactFormatter.format(v);
}
export const chartTooltipStyle = {
  contentStyle: { borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 12, boxShadow: '0 4px 12px rgba(15,23,42,0.08)' },
};
