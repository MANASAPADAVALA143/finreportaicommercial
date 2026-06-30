import { useEffect, useState } from 'react';
import { gulfTaxPost, gulfTaxGet } from '../../services/gulfTaxApi';
import { useCompany } from '../../context/CompanyContext';

const ACTIVITIES = [
  'Banking',
  'Insurance',
  'Investment Fund Management',
  'Lease Finance',
  'Headquarters',
  'Shipping',
  'Holding Company',
  'Intellectual Property',
  'Distribution and Service Centre',
  'None / Not Applicable',
];

type ESRResult = {
  activity_type: string;
  passes_dm_test: boolean;
  passes_ciga_test: boolean;
  passes_adequacy_test: boolean;
  overall_status: string;
  notification_deadline?: string;
  filing_deadline?: string;
  explanations?: Record<string, string>;
};

export default function ESRFiling() {
  const { activeCompanyId } = useCompany();
  const [activity, setActivity] = useState(ACTIVITIES[0]);
  const [dm, setDm] = useState(true);
  const [ciga, setCiga] = useState(true);
  const [employees, setEmployees] = useState(5);
  const [spend, setSpend] = useState(250000);
  const [assets, setAssets] = useState(100000);
  const [result, setResult] = useState<ESRResult | null>(null);
  const [deadlines, setDeadlines] = useState<{ notification_deadline: string; filing_deadline: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStatus = async () => {
    try {
      const data = await gulfTaxGet<{ notification_deadline: string; filing_deadline: string }>('/api/gulftax/esr/status');
      setDeadlines(data);
    } catch {
      setDeadlines(null);
    }
  };

  useEffect(() => { void loadStatus(); }, []);

  const calculate = async () => {
    setLoading(true);
    try {
      const data = await gulfTaxPost<ESRResult>('/api/gulftax/esr/calculate', {
        activity_type: activity,
        directors_meetings_in_uae: dm,
        ciga_in_uae: ciga,
        employee_count_uae: employees,
        expenditure_uae_aed: spend,
        assets_uae_aed: assets,
      });
      setResult(data);
    } catch (e) {
      setResult(null);
      alert(e instanceof Error ? e.message : 'ESR calculation failed');
    } finally {
      setLoading(false);
    }
  };

  const statusColor =
    result?.overall_status === 'PASS'
      ? 'text-green-400 border-green-500/40 bg-green-500/10'
      : result?.overall_status === 'EXEMPT'
        ? 'text-gray-400 border-gray-500/40 bg-gray-500/10'
        : 'text-red-400 border-red-500/40 bg-red-500/10';

  return (
    <div>
      <p className="text-[11px] font-mono uppercase tracking-widest text-amber-500 mb-1">Compliance</p>
      <h1 className="text-2xl font-bold text-white mb-2">ESR Filing</h1>
      <p className="text-sm text-gray-400 mb-6">Economic Substance Regulations — substance tests for relevant activities</p>

      {deadlines && (
        <p className="text-xs text-gray-500 mb-4">
          Notification by {deadlines.notification_deadline} · Report by {deadlines.filing_deadline}
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-white/10 p-5 space-y-4">
          <label className="block text-sm text-gray-400">
            Relevant activity
            <select
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
              className="mt-1 w-full bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-white"
            >
              {ACTIVITIES.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={dm} onChange={(e) => setDm(e.target.checked)} />
            Directed &amp; managed in UAE (board meetings)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={ciga} onChange={(e) => setCiga(e.target.checked)} />
            CIGAs performed in UAE
          </label>
          <label className="block text-sm text-gray-400">
            UAE employees
            <input type="number" value={employees} onChange={(e) => setEmployees(Number(e.target.value))} className="mt-1 w-full bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-white" />
          </label>
          <label className="block text-sm text-gray-400">
            UAE expenditure (AED)
            <input type="number" value={spend} onChange={(e) => setSpend(Number(e.target.value))} className="mt-1 w-full bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-white" />
          </label>
          <label className="block text-sm text-gray-400">
            UAE assets (AED)
            <input type="number" value={assets} onChange={(e) => setAssets(Number(e.target.value))} className="mt-1 w-full bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-white" />
          </label>
          <button
            type="button"
            disabled={loading || !activeCompanyId}
            onClick={() => void calculate()}
            className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Calculating…' : 'Calculate ESR Status'}
          </button>
        </div>

        {result && (
          <div className={`rounded-xl border p-5 ${statusColor}`}>
            <div className="text-3xl font-black mb-2">{result.overall_status}</div>
            <p className="text-sm mb-4">{result.activity_type}</p>
            <ul className="text-sm space-y-2">
              <li>DM test: {result.passes_dm_test ? '✅ Pass' : '❌ Fail'}</li>
              <li>CIGA test: {result.passes_ciga_test ? '✅ Pass' : '❌ Fail'}</li>
              <li>Adequacy test: {result.passes_adequacy_test ? '✅ Pass' : '❌ Fail'}</li>
            </ul>
            {result.explanations && (
              <div className="mt-4 text-xs space-y-1 opacity-90">
                {Object.entries(result.explanations).map(([k, v]) => (
                  <p key={k}><span className="uppercase font-mono">{k}:</span> {v}</p>
                ))}
              </div>
            )}
            {result.filing_deadline && (
              <p className="mt-4 text-xs">Filing deadline: {result.filing_deadline}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
