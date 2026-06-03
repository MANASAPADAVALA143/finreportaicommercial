/**
 * Fixed Assets — IFRS depreciation + UAE CT Ministerial Decision 134
 * Side-by-side IFRS vs CT book values
 */
import { useEffect, useState } from 'react';
import { Building2, Plus, Zap, ChevronDown, ChevronRight } from 'lucide-react';
import * as svc from '../../services/uaeFullAccounting.service';
import type { FixedAsset } from '../../services/uaeFullAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);

const CATEGORIES = ['Computer', 'Vehicle', 'Furniture', 'Machinery', 'Building', 'Intangible'];

const CT_RATES: Record<string, string> = {
  Computer: '33.3%',
  Vehicle:  '20%',
  Furniture:'20%',
  Machinery:'20%',
  Building: '4%',
  Intangible:'10%',
};

export default function FixedAssets() {
  const [assets, setAssets]       = useState<FixedAsset[]>([]);
  const [schedule, setSchedule]   = useState<{ asset_id: string; schedule: any[] } | null>(null);
  const [period, setPeriod]       = useState(THIS_PERIOD);
  const [loading, setLoading]     = useState(true);
  const [running, setRunning]     = useState(false);
  const [error, setError]         = useState('');
  const [msg, setMsg]             = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    svc.listAssets()
      .then(d => setAssets(d.assets))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleRunDep = async () => {
    setRunning(true); setError(''); setMsg('');
    try {
      const r = await svc.runDepreciation(period);
      setMsg(`Depreciation run: ${r.assets_processed} assets | IFRS AED ${r.total_ifrs_depreciation?.toLocaleString()} | CT AED ${r.total_ct_depreciation?.toLocaleString()}`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!schedule || schedule.asset_id !== id) {
      const s = await svc.getDepreciationSchedule(id).catch(() => null);
      if (s) setSchedule(s);
    }
  };

  const totalCost     = assets.reduce((s, a) => s + a.cost, 0);
  const totalNBV      = assets.reduce((s, a) => s + a.net_book_value, 0);
  const totalCTNBV    = assets.reduce((s, a) => s + a.ct_net_book_value, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Fixed Assets</h1>
          <p className="text-gray-400 text-sm mt-1">IFRS Depreciation + UAE CT Ministerial Decision 134</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month" value={period}
            onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
          />
          <button
            onClick={handleRunDep}
            disabled={running}
            className="flex items-center gap-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Zap size={14} /> {running ? 'Running…' : 'Run Depreciation'}
          </button>
          <button className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 px-4 py-2 rounded-lg text-sm font-medium">
            <Plus size={14} /> Add Asset
          </button>
        </div>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-purple-900/40 text-purple-300 border border-purple-700'}`}>
          {error || msg}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Cost',    value: `AED ${totalCost.toLocaleString()}`,  color: 'text-blue-400' },
          { label: 'IFRS Net Book', value: `AED ${totalNBV.toLocaleString()}`,   color: 'text-green-400' },
          { label: 'CT Net Book',   value: `AED ${totalCTNBV.toLocaleString()}`, color: 'text-purple-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-lg font-bold ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* CT Rates Reference */}
      <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4 mb-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">CT Depreciation Rates (MoF Decision 134)</p>
        <div className="flex gap-4 flex-wrap">
          {Object.entries(CT_RATES).map(([cat, rate]) => (
            <div key={cat} className="bg-gray-900/60 rounded-lg px-3 py-2 text-center">
              <p className="text-xs text-gray-500">{cat}</p>
              <p className="text-sm font-bold text-purple-400">{rate}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Assets Table */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80">
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold w-6"></th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Code</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Asset Name</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Category</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Acquired</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Cost</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">IFRS NBV</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">CT NBV</th>
              <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 bg-gray-700 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : assets.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                  No assets yet. Click "Add Asset" to register your first fixed asset.
                </td>
              </tr>
            ) : (
              assets.map(a => (
                <>
                  <tr
                    key={a.id}
                    className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors cursor-pointer"
                    onClick={() => handleExpand(a.id)}
                  >
                    <td className="px-4 py-3 text-gray-500">
                      {expandedId === a.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </td>
                    <td className="px-4 py-3 font-mono text-blue-400 text-xs">{a.asset_code}</td>
                    <td className="px-4 py-3 text-white">{a.asset_name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{a.asset_category}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{a.acquisition_date}</td>
                    <td className="px-4 py-3 text-right text-white text-xs">{a.cost.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-green-400 text-xs">{a.net_book_value.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-purple-400 text-xs">{a.ct_net_book_value.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${a.status === 'active' ? 'border-green-700 text-green-400 bg-green-900/30' : 'border-gray-600 text-gray-400'}`}>
                        {a.status}
                      </span>
                    </td>
                  </tr>
                  {expandedId === a.id && schedule?.asset_id === a.id && (
                    <tr key={`${a.id}-sched`}>
                      <td colSpan={9} className="bg-gray-900/60 px-6 py-4 border-b border-gray-700">
                        <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">Depreciation Schedule</p>
                        <div className="overflow-x-auto">
                          <table className="text-xs w-full">
                            <thead>
                              <tr className="text-gray-500">
                                <th className="text-left py-1 pr-4 font-normal">Year</th>
                                <th className="text-right py-1 pr-4 font-normal">IFRS Dep</th>
                                <th className="text-right py-1 pr-4 font-normal">IFRS NBV</th>
                                <th className="text-right py-1 pr-4 font-normal">CT Dep</th>
                                <th className="text-right py-1 font-normal">CT NBV</th>
                              </tr>
                            </thead>
                            <tbody>
                              {schedule.schedule.map((r: any) => (
                                <tr key={r.year} className="border-t border-gray-800">
                                  <td className="py-1 pr-4 text-gray-300">{r.year}</td>
                                  <td className="py-1 pr-4 text-right text-amber-400">{(r.ifrs_depreciation ?? 0).toLocaleString()}</td>
                                  <td className="py-1 pr-4 text-right text-green-400">{(r.ifrs_closing_nbv ?? 0).toLocaleString()}</td>
                                  <td className="py-1 pr-4 text-right text-amber-400">{(r.ct_depreciation ?? 0).toLocaleString()}</td>
                                  <td className="py-1 text-right text-purple-400">{(r.ct_closing_nbv ?? 0).toLocaleString()}</td>
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
