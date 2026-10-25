import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { ESCALATION_LEVELS, followUpApi, type OverdueFinding } from '../../services/internalAudit.service';
import { Badge, ErrorBanner, RISK_BADGE, errorText, useAuditCompanyId } from './shared';
import { FindingFollowupModal } from './FindingFollowupModal';

const BANDS = [
  { label: '90+ days', min: 91, tone: 'text-red-700' },
  { label: '61–90 days', min: 61, tone: 'text-red-600' },
  { label: '31–60 days', min: 31, tone: 'text-orange-600' },
  { label: '1–30 days', min: 1, tone: 'text-amber-600' },
] as const;
type BandLabel = (typeof BANDS)[number]['label'];

const RISK_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

const ESCALATION_BADGE: Record<string, string> = {
  Management: 'bg-amber-50 text-amber-700 border border-amber-200',
  CFO: 'bg-orange-100 text-orange-700 border border-orange-200',
  'Audit Committee': 'bg-red-100 text-red-700 border border-red-200',
};
const escalationLabel = (level: string) =>
  level === 'none' ? null : ESCALATION_LEVELS.find((l) => l.value === level)?.label ?? level;

function bandOf(days: number): BandLabel {
  return (BANDS.find((b) => days >= b.min) ?? BANDS[BANDS.length - 1]).label;
}

export default function OverdueFindingsPage() {
  const companyId = useAuditCompanyId();
  const [items, setItems] = useState<OverdueFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Set<BandLabel>>(new Set());
  const [selected, setSelected] = useState<OverdueFinding | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await followUpApi.overdue(companyId));
    } catch (e) {
      setError(errorText(e, 'Failed to load overdue findings'));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<BandLabel, OverdueFinding[]>(BANDS.map((b) => [b.label, []]));
    for (const f of items) map.get(bandOf(f.days_overdue))!.push(f);
    for (const rows of map.values()) {
      rows.sort((a, b) => (RISK_RANK[a.risk_rating] ?? 9) - (RISK_RANK[b.risk_rating] ?? 9) || b.days_overdue - a.days_overdue);
    }
    return map;
  }, [items]);

  const neverChased = items.filter((f) => !f.latest_followup).length;
  const escalated = items.filter((f) => f.escalation_level !== 'none').length;

  const toggle = (band: BandLabel) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(band)) next.delete(band);
      else next.add(band);
      return next;
    });

  const refreshAfterSave = async (dueDate?: string) => {
    const fresh = await followUpApi.overdue(companyId).catch(() => null);
    if (!fresh || !selected) return;
    setItems(fresh);
    const still = fresh.find((f) => f.id === selected.id);
    if (!still) {
      setNotice(`${selected.finding_ref || `F-${selected.id}`} left the queue${dueDate ? ` — now due ${dueDate}` : ''}.`);
    }
    setSelected(still ?? null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Overdue Follow-up Queue</h2>
          <p className="text-sm text-muted-foreground">
            {items.length} open corrective action{items.length === 1 ? '' : 's'} past due
            {items.length > 0 && ` · ${neverChased} never followed up · ${escalated} escalated`}
          </p>
        </div>
        <button onClick={() => void load()} aria-label="Refresh" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <div className="flex items-center justify-between rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm p-3">
          {notice}
          <button onClick={() => setNotice('')} className="text-xs underline">Dismiss</button>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 && !error ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl text-sm text-muted-foreground">
          No overdue corrective actions. Every open finding is within its due date.
        </div>
      ) : (
        BANDS.map(({ label, tone }) => {
          const rows = grouped.get(label) ?? [];
          if (rows.length === 0) return null;
          const open = !collapsed.has(label);
          return (
            <div key={label} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => toggle(label)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
              >
                {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <span className={`text-sm font-semibold ${tone}`}>{label} overdue</span>
                <span className="text-xs text-muted-foreground">({rows.length})</span>
              </button>
              {open && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20">
                      <tr>
                        {['Ref', 'Finding', 'Risk', 'Owner', 'Due', 'Days overdue', 'Escalation', 'Last follow-up'].map((h) => (
                          <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((f) => (
                        <tr
                          key={f.id}
                          onClick={() => setSelected(f)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(f); } }}
                          tabIndex={0}
                          className="cursor-pointer hover:bg-muted/20 focus:bg-muted/30 focus:outline-none transition-colors"
                        >
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{f.finding_ref || `F-${f.id}`}</td>
                          <td className="px-4 py-3 font-medium max-w-xs truncate" title={f.title}>{f.title}</td>
                          <td className="px-4 py-3"><Badge value={f.risk_rating} styles={RISK_BADGE} /></td>
                          <td className="px-4 py-3 text-muted-foreground">{f.action_owner || '—'}</td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            <span className="text-red-600 font-medium">{f.action_due_date}</span>
                            {f.revision_count > 0 && (
                              <span className="block text-muted-foreground">revised {f.revision_count}× · was {f.original_due_date || '—'}</span>
                            )}
                          </td>
                          <td className={`px-4 py-3 font-semibold tabular-nums ${tone}`}>{f.days_overdue}</td>
                          <td className="px-4 py-3"><Badge value={escalationLabel(f.escalation_level)} styles={ESCALATION_BADGE} /></td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {f.latest_followup ? (
                              <>
                                {f.latest_followup.contacted_at}
                                {f.latest_followup.contacted_person && ` · ${f.latest_followup.contacted_person}`}
                                {f.followup_count > 1 && <span className="block">{f.followup_count} follow-ups</span>}
                              </>
                            ) : (
                              <span className="text-red-600">Never followed up</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}

      {selected && (
        <FindingFollowupModal
          companyId={companyId}
          finding={selected}
          onClose={() => setSelected(null)}
          onChanged={(dueDate) => void refreshAfterSave(dueDate)}
        />
      )}
    </div>
  );
}
