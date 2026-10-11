import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import {
  ENGAGEMENT_STATUSES,
  RISK_OPTIONS,
  auditUniverseApi,
  engagementsApi,
  type AuditUnit,
  type Engagement,
  type EngagementStatus,
  type Risk,
} from '../../services/internalAudit.service';
import {
  Badge,
  ENGAGEMENT_STATUS_BADGE,
  ErrorBanner,
  Field,
  Modal,
  RISK_BADGE,
  errorText,
  inputCls,
  useAuditCompanyId,
} from './shared';

type EngagementForm = {
  title: string;
  audit_unit: string;
  scope: string;
  objectives: string;
  lead_auditor: string;
  team_members: string;
  status: EngagementStatus;
  planned_start: string;
  planned_end: string;
  actual_start: string;
  actual_end: string;
  budget_hours: string;
  actual_hours: string;
  risk_rating: Risk | '';
};

const EMPTY: EngagementForm = {
  title: '',
  audit_unit: '',
  scope: '',
  objectives: '',
  lead_auditor: '',
  team_members: '',
  status: 'Planning',
  planned_start: '',
  planned_end: '',
  actual_start: '',
  actual_end: '',
  budget_hours: '',
  actual_hours: '',
  risk_rating: '',
};

function toForm(e: Engagement): EngagementForm {
  return {
    title: e.title,
    audit_unit: e.audit_unit ?? '',
    scope: e.scope ?? '',
    objectives: e.objectives ?? '',
    lead_auditor: e.lead_auditor ?? '',
    team_members: (e.team_members ?? []).join(', '),
    status: e.status,
    planned_start: e.planned_start ?? '',
    planned_end: e.planned_end ?? '',
    actual_start: e.actual_start ?? '',
    actual_end: e.actual_end ?? '',
    budget_hours: e.budget_hours != null ? String(e.budget_hours) : '',
    actual_hours: e.actual_hours != null ? String(e.actual_hours) : '',
    risk_rating: e.risk_rating ?? '',
  };
}

function toPayload(f: EngagementForm): Partial<Engagement> {
  const hours = (v: string) => (v.trim() === '' ? null : Number(v));
  return {
    ...f,
    team_members: f.team_members.split(',').map((s) => s.trim()).filter(Boolean),
    budget_hours: hours(f.budget_hours),
    actual_hours: hours(f.actual_hours),
    risk_rating: f.risk_rating || null,
  };
}

function hoursCell(e: Engagement) {
  if (e.budget_hours == null && e.actual_hours == null) return '—';
  const over = e.budget_hours != null && e.actual_hours != null && e.actual_hours > e.budget_hours;
  return (
    <span className={over ? 'text-red-600 font-medium' : undefined}>
      {e.actual_hours ?? 0} / {e.budget_hours ?? '—'}
    </span>
  );
}

