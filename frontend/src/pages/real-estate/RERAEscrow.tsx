import * as api from '../../services/reraApi';
import type { RERAEscrowTransaction, RERAProject } from '../../services/reraApi';
import { useReraData, AED, DemoBadge, PageHeader, Card, Table, EmptyRow, GOLD, BORDER, MUTED } from './shared';

async function fetchAllEscrow(): Promise<{ tx: RERAEscrowTransaction; project: RERAProject }[]> {
  const { projects } = await api.listProjects();
  const perProject = await Promise.all(
    projects.map(async (project) => {
      const { transactions } = await api.listEscrowTransactions(project.id);
      return transactions.map((tx) => ({ tx, project }));
    }),
  );
  return perProject.flat().sort((a, b) => (b.tx.transaction_date || '').localeCompare(a.tx.transaction_date || ''));
}

export default function RERAEscrow() {
  const rows = useReraData(fetchAllEscrow, [], () => false);
  const projects = useReraData(async () => (await api.listProjects()).projects, [], () => false);

  const currentBalance = projects.data.reduce((s, p) => s + p.escrow_balance, 0);
  const lowBalanceProjects = projects.data.filter((p) => p.escrow_balance < p.total_project_cost * 0.05 && p.total_project_cost > 0);

  let running = currentBalance;
  const withRunning = rows.data.map((r) => {
    const row = { ...r, runningBalance: running };
    running -= r.tx.type === 'deposit' ? r.tx.amount : -r.tx.amount;
    return row;
  });

  return (
    <div>
      <PageHeader title="Escrow" subtitle="RERA escrow account across all projects" />

      <Card className="mb-6">
        <p className="text-xs" style={{ color: MUTED }}>Current Combined Balance</p>
        <p className="text-3xl font-bold mt-1" style={{ color: GOLD }}>{AED(currentBalance)}</p>
      </Card>

      {lowBalanceProjects.length > 0 && (
        <div className="mb-6 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: '#7f1d1d', background: 'rgba(127,29,29,0.2)', color: '#fca5a5' }}>
          ⚠️ {lowBalanceProjects.length} project(s) below 5% escrow-balance threshold: {lowBalanceProjects.map((p) => p.name).join(', ')}
        </div>
      )}

      <Table headers={['Type', 'Amount', 'Date', 'Project', 'Running Balance']}>
        {withRunning.length === 0 ? (
          <EmptyRow colSpan={5} text="No escrow transactions yet." />
        ) : (
          withRunning.map(({ tx, project, runningBalance }) => (
            <tr key={tx.id} className="border-b" style={{ borderColor: BORDER }}>
              <td className="px-4 py-3 capitalize">{tx.type}</td>
              <td className="px-4 py-3">{AED(tx.amount)}</td>
              <td className="px-4 py-3" style={{ color: MUTED }}>{tx.transaction_date || '—'}</td>
              <td className="px-4 py-3">{project.name}</td>
              <td className="px-4 py-3">{AED(runningBalance)}</td>
            </tr>
          ))
        )}
      </Table>

      <DemoBadge show={rows.isDemo || projects.isDemo} />
    </div>
  );
}
