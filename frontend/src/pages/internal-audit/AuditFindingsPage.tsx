import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, Repeat2, Save, Search, Trash2 } from 'lucide-react';
import {
  FINDING_STATUSES,
  RISK_OPTIONS,
  engagementsApi,
  findingsApi,
  isOverdue,
  type Engagement,
  type Finding,
  type FindingStatus,
  type Risk,
} from '../../services/internalAudit.service';
import {
  Badge,
  ErrorBanner,
  FINDING_STATUS_BADGE,
  Field,
  Modal,
  RISK_BADGE,
  errorText,
  inputCls,
  useAuditCompanyId,
} from './shared';

const ROOT_CAUSES = ['People', 'Process', 'Technology', 'Policy / Governance', 'External'];

type FindingForm = {
  title: string;
  engagement_id: string;
  description: string;
  risk_rating: Risk;
  root_cause: string;
  control_gap: string;
  recommendation: string;
  management_response: string;
  action_owner: string;
  action_due_date: string;
  status: FindingStatus;
  is_repeat: boolean;
  repeat_from_year: string;
  evidence_ref: string;
};

const EMPTY: FindingForm = {
  title: '',
  engagement_id: '',
  description: '',
  risk_rating: 'Medium',
  root_cause: '',
  control_gap: '',
  recommendation: '',
  management_response: '',
  action_owner: '',
  action_due_date: '',
  status: 'Open',
  is_repeat: false,
  repeat_from_year: '',
  evidence_ref: '',
};

function toForm(x: Finding): FindingForm {
  return {
    title: x.title,
    engagement_id: x.engagement_id != null ? String(x.engagement_id) : '',
    description: x.description ?? '',
    risk_rating: x.risk_rating,
    root_cause: x.root_cause ?? '',
    control_gap: x.control_gap ?? '',
    recommendation: x.recommendation ?? '',
    management_response: x.management_response ?? '',
    action_owner: x.action_owner ?? '',
    action_due_date: x.action_due_date ?? '',
    status: x.status,
    is_repeat: !!x.is_repeat,
    repeat_from_year: x.repeat_from_year ?? '',
    evidence_ref: x.evidence_ref ?? '',
  };
}

function toPayload(f: FindingForm): Partial<Finding> {
  return {
    ...f,
    engagement_id: f.engagement_id ? Number(f.engagement_id) : null,
    repeat_from_year: f.is_repeat ? f.repeat_from_year : '',
  };
}

