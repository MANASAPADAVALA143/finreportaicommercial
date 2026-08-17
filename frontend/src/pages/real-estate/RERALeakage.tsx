import { useState } from 'react';
import * as api from '../../services/reraApi';
import type { RERALeakageScan } from '../../services/reraApi';
import { useReraData, AED, DemoBadge, PageHeader, Card, OutlineButton, GoldButton, Table, EmptyRow, SeverityBadge, BORDER, MUTED } from './shared';

const DEMO_SCAN: RERALeakageScan = {
  flagged_count: 3,
  total_at_risk: 940_000,
  window_days: 14,
  items: [
    { spa_id: 'SPA-2201', project_id: 'demo-1', booking_id: 'b1', milestone: '40% Construction', triggered_at: '2026-07-20T00:00:00', amount_at_risk: 420_000, window_days: 14, reason: 'milestone reached but no billing signal within window' },
    { spa_id: 'SPA-2214', project_id: 'demo-1', booking_id: 'b2', milestone: 'Foundation Complete', triggered_at: '2026-07-15T00:00:00', amount_at_risk: 310_000, window_days: 14, reason: 'milestone reached but no billing signal within window' },
    { spa_id: 'SPA-2233', project_id: 'demo-2', booking_id: 'b3', milestone: '60% Construction', triggered_at: '2026-07-28T00:00:00', amount_at_risk: 210_000, window_days: 14, reason: 'milestone reached but no billing signal within window' },
  ],
};

/** Backend doesn't compute a risk level — derived client-side from amount at risk. */
function riskLevel(amount: number): string {
  if (amount >= 300_000) return 'critical';
  if (amount >= 100_000) return 'high';
  return 'medium';
}

export default function RERALeakage() {
  const [windowDays, setWindowDays] = useState(14);
  const scan = useReraData(() => api.scanLeakage(windowDays), DEMO_SCAN, (d) => d.items.length === 0, [windowDays]);

  const projectsAffected = new Set(scan.data.items.map((i) => i.project_id)).size;

  return (
    <div>
      <PageHeader
        title="Revenue Leakage"
        subtitle={`Milestone-triggered billing scan — ${windowDays}-day window`}
        action={<OutlineButton onClick={() => void api.downloadLeakageCsv(windowDays)}>Export CSV</OutlineButton>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <p className="text-xs" style={{ color: MUTED }}>Total At Risk</p>
          <p className="text-2xl font-bold mt-1 text-red-400">{AED(scan.data.total_at_risk)}</p>
        </Card>
        <Card>
          <p className="text-xs" style={{ color: MUTED }}>Milestones Flagged</p>
          <p className="text-2xl font-bold mt-1">{scan.data.flagged_count}</p>
        </Card>
        <Card>
          <p className="text-xs" style={{ color: MUTED }}>Projects Affected</p>
          <p className="text-2xl font-bold mt-1">{projectsAffected}</p>
        </Card>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <label className="text-xs" style={{ color: MUTED }}>Window (days)</label>
        <input
          type="number"
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value) || 14)}
          className="w-20 px-2 py-1 rounded-lg border bg-transparent text-sm text-white"
          style={{ borderColor: BORDER }}
        />
        <GoldButton onClick={() => scan.reload()}>Run New Scan</GoldButton>
      </div>

      <Table headers={['SPA ID', 'Milestone', 'Amount At Risk', 'Triggered', 'Risk Level']}>
        {scan.data.items.length === 0 ? (
          <EmptyRow colSpan={5} text="No revenue leakage detected in this window." />
        ) : (
          scan.data.items.map((item, i) => (
            <tr key={`${item.spa_id}-${i}`} className="border-b" style={{ borderColor: BORDER }}>
              <td className="px-4 py-3 font-mono text-xs">{item.spa_id}</td>
              <td className="px-4 py-3">{item.milestone}</td>
              <td className="px-4 py-3 text-red-400">{AED(item.amount_at_risk)}</td>
              <td className="px-4 py-3" style={{ color: MUTED }}>{new Date(item.triggered_at).toLocaleDateString()}</td>
              <td className="px-4 py-3"><SeverityBadge severity={riskLevel(item.amount_at_risk)} /></td>
            </tr>
          ))
        )}
      </Table>

      <DemoBadge show={scan.isDemo} />
    </div>
  );
}
