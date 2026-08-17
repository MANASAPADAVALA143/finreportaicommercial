import * as api from '../../services/reraApi';
import { useReraData, AED, DemoBadge, PageHeader, Card, Table, EmptyRow, BORDER, MUTED, GOLD } from './shared';

interface LeaseRow {
  spa_id: string;
  lease_liability: number | null;
  rou_asset: number | null;
  ok: boolean;
}

async function fetchLeases(): Promise<{ status: { available: boolean; source: string }; leases: LeaseRow[] }> {
  const [status, { spa_ids }] = await Promise.all([api.ifrs16Status(), api.ifrs16Leases()]);
  const leases = await Promise.all(
    spa_ids.map(async (spa_id): Promise<LeaseRow> => {
      try {
        const detail = await api.ifrs16LeaseDetail(spa_id);
        return {
          spa_id,
          lease_liability: (detail.schedule.lease_liability as number) ?? null,
          rou_asset: (detail.schedule.rou_asset as number) ?? null,
          ok: true,
        };
      } catch {
        return { spa_id, lease_liability: null, rou_asset: null, ok: false };
      }
    }),
  );
  return { status, leases };
}

const DEMO_RESULT = {
  status: { available: true, source: 'local_module' },
  leases: [
    { spa_id: 'SPA-2201', lease_liability: 4_200_000, rou_asset: 4_050_000, ok: true },
    { spa_id: 'SPA-2214', lease_liability: 2_800_000, rou_asset: 2_690_000, ok: true },
  ] as LeaseRow[],
};

export default function RERAIFRS16() {
  const data = useReraData(fetchLeases, DEMO_RESULT, (d) => d.leases.length === 0);

  const totalRou = data.data.leases.reduce((s, l) => s + (l.rou_asset || 0), 0);
  const totalLiability = data.data.leases.reduce((s, l) => s + (l.lease_liability || 0), 0);

  return (
    <div>
      <PageHeader
        title="IFRS 16 Leases"
        subtitle={`Source: ${data.data.status.source === 'local_module' ? 'local IFRS 16 engine' : data.data.status.source}`}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card><p className="text-xs" style={{ color: MUTED }}>Total Leases</p><p className="text-xl font-bold mt-1">{data.data.leases.length}</p></Card>
        <Card><p className="text-xs" style={{ color: MUTED }}>Total ROU Asset</p><p className="text-xl font-bold mt-1">{AED(totalRou)}</p></Card>
        <Card><p className="text-xs" style={{ color: MUTED }}>Total Lease Liability</p><p className="text-xl font-bold mt-1">{AED(totalLiability)}</p></Card>
      </div>

      <Table headers={['SPA ID', 'ROU Asset', 'Lease Liability', 'Status']}>
        {data.data.leases.length === 0 ? (
          <EmptyRow colSpan={4} text="No leases found — RERA bookings need a usable payment schedule to amortize." />
        ) : (
          data.data.leases.map((l) => (
            <tr key={l.spa_id} className="border-b" style={{ borderColor: BORDER }}>
              <td className="px-4 py-3 font-mono text-xs">{l.spa_id}</td>
              <td className="px-4 py-3">{l.ok ? AED(l.rou_asset) : '—'}</td>
              <td className="px-4 py-3">{l.ok ? AED(l.lease_liability) : '—'}</td>
              <td className="px-4 py-3">{l.ok ? 'Computed' : 'Unavailable'}</td>
            </tr>
          ))
        )}
      </Table>

      <a
        href="https://ifrsai.onrender.com"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-sm mt-4 underline"
        style={{ color: GOLD }}
      >
        Open full IFRS 16 module →
      </a>

      <DemoBadge show={data.isDemo} />
    </div>
  );
}
