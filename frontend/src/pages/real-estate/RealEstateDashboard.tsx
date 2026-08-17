import { useNavigate } from 'react-router-dom';
import { Download, Plus, DollarSign, FileBarChart, Search } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import * as api from '../../services/reraApi';
import type { RERACfoDashboard, RERAProject } from '../../services/reraApi';
import { useReraData, AED, DemoBadge, Card, KpiCard, PageHeader, GoldButton, OutlineButton, GOLD, TEAL, MUTED, BORDER, StatusBadge, Table, EmptyRow } from './shared';

const DEMO_DASHBOARD: RERACfoDashboard = {
  kpis: {
    total_escrow_balance: 586_700_000,
    total_collected: 1_240_000_000,
    total_withdrawn: 420_000_000,
    avg_utilization: 33.8,
    avg_progress: 25,
    active_projects: 5,
    open_risk_flags: 3,
  },
  alerts: [],
  chart_escrow_vs_withdrawal: [
    { project: 'Marina Heights', escrow_balance: 180_000_000, withdrawn: 60_000_000 },
    { project: 'Downtown Tower B', escrow_balance: 150_000_000, withdrawn: 90_000_000 },
    { project: 'Palm Residences', escrow_balance: 120_000_000, withdrawn: 40_000_000 },
    { project: 'Business Bay Suites', escrow_balance: 90_000_000, withdrawn: 150_000_000 },
    { project: 'Creek View', escrow_balance: 46_700_000, withdrawn: 80_000_000 },
  ],
  chart_progress_vs_utilization: [],
};

const DEMO_PROJECTS: RERAProject[] = [];

export default function RealEstateDashboard() {
  const navigate = useNavigate();
  const dash = useReraData(api.getCfoDashboard, DEMO_DASHBOARD, (d) => d.kpis.active_projects === 0 && d.chart_escrow_vs_withdrawal.length === 0);
  const projects = useReraData(
    async () => (await api.listProjects()).projects,
    DEMO_PROJECTS,
    (d) => d.length === 0,
  );
  const riskFlags = useReraData(
    async () => (await api.listRiskFlags(undefined, false)).risk_flags,
    [],
    (d) => false,
  );

  const isDemo = dash.isDemo || projects.isDemo;

  return (
    <div>
      <PageHeader
        title="Real Estate Executive Command Center"
        subtitle="FY 2026 · AED"
        action={
          <OutlineButton onClick={() => window.print()}>
            <span className="flex items-center gap-2">
              <Download size={14} /> Download
            </span>
          </OutlineButton>
        }
      />

      {/* Note: total_assets / net_income / cash_position aren't computed by /api/rera/dashboard/cfo
          (RERA OS tracks escrow compliance, not consolidated financials) — shown as demo figures. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Total Assets" value="AED 4.68B" />
        <KpiCard label="Net Income" value="AED 312.6M" />
        <KpiCard label="Cash Position" value="AED 586.7M" />
        <KpiCard label="Revenue Recognised" value={`${dash.data.kpis.avg_progress.toFixed(0)}%`} accent sub={AED(dash.data.kpis.total_collected)} />
        <KpiCard label="Active Projects" value={String(dash.data.kpis.active_projects)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2">
          <p className="text-sm font-semibold mb-1">Revenue Recognition</p>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs" style={{ color: MUTED }}>IFRS 15 — off-plan sales</span>
            <span className="text-sm font-semibold" style={{ color: GOLD }}>{dash.data.kpis.avg_progress.toFixed(0)}% recognised</span>
          </div>
          <div className="h-2 rounded-full mb-5" style={{ background: BORDER }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, dash.data.kpis.avg_progress)}%`, background: GOLD }} />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dash.data.chart_escrow_vs_withdrawal}>
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
              <XAxis dataKey="project" tick={{ fill: MUTED, fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fill: MUTED, fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#0F2035', border: `1px solid ${BORDER}`, fontSize: 12 }} />
              <Bar dataKey="escrow_balance" name="Escrow Balance" fill={GOLD} radius={[4, 4, 0, 0]} />
              <Bar dataKey="withdrawn" name="Withdrawn" fill={TEAL} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <p className="text-sm font-semibold mb-3">Risk Flags</p>
          {riskFlags.data.length === 0 ? (
            <p className="text-xs" style={{ color: MUTED }}>No open risk flags.</p>
          ) : (
            <ul className="space-y-2">
              {riskFlags.data.slice(0, 5).map((f) => (
                <li key={f.id} className="text-xs flex items-start gap-2">
                  <span className="mt-0.5">⚠️</span>
                  <span>{f.title}</span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => navigate('/real-estate/risk-flags')}
            className="text-xs mt-3 underline"
            style={{ color: GOLD }}
          >
            View all →
          </button>
        </Card>
      </div>

      <Card className="mb-6">
        <p className="text-sm font-semibold mb-3">Project Performance</p>
        <Table headers={['Project', 'RERA #', 'Progress', 'Utilization', 'Escrow Balance', 'Status']}>
          {projects.data.length === 0 ? (
            <EmptyRow colSpan={6} text="No projects yet." />
          ) : (
            projects.data.slice(0, 8).map((p) => (
              <tr
                key={p.id}
                className="border-b cursor-pointer hover:bg-white/5"
                style={{ borderColor: BORDER }}
                onClick={() => navigate(`/real-estate/projects/${p.id}`)}
              >
                <td className="px-4 py-3">{p.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{p.rera_number}</td>
                <td className="px-4 py-3">{p.construction_progress}%</td>
                <td className="px-4 py-3">{p.utilization_percentage}%</td>
                <td className="px-4 py-3">{AED(p.escrow_balance)}</td>
                <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
              </tr>
            ))
          )}
        </Table>
      </Card>

      <Card>
        <p className="text-sm font-semibold mb-3">Quick Actions</p>
        <div className="flex flex-wrap gap-3">
          <GoldButton onClick={() => navigate('/real-estate/projects')}>
            <span className="flex items-center gap-2"><Plus size={14} /> Create Project</span>
          </GoldButton>
          <OutlineButton onClick={() => navigate('/real-estate/payments')}>
            <span className="flex items-center gap-2"><DollarSign size={14} /> Log Payment</span>
          </OutlineButton>
          <OutlineButton onClick={() => navigate('/real-estate/qpr')}>
            <span className="flex items-center gap-2"><FileBarChart size={14} /> Generate QPR</span>
          </OutlineButton>
          <OutlineButton onClick={() => navigate('/real-estate/leakage')}>
            <span className="flex items-center gap-2"><Search size={14} /> Run Leakage Scan</span>
          </OutlineButton>
        </div>
      </Card>

      <DemoBadge show={isDemo} />
    </div>
  );
}
