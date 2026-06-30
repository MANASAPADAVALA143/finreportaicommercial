import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Shield } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { fetchIFRS9Dashboard, postIFRS9ProvisionJE } from '../../services/ifrs9.service';

function fmt(n: number) { return `AED ${(n ?? 0).toLocaleString('en-AE', { maximumFractionDigits: 0 })}`; }

export default function IFRS9Dashboard() {
  const { activeCompanyId } = useCompany();
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    try { setData(await fetchIFRS9Dashboard(activeCompanyId)); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Load failed'); }
  }, [activeCompanyId]);

  useEffect(() => { void load(); }, [load]);

  if (!activeCompanyId) return <div className="min-h-screen bg-gray-950 text-gray-100 p-6 flex items-center justify-center"><p className="text-gray-400">Select a company.</p></div>;

  const ports = (data?.portfolios as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between">
          <div><p className="text-xs text-rose-400 uppercase">IFRS 9</p><h1 className="text-2xl font-bold flex items-center gap-2"><Shield size={22} /> ECL Dashboard</h1></div>
          <Link to="/ifrs9/calculator" className="text-sm bg-rose-800 px-4 py-2 rounded-lg">ECL Calculator →</Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { l: 'Total exposure', v: fmt(Number(data?.total_exposure_aed)) },
            { l: 'Total ECL', v: fmt(Number(data?.total_ecl_aed)) },
            { l: 'Coverage %', v: `${Number(data?.ecl_coverage_ratio_pct ?? 0).toFixed(1)}%` },
            { l: 'Stage 3 %', v: `${Number(data?.stage3_pct ?? 0).toFixed(1)}%` },
            { l: 'Last calc', v: String(data?.last_calculation_date ?? '—') },
          ].map((c) => (
            <div key={c.l} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500">{c.l}</p><p className="text-lg font-bold text-rose-400">{c.v}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-4 text-sm">
          <span className="text-green-400">Stage 1: {Number(data?.stage1_pct ?? 0).toFixed(0)}%</span>
          <span className="text-amber-400">Stage 2: {Number(data?.stage2_pct ?? 0).toFixed(0)}%</span>
          <span className="text-red-400">Stage 3: {Number(data?.stage3_pct ?? 0).toFixed(0)}%</span>
        </div>
        <table className="w-full text-xs bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
          <thead className="bg-gray-800 text-gray-400"><tr>
            {['Portfolio', 'Class', 'Exposure', 'ECL', 'Coverage', 'Actions'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
          </tr></thead>
          <tbody>
            {ports.map((p) => (
              <tr key={String(p.id)} className="border-t border-gray-800">
                <td className="px-3 py-2">{String(p.portfolio_name)}</td>
                <td className="px-3 py-2">{String(p.asset_class)}</td>
                <td className="px-3 py-2">{fmt(Number(p.total_exposure_aed))}</td>
                <td className="px-3 py-2">{fmt(Number(p.total_ecl_aed))}</td>
                <td className="px-3 py-2">{Number(p.total_exposure_aed) ? ((Number(p.total_ecl_aed) / Number(p.total_exposure_aed)) * 100).toFixed(1) : 0}%</td>
                <td className="px-3 py-2">
                  <button className="text-rose-400" onClick={() => void postIFRS9ProvisionJE(String(p.id), new Date().toISOString().slice(0, 10), activeCompanyId).then(() => { toast.success('ECL JE posted'); void load(); })}>Post JE</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
