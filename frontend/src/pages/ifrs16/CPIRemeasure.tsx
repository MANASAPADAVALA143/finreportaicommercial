import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { fetchLeases, type LeaseRecord } from '../../services/ifrs16.service';
import { CPIRemeasureModal } from './CPIRemeasureModal';

export default function CPIRemeasure() {
  const { activeCompanyId } = useCompany();
  const [leases, setLeases] = useState<LeaseRecord[]>([]);
  const [selected, setSelected] = useState<LeaseRecord | null>(null);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const ls = await fetchLeases(activeCompanyId, { status: 'active' });
    setLeases(ls);
  }, [activeCompanyId]);

  useEffect(() => { void load(); }, [load]);

  if (!activeCompanyId) {
    return <div className="min-h-screen bg-gray-950 text-gray-100 p-6 flex items-center justify-center"><p className="text-gray-400">Select a company first.</p></div>;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <p className="text-xs text-teal-400 uppercase tracking-widest mb-1">IFRS 16</p>
          <h1 className="text-2xl font-bold flex items-center gap-2"><TrendingUp size={22} /> CPI Remeasurement</h1>
          <p className="text-gray-400 text-sm mt-1">Select a lease to remeasure when payments change due to CPI/index</p>
        </div>
        <div className="space-y-2">
          {leases.map((l) => (
            <button
              key={l.id}
              onClick={() => setSelected(l)}
              className="w-full text-left bg-gray-900/60 border border-gray-800 rounded-xl p-4 hover:border-teal-700 transition"
            >
              <p className="font-medium">{l.lease_name}</p>
              <p className="text-xs text-gray-500 mt-1">Liability: AED {(l.lease_liability_current ?? 0).toLocaleString()} · Next remeasure: {l.next_remeasurement_date?.slice(0, 10) ?? '—'}</p>
            </button>
          ))}
          {leases.length === 0 && <p className="text-gray-500 text-sm">No active leases. <Link to="/ifrs/16" className="text-teal-400">Add a lease</Link></p>}
        </div>
        <Link to="/ifrs/16/leases" className="text-sm text-gray-400 hover:text-teal-400">← Lease Register</Link>
      </div>
      {selected && activeCompanyId && (
        <CPIRemeasureModal lease={selected} companyId={activeCompanyId} onClose={() => setSelected(null)} onDone={() => { setSelected(null); void load(); }} />
      )}
    </div>
  );
}
