import { useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCompany } from '../../context/CompanyContext';
import { downloadAuditPdf } from '../../services/ifrs16.service';

export default function IFRS16Audit() {
  const { activeCompanyId, activeCompany } = useCompany();
  const [period, setPeriod] = useState(format(new Date(), 'yyyy-MM'));
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      await downloadAuditPdf(activeCompanyId, { periodDate: period });
      toast.success('Audit PDF downloaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF export failed');
    } finally {
      setLoading(false);
    }
  }

  if (!activeCompanyId) {
    return <div className="min-h-screen bg-gray-950 text-gray-100 p-6 flex items-center justify-center"><p className="text-gray-400">Select a company first.</p></div>;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <p className="text-xs text-teal-400 uppercase tracking-widest mb-1">IFRS 16</p>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileText size={22} /> Audit Report</h1>
        </div>
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-6 space-y-4">
          <p className="text-sm text-gray-400">Company: <span className="text-gray-200">{activeCompany?.company_name ?? activeCompanyId}</span></p>
          <label className="block text-sm">
            <span className="text-gray-400 text-xs">Reporting period</span>
            <input type="month" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </label>
          <p className="text-xs text-gray-500">Generates portfolio summary, per-lease schedules, maturity analysis, and IFRS 16 disclosure note.</p>
          <button disabled={loading} onClick={() => void handleDownload()} className="w-full bg-teal-700 hover:bg-teal-600 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
            {loading ? 'Generating…' : 'Download Audit PDF'}
          </button>
        </div>
        <Link to="/ifrs/16/leases" className="text-sm text-gray-400 hover:text-teal-400">← Lease Register</Link>
      </div>
    </div>
  );
}
