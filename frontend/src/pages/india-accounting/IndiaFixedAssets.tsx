/**
 * India Fixed Assets — Ind AS 16, Companies Act WDV rates
 */
import { useEffect, useState } from 'react';
import { TrendingUp, Zap, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import * as svc from '../../services/indiaAccounting.service';
import type { IndiaFixedAsset } from '../../services/indiaAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);
const INR = (v: number) => `₹${v.toLocaleString('en-IN')}`;

const WDV_RATES: Record<string, string> = {
  Computer: '63.16%', Vehicle: '25.89%', Furniture: '18.10%',
  Plant: '13.91%', Building: '5.0%', Intangible: '25.0%',
};

const SLM_RATES: Record<string, string> = {
  Computer: '33.33%', Vehicle: '12.50%', Furniture: '10.0%',
  Plant: '6.67%', Building: '3.33%', Intangible: '20.0%',
};

export default function IndiaFixedAssets() {
  const [assets, setAssets]       = useState<IndiaFixedAsset[]>([]);
  const [period, setPeriod]       = useState(THIS_PERIOD);
  const [loading, setLoading]     = useState(true);
  const [running, setRunning]     = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [schedule, setSchedule]   = useState<{ asset_id: string; schedule: any[] } | null>(null);
  const [error, setError]         = useState('');
  const [msg, setMsg]             = useState('');

  const load = () => {
    setLoading(true);
    svc.listIndiaAssets()
      .then(d => setAssets(d.assets))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleRunDep = async () => {
    setRunning(true); setError(''); setMsg('');
    try {
      const r = await svc.runIndiaDepreciation(period);
      setMsg(`Depreciation run: ${r.assets_processed} assets | ₹${r.total_depreciation.toLocaleString('en-IN')}`);
      load();
    } catch (e: any) { setError(e.message); } finally { setRunning(false); }
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!schedule || schedule.asset_id !== id) {
      const s = await svc.getIndiaDepreciationSchedule(id).catch(() => null);
      if (s) setSchedule(s);
    }
  };

  const totalCost = assets.reduce((s, a) => s + a.purchase_cost, 0);
  const totalNBV  = assets.reduce((s, a) => s + a.net_book_value, 0);
  const totalDep  = assets.reduce((s, a) => s + a.accumulated_depreciation, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Fixed Assets</h1>
          <p className="text-gray-400 text-sm mt-1">Ind AS 16 — SLM &amp; WDV (Companies Act 2013 Schedule II)</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm" />
          <button onClick={handleRunDep} disabled={running}
            className="flex items-center gap-2 bg-pink-700 hover:bg-pink-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium">
            <Zap size={14} /> {running ? 'Running…' : 'Run Depreciation'}
          </button>
          <button className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 px-4 py-2 rounded-lg text-sm font-medium">
            <Plus size={14} /> Add Asset
          </button>
        </div>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-pink-900/40 text-pink-300 border border-pink-700'}`}>
          {error || msg}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Gross Block',           value: INR(totalCost), color: 'text-white' },
          { label: 'Accumulated Dep.',       value: INR(totalDep),  color: 'text-red-400' },
          { label: 'Net Book Value (Ind AS)',value: INR(totalNBV),  color: 'text-pink-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-lg font-bold ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* WDV Rates Reference — Companies Act Schedule II */}
      <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4 mb-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Companies Act 2013 — Schedule II Rates</p>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(WDV_RATES).map(([cat, rate]) => (
            <div key={cat} className="bg-gray-900/60 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500">{cat}</p>
              <div className="flex justify-between mt-1">
                <div>
                  <p className="text-xs text-gray-600">WDV</p>
                  <p className="text-sm font-bold text-pink-400">{rate}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-600">SLM</p>
                  <p className="text-sm font-bold text-blue-400">{SLM_RATES[cat]}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Assets Table */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80">
              <th className="px-4 py-3 w-6"></th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Code</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Asset Name</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Category</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Method</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Date</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Cost</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Acc. Dep</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">NBV</th>
              <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  {Array.from({ length: 10 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-700 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : assets.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                  No assets. Click "Add Asset" to register your first fixed asset.
                </td>
              </tr>
            ) : (
              assets.map(a => (
                <>
                  <tr key={a.id}
                    className="border-b border-gray-700/30 hover:bg-gray-700/20 cursor-pointer"
                    onClick={() => handleExpand(a.id)}>
                    <td className="px-4 py-3 text-gray-500">
                      {expandedId === a.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </td>
                    <td className="px-4 py-3 font-mono text-pink-400 text-xs">{a.asset_code}</td>
                    <td className="px-4 py-3 text-white text-sm">{a.name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{a.category}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded border ${a.depreciation_method === 'WDV' ? 'border-pink-700 text-pink-400' : 'border-blue-700 text-blue-400'}`}>
                        {a.depreciation_method}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{a.purchase_date}</td>
                    <td className="px-4 py-3 text-right text-white text-xs">{INR(a.purchase_cost)}</td>
                    <td className="px-4 py-3 text-right text-red-400 text-xs">{INR(a.accumulated_depreciation)}</td>
                    <td className="px-4 py-3 text-right text-pink-400 font-medium text-xs">{INR(a.net_book_value)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${a.status === 'active' ? 'border-emerald-700 text-emerald-400 bg-emerald-900/20' : 'border-gray-600 text-gray-400'}`}>
                        {a.status}
                      </span>
                    </td>
                  </tr>
                  {expandedId === a.id && schedule?.asset_id === a.id && (
                    <tr key={`${a.id}-sched`}>
                      <td colSpan={10} className="bg-gray-900/60 px-6 py-4 border-b border-gray-700">
                        <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">
                          Depreciation Schedule — {schedule.method || a.depreciation_method}
                        </p>
                        <div className="overflow-x-auto">
                          <table className="text-xs w-full">
                            <thead>
                              <tr className="text-gray-500">
                                <th className="text-left py-1 pr-4 font-normal">Year</th>
                                <th className="text-right py-1 pr-4 font-normal">Depreciation</th>
                                <th className="text-right py-1 font-normal">Closing NBV</th>
                              </tr>
                            </thead>
                            <tbody>
                              {schedule.schedule.map((r: any) => (
                                <tr key={r.year} className="border-t border-gray-800">
                                  <td className="py-1 pr-4 text-gray-300">{r.year}</td>
                                  <td className="py-1 pr-4 text-right text-amber-400">{INR(r.depreciation ?? 0)}</td>
                                  <td className="py-1 text-right text-pink-400">{INR(r.closing_nbv ?? 0)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