export default function AuditEngagementsPage() {
  const companyId = useAuditCompanyId();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [units, setUnits] = useState<AuditUnit[]>([]);
  const [statusFilter, setStatusFilter] = useState<EngagementStatus | 'All'>('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: number | null; form: EngagementForm } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [engs, unitRows] = await Promise.all([engagementsApi.list(companyId), auditUniverseApi.list(companyId)]);
      setEngagements(engs);
      setUnits(unitRows);
    } catch (e) {
      setError(errorText(e, 'Failed to load engagements'));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(
    () => (statusFilter === 'All' ? engagements : engagements.filter((e) => e.status === statusFilter)),
    [engagements, statusFilter],
  );

  const open = (eng?: Engagement) => {
    setFormError('');
    setEditing({ id: eng?.id ?? null, form: eng ? toForm(eng) : EMPTY });
  };
  const set = <K extends keyof EngagementForm>(k: K, v: EngagementForm[K]) =>
    setEditing((cur) => (cur ? { ...cur, form: { ...cur.form, [k]: v } } : cur));

  const save = async () => {
    if (!editing) return;
    const { form } = editing;
    if (form.planned_start && form.planned_end && form.planned_end < form.planned_start) {
      setFormError('Planned end is before planned start.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (editing.id) await engagementsApi.update(companyId, editing.id, toPayload(form));
      else await engagementsApi.create(companyId, toPayload(form));
      setEditing(null);
      await load();
    } catch (e) {
      setFormError(errorText(e, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (eng: Engagement) => {
    const linked = eng.findings_count ? ` Its ${eng.findings_count} finding(s) will be kept but unlinked.` : '';
    if (!window.confirm(`Delete engagement "${eng.title}"?${linked}`)) return;
    try {
      await engagementsApi.remove(companyId, eng.id);
      await load();
    } catch (e) {
      setError(errorText(e, 'Delete failed'));
    }
  };

  const f = editing?.form;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Audit Engagements</h2>
          <p className="text-sm text-muted-foreground">Plan, run and close individual audits against the annual plan</p>
        </div>
        <div className="flex gap-2">
          <select
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EngagementStatus | 'All')}
            aria-label="Filter by status"
          >
            <option value="All">All statuses</option>
            {ENGAGEMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button onClick={() => void load()} aria-label="Refresh" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => open()} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors">
            <Plus className="h-4 w-4" /> New Engagement
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {editing && f && (
        <Modal
          title={`${editing.id ? 'Edit' : 'New'} Engagement`}
          onClose={() => setEditing(null)}
          footer={
            <>
              {formError && <p className="mr-auto text-sm text-red-600">{formError}</p>}
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-md">Cancel</button>
              <button onClick={() => void save()} disabled={saving || !f.title.trim()} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 transition-colors">
                <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Engagement title *" wide>
              <input className={inputCls} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. FY2026 Procure-to-Pay audit" />
            </Field>
            <Field label="Audit unit">
              <input className={inputCls} list="ia-audit-units" value={f.audit_unit} onChange={(e) => set('audit_unit', e.target.value)} placeholder="From the audit universe" />
              <datalist id="ia-audit-units">
                {units.map((u) => <option key={u.id} value={u.unit_name} />)}
              </datalist>
            </Field>
            <Field label="Lead auditor">
              <input className={inputCls} value={f.lead_auditor} onChange={(e) => set('lead_auditor', e.target.value)} />
            </Field>
            <Field label="Team members (comma-separated)" wide>
              <input className={inputCls} value={f.team_members} onChange={(e) => set('team_members', e.target.value)} />
            </Field>
            <Field label="Status">
              <select className={inputCls} value={f.status} onChange={(e) => set('status', e.target.value as EngagementStatus)}>
                {ENGAGEMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Risk rating">
              <select className={inputCls} value={f.risk_rating} onChange={(e) => set('risk_rating', e.target.value as Risk | '')}>
                <option value="">Not rated</option>
                {RISK_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Planned start">
              <input type="date" className={inputCls} value={f.planned_start} onChange={(e) => set('planned_start', e.target.value)} />
            </Field>
            <Field label="Planned end">
              <input type="date" className={inputCls} value={f.planned_end} onChange={(e) => set('planned_end', e.target.value)} />
            </Field>
            <Field label="Actual start">
              <input type="date" className={inputCls} value={f.actual_start} onChange={(e) => set('actual_start', e.target.value)} />
            </Field>
            <Field label="Actual end">
              <input type="date" className={inputCls} value={f.actual_end} onChange={(e) => set('actual_end', e.target.value)} />
            </Field>
            <Field label="Budget hours">
              <input type="number" min={0} step="0.5" className={inputCls} value={f.budget_hours} onChange={(e) => set('budget_hours', e.target.value)} />
            </Field>
            <Field label="Actual hours">
              <input type="number" min={0} step="0.5" className={inputCls} value={f.actual_hours} onChange={(e) => set('actual_hours', e.target.value)} />
            </Field>
            <Field label="Scope" wide>
              <textarea className={inputCls} rows={2} value={f.scope} onChange={(e) => set('scope', e.target.value)} />
            </Field>
            <Field label="Objectives" wide>
              <textarea className={inputCls} rows={2} value={f.objectives} onChange={(e) => set('objectives', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}

      {loading && engagements.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : engagements.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
          <p className="text-muted-foreground text-sm mb-3">No engagements yet.</p>
          <button onClick={() => open()} className="flex items-center gap-1.5 mx-auto bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md">
            <Plus className="h-4 w-4" /> Plan first engagement
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {['Ref', 'Engagement', 'Audit Unit', 'Lead', 'Status', 'Risk', 'Planned', 'Hours (actual / budget)', 'Findings', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{e.engagement_ref || `IA-${e.id}`}</td>
                    <td className="px-4 py-3 font-medium max-w-xs truncate">{e.title}</td>
                    <td className="px-4 py-3 text-muted-foreground">{e.audit_unit || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{e.lead_auditor || '—'}</td>
                    <td className="px-4 py-3"><Badge value={e.status} styles={ENGAGEMENT_STATUS_BADGE} /></td>
                    <td className="px-4 py-3"><Badge value={e.risk_rating} styles={RISK_BADGE} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {e.planned_start || e.planned_end ? `${e.planned_start || '?'} → ${e.planned_end || '?'}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">{hoursCell(e)}</td>
                    <td className="px-4 py-3 text-center">{e.findings_count ?? 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => open(e)} aria-label="Edit" className="p-1 text-muted-foreground hover:text-foreground rounded"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => void remove(e)} aria-label="Delete" className="p-1 text-muted-foreground hover:text-red-600 rounded"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">No engagements with status {statusFilter}.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
