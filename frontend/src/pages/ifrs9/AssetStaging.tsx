import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useCompany } from '../../context/CompanyContext';
import { stageIFRS9Assets, type ECLAsset } from '../../services/ifrs9.service';

export default function AssetStaging() {
  const { activeCompanyId } = useCompany();
  const [assets, setAssets] = useState<ECLAsset[]>([
    { asset_name: 'Invoice #1001', counterparty: 'Customer A', exposure_aed: 50000, days_past_due: 15, credit_rating: 'BBB' },
    { asset_name: 'Invoice #1002', counterparty: 'Customer B', exposure_aed: 120000, days_past_due: 45, credit_rating: 'BB', has_significant_increase_in_credit_risk: true },
    { asset_name: 'Invoice #1003', counterparty: 'Customer C', exposure_aed: 80000, days_past_due: 95, credit_rating: 'B' },
  ]);
  const [staged, setStaged] = useState<ECLAsset[] | null>(null);

  async function run() {
    if (!activeCompanyId) return;
    try {
      const r = await stageIFRS9Assets(assets, activeCompanyId);
      setStaged(r.assets);
      toast.success('Staging complete');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  }

  function rowClass(s?: number) {
    if (s === 3) return 'bg-red-950/40 border-red-800';
    if (s === 2) return 'bg-amber-950/40 border-amber-800';
    return 'bg-green-950/30 border-green-900';
  }

  const rows = staged ?? assets;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <Link to="/ifrs9" className="text-xs text-rose-400">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Asset Staging</h1>
        <button onClick={() => void run()} className="bg-rose-800 px-4 py-2 rounded-lg text-sm">Run Staging</button>
        <div className="space-y-2">
          {rows.map((a, i) => (
            <div key={i} className={`border rounded-xl p-4 grid grid-cols-4 gap-2 text-sm ${rowClass(a.stage)}`}>
              <span>{a.asset_name}</span><span>{a.counterparty}</span>
              <span>AED {a.exposure_aed?.toLocaleString()} · {a.days_past_due} DPD</span>
              <span className="font-bold">{a.stage ? `Stage ${a.stage}` : 'Pending'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
