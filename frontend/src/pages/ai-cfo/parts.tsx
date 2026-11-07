import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import { APChatMarkdown } from '../../components/chat/APChatMarkdown';
import { aiCfoApi, type Investigation, type Severity } from '../../services/aiCfo.service';

export const NAVY = '#071226';
export const GOLD = '#C9A84C';

const SEVERITY_STYLE: Record<Severity, string> = {
  high: 'bg-red-100 text-red-700 border border-red-200',
  medium: 'bg-amber-100 text-amber-800 border border-amber-200',
  low: 'bg-slate-100 text-slate-700 border border-slate-200',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${SEVERITY_STYLE[severity]}`}>{severity}</span>;
}

export function StatusPill({ value }: { value: string }) {
  const tone =
    value === 'completed' || value === 'approved' || value === 'resolved' || value === 'closed' || value === 'done' || value === 'ready'
      ? 'bg-green-50 text-green-700 border-green-200'
      : value === 'failed' || value === 'rejected'
        ? 'bg-red-50 text-red-700 border-red-200'
        : value === 'running' || value === 'queued' || value === 'investigated'
          ? 'bg-blue-50 text-blue-700 border-blue-200'
          : value === 'completed_with_exceptions' || value === 'awaiting_approval' || value === 'pending_approval' || value === 'changes_requested' || value === 'open'
            ? 'bg-amber-50 text-amber-800 border-amber-200'
            : 'bg-slate-50 text-slate-700 border-slate-200';
  return <span className={`px-2 py-0.5 rounded border text-xs font-medium ${tone}`}>{value.replace(/_/g, ' ')}</span>;
}

export function money(value: number | null | undefined, currency = 'AED') {
  if (value == null) return '—';
  return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const POLL_MS = 2500;

/** Loads an investigation and keeps polling while the agent is still working. */
export function useInvestigation(companyId: string, id: number | null) {
  const [inv, setInv] = useState<Investigation | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let cancelled = false;
    setInv(null);
    setError('');
    if (id == null) return;
    const tick = async () => {
      try {
        const next = await aiCfoApi.investigation(companyId, id);
        if (cancelled) return;
        setInv(next);
        if (next.status === 'queued' || next.status === 'running') timer.current = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load investigation');
      }
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
    };
  }, [companyId, id]);

  return { inv, error };
}

export function InvestigationView({ inv, currency }: { inv: Investigation; currency: string }) {
  const [showSteps, setShowSteps] = useState(false);
  const result = inv.result_json;

  if (inv.status === 'queued' || inv.status === 'running') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800" aria-live="polite">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />
        Agent {inv.status === 'queued' ? 'queued' : 'investigating'}… {inv.steps} tool call{inv.steps === 1 ? '' : 's'} so far.
      </div>
    );
  }
  if (inv.status === 'failed') {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Investigation failed: {inv.error}</div>;
  }
  if (!result) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded border border-slate-200 px-2 py-0.5 text-slate-700">Confidence: {result.confidence}</span>
        {result.nature !== 'not_applicable' && (
          <span className="rounded border border-slate-200 px-2 py-0.5 text-slate-700">Nature: {result.nature.replace('_', ' ')}</span>
        )}
        <span className="text-slate-500">{inv.steps} tool calls · {inv.model}</span>
      </div>

      {(inv.unverified_refs?.length ?? 0) > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          These references were cited but not returned by any tool, so treat them as unverified: {inv.unverified_refs!.join(', ')}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <APChatMarkdown content={result.answer_markdown} />
      </div>

      {result.drivers.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Drivers and evidence</p>
          <ul className="space-y-1.5 text-sm">
            {result.drivers.map((d, i) => (
              <li key={i} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                <span className="font-medium text-slate-900">{d.account_code}</span>
                {d.amount != null && <span className="ml-2 text-slate-700">{money(d.amount, currency)}</span>}
                {d.explanation && <span className="ml-2 text-slate-600">— {d.explanation}</span>}
                {(d.refs?.length ?? 0) > 0 && (
                  <span className="mt-1 block font-mono text-[11px] text-slate-500">{d.refs!.join(' · ')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.limitations.length > 0 && (
        <div className="text-xs text-slate-600">
          <p className="font-semibold text-slate-700">Limitations</p>
          <ul className="ml-4 list-disc">{result.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}

      {(inv.approval_requests?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Prepared for approval (nothing has been executed)
          </p>
          <ul className="space-y-1 text-sm">
            {inv.approval_requests!.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                <span>{a.title}{a.amount != null ? ` · ${money(a.amount, currency)}` : ''}</span>
                <StatusPill value={a.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {(inv.tool_calls?.length ?? 0) > 0 && (
        <div>
          <button onClick={() => setShowSteps((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
            {showSteps ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Agent trail: {inv.tool_calls!.length} tool calls
          </button>
          {showSteps && (
            <ol className="mt-2 space-y-1 text-xs">
              {inv.tool_calls!.map((c) => (
                <li key={c.id} className={`rounded border px-2 py-1.5 ${c.is_error ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-slate-50'}`}>
                  <span className="font-mono font-semibold">{c.step}. {c.tool_name}</span>
                  <span className="ml-2 uppercase text-slate-500">{c.action_class}</span>
                  <span className="ml-2 text-slate-500">{JSON.stringify(c.input_json)}</span>
                  <span className="mt-0.5 block break-all text-slate-600">{c.output_summary}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
