import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, Paperclip, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import {
  WORKPAPER_STATUSES,
  workpapersApi,
  type Engagement,
  type WorkpaperProcedure,
  type WorkpaperStatus,
} from '../../services/internalAudit.service';
import { ErrorBanner, Field, Modal, errorText, inputCls, useAuditCompanyId } from './shared';
import { EvidencePanel } from './EvidencePanel';

const STATUS_STYLE: Record<WorkpaperStatus, string> = {
  not_started: 'border-border bg-background text-muted-foreground',
  in_progress: 'border-blue-200 bg-blue-50 text-blue-700',
  done: 'border-green-200 bg-green-50 text-green-700',
};

export default function WorkpapersPage() {
  const companyId = useAuditCompanyId();
  const engagementId = Number(useParams<{ eid: string }>().eid);
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [procedures, setProcedures] = useState<WorkpaperProcedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState<{ title: string; description: string; assigned_to: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [openEvidence, setOpenEvidence] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    if (!Number.isInteger(engagementId)) {
      setError('Invalid engagement');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await workpapersApi.list(companyId, engagementId);
      setEngagement(res.engagement);
      setProcedures(res.procedures);
    } catch (e) {
      setError(errorText(e, 'Failed to load workpapers'));
    } finally {
      setLoading(false);
    }
  }, [companyId, engagementId]);

  useEffect(() => { void load(); }, [load]);

  const replace = (p: WorkpaperProcedure) => setProcedures((cur) => cur.map((x) => (x.id === p.id ? p : x)));

  const update = async (p: WorkpaperProcedure, body: Parameters<typeof workpapersApi.update>[2]) => {
    setError('');
    try {
      replace(await workpapersApi.update(companyId, p.id, body));
      return true;
    } catch (e) {
      setError(errorText(e, 'Update failed'));
      return false;
    }
  };

  const add = async () => {
    if (!adding) return;
    setSaving(true);
    setFormError('');
    try {
      const created = await workpapersApi.create(companyId, engagementId, {
        title: adding.title.trim(),
        description: adding.description.trim() || undefined,
        assigned_to: adding.assigned_to.trim() || undefined,
      });
      setProcedures((cur) => [...cur, created]);
      setAdding(null);
    } catch (e) {
      setFormError(errorText(e, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: WorkpaperProcedure) => {
    const files = p.evidence_count ? ` and its ${p.evidence_count} evidence file(s)` : '';
    if (!window.confirm(`Delete procedure "${p.title}"${files}? This cannot be undone.`)) return;
    try {
      await workpapersApi.remove(companyId, p.id);
      setProcedures((cur) => cur.filter((x) => x.id !== p.id));
    } catch (e) {
      setError(errorText(e, 'Delete failed'));
    }
  };

  const toggleEvidence = (id: number) =>
    setOpenEvidence((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const done = procedures.filter((p) => p.status === 'done').length;
  const withoutEvidence = procedures.filter((p) => p.status === 'done' && p.evidence_count === 0).length;
  const pct = procedures.length ? Math.round((done / procedures.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <Link to="/internal-audit/engagements" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Engagements
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Workpapers{engagement ? ` — ${engagement.title}` : ''}</h2>
          <p className="text-sm text-muted-foreground">
            {engagement?.engagement_ref || (engagement ? `IA-${engagement.id}` : '')}
            {engagement && ' · '}Audit procedures and the evidence supporting each one
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} aria-label="Refresh" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => { setFormError(''); setAdding({ title: '', description: '', assigned_to: '' }); }}
            disabled={!engagement}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add Procedure
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {procedures.length > 0 && (
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>
              {done} of {procedures.length} procedures done
              {withoutEvidence > 0 && <span className="text-amber-700"> · {withoutEvidence} done without evidence</span>}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {adding && (
        <Modal
          title="New Procedure"
          onClose={() => setAdding(null)}
          footer={
            <>
              {formError && <p className="mr-auto text-sm text-red-600">{formError}</p>}
              <button onClick={() => setAdding(null)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-md">Cancel</button>
              <button onClick={() => void add()} disabled={saving || !adding.title.trim()} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 transition-colors">
                <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Procedure *" wide>
              <input className={inputCls} value={adding.title} maxLength={300} onChange={(e) => setAdding({ ...adding, title: e.target.value })} placeholder="e.g. Vouch a sample of 25 vendor payments to approved invoices" />
            </Field>
            <Field label="Assigned to">
              <input className={inputCls} value={adding.assigned_to} maxLength={100} onChange={(e) => setAdding({ ...adding, assigned_to: e.target.value })} />
            </Field>
            <Field label="Description / test steps" wide>
              <textarea className={inputCls} rows={3} value={adding.description} maxLength={4000} onChange={(e) => setAdding({ ...adding, description: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}

      {loading && procedures.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : engagement && procedures.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl text-sm text-muted-foreground">
          No procedures yet. Add the audit steps for this engagement to build its workpapers.
        </div>
      ) : (
        <ol className="space-y-3">
          {procedures.map((p, idx) => (
            <ProcedureCard
              key={p.id}
              index={idx + 1}
              procedure={p}
              companyId={companyId}
              evidenceOpen={openEvidence.has(p.id)}
              onToggleEvidence={() => toggleEvidence(p.id)}
              onUpdate={(body) => update(p, body)}
              onDelete={() => void remove(p)}
              onEvidenceCount={(n) =>
                setProcedures((cur) => cur.map((x) => (x.id === p.id ? { ...x, evidence_count: n } : x)))
              }
            />
          ))}
        </ol>
      )}
    </div>
  );
}

type CardProps = {
  index: number;
  procedure: WorkpaperProcedure;
  companyId: string;
  evidenceOpen: boolean;
  onToggleEvidence: () => void;
  onUpdate: (body: Parameters<typeof workpapersApi.update>[2]) => Promise<boolean>;
  onDelete: () => void;
  onEvidenceCount: (n: number) => void;
};

function ProcedureCard({ index, procedure: p, companyId, evidenceOpen, onToggleEvidence, onUpdate, onDelete, onEvidenceCount }: CardProps) {
  const [notes, setNotes] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);

  const saveNotes = async () => {
    if (notes === null) return;
    setSavingNotes(true);
    if (await onUpdate({ notes })) setNotes(null);
    setSavingNotes(false);
  };

  return (
    <li className={`rounded-xl border bg-card overflow-hidden ${p.status === 'done' ? 'border-green-200' : 'border-border'}`}>
      <div className="flex items-start gap-4 px-4 py-3">
        <span className="mt-1 w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">{index}.</span>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{p.title}</p>
              {p.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{p.description}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {p.assigned_to ? `Assigned to ${p.assigned_to}` : 'Unassigned'}
                {p.status === 'done' && p.completed_at && (
                  <span className="text-green-700"> · Done {p.completed_at.slice(0, 10)}{p.completed_by ? ` by ${p.completed_by}` : ''}</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <select
                aria-label="Procedure status"
                value={p.status}
                onChange={(e) => void onUpdate({ status: e.target.value as WorkpaperStatus })}
                className={`rounded-md border px-2 py-1 text-xs font-medium ${STATUS_STYLE[p.status]}`}
              >
                {WORKPAPER_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <button
                onClick={onToggleEvidence}
                aria-expanded={evidenceOpen}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                <Paperclip className="h-3.5 w-3.5" /> {p.evidence_count}
                {evidenceOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              <button onClick={onDelete} aria-label="Delete procedure" className="p-1 text-muted-foreground hover:text-red-600 rounded">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {notes === null ? (
            <button
              onClick={() => setNotes(p.notes ?? '')}
              className="block w-full text-left text-sm rounded px-2 py-1 -mx-2 hover:bg-muted/50 text-muted-foreground whitespace-pre-wrap"
            >
              {p.notes || <span className="italic">Add work done, results and conclusion…</span>}
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                autoFocus
                className={inputCls}
                rows={4}
                maxLength={10000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Work done, results and conclusion"
              />
              <div className="flex gap-2">
                <button onClick={() => void saveNotes()} disabled={savingNotes} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50">
                  {savingNotes ? 'Saving…' : 'Save notes'}
                </button>
                <button onClick={() => setNotes(null)} className="px-3 py-1 text-xs text-muted-foreground border border-border rounded-md">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {evidenceOpen && (
        <div className="border-t border-border bg-muted/10 px-4 py-3 pl-14">
          <EvidencePanel companyId={companyId} procedureId={p.id} onCountChange={onEvidenceCount} />
        </div>
      )}
    </li>
  );
}
