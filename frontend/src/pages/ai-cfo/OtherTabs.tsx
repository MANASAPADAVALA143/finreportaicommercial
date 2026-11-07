import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { aiCfoApi, type ApprovalRequest, type Investigation, type ToolCall } from '../../services/aiCfo.service';
import { ErrorBanner, errorText } from '../internal-audit/shared';
import { Card, GOLD, InvestigationView, StatusPill, money, useInvestigation } from './parts';

const SUGGESTIONS = [
  'Which expense categories increased the most last month, and why?',
  'What is driving the change in operating costs versus the prior three months?',
  'Compare last month against budget and explain the largest variances.',
  'What are the top financial risks in the ledger this month?',
];

export function CopilotTab({ companyId, currency, aiConfigured }: { companyId: string; currency: string; aiConfigured: boolean }) {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<Investigation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const { inv, error: runError } = useInvestigation(companyId, activeId);

  const loadHistory = useCallback(async () => {
    try {
      setHistory((await aiCfoApi.investigations(companyId)).filter((i) => i.agent === 'cfo_analyst'));
    } catch (e) {
      setError(errorText(e, 'Failed to load questions'));
    }
  }, [companyId]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => {
    if (inv?.status === 'completed' || inv?.status === 'failed') void loadHistory();
  }, [inv?.status, loadHistory]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || sending) return;
    setSending(true);
    setError('');
    try {
      const started = await aiCfoApi.investigate(companyId, { question: q });
      setActiveId(started.id);
      setQuestion('');
      void loadHistory();
    } catch (e) {
      setError(errorText(e, 'Could not ask the copilot'));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(question);
    }
  };

  const running = inv?.status === 'queued' || inv?.status === 'running';

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_minmax(260px,1fr)]">
      <div className="space-y-4">
        <Card title="Ask the CFO Copilot">
          <p className="mb-3 text-xs text-slate-500">
            The copilot answers from this company&apos;s posted ledger and budget using the same audited tools as investigations.
          </p>
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={question}
              maxLength={2000}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!aiConfigured}
              placeholder="e.g. Why did operating expenses rise last month?"
              aria-label="Question for the CFO Copilot"
              className="flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button
              onClick={() => void ask(question)}
              disabled={sending || running || !question.trim() || !aiConfigured}
              aria-label="Ask"
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-900 disabled:opacity-50"
              style={{ background: GOLD }}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => void ask(s)} disabled={sending || running || !aiConfigured}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
          <div className="mt-3"><ErrorBanner message={error} /></div>
        </Card>
        {(inv || runError) && (
          <Card title={inv?.question ?? 'Answer'}>
            <ErrorBanner message={runError} />
            {inv && <InvestigationView inv={inv} currency={currency} />}
          </Card>
        )}
      </div>
      <Card title="Previous questions">
        {history.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : (
          <ul className="space-y-1">
            {history.map((h) => (
              <li key={h.id}>
                <button onClick={() => setActiveId(h.id)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${h.id === activeId ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                  <span className="line-clamp-2 text-slate-800">{h.question}</span>
                  <span className="mt-0.5 block"><StatusPill value={h.status} /></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function ApprovalsTab({ companyId, currency, onChange }: { companyId: string; currency: string; onChange: () => void }) {
  const [rows, setRows] = useState<ApprovalRequest[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await aiCfoApi.approvals(companyId, filter === 'pending' ? 'pending' : undefined));
    } catch (e) {
      setError(errorText(e, 'Failed to load approvals'));
    }
  }, [companyId, filter]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (a: ApprovalRequest, decision: 'approved' | 'rejected') => {
    setError('');
    try {
      await aiCfoApi.decide(companyId, a.id, decision, notes[a.id]);
      await load();
      onChange();
    } catch (e) {
      setError(errorText(e, 'Decision failed'));
    }
  };

  return (
    <Card
      title="Approval requests"
      actions={
        <select value={filter} onChange={(e) => setFilter(e.target.value as 'pending' | 'all')} aria-label="Filter approvals"
          className="rounded-md border border-slate-300 px-2 py-1 text-xs">
          <option value="pending">Pending</option>
          <option value="all">All</option>
        </select>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        Agents can only prepare requests. Approving records your decision in the audit log; it does not post, pay or change anything.
        Deciding requires the owner or finance manager role.
      </p>
      <ErrorBanner message={error} />
      {rows.length === 0 ? <p className="text-sm text-slate-500">No {filter === 'pending' ? 'pending ' : ''}requests.</p> : (
        <ul className="space-y-3">
          {rows.map((a) => (
            <li key={a.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{a.title}</p>
                <StatusPill value={a.status} />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {a.action_type.replace(/_/g, ' ')}{a.amount != null ? ` · ${money(a.amount, currency)}` : ''} · requested by {a.requested_by}
                {a.investigation_id ? ` · investigation #${a.investigation_id}` : ''}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{a.rationale}</p>
              {a.status === 'pending' ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                    placeholder="Decision note (optional)" maxLength={2000}
                    className="min-w-48 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                  <button onClick={() => void decide(a, 'approved')} className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700">Approve</button>
                  <button onClick={() => void decide(a, 'rejected')} className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">Reject</button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  {a.status} by {a.decided_by}{a.decided_at ? ` on ${new Date(a.decided_at).toLocaleString()}` : ''}
                  {a.decision_note ? ` — ${a.decision_note}` : ''}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ActivityTab({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<ToolCall[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    aiCfoApi.activity(companyId).then(setRows).catch((e) => setError(errorText(e, 'Failed to load activity')));
  }, [companyId]);

  return (
    <Card title="AI activity and audit trail">
      <p className="mb-3 text-xs text-slate-500">Every tool an agent ran, with its inputs and a summary of what it returned.</p>
      <ErrorBanner message={error} />
      {rows.length === 0 ? <p className="text-sm text-slate-500">No agent activity yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                {['Time', 'Agent', 'Run', 'Tool', 'Class', 'Input', 'Result'].map((h) => <th key={h} className="whitespace-nowrap py-1.5 pr-3">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {rows.map((c) => (
                <tr key={c.id} className={c.is_error ? 'bg-red-50' : undefined}>
                  <td className="whitespace-nowrap py-1.5 pr-3">{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</td>
                  <td className="py-1.5 pr-3">{c.agent?.replace('_', ' ')}</td>
                  <td className="py-1.5 pr-3">#{c.investigation_id}</td>
                  <td className="py-1.5 pr-3 font-mono">{c.tool_name}</td>
                  <td className="py-1.5 pr-3 uppercase">{c.action_class}</td>
                  <td className="max-w-xs break-all py-1.5 pr-3 text-slate-600">{JSON.stringify(c.input_json)}</td>
                  <td className="max-w-md break-all py-1.5 text-slate-600">{c.output_summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
