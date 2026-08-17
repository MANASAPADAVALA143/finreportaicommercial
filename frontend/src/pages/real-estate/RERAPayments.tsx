import * as api from '../../services/reraApi';
import type { RERAPayment, RERAProject } from '../../services/reraApi';
import { useReraData, AED, DemoBadge, PageHeader, OutlineButton, Card, Table, EmptyRow, StatusBadge, BORDER, MUTED } from './shared';

/** No global "all payments" endpoint on the backend — fan out per project. */
async function fetchAllPayments(): Promise<{ payment: RERAPayment; project: RERAProject }[]> {
  const { projects } = await api.listProjects();
  const perProject = await Promise.all(
    projects.map(async (project) => {
      const { payments } = await api.listPayments(project.id);
      return payments.map((payment) => ({ payment, project }));
    }),
  );
  return perProject.flat();
}

export default function RERAPayments() {
  const rows = useReraData(fetchAllPayments, [], () => false);

  const totalReceived = rows.data.reduce((s, r) => s + r.payment.net_amount, 0);
  const totalVat = rows.data.reduce((s, r) => s + r.payment.vat_amount + r.payment.gst_amount, 0);
  const pendingCount = rows.data.filter((r) => r.payment.status !== 'received').length;

  const exportCsv = () => {
    const headers = ['Payment Ref', 'Booking', 'Project', 'Amount', 'VAT', 'Total', 'Date', 'Status'];
    const csvRows = rows.data.map((r) => [
      r.payment.id, r.payment.booking_id, r.project.name, r.payment.gross_amount,
      r.payment.vat_amount + r.payment.gst_amount, r.payment.net_amount, r.payment.payment_date || '', r.payment.status,
    ]);
    const csv = [headers, ...csvRows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rera_payments.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader title="Payments" subtitle={`${rows.data.length} payment(s) across all projects`} action={<OutlineButton onClick={exportCsv}>Export CSV</OutlineButton>} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card><p className="text-xs" style={{ color: MUTED }}>Total Received</p><p className="text-xl font-bold mt-1">{AED(totalReceived)}</p></Card>
        <Card><p className="text-xs" style={{ color: MUTED }}>Total VAT</p><p className="text-xl font-bold mt-1">{AED(totalVat)}</p></Card>
        <Card><p className="text-xs" style={{ color: MUTED }}>Pending</p><p className="text-xl font-bold mt-1">{pendingCount}</p></Card>
      </div>

      <Table headers={['Payment Ref', 'Booking', 'Project', 'Amount', 'VAT', 'Total', 'Date', 'Status']}>
        {rows.data.length === 0 ? (
          <EmptyRow colSpan={8} text="No payments logged yet." />
        ) : (
          rows.data.map(({ payment, project }) => (
            <tr key={payment.id} className="border-b" style={{ borderColor: BORDER }}>
              <td className="px-4 py-3 font-mono text-xs">{payment.id.slice(0, 8)}</td>
              <td className="px-4 py-3 font-mono text-xs">{payment.booking_id.slice(0, 8)}</td>
              <td className="px-4 py-3">{project.name}</td>
              <td className="px-4 py-3">{AED(payment.gross_amount)}</td>
              <td className="px-4 py-3">{AED(payment.vat_amount + payment.gst_amount)}</td>
              <td className="px-4 py-3">{AED(payment.net_amount)}</td>
              <td className="px-4 py-3" style={{ color: MUTED }}>{payment.payment_date || '—'}</td>
              <td className="px-4 py-3"><StatusBadge status={payment.status} /></td>
            </tr>
          ))
        )}
      </Table>

      <DemoBadge show={rows.isDemo} />
    </div>
  );
}
