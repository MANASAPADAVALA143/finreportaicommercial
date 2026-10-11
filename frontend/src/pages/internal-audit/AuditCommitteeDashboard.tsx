import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Repeat2, TrendingUp } from 'lucide-react';
import {
  ENGAGEMENT_STATUSES,
  RISK_OPTIONS,
  getAuditDashboard,
  isOverdue,
  type AuditDashboard,
} from '../../services/internalAudit.service';
import { Badge, ErrorBanner, FINDING_STATUS_BADGE, RISK_BADGE, errorText, useAuditCompanyId } from './shared';

const ENG_BAR: Record<string, string> = {
  Planning: 'bg-slate-400',
  Fieldwork: 'bg-blue-500',
  Reporting: 'bg-amber-500',
  Closed: 'bg-green-500',
};

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: number; sub?: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex items-start gap-4">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

export default function AuditCommitteeDashboard() {
  const companyId = useAuditCompanyId();
  const [data, setData] = useState<AuditDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getAuditDashboard(companyId));
    } catch (e) {
      setError(errorText(e, 'Failed to load dashboard'));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading dashboard…
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  const totalEngagements = sum(data.engagements_by_status);
  const closedEngagements = data.engagements_by_status.Closed || 0;
  const totalFindings = sum(data.findings_by_risk);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Audit Committee Dashboard</h2>
          <p className="text-sm text-muted-foreground">Executive view — audit coverage, findings and action status</p>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Audits Completed" value={closedEngagements} sub={`of ${totalEngagements} total`} icon={CheckCircle2} color="bg-green-100 text-green-700" />
        <StatCard label="Open Findings" value={data.open_findings} sub={`of ${totalFindings} total`} icon={AlertTriangle} color="bg-orange-100 text-orange-700" />
        <StatCard label="Overdue Actions" value={data.overdue_actions} sub="past due date" icon={Clock} color={data.overdue_actions > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'} />
        <StatCard label="Repeat Findings" value={data.repeat_findings} sub="recurring observations" icon={Repeat2} color={data.repeat_findings > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-600" /> Engagements by Status
          </h3>
          {totalEngagements === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No engagements yet.</p>
          ) : (
            <div className="space-y-3">
              {ENGAGEMENT_STATUSES.map((s) => {
                const cnt = data.engagements_by_status[s] || 0;
                const pct = Math.round((cnt / totalEngagements) * 100);
                return (
                  <div key={s}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-foreground">{s}</span>
                      <span className="text-muted-foreground">{cnt} ({pct}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${ENG_BAR[s]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500" /> Findings by Risk Rating
          </h3>
          {totalFindings === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No findings yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {[...RISK_OPTIONS].reverse().map((r) => (
                <div key={r} className={`rounded-lg p-3 ${RISK_BADGE[r]}`}>
                  <p className="text-2xl font-bold">{data.findings_by_risk[r] || 0}</p>
                  <p className="text-xs font-medium mt-0.5">{r}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {Object.keys(data.universe_by_risk).length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Audit Universe — Residual Risk Spread</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(data.universe_by_risk).map(([risk, cnt]) => (
              <div key={risk} className={`rounded-lg px-4 py-3 ${RISK_BADGE[risk] || 'bg-muted text-muted-foreground'}`}>
                <p className="text-xl font-bold">{cnt}</p>
                <p className="text-xs font-medium">{risk} risk units</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Open Findings — Action Tracker</h3>
          <Link to="/internal-audit/findings" className="text-xs text-blue-600 hover:underline">View all →</Link>
        </div>
        {data.recent_open_findings.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No open findings.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {['Ref', 'Finding', 'Risk', 'Status', 'Owner', 'Due Date'].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.recent_open_findings.map((f) => {
                  const overdue = isOverdue(f);
                  return (
                    <tr key={f.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{f.finding_ref || `F-${f.id}`}</td>
                      <td className="px-4 py-2.5 font-medium max-w-xs truncate">{f.title}</td>
                      <td className="px-4 py-2.5"><Badge value={f.risk_rating} styles={RISK_BADGE} /></td>
                      <td className="px-4 py-2.5"><Badge value={f.status} styles={FINDING_STATUS_BADGE} /></td>
                      <td className="px-4 py-2.5 text-muted-foreground">{f.action_owner || '—'}</td>
                      <td className={`px-4 py-2.5 ${overdue ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                        {f.action_due_date || '—'}{overdue ? ' (overdue)' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
