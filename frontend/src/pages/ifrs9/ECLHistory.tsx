import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCompany } from '../../context/CompanyContext';
import { fetchIFRS9Portfolios } from '../../services/ifrs9.service';

export default function ECLHistory() {
  const { activeCompanyId } = useCompany();
  const [ports, setPorts] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    void fetchIFRS9Portfolios(activeCompanyId).then(setPorts);
  }, [activeCompanyId]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <Link to="/ifrs9" className="text-xs text-rose-400">← Dashboard</Link>
        <h1 className="text-2xl font-bold">ECL History</h1>
        <table className="w-full text-xs border border-gray-800 rounded-xl overflow-hidden">
          <thead className="bg-gray-800 text-gray-400"><tr>
            {['Period', 'Portfolio', 'Total ECL', 'JE Posted', 'Created'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
          </tr></thead>
          <tbody>
            {ports.map((p) => (
              <tr key={String(p.id)} className="border-t border-gray-800">
                <td className="px-3 py-2">{String(p.calculation_date ?? '—')}</td>
                <td className="px-3 py-2">{String(p.portfolio_name)}</td>
                <td className="px-3 py-2">AED {Number(p.total_ecl_aed ?? 0).toLocaleString()}</td>
                <td className="px-3 py-2">{p.je_posted ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2">{String(p.created_at ?? '').slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