export default function AuditFindingsPage() {
  const companyId = useAuditCompanyId();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [statusFilter, setStatusFilter] = useState<FindingStatus | 'All' | 'Open items'>('Open items');
  const [riskFilter, setRiskFilter] = useState<Risk | 'All'>('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: number | null; form: FindingForm } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rows, engs] = await Promise.all([findingsApi.list(companyId), engagementsApi.list(companyId)]);
      setFindings(rows);
      setEngagements(engs);
    } catch (e) {
      setError(errorText(e, 'Failed to load findings'));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const engagementRef = useMemo(
    () => new Map(engagements.map((e) => [e.id, e.engagement_ref || e.title])),
    [engagements],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return findings.filter((x) => {
      if (statusFilter === 'Open items' && ['Implemented', 'Verified'].includes(x.status)) return false;
      if (statusFilter !== 'All' && statusFilter !== 'Open items' && x.status !== statusFilter) return false;
      if (riskFilter !== 'All' && x.risk_rating !== riskFilter) return false;
      if (!term) return true;
      return [x.title, x.finding_ref, x.action_owner, x.description]
        .some((v) => (v ?? '').toLowerCase().includes(term));
    });
  }, [findings, statusFilter, riskFilter, search]);

  const overdueCount = useMemo(() => findings.filter((x) => isOverdue(x)).length, [findings]);

  const open = (x?: Finding) => {
    setFormError('');
    setEditing({ id: x?.id ?? null, form: x ? toForm(x) : EMPTY });
  };
  const set = <K extends keyof FindingForm>(k: K, v: FindingForm[K]) =>
    setEditing((cur) => (cur ? { ...cur, form: { ...cur.form, [k]: v } } : cur));

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setFormError('');
    try {
      const body = toPayload(editing.form);
      if (editing.id) await findingsApi.update(companyId, editing.id, body);
      else await findingsApi.create(companyId, body);
      setEditing(null);
      await load();
    } catch (e) {
      setFormError(errorText(e, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (x: Finding) => {
    if (!window.confirm(`Delete finding "${x.title}"?`)) return;
    try {
      await findingsApi.remove(companyId, x.id);
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
          <h2 className="text-xl font-semibold text-foreground">Findings &amp; Corrective Actions</h2>
          <p className="text-sm text-muted-foreground">
            Track observations from fieldwork through management response to verified closure
            {overdueCount > 0 && <span className="ml-2 text-red-600 font-medium">· {overdueCount} overdue</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} aria-label="Refresh" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => open()} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors">
            <Plus className="h-4 w-4" /> Log Finding
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            className="rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm w-64"
            placeholder="Search title, ref, owner…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="rounded-md border border-border bg-background px-3 py-1.5 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by status">
          <option value="Open items">Open items</option>
          <option value="All">All statuses</option>
          {FINDING_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="rounded-md border border-border bg-background px-3 py-1.5 text-sm" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value as Risk | 'All')} aria-label="Filter by risk">
          <option value="All">All risks</option>
          {RISK_OPTIONS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </div>

      <ErrorBanner message={error} />

      {editing && f && (
        <Modal
          title={`${editing.id ? 'Edit' : 'Log'} Finding`}
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
            <Field label="Finding title *" wide>
              <input className={inputCls} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Vendor master changes not independently reviewed" />
            </Field>
            <Field label="Engagement">
              <select className={inputCls} value={f.engagement_id} onChange={(e) => set('engagement_id', e.target.value)}>
                <option value="">Not linked</option>
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>{e.engagement_ref ? `${e.engagement_ref} — ${e.title}` : e.title}</option>
                ))}
              </select>
            </Field>
            <Field label="Risk rating">
              <select className={inputCls} value={f.risk_rating} onChange={(e) => set('risk_rating', e.target.value as Risk)}>
                {RISK_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Description" wide>
              <textarea className={inputCls} rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <Field label="Root cause">
              <select className={inputCls} value={f.root_cause} onChange={(e) => set('root_cause', e.target.value)}>
                <option value="">Not assessed</option>
                {ROOT_CAUSES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputCls} value={f.status} onChange={(e) => set('status', e.target.value as FindingStatus)}>
                {FINDING_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Control gap" wide>
              <textarea className={inputCls} rows={2} value={f.control_gap} onChange={(e) => set('control_gap', e.target.value)} />
            </Field>
            <Field label="Recommendation" wide>
              <textarea className={inputCls} rows={2} value={f.recommendation} onChange={(e) => set('recommendation', e.target.value)} />
            </Field>
            <Field label="Management response" wide>
              <textarea className={inputCls} rows={2} value={f.management_response} onChange={(e) => set('management_response', e.target.value)} />
            </Field>
            <Field label="Action owner">
              <input className={inputCls} value={f.action_owner} onChange={(e) => set('action_owner', e.target.value)} />
            </Field>
            <Field label="Action due date">
              <input type="date" className={inputCls} value={f.action_due_date} onChange={(e) => set('action_due_date', e.target.value)} />
            </Field>
            <Field label="Evidence reference">
              <input className={inputCls} value={f.evidence_ref} onChange={(e) => set('evidence_ref', e.target.value)} placeholder="Working paper / document ref" />
            </Field>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm text-foreground pb-2">
                <input type="checkbox" checked={f.is_repeat} onChange={(e) => set('is_repeat', e.target.checked)} />
                Repeat finding
              </label>
              {f.is_repeat && (
                <input className={inputCls} value={f.repeat_from_year} onChange={(e) => set('repeat_from_year', e.target.value)} placeholder="First raised (year)" maxLength={10} />
              )}
            </div>
          </div>
        </Modal>
      )}

      {loading && findings.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : findings.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
          <p className="text-muted-foreground text-sm mb-3">No findings logged yet.</p>
          <button onClick={() => open()} className="flex items-center gap-1.5 mx-auto bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md">
            <Plus className="h-4 w-4" /> Log first finding
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {['Ref', 'Finding', 'Engagement', 'Risk', 'Status', 'Owner', 'Due Date', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((x) => {
                  const overdue = isOverdue(x);
                  return (
                    <tr key={x.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{x.finding_ref || `F-${x.id}`}</td>
                      <td className="px-4 py-3 max-w-sm">
                        <div className="font-medium truncate flex items-center gap-1.5">
                          {x.is_repeat && (
                            <span title={x.repeat_from_year ? `Repeat — first raised ${x.repeat_from_year}` : 'Repeat finding'}>
                              <Repeat2 className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                            </span>
                          )}
                          {x.title}
                        </div>
                        {x.recommendation && <div className="text-xs text-muted-foreground truncate">{x.recommendation}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {x.engagement_id != null ? engagementRef.get(x.engagement_id) ?? '—' : '—'}
                      </td>
                      <td className="px-4 py-3"><Badge value={x.risk_rating} styles={RISK_BADGE} /></td>
                      <td className="px-4 py-3"><Badge value={x.status} styles={FINDING_STATUS_BADGE} /></td>
                      <td className="px-4 py-3 text-muted-foreground">{x.action_owner || '—'}</td>
                      <td className={`px-4 py-3 whitespace-nowrap ${overdue ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                        {x.action_due_date || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => open(x)} aria-label="Edit" className="p-1 text-muted-foreground hover:text-foreground rounded"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => void remove(x)} aria-label="Delete" className="p-1 text-muted-foreground hover:text-red-600 rounded"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No findings match these filters.</td>
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
