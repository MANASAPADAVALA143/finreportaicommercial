import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FileSpreadsheet, FileText, Lock, XCircle } from 'lucide-react';
import {
  aiCloseApi, refLabel, type CloseRun, type CloseTask, type Deliverable, type JournalProposal, type Kpi, type ProposalStatus,
} from '../../services/aiClose.service';
import { errorText } from '../internal-audit/shared';
import { Card, GOLD, NAVY, SeverityBadge, StatusPill, money } from './parts';

export function fmtTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtDuration(ms: number | null) {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {kpis.map((k) => (
        <div key={k.key} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" title={k.definition}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k.label}</p>
          {k.available ? (
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {k.value!.toLocaleString()}{k.unit === '%' ? '%' : ''}
            </p>
          ) : (
            <p className="mt-1 text-sm font-medium text-slate-400">Not run</p>
          )}
          <p className="mt-1 text-[11px] leading-snug text-slate-500">{k.definition}</p>
        </div>
      ))}
    </div>
  );
}

/** NEXUS → dependency waves, laid out from the stored task records; bars use actual start/finish times. */
export function ExecutionSequence({ run }: { run: CloseRun }) {
  const waves = [...new Set(run.tasks.map((t) => t.wave))].sort((a, b) => a - b);
  const starts = run.tasks.map((t) => (t.started_at ? Date.parse(t.started_at) : NaN)).filter((n) => !Number.isNaN(n));
  const ends = run.tasks.map((t) => (t.finished_at ? Date.parse(t.finished_at) : NaN)).filter((n) => !Number.isNaN(n));
  const t0 = starts.length ? Math.min(...starts) : 0;
  const span = Math.max((ends.length ? Math.max(...ends) : t0) - t0, 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-stretch gap-2 text-xs">
        <div className="flex items-center rounded-lg px-3 py-2 font-semibold text-white" style={{ background: NAVY }}>
          NEXUS · run #{run.id}
        </div>
        {waves.map((w, step) => (
          <div key={w} className="flex items-stretch gap-2">
            <ChevronRight className="h-4 w-4 self-center text-slate-400" />
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <p className="mb-1 text-[10px] font-semibold uppercase text-slate-500">Step {step + 1}{run.tasks.filter((t) => t.wave === w).length > 1 ? ' · parallel' : ''}</p>
              <div className="flex flex-col gap-1">
                {run.tasks.filter((t) => t.wave === w).map((t) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{t.agent_name}</span>
                    <StatusPill value={t.status} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      {starts.length > 0 && (
        <div className="space-y-1.5">
          {run.tasks.map((t) => {
            const s = t.started_at ? Date.parse(t.started_at) : null;
            const e = t.finished_at ? Date.parse(t.finished_at) : null;
            const left = s == null ? 0 : ((s - t0) / span) * 100;
            const width = s == null ? 0 : Math.max((((e ?? s) - s) / span) * 100, 1.5);
            return (
              <div key={t.id} className="flex items-center gap-3 text-xs">
                <span className="w-44 shrink-0 truncate text-slate-700">{t.agent_name}</span>
                <div className="relative h-4 flex-1 rounded bg-slate-100">
                  {s != null && (
                    <div
                      className={`absolute h-4 rounded ${t.status === 'failed' ? 'bg-red-400' : t.status === 'running' ? 'animate-pulse bg-blue-400' : ''}`}
                      style={{ left: `${left}%`, width: `${width}%`, background: t.status === 'failed' || t.status === 'running' ? undefined : GOLD }}
                    />
                  )}
                </div>
                <span className="w-40 shrink-0 text-right text-slate-500">{t.started_at ? `${new Date(t.started_at).toLocaleTimeString()} · ${fmtDuration(t.duration_ms)}` : 'not started'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AgentCard({ task, companyId, runId }: { task: CloseTask; companyId: string; runId: number }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<CloseTask | null>(null);
  const failedChecks = (task.validation_json ?? []).filter((c) => !c.passed);

  const toggle = async () => {
    setOpen((v) => !v);
    if (!detail) setDetail(await aiCloseApi.task(companyId, runId, task.agent).catch(() => null));
  };
  const output = detail?.output_json ?? {};
  const scalars = Object.entries(output).filter(([, v]) => typeof v === 'number' || typeof v === 'string');
  const limitations = Array.isArray(output.limitations) ? (output.limitations as string[]) : [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{task.agent_name}</p>
        <StatusPill value={task.status} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-slate-500">Records</dt><dd className="font-semibold text-slate-900">{task.records_processed ?? '—'}</dd></div>
        <div><dt className="text-slate-500">Exceptions</dt><dd className="font-semibold text-slate-900">{task.exceptions_count ?? '—'}</dd></div>
        <div><dt className="text-slate-500">Duration</dt><dd className="font-semibold text-slate-900">{fmtDuration(task.duration_ms)}</dd></div>
      </dl>
      <p className="mt-2 text-[11px] text-slate-500">
        Finished {fmtTime(task.finished_at)}{task.attempts > 1 ? ` · ${task.attempts} attempts` : ''}
      </p>
      {task.error && <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">{task.error}</p>}
      {(task.messages_json ?? []).map((m, i) => <p key={i} className="mt-1 text-xs text-slate-600">{m}</p>)}
      {task.validation_json && (
        <p className={`mt-2 flex items-center gap-1 text-xs ${failedChecks.length ? 'text-amber-800' : 'text-green-700'}`}>
          {failedChecks.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {task.validation_json.length - failedChecks.length}/{task.validation_json.length} output checks passed
        </p>
      )}
      <button onClick={() => void toggle()} className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Output and checks
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          <ul className="space-y-0.5">
            {(task.validation_json ?? []).map((c) => (
              <li key={c.name} className={c.passed ? 'text-slate-600' : 'text-red-700'}>
                {c.passed ? '✓' : '✗'} {c.detail}{c.blocking ? ' (blocking)' : ''}
              </li>
            ))}
          </ul>
          {scalars.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded border border-slate-100 bg-slate-50 p-2">
              {scalars.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="truncate text-slate-500">{k.replace(/_/g, ' ')}</dt>
                  <dd className="text-right font-mono text-slate-800">{typeof v === 'number' ? v.toLocaleString() : String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {limitations.length > 0 && <ul className="ml-4 list-disc text-amber-800">{limitations.map((l) => <li key={l}>{l}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

export function Deliverables({ run, companyId, onError }: { run: CloseRun; companyId: string; onError: (m: string) => void }) {
  const [busy, setBusy] = useState('');
  const approval = run.status === 'closed'
    ? `Approved by ${run.close_approved_by} on ${fmtTime(run.close_approved_at)}`
    : 'Draft · awaiting close approval';

  const get = async (d: Deliverable, fmt: 'xlsx' | 'pdf') => {
    setBusy(`${d.key}.${fmt}`);
    try {
      await aiCloseApi.download(companyId, run, d.key, fmt);
    } catch (e) {
      onError(errorText(e, 'Download failed'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="divide-y divide-slate-100">
      {run.deliverables.map((d) => (
        <div key={d.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <p className="text-sm font-medium text-slate-900">{d.title}</p>
            <p className="text-xs text-slate-500">
              {d.agent_name} · executed {fmtTime(d.executed_at)} · {d.status === 'ready' ? approval : 'not available'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {d.status !== 'ready' && <StatusPill value={d.status} />}
            {(['xlsx', 'pdf'] as const).map((fmt) => (
              <button
                key={fmt}
                disabled={d.status !== 'ready' || busy !== ''}
                onClick={() => void get(d, fmt)}
                className="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                {fmt === 'xlsx' ? <FileSpreadsheet className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                {busy === `${d.key}.${fmt}` ? '…' : fmt === 'xlsx' ? 'Excel' : 'PDF'}
                <Download className="h-3 w-3" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ExceptionsTable({ run, currency }: { run: CloseRun; currency: string }) {
  const [agent, setAgent] = useState('');
  const agents = [...new Set(run.exceptions.map((e) => e.agent))];
  const rows = run.exceptions.filter((e) => !agent || e.agent === agent);
  const names = Object.fromEntries(run.tasks.map((t) => [t.agent, t.agent_name]));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
        <span>{run.exceptions_total} unique exception(s){run.exceptions_total > run.exceptions.length ? `, showing first ${run.exceptions.length}` : ''}</span>
        <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Filter by agent" className="rounded border border-slate-300 px-2 py-1">
          <option value="">All agents</option>
          {agents.map((a) => <option key={a} value={a}>{names[a] ?? a}</option>)}
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No exceptions.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-slate-500">
              <tr><th className="py-1.5 pr-2">Severity</th><th className="pr-2">Exception</th><th className="pr-2">Agent</th><th className="pr-2 text-right">Amount</th><th>Source</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="py-1.5 pr-2"><SeverityBadge severity={e.severity} /></td>
                  <td className="pr-2"><p className="font-medium text-slate-800">{e.title}</p>{e.detail && <p className="text-slate-500">{e.detail}</p>}</td>
                  <td className="pr-2 text-slate-600">{names[e.agent] ?? e.agent}</td>
                  <td className="pr-2 text-right font-mono">{e.amount != null ? money(e.amount, currency) : '—'}</td>
                  <td className="text-[11px] text-slate-500">{(e.source_refs ?? []).map(refLabel).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function JournalApprovalCentre({
  proposals, companyId, currency, onChange, onError,
}: { proposals: JournalProposal[]; companyId: string; currency: string; onChange: () => void; onError: (m: string) => void }) {
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const pending = proposals.filter((p) => p.status === 'pending_approval');
  const decided = proposals.filter((p) => p.status !== 'pending_approval');

  const decide = async (p: JournalProposal, decision: Exclude<ProposalStatus, 'pending_approval'>) => {
    setBusy(p.id);
    try {
      await aiCloseApi.decide(companyId, p.id, decision, notes[p.id]);
      onChange();
    } catch (e) {
      onError(errorText(e, 'Decision failed'));
    } finally {
      setBusy(null);
    }
  };

  if (!proposals.length) return <p className="text-sm text-slate-500">No journals were proposed in this run.</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Agents prepare journals only. Nothing is posted to the ledger until a finance manager approves it here.</p>
      {pending.map((p) => (
        <div key={p.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">{p.title}</p>
              <p className="text-xs text-slate-600">{p.rationale}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {p.entry_number} · {p.entry_date} · prepared by {p.agent_name} · source: {(p.source_refs ?? []).map(refLabel).join(', ')}
              </p>
            </div>
            <StatusPill value={p.status} />
          </div>
          <JournalLines p={p} currency={currency} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={notes[p.id] ?? ''}
              onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
              placeholder="Note (required to request changes)"
              aria-label="Decision note"
              className="min-w-[16rem] flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
            <button disabled={busy != null} onClick={() => void decide(p, 'approved')} className="flex items-center gap-1 rounded-md bg-green-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
              <CheckCircle2 className="h-3.5 w-3.5" /> Approve and post
            </button>
            <button disabled={busy != null} onClick={() => void decide(p, 'changes_requested')} className="rounded-md border border-amber-400 px-3 py-1 text-xs font-semibold text-amber-800 disabled:opacity-50">
              Request changes
            </button>
            <button disabled={busy != null} onClick={() => void decide(p, 'rejected')} className="flex items-center gap-1 rounded-md border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50">
              <XCircle className="h-3.5 w-3.5" /> Reject
            </button>
          </div>
        </div>
      ))}
      {decided.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500"><tr><th className="py-1">Journal</th><th>Decision</th><th>By</th><th>Note</th><th className="text-right">Amount</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {decided.map((p) => (
              <tr key={p.id}>
                <td className="py-1.5 pr-2">{p.entry_number} · {p.title}</td>
                <td className="pr-2"><StatusPill value={p.status} /> <span className="text-slate-500">ledger: {p.journal_status}</span></td>
                <td className="pr-2 text-slate-600">{p.decided_by} · {fmtTime(p.decided_at)}</td>
                <td className="pr-2 text-slate-600">{p.decision_note ?? '—'}</td>
                <td className="text-right font-mono">{money(p.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function JournalLines({ p, currency }: { p: JournalProposal; currency: string }) {
  return (
    <table className="mt-2 w-full text-left text-xs">
      <thead className="text-slate-500"><tr><th className="py-1">Account</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {p.lines.map((l, i) => (
          <tr key={i}>
            <td className="py-1 pr-2 font-mono">{l.account_code} {l.account_name}</td>
            <td className="pr-2 text-slate-600">{l.description}</td>
            <td className="text-right font-mono">{l.debit ? money(l.debit, currency) : ''}</td>
            <td className="text-right font-mono">{l.credit ? money(l.credit, currency) : ''}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td className="py-1" colSpan={2}>Total</td>
          <td className="text-right font-mono">{money(p.total_debit, currency)}</td>
          <td className="text-right font-mono">{money(p.total_credit, currency)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function CloseApproval({ run, companyId, onChange, onError }: { run: CloseRun; companyId: string; onChange: () => void; onError: (m: string) => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const items = run.checklist?.items ?? [];
  const pending = run.proposals.filter((p) => p.status === 'pending_approval').length;

  const approve = async () => {
    if (!window.confirm(`Approve the ${run.period} close and lock the period? No further journals can be posted to it.`)) return;
    setBusy(true);
    try {
      await aiCloseApi.approveClose(companyId, run.id, note);
      onChange();
    } catch (e) {
      onError(errorText(e, 'Close approval failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Close checklist and approval">
      {run.checklist && (
        <p className="mb-2 text-xs text-slate-500">
          {run.checklist.done}/{run.checklist.applicable} items done · {run.checklist.definition}
        </p>
      )}
      <ul className="mb-4 space-y-1.5 text-sm">
        {items.map((i) => (
          <li key={i.key} className="flex items-start justify-between gap-3">
            <span><span className="font-medium text-slate-800">{i.label}</span><span className="block text-xs text-slate-500">{i.evidence}</span></span>
            <StatusPill value={i.status} />
          </li>
        ))}
      </ul>
      {run.status === 'closed' ? (
        <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Period {run.period} closed and locked by {run.close_approved_by} on {fmtTime(run.close_approved_at)}.{run.close_note ? ` Note: ${run.close_note}` : ''}</span>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Approval note (required while checklist items are open, e.g. agents not run this month)"
            aria-label="Close approval note"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            disabled={busy || run.status !== 'awaiting_approval' || pending > 0}
            onClick={() => void approve()}
            className="flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold text-slate-900 disabled:opacity-50"
            style={{ background: GOLD }}
          >
            <Lock className="h-4 w-4" /> {busy ? 'Locking…' : 'Approve close and lock period'}
          </button>
          <p className="text-xs text-slate-500">
            {pending > 0
              ? `Decide the ${pending} proposed journal(s) first.`
              : run.status === 'failed'
                ? 'An agent failed; re-run the close before approving.'
                : 'Only finance managers and owners can approve. Locking blocks any further posting to the period.'}
          </p>
        </div>
      )}
    </Card>
  );
}
