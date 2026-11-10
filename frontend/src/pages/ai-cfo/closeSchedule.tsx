import { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Send, ShieldCheck, XCircle } from 'lucide-react';
import {
  aiCloseApi, type CloseControls, type CloseRun, type CloseSchedule, type Delivery, type EclRates, type SelectableAgent,
} from '../../services/aiClose.service';

const ECL_BUCKETS: [keyof EclRates, string][] = [
  ['current', 'Current'], ['1_30', '1–30'], ['31_60', '31–60'], ['61_90', '61–90'], ['90_plus', '90+'],
];
import { errorText } from '../internal-audit/shared';
import { Card, GOLD } from './parts';
import { fmtTime } from './closeParts';

const TIMEZONES = ['Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'];
const WHEN: { value: CloseSchedule['notify_when']; label: string }[] = [
  { value: 'always', label: 'Always email / Slack the summary' },
  { value: 'issues', label: 'Only when there are failures, exceptions or approvals' },
  { value: 'never', label: 'In-app notification only' },
];

type Selection = { scope: 'entity' | 'group'; entityIds: string[]; agents: SelectableAgent[]; names: Record<string, string> };

export function ScheduleCard({ companyId, selection, onOpenRun, onError }: {
  companyId: string; selection: Selection; onOpenRun: (id: number) => void; onError: (m: string) => void;
}) {
  const [schedule, setSchedule] = useState<CloseSchedule | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ enabled: true, run_day: 2, run_hour: 6, timezone: 'Asia/Dubai', emails: '', slack: '',
    removeSlack: false, notify_when: 'always' as CloseSchedule['notify_when'] });

  useEffect(() => {
    let cancelled = false;
    setSchedule(null);
    setEditing(false);
    aiCloseApi.schedule(companyId).then((s) => { if (!cancelled) setSchedule(s); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [companyId]);

  const edit = () => {
    setForm({
      enabled: schedule?.enabled ?? true, run_day: schedule?.run_day ?? 2, run_hour: schedule?.run_hour ?? 6,
      timezone: schedule?.timezone ?? 'Asia/Dubai', emails: (schedule?.notify_emails ?? []).join(', '), slack: '',
      removeSlack: false, notify_when: schedule?.notify_when ?? 'always',
    });
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await aiCloseApi.saveSchedule(companyId, {
        enabled: form.enabled, scope: selection.scope, entity_ids: selection.scope === 'group' ? selection.entityIds : undefined,
        agents: selection.agents, run_day: form.run_day, run_hour: form.run_hour, timezone: form.timezone,
        notify_emails: form.emails.split(/[,;\s]+/).filter(Boolean), notify_when: form.notify_when,
        slack_webhook_url: form.removeSlack ? '' : form.slack.trim() || null,
      });
      setSchedule(saved);
      setEditing(false);
    } catch (e) {
      onError(errorText(e, 'Could not save the schedule'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Remove the scheduled close for this company?')) return;
    setBusy(true);
    try {
      await aiCloseApi.deleteSchedule(companyId);
      setSchedule(null);
      setEditing(false);
    } catch (e) {
      onError(errorText(e, 'Could not remove the schedule'));
    } finally {
      setBusy(false);
    }
  };

  const selectionText = `${selection.scope === 'group'
    ? `Group of ${selection.entityIds.length + 1} (this company + ${selection.entityIds.map((i) => selection.names[i] ?? i).join(', ')})`
    : 'This entity'} · ${selection.agents.length} agent(s)`;

  return (
    <Card title="Scheduled close and CFO alerts" actions={!editing && (
      <button onClick={edit} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
        {schedule ? 'Edit schedule' : 'Set up schedule'}
      </button>
    )}>
      {!editing && !schedule && (
        <p className="text-sm text-slate-500">
          No schedule. Set one up to close the previous month automatically (for example on the 2nd at 06:00) and send the CFO
          Executive Summary and pending approvals by email or Slack.
        </p>
      )}
      {!editing && schedule && (
        <div className="space-y-2 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <CalendarClock className="h-4 w-4" style={{ color: GOLD }} />
            <span className="font-medium text-slate-900">
              {schedule.enabled ? `Day ${schedule.run_day} at ${String(schedule.run_hour).padStart(2, '0')}:00 ${schedule.timezone}` : 'Paused'}
            </span>
            <span className="text-slate-500">
              · {schedule.scope === 'group' ? `group of ${schedule.entity_ids.length}` : 'this entity'} · {schedule.agents.length} agent(s)
            </span>
          </p>
          {schedule.next_run_at && (
            <p className="text-xs text-slate-600">Next run {fmtTime(schedule.next_run_at)} closes {schedule.next_period}.</p>
          )}
          <p className="text-xs text-slate-600">
            Alerts: {WHEN.find((w) => w.value === schedule.notify_when)?.label}
            {schedule.notify_emails.length ? ` · ${schedule.notify_emails.join(', ')}` : ' · no email recipients'}
            {schedule.slack_configured ? ' · Slack connected' : ''}
          </p>
          {schedule.last_run_period && (
            <p className="text-xs text-slate-600">
              Last scheduled close: {schedule.last_run_period} on {fmtTime(schedule.last_run_at)}
              {schedule.last_run_id && <button onClick={() => onOpenRun(schedule.last_run_id!)} className="ml-1 underline">open run #{schedule.last_run_id}</button>}
            </p>
          )}
          {schedule.last_error && <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">{schedule.last_error}</p>}
        </div>
      )}
      {editing && (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-500">Runs with the scope, companies and agents selected above: {selectionText}.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
            <label className="text-xs text-slate-600">Day of month
              <select value={form.run_day} onChange={(e) => setForm({ ...form, run_day: Number(e.target.value) })} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">Hour
              <select value={form.run_hour} onChange={(e) => setForm({ ...form, run_hour: Number(e.target.value) })} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {Array.from({ length: 24 }, (_, h) => h).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">Time zone
              <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">Send alerts
              <select value={form.notify_when} onChange={(e) => setForm({ ...form, notify_when: e.target.value as CloseSchedule['notify_when'] })} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {WHEN.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-xs text-slate-600">Email recipients (up to 10, comma separated)
            <input value={form.emails} onChange={(e) => setForm({ ...form, emails: e.target.value })} placeholder="cfo@company.com, controller@company.com"
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs text-slate-600">Slack incoming webhook (optional)
            <input type="password" autoComplete="off" value={form.slack} disabled={form.removeSlack} onChange={(e) => setForm({ ...form, slack: e.target.value })}
              placeholder={schedule?.slack_configured ? 'Connected — leave blank to keep the current webhook' : 'https://hooks.slack.com/services/…'}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100" />
          </label>
          {schedule?.slack_configured && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={form.removeSlack} onChange={(e) => setForm({ ...form, removeSlack: e.target.checked })} /> Remove the Slack webhook</label>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void save()} disabled={busy || selection.agents.length === 0} className="rounded-md px-4 py-1.5 text-sm font-semibold text-slate-900 disabled:opacity-50" style={{ background: GOLD }}>
              {busy ? 'Saving…' : 'Save schedule'}
            </button>
            <button onClick={() => setEditing(false)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancel</button>
            {schedule && <button onClick={() => void remove()} disabled={busy} className="ml-auto rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700">Remove schedule</button>}
          </div>
          <p className="text-xs text-slate-500">
            Only owners and finance managers can change the schedule. Scheduled runs prepare journals for approval; nothing is posted automatically.
          </p>
        </div>
      )}
    </Card>
  );
}

export function ApprovalControlsCard({ companyId, currency, onSaved, onError }: {
  companyId: string; currency: string; onSaved: () => void; onError: (m: string) => void;
}) {
  const [controls, setControls] = useState<CloseControls | null>(null);
  const [editing, setEditing] = useState(false);
  const [sod, setSod] = useState(false);
  const [limit, setLimit] = useState('');
  const [ecl, setEcl] = useState<Record<keyof EclRates, string>>({ current: '', '1_30': '', '31_60': '', '61_90': '', '90_plus': '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    aiCloseApi.controls(companyId).then((c) => { if (!cancelled) setControls(c); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [companyId]);

  const edit = () => {
    setSod(controls?.require_segregation ?? false);
    setLimit(controls?.manager_limit != null ? String(controls.manager_limit) : '');
    const r = controls?.ecl_rates;
    setEcl(Object.fromEntries(ECL_BUCKETS.map(([k]) => [k, r ? String(+(r[k] * 100).toFixed(2)) : ''])) as Record<keyof EclRates, string>);
    setEditing(true);
  };

  const save = async () => {
    const filled = ECL_BUCKETS.filter(([k]) => ecl[k].trim() !== '');
    if (filled.length && filled.length !== ECL_BUCKETS.length) {
      onError('Enter a loss rate for every ageing bucket, or leave them all blank to use the defaults');
      return;
    }
    setBusy(true);
    try {
      const saved = await aiCloseApi.saveControls(companyId, {
        require_segregation: sod, manager_limit: limit.trim() ? Number(limit.replace(/,/g, '')) : null,
        ecl_rates: filled.length ? Object.fromEntries(ECL_BUCKETS.map(([k]) => [k, Number(ecl[k]) / 100])) as EclRates : null,
      });
      setControls(saved);
      setEditing(false);
      onSaved();
    } catch (e) {
      onError(errorText(e, 'Could not save the approval controls'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Approval controls and policies" actions={!editing && (
      <button onClick={edit} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">Edit</button>
    )}>
      {!editing ? (
        <ul className="space-y-1 text-sm text-slate-700">
          <li className="flex items-center gap-2">
            <ShieldCheck className={`h-4 w-4 ${controls?.require_segregation ? 'text-green-700' : 'text-slate-400'}`} />
            Segregation of duties: {controls?.require_segregation ? 'on — whoever starts a close cannot approve its journals or the close' : 'off'}
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className={`h-4 w-4 ${controls?.manager_limit != null ? 'text-green-700' : 'text-slate-400'}`} />
            Finance manager approval limit: {controls?.manager_limit != null ? `${currency} ${controls.manager_limit.toLocaleString()} — larger journals need an owner` : 'none'}
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className={`h-4 w-4 ${controls?.ecl_rates ? 'text-green-700' : 'text-slate-400'}`} />
            ECL loss rates (IFRS 9 provision matrix): {controls?.ecl_rates
              ? ECL_BUCKETS.map(([k, label]) => `${label} ${+(controls.ecl_rates![k] * 100).toFixed(2)}%`).join(' · ')
              : 'defaults (1 / 3 / 8 / 20 / 50%)'}
          </li>
          {controls?.updated_by && <li className="text-xs text-slate-500">Last changed by {controls.updated_by}</li>}
        </ul>
      ) : (
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={sod} onChange={(e) => setSod(e.target.checked)} />
            Segregation of duties (recommended for live companies)</label>
          <label className="block text-xs text-slate-600">Finance manager approval limit ({currency}, blank for no limit)
            <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 100000"
              className="mt-1 block w-48 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <fieldset className="text-xs text-slate-600">
            <legend className="mb-1">ECL loss rates by ageing bucket (%, blank for defaults; must not fall as debts age)</legend>
            <div className="flex flex-wrap gap-2">
              {ECL_BUCKETS.map(([k, label]) => (
                <label key={k} className="flex flex-col">{label}
                  <input inputMode="decimal" value={ecl[k]} onChange={(e) => setEcl({ ...ecl, [k]: e.target.value })}
                    className="mt-0.5 w-20 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button onClick={() => void save()} disabled={busy} className="rounded-md px-4 py-1.5 text-sm font-semibold text-slate-900 disabled:opacity-50" style={{ background: GOLD }}>
              {busy ? 'Saving…' : 'Save controls'}
            </button>
            <button onClick={() => setEditing(false)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancel</button>
          </div>
          <p className="text-xs text-slate-500">Only an owner can change these controls.</p>
        </div>
      )}
    </Card>
  );
}

export function SummaryAlerts({ run, companyId, onSent, onError }: {
  run: CloseRun; companyId: string; onSent: () => void; onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const deliveries: Delivery[] = run.notified_json ?? [];
  const running = run.status === 'queued' || run.status === 'running';

  const send = async () => {
    setBusy(true);
    try {
      await aiCloseApi.notify(companyId, run.id);
      onSent();
    } catch (e) {
      onError(errorText(e, 'Could not send the summary'));
    } finally {
      setBusy(false);
    }
  };

  const recent = deliveries.slice(-6).reverse();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
      <button onClick={() => void send()} disabled={busy || running}
        className="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        <Send className="h-3.5 w-3.5" /> {busy ? 'Sending…' : 'Send summary'}
      </button>
      {recent.length > 0 && <span className="text-slate-500">Sent:</span>}
      {recent.map((d, i) => (
        <span key={`${d.at}-${i}`} className="flex items-center gap-1" title={`${fmtTime(d.at)}${d.detail ? ` · ${d.detail}` : ''}`}>
          {d.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <XCircle className="h-3.5 w-3.5 text-red-600" />}
          {d.channel === 'in_app' ? 'in-app' : d.target}
        </span>
      ))}
    </div>
  );
}
