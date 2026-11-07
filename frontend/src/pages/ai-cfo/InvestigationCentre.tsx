import { useCallback, useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { aiCfoApi, type Finding, type FindingStatus, type Investigation } from '../../services/aiCfo.service';
import { ErrorBanner, errorText } from '../internal-audit/shared';
import { Card, GOLD, InvestigationView, SeverityBadge, StatusPill, money, useInvestigation } from './parts';

const KIND_LABEL: Record<string, string> = {
  expense_spike: 'Expense spike',
  budget_overrun: 'Budget overrun',
  duplicate_entry: 'Possible duplicate',
};

type Props = { companyId: string; currency: string; onChange: () => void };

export function InvestigationCentre({ companyId, currency, onChange }: Props) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [selected, setSelected] = useState<(Finding & { investigations: Investigation[] }) | null>(null);
  const [activeRun, setActiveRun] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { inv, error: runError } = useInvestigation(companyId, activeRun);

  const load = useCallback(async () => {
    try {
      setFindings(await aiCfoApi.findings(companyId));
    } catch (e) {
      setError(errorText(e, 'Failed to load findings'));
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const open = async (f: Finding) => {
    setError('');
    try {
      const detail = await aiCfoApi.finding(companyId, f.id);
      setSelected(detail);
      setActiveRun(detail.investigations[0]?.id ?? null);
    } catch (e) {
      setError(errorText(e, 'Failed to load the finding'));
    }
  };

  useEffect(() => {
    if (inv && (inv.status === 'completed' || inv.status === 'failed')) {
      void load();
      onChange();
    }
  }, [inv?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const investigate = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const started = await aiCfoApi.investigate(companyId, { finding_id: selected.id });
      setActiveRun(started.id);
    } catch (e) {
      setError(errorText(e, 'Could not start the investigation'));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: FindingStatus) => {
    if (!selected) return;
    const note = status === 'dismissed' ? window.prompt('Why is this finding being dismissed?') ?? undefined : undefined;
    if (status === 'dismissed' && !note) return;
    try {
      const updated = await aiCfoApi.updateFinding(companyId, selected.id, status, note);
      setSelected({ ...selected, ...updated });
      await load();
      onChange();
    } catch (e) {
      setError(errorText(e, 'Update failed'));
    }
  };

  const visible = findings.filter((f) => showClosed || f.status === 'open' || f.status === 'investigated');
  const metrics = (selected?.metrics_json ?? {}) as Record<string, number | null>;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,2fr)_3fr]">
      <Card
        title={`Alerts (${visible.length})`}
        actions={
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show dismissed and resolved
          </label>
        }
      >
        <ErrorBanner message={error} />
        {visible.length === 0 ? (
          <p className="text-sm text-slate-500">No alerts. Run detection from the Overview tab.</p>
        ) : (
          <ul className="space-y-2">
            {visible.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => void open(f)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected?.id === f.id ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">{KIND_LABEL[f.kind] ?? f.kind} · {f.period}</span>
                    <SeverityBadge severity={f.severity} />
                  </div>
                  <p className="mt-0.5 text-sm font-medium text-slate-900">{f.title}</p>
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                    <span>{money(f.amount, currency)}</span>
                    <StatusPill value={f.status} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="space-y-4">
        {!selected ? (
          <Card><p className="text-sm text-slate-500">Select an alert to see the evidence and investigate it.</p></Card>
        ) : (
          <>
            <Card
              title={selected.title}
              actions={
                <div className="flex gap-2">
                  {selected.status !== 'resolved' && (
                    <button onClick={() => void setStatus('resolved')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">Mark resolved</button>
                  )}
                  {selected.status !== 'dismissed' && (
                    <button onClick={() => void setStatus('dismissed')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">Dismiss</button>
                  )}
                </div>
              }
            >
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <SeverityBadge severity={selected.severity} />
                <StatusPill value={selected.status} />
                <span className="text-slate-500">{selected.account_code} {selected.account_name} · {selected.period}</span>
              </div>
              <p className="text-sm text-slate-700">{selected.detection_reason}</p>
              {selected.status_note && <p className="mt-2 text-xs text-slate-500">Note: {selected.status_note}</p>}

              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {(['current', 'baseline_mean', 'increase', 'actual', 'budget', 'over', 'potential_overstatement'] as const)
                  .filter((k) => metrics[k] != null)
                  .map((k) => (
                    <div key={k} className="rounded-md bg-slate-50 px-2 py-1.5">
                      <dt className="text-slate-500">{k.replace(/_/g, ' ')}</dt>
                      <dd className="font-semibold text-slate-900">{money(metrics[k] as number, currency)}</dd>
                    </div>
                  ))}
              </dl>

              {(selected.evidence_refs?.length ?? 0) > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Supporting transactions</p>
                  <table className="w-full text-xs">
                    <thead className="text-left text-slate-500">
                      <tr><th className="py-1 pr-3">Ref</th><th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Description</th><th className="py-1 text-right">Amount</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selected.evidence_refs!.map((r) => (
                        <tr key={r.journal_entry_id + r.ref}>
                          <td className="py-1 pr-3 font-mono">{r.ref}</td>
                          <td className="py-1 pr-3">{r.date}</td>
                          <td className="py-1 pr-3">{r.description}</td>
                          <td className="py-1 text-right">{money(r.amount, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button
                onClick={() => void investigate()}
                disabled={busy || inv?.status === 'queued' || inv?.status === 'running'}
                className="mt-4 flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50"
                style={{ background: GOLD }}
              >
                <Bot className="h-4 w-4" /> {selected.investigations.length || inv ? 'Re-investigate with AI' : 'Investigate with AI'}
              </button>
            </Card>

            {(inv || runError) && (
              <Card title="AI investigation">
                <ErrorBanner message={runError} />
                {inv && <InvestigationView inv={inv} currency={currency} />}
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
