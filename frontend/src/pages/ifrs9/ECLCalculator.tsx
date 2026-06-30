import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useCompany } from '../../context/CompanyContext';
import { calculateIFRS9ECL, saveIFRS9Portfolio, stageIFRS9Assets, type ECLAsset } from '../../services/ifrs9.service';

const emptyRow = (): ECLAsset => ({ asset_name: '', counterparty: '', exposure_aed: 0, days_past_due: 0, credit_rating: 'Unrated', has_significant_increase_in_credit_risk: false });

export default function ECLCalculator() {
  const { activeCompanyId } = useCompany();
  const [name, setName] = useState('Trade Receivables Portfolio');
  const [assetClass, setAssetClass] = useState('trade_receivables');
  const [assets, setAssets] = useState<ECLAsset[]>([emptyRow(), emptyRow()]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  function stageColor(s?: number) {
    if (s === 3) return 'text-red-400 bg-red-900/30';
    if (s === 2) return 'text-amber-400 bg-amber-900/30';
    return 'text-green-400 bg-green-900/30';
  }

  async function runStage() {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const r = await stageIFRS9Assets(assets, activeCompanyId, assetClass);
      setAssets(r.assets ?? assets);
      toast.success('Assets staged');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Staging failed'); }
    finally { setLoading(false); }
  }

  async function runCalc() {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const r = await calculateIFRS9ECL(assets, activeCompanyId, assetClass);
      setResult(r);
      setAssets(r.assets ?? assets);
      toast.success(`ECL: AED ${Number(r.portfolio_summary?.total_ecl_aed ?? 0).toLocaleString()}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Calc failed'); }
    finally { setLoading(false); }
  }

  async function runSave() {
    if (!activeCompanyId || !result) return;
    try {
      await saveIFRS9Portfolio({
        portfolio_name: name, asset_class: assetClass,
        calculation_date: new Date().toISOString().slice(0, 10),
        assets: result.assets, portfolio_summary: result.portfolio_summary,
      }, activeCompanyId);
      toast.success('Portfolio saved');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
  }

  if (!activeCompanyId) return <div className="min-h-screen bg-gray-950 text-gray-100 p-6 flex items-center justify-center"><p className="text-gray-400">Select a company.</p></div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div><Link to="/ifrs9" className="text-xs text-rose-400">← Dashboard</Link><h1 className="text-2xl font-bold mt-2">ECL Calculator</h1></div>
        <div className="grid grid-cols-2 gap-4">
          <input className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Portfolio name" />
          <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={assetClass} onChange={(e) => setAssetClass(e.target.value)}>
            {['trade_receivables', 'loans', 'loans_secured', 'bonds', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          {assets.map((a, i) => (
            <div key={i} className={`grid grid-cols-6 gap-2 p-2 rounded-lg ${stageColor(a.stage)}`}>
              <input className="bg-gray-800 rounded px-2 py-1 text-xs" placeholder="Asset" value={a.asset_name} onChange={(e) => setAssets((p) => p.map((x, j) => j === i ? { ...x, asset_name: e.target.value } : x))} />
              <input className="bg-gray-800 rounded px-2 py-1 text-xs" placeholder="Counterparty" value={a.counterparty} onChange={(e) => setAssets((p) => p.map((x, j) => j === i ? { ...x, counterparty: e.target.value } : x))} />
              <input type="number" className="bg-gray-800 rounded px-2 py-1 text-xs" placeholder="Exposure" value={a.exposure_aed} onChange={(e) => setAssets((p) => p.map((x, j) => j === i ? { ...x, exposure_aed: Number(e.target.value) } : x))} />
              <input type="number" className="bg-gray-800 rounded px-2 py-1 text-xs" placeholder="DPD" value={a.days_past_due} onChange={(e) => setAssets((p) => p.map((x, j) => j === i ? { ...x, days_past_due: Number(e.target.value) } : x))} />
              <input className="bg-gray-800 rounded px-2 py-1 text-xs" placeholder="Rating" value={a.credit_rating} onChange={(e) => setAssets((p) => p.map((x, j) => j === i ? { ...x, credit_rating: e.target.value } : x))} />
              <span className="text-xs self-center">{a.stage ? `S${a.stage}` : '—'} {a.ecl_recognised_aed ? `ECL ${a.ecl_recognised_aed}` : ''}</span>
            </div>
          ))}
          <button onClick={() => setAssets((p) => [...p, emptyRow()])} className="text-xs text-gray-400">+ Add row</button>
        </div>
        <div className="flex gap-2">
          <button disabled={loading} onClick={() => void runStage()} className="bg-gray-700 px-4 py-2 rounded-lg text-sm">Stage Assets</button>
          <button disabled={loading} onClick={() => void runCalc()} className="bg-rose-800 px-4 py-2 rounded-lg text-sm">Calculate ECL</button>
          <button disabled={!result} onClick={() => void runSave()} className="bg-rose-700 px-4 py-2 rounded-lg text-sm">Save Portfolio</button>
        </div>
        {result && <p className="text-sm text-rose-300">Total ECL: AED {Number((result.portfolio_summary as Record<string, number>)?.total_ecl_aed ?? 0).toLocaleString()}</p>}
      </div>
    </div>
  );
}
