import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Percent } from 'lucide-react';
import { IBR_STORAGE_KEY } from '../../services/ifrs16.service';

const CREDIT_SPREADS: Record<string, number> = {
  AAA: 0.5, AA: 0.75, A: 1.0, BBB: 1.5, BB: 2.5, B: 4.0, Unrated: 3.0,
};

function termAdj(years: number): number {
  if (years < 2) return -0.25;
  if (years <= 5) return 0;
  if (years <= 10) return 0.25;
  return 0.5;
}

export default function IBRTool() {
  const navigate = useNavigate();
  const [riskFree, setRiskFree] = useState(4.5);
  const [rating, setRating] = useState('BBB');
  const [size, setSize] = useState('Large');
  const [assetType, setAssetType] = useState('Property');
  const [termYears, setTermYears] = useState(5);
  const [liquidity, setLiquidity] = useState(0.25);

  const result = useMemo(() => {
    const spread = CREDIT_SPREADS[rating] ?? 3.0;
    const sizeAdj = size === 'SME' ? 0.5 : size === 'Small' ? 0.25 : 0;
    const term = termAdj(termYears);
    const ibr = riskFree + spread + liquidity + term + sizeAdj;
    return { ibr, spread, term, sizeAdj };
  }, [riskFree, rating, size, termYears, liquidity]);

  function useIbr() {
    localStorage.setItem(IBR_STORAGE_KEY, String(result.ibr / 100));
    navigate('/ifrs/16');
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <p className="text-xs text-teal-400 uppercase tracking-widest mb-1">IFRS 16</p>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Percent size={22} /> IBR Benchmark Tool</h1>
          <p className="text-gray-400 text-sm mt-1">Estimate incremental borrowing rate per IFRS 16 paragraph 26</p>
        </div>

        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-6 space-y-5">
          <h2 className="text-sm font-semibold text-teal-400">Step 1 — Lessee profile</h2>
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm"><span className="text-gray-400 text-xs">Country</span>
              <input disabled value="UAE" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm opacity-60" />
            </label>
            <label className="text-sm"><span className="text-gray-400 text-xs">Credit rating</span>
              <select className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={rating} onChange={(e) => setRating(e.target.value)}>
                {Object.keys(CREDIT_SPREADS).map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label className="text-sm col-span-2"><span className="text-gray-400 text-xs">Company size</span>
              <select className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={size} onChange={(e) => setSize(e.target.value)}>
                {['Large', 'Medium', 'Small', 'SME'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <h2 className="text-sm font-semibold text-teal-400">Step 2 — Lease profile</h2>
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm"><span className="text-gray-400 text-xs">Asset type</span>
              <select className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={assetType} onChange={(e) => setAssetType(e.target.value)}>
                {['Property', 'Vehicle', 'Equipment'].map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
            <label className="text-sm"><span className="text-gray-400 text-xs">Lease term (years)</span>
              <input type="number" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={termYears} onChange={(e) => setTermYears(Number(e.target.value))} />
            </label>
          </div>

          <h2 className="text-sm font-semibold text-teal-400">Step 3 — Market rates</h2>
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm"><span className="text-gray-400 text-xs">UAE risk-free rate (%)</span>
              <input type="number" step="0.1" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={riskFree} onChange={(e) => setRiskFree(Number(e.target.value))} />
            </label>
            <label className="text-sm"><span className="text-gray-400 text-xs">Liquidity premium (%)</span>
              <input type="number" step="0.05" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={liquidity} onChange={(e) => setLiquidity(Number(e.target.value))} />
            </label>
            <p className="col-span-2 text-xs text-gray-500">Credit spread ({rating}): +{result.spread}% · Term adj: {result.term >= 0 ? '+' : ''}{result.term}% · Size adj: +{result.sizeAdj}%</p>
          </div>
        </div>

        <div className="bg-teal-900/30 border border-teal-800 rounded-xl p-6">
          <p className="text-3xl font-bold text-teal-300">Suggested IBR: {result.ibr.toFixed(2)}%</p>
          <p className="text-sm text-gray-400 mt-2">
            Basis: UAE risk-free ({riskFree}%) + credit spread {rating} ({result.spread}%) + liquidity ({liquidity}%) + term adj ({result.term}%)
          </p>
          <p className="text-xs text-gray-500 mt-4 border-t border-gray-700 pt-3">
            This is an estimate. IFRS 16 paragraph 26 requires the rate a lessee would pay to borrow funds to obtain an asset of similar value in a similar economic environment. Consult your auditor.
          </p>
          <button onClick={useIbr} className="mt-4 bg-teal-700 hover:bg-teal-600 px-5 py-2 rounded-lg text-sm font-medium">
            Use This IBR → Calculator
          </button>
        </div>

        <Link to="/ifrs/16/leases" className="text-sm text-gray-400 hover:text-teal-400">← Back to Lease Register</Link>
      </div>
    </div>
  );
}
