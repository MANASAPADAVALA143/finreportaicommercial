import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Save } from 'lucide-react';
import {
  ESCALATION_LEVELS,
  followUpApi,
  type DueDateRevision,
  type EscalationLevel,
  type FindingFollowup,
  type OverdueFinding,
} from '../../services/internalAudit.service';
import { ErrorBanner, Field, Modal, errorText, inputCls } from './shared';

type Tab = 'followup' | 'revise' | 'escalation';
const TABS: { value: Tab; label: string }[] = [
  { value: 'followup', label: 'Log follow-up' },
  { value: 'revise', label: 'Revise due date' },
  { value: 'escalation', label: 'Escalation' },
];

/** Local calendar date as YYYY-MM-DD (toISOString would give the UTC date). */
const today = () => new Date().toLocaleDateString('en-CA');

type Props = {
  companyId: string;
  finding: OverdueFinding;
  onClose: () => void;
  /** Called after every successful save; `dueDate` is set when the due date changed. */
  onChanged: (dueDate?: string) => void;
};

export function FindingFollowupModal({ companyId, finding, onClose, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('followup');
  const [followups, setFollowups] = useState<FindingFollowup[]>([]);
  const [revisions, setRevisions] = useState<DueDateRevision[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [contactedAt, setContactedAt] = useState(today());
  const [contactedPerson, setContactedPerson] = useState(finding.action_owner ?? '');
  const [notes, setNotes] = useState('');
  const [revisedDate, setRevisedDate] = useState('');
  const [reason, setReason] = useState('');
  const [level, setLevel] = useState<EscalationLevel>(finding.escalation_level);

  const loadHistory = useCallback(async () => {
    setHistoryError('');
    try {
      const h = await followUpApi.history(companyId, finding.id);
      setFollowups(h.followups);
      setRevisions(h.revisions);
    } catch (e) {
      setHistoryError(errorText(e, 'Failed to load history'));
    }
  }, [companyId, finding.id]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const switchTab = (t: Tab) => {
    setTab(t);
    setError('');
  };

  const run = async (action: () => Promise<string | undefined>) => {
    setSaving(true);
    setError('');
    try {
      const dueDate = await action();
      await loadHistory();
      onChanged(dueDate);
    } catch (e) {
      setError(errorText(e, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (tab === 'followup') {
      void run(async () => {
        await followUpApi.logFollowup(companyId, finding.id, {
          contacted_at: contactedAt,
          contacted_person: contactedPerson.trim() || undefined,
          response_notes: notes.trim() || undefined,
        });
        setNotes('');
        return undefined;
      });
    } else if (tab === 'revise') {
      void run(async () => {
        const res = await followUpApi.reviseDueDate(companyId, finding.id, { revised_due_date: revisedDate, reason: reason.trim() });
        setRevisedDate('');
        setReason('');
        return res.finding.action_due_date ?? undefined;
      });
    } else {
      void run(async () => {
        await followUpApi.setEscalation(companyId, finding.id, level);
        return undefined;
      });
    }
  };

  const canSave =
    !saving &&
    (tab === 'followup'
      ? !!contactedAt
      : tab === 'revise'
        ? !!revisedDate && !!reason.trim()
        : level !== finding.escalation_level);

  const saveLabel = tab === 'followup' ? 'Save follow-up' : tab === 'revise' ? 'Agree revised date' : 'Save escalation';

  return (
    <Modal
      title={`${finding.finding_ref || `F-${finding.id}`} · ${finding.days_overdue} days overdue`}
      onClose={onClose}
      footer={
        <>
          {error && <p className="mr-auto text-sm text-red-600">{error}</p>}
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-md">Close</button>
          <button
            onClick={save}
            disabled={!canSave}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 transition-colors"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : saveLabel}
          </button>
        </>
      }
    >
      <div className="p-6 space-y-5">
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm font-semibold text-foreground">{finding.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {finding.risk_rating} risk · Owner {finding.action_owner || '—'} · Due {finding.action_due_date}
            {finding.original_due_date && ` (originally ${finding.original_due_date})`}
          </p>
        </div>

        <div className="flex gap-1 border-b border-border" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => switchTab(t.value)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.value ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <ErrorBanner message={historyError} />

        {tab === 'followup' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Contact date *">
                <input type="date" max={today()} className={inputCls} value={contactedAt} onChange={(e) => setContactedAt(e.target.value)} />
              </Field>
              <Field label="Person contacted">
                <input className={inputCls} value={contactedPerson} onChange={(e) => setContactedPerson(e.target.value)} placeholder="Name or role" maxLength={200} />
              </Field>
              <Field label="Response / notes" wide>
                <textarea className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="What the owner said and any commitment made" />
              </Field>
            </div>
            <History title="Follow-up history" empty="No follow-ups logged yet.">
              {followups.map((f) => (
                <li key={f.id} className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs">
                  <div className="flex justify-between gap-4 text-muted-foreground">
                    <span className="font-medium text-foreground">{f.contacted_at}{f.contacted_person ? ` · ${f.contacted_person}` : ''}</span>
                    {f.logged_by && <span>logged by {f.logged_by}</span>}
                  </div>
                  {f.response_notes && <p className="mt-1 text-foreground whitespace-pre-wrap">{f.response_notes}</p>}
                </li>
              ))}
            </History>
          </>
        )}

        {tab === 'revise' && (
          <>
            <p className="text-xs text-muted-foreground">
              The current due date is kept in the revision history, and the revised date appears in the engagement report.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Revised due date *">
                <input type="date" min={today()} className={inputCls} value={revisedDate} onChange={(e) => setRevisedDate(e.target.value)} />
              </Field>
              <Field label="Reason (who agreed it and why) *" wide>
                <textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
              </Field>
            </div>
            <History title="Revision history" empty="The due date has not been revised.">
              {revisions.map((r) => (
                <li key={r.id} className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs">
                  <div className="flex justify-between gap-4 text-muted-foreground">
                    <span className="font-medium text-foreground">{r.original_due_date || '—'} → {r.revised_due_date}</span>
                    <span>{r.revised_by ? `${r.revised_by} · ` : ''}{r.created_at?.slice(0, 10)}</span>
                  </div>
                  <p className="mt-1 text-foreground whitespace-pre-wrap">{r.reason}</p>
                </li>
              ))}
            </History>
          </>
        )}

        {tab === 'escalation' && (
          <Field label="Escalation level">
            <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value as EscalationLevel)}>
              {ESCALATION_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function History({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground mb-2">{title}</p>
      {children.length === 0 ? <p className="text-xs text-muted-foreground">{empty}</p> : <ul className="space-y-2">{children}</ul>}
    </div>
  );
}
