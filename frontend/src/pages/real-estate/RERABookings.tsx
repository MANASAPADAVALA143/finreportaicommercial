import { useState } from 'react';
import * as api from '../../services/reraApi';
import type { RERABooking, RERAProject } from '../../services/reraApi';
import { useReraData, AED, DemoBadge, PageHeader, OutlineButton, Table, EmptyRow, StatusBadge, BORDER, MUTED } from './shared';

/**
 * The backend has no global "all bookings" endpoint — GET /api/rera/bookings
 * requires project_id. This fans out per-project and combines client-side.
 */
async function fetchAllBookings(): Promise<{ booking: RERABooking; project: RERAProject }[]> {
  const { projects } = await api.listProjects();
  const perProject = await Promise.all(
    projects.map(async (project) => {
      const { bookings } = await api.listBookings(project.id);
      return bookings.map((booking) => ({ booking, project }));
    }),
  );
  return perProject.flat();
}

export default function RERABookings() {
  const rows = useReraData(fetchAllBookings, [], () => false);
  const [statusFilter, setStatusFilter] = useState('');

  const filtered = rows.data.filter((r) => !statusFilter || r.booking.status === statusFilter);

  const exportCsv = () => {
    const headers = ['Booking Ref', 'Project', 'Buyer', 'Unit', 'SPA Value', 'Status', 'Booking Date'];
    const csvRows = filtered.map((r) => [r.booking.id, r.project.name, r.booking.customer_name || '', r.booking.unit_number || '', r.booking.total_value, r.booking.status, r.booking.booking_date || '']);
    const csv = [headers, ...csvRows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rera_bookings.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Bookings"
        subtitle={`${filtered.length} booking(s) across all projects`}
        action={<OutlineButton onClick={exportCsv}>Export CSV</OutlineButton>}
      />

      <div className="flex gap-2 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border bg-transparent text-sm text-white"
          style={{ borderColor: BORDER }}
        >
          <option value="" style={{ background: '#0F2035' }}>All statuses</option>
          <option value="active" style={{ background: '#0F2035' }}>Active</option>
          <option value="completed" style={{ background: '#0F2035' }}>Completed</option>
          <option value="cancelled" style={{ background: '#0F2035' }}>Cancelled</option>
        </select>
      </div>

      <Table headers={['Booking Ref', 'Project', 'Buyer', 'Unit', 'SPA Value', 'Status', 'Booking Date']}>
        {filtered.length === 0 ? (
          <EmptyRow colSpan={7} text="No bookings found." />
        ) : (
          filtered.map(({ booking, project }) => (
            <tr key={booking.id} className="border-b" style={{ borderColor: BORDER }}>
              <td className="px-4 py-3 font-mono text-xs">{booking.id.slice(0, 8)}</td>
              <td className="px-4 py-3">{project.name}</td>
              <td className="px-4 py-3">{booking.customer_name || '—'}</td>
              <td className="px-4 py-3">{booking.unit_number || '—'}</td>
              <td className="px-4 py-3">{AED(booking.total_value)}</td>
              <td className="px-4 py-3"><StatusBadge status={booking.status} /></td>
              <td className="px-4 py-3" style={{ color: MUTED }}>{booking.booking_date || '—'}</td>
            </tr>
          ))
        )}
      </Table>

      <DemoBadge show={rows.isDemo} />
    </div>
  );
}
