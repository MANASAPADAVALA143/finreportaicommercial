import { useState } from 'react';
import * as api from '../../services/reraApi';
import type { RERARiskFlag } from '../../services/reraApi';
import { useReraData, DemoBadge, PageHeader, Card, OutlineButton, Table, EmptyRow, SeverityBadge, BORDER, MUTED } from './shared';

const DEMO_FLAGS: RERARiskFlag[] = [
  { id: 'demo-f1', project_id: 'demo-1', severity: 'high', category: 'escrow', title: 'Escrow utilization ceiling exceeded', description: 'Utilization 55% exceeds construction progress 42% by more than 10%.', resolved: false, created_at: '2026-07-01T00:00:00' },
  { id: 'demo-f2', project_id: 'demo-2', severity: 'medium', category: 'qpr', title: 'QPR deadline approaching', description: '5 day(s) remaining to file.', resolved: false, created_at: '2026-07-10T00:00:00' },
  { id: 'demo-f3', project_id: 'demo-1', severity: 'low', category: 'ifrs15', title: 'Revenue recognition variance', description: 'Minor variance flagged for review.', resolved: true, created_at: '2026-06-20T00:00:00' },
];

export default function RERAFlags() {
  const flags = useReraData(async () => (await api.listRiskFlags()).risk_flags, DEMO_FLAGS, (d) => d.length === 0);
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);

  const filtered = flags.data.filter(
    (f) =>
      (!severityFilter || f.severity === severityFilter) &&
      (!statusFilter || (statusFilter === 'resolved' ? f.resolved : !f.resolved)),
  );
  const activeCount = flags.data.filter((f) => !f.resolved).length;

  const resolve = async (id: string) => {
    setResolving(id);
    try {
      await api.resolveRiskFlag(id);
      flags.reload();
    } finally {
      setResolving(null);
    }
  };

  return (
    <div>
      <PageHeader title="Risk Flags" subtitle="Escrow, VAT, QPR, TDS and IFRS 15 compliance alerts" />

      <Card className="mb-6 max-w-xs">
        <p className="text-xs" style={{ color: MUTED }}>Active Flags</p>
        <p className="text-3xl font-bold mt-1 text-red-400">{activeCount}</p>
      </Card>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="px-3 py-2 rounded-lg border bg-transparent text-sm text-white" style={{ borderColor: BORDER }}>
          <option value="" style={{ background: '#0F2035' }}>All severities</option>
          <option value="high" style={{ background: '#0F2035' }}>High</option>
          <option value="medium" style={{ background: '#0F2035' }}>Medium</option>
          <option value="low" style={{ background: '#0F2035' }}>Low</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 rounded-lg border bg-transparent text-sm text-white" style={{ borderColor: BORDER }}>
          <option value="" style={{ background: '#0F2035' }}>All statuses</option>
          <option value="open" style={{ background: '#0F2035' }}>Open</option>
          <option value="resolved" style={{ background: '#0F2035' }}>Resolved</option>
        </select>
      </div>

      <Table headers={['Title', 'Category', 'Severity', 'Created', 'Status', 'Actions']}>
        {filtered.length === 0 ? (
          <EmptyRow colSpan={6} text="No risk flags." />
        ) : (
          filtered.map((f) => (
            <tr key={f.id} className="border-b" style={{ borderColor: BORDER }}>
              <td className="px-4 py-3">{f.title}</td>
              <td className="px-4 py-3 capitalize" style={{ color: MUTED }}>{f.category}</td>
              <td className="px-4 py-3"><SeverityBadge severity={f.severity} /></td>
              <td className="px-4 py-3" style={{ color: MUTED }}>{f.created_at ? new Date(f.created_at).toLocaleDateString() : '—'}</td>
              <td className="px-4 py-3">{f.resolved ? 'Resolved' : 'Open'}</td>
              <td className="px-4 py-3">
                {!f.resolved && (
                  <OutlineButton onClick={() => void resolve(f.id)} disabled={resolving === f.id}>
                    {resolving === f.id ? 'Resolving…' : 'Resolve'}
                  </OutlineButton>
                )}
              </td>
            </tr>
          ))
        )}
      </Table>

      <DemoBadge show={flags.isDemo} />
    </div>
  );
}
