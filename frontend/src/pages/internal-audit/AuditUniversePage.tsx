import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import {
  CONTROL_OPTIONS,
  FREQUENCY_OPTIONS,
  RISK_OPTIONS,
  auditUniverseApi,
  type AuditUnit,
} from '../../services/internalAudit.service';
import { Badge, ErrorBanner, Field, Modal, RISK_BADGE, errorText, inputCls, useAuditCompanyId } from './shared';

type UnitForm = Record<Exclude<keyof AuditUnit, 'id'>, string>;

const EMPTY: UnitForm = {
  unit_name: '',
  department: '',
  process_owner: '',
  inherent_risk: 'Medium',
  control_effectiveness: 'Adequate',
  residual_risk: 'Medium',
  audit_frequency: 'Annual',
  last_audited: '',
  next_planned: '',
  notes: '',
};

const toForm = (u: AuditUnit): UnitForm =>
  Object.fromEntries(Object.keys(EMPTY).map((k) => [k, u[k as keyof UnitForm] ?? ''])) as UnitForm;

export default function AuditUniversePage() {
  const companyId = useAuditCompanyId();
  const [units, setUnits] = useState<AuditUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: number | null; form: UnitForm } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUnits(await auditUniverseApi.list(companyId));
    } catch (e) {
      setError(errorText(e, 'Failed to load audit universe'));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const open = (unit?: AuditUnit) => {
    setFormError('');
    setEditing({ id: unit?.id ?? null, form: unit ? toForm(unit) : EMPTY });
  };
  const set = (k: keyof UnitForm, v: string) =>
    setEditing((cur) => (cur ? { ...cur, form: { ...cur.form, [k]: v } } : cur));

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setFormError('');
    try {
      const body = editing.form as unknown as Partial<AuditUnit>;
      if (editing.id) await auditUniverseApi.update(companyId, editing.id, body);
      else await auditUniverseApi.create(companyId, body);
      setEditing(null);
      await load();
    } catch (e) {
      setFormError(errorText(e, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (u: AuditUnit) => {
    if (!window.confirm(`Delete audit unit "${u.unit_name}"?`)) return;
    try {
      await auditUniverseApi.remove(companyId, u.id);
      await load();
    } catch (e) {
      setError(errorText(e, 'Delete failed'));
    }
  };

  const f = editing?.form;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Audit Universe &amp; Annual Plan</h2>
          <p className="text-sm text-muted-foreground">Risk-scored list of auditable units and their scheduled audit dates</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} aria-label="Refresh" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => open()} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors">
            <Plus className="h-4 w-4" /> Add Unit
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {editing && f && (
        <Modal
          title={`${editing.id ? 'Edit' : 'Add'} Audit Unit`}
          onClose={() => setEditing(null)}
          footer={
            <>
              {formError && <p className="mr-auto text-sm text-red-600">{formError}</p>}
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-md">Cancel</button>
              <button onClick={() => void save()} disabled={saving || !f.unit_name.trim()} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 transition-colors">
                <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Audit unit / process name *" wide>
              <input className={inputCls} value={f.unit_name} onChange={(e) => set('unit_name', e.target.value)} placeholder="e.g. Accounts Payable process" />
            </Field>
            <Field label="Department">
              <input className={inputCls} value={f.department} onChange={(e) => set('department', e.target.value)} placeholder="Finance" />
            </Field>
            <Field label="Process owner">
              <input className={inputCls} value={f.process_owner} onChange={(e) => set('process_owner', e.target.value)} />
            </Field>
            <Field label="Inherent risk">
              <select className={inputCls} value={f.inherent_risk} onChange={(e) => set('inherent_risk', e.target.value)}>
                {RISK_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Control effectiveness">
              <select className={inputCls} value={f.control_effectiveness} onChange={(e) => set('control_effectiveness', e.target.value)}>
                {CONTROL_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Residual risk">
              <select className={inputCls} value={f.residual_risk} onChange={(e) => set('residual_risk', e.target.value)}>
                {RISK_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Audit frequency">
              <select className={inputCls} value={f.audit_frequency} onChange={(e) => set('audit_frequency', e.target.value)}>
                {FREQUENCY_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Last audited">
              <input type="month" className={inputCls} value={f.last_audited} onChange={(e) => set('last_audited', e.target.value)} />
            </Field>
            <Field label="Next planned">
              <input type="month" className={inputCls} value={f.next_planned} onChange={(e) => set('next_planned', e.target.value)} />
            </Field>
            <Field label="Notes" wide>
              <textarea className={inputCls} rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}

      {loading && units.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : units.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
          <p className="text-muted-foreground text-sm mb-3">No audit units defined yet.</p>
          <button onClick={() => open()} className="flex items-center gap-1.5 mx-auto bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md">
            <Plus className="h-4 w-4" /> Add first unit
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {['Unit / Process', 'Department', 'Owner', 'Inherent', 'Controls', 'Residual', 'Frequency', 'Last Audited', 'Next Planned', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {units.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{u.unit_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.department || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.process_owner || '—'}</td>
                    <td className="px-4 py-3"><Badge value={u.inherent_risk} styles={RISK_BADGE} /></td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{u.control_effectiveness || '—'}</td>
                    <td className="px-4 py-3"><Badge value={u.residual_risk} styles={RISK_BADGE} /></td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{u.audit_frequency || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{u.last_audited || '—'}</td>
                    <td className="px-4 py-3 text-xs font-medium text-blue-600">{u.next_planned || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => open(u)} aria-label="Edit" className="p-1 text-muted-foreground hover:text-foreground rounded"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => void remove(u)} aria-label="Delete" className="p-1 text-muted-foreground hover:text-red-600 rounded"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
