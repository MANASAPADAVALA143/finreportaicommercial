import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Play } from 'lucide-react';
import { FpaPageShell } from '../../components/fpa/FpaPageShell';
import { LoadingSpinner } from '../../components/fpa/LoadingSpinner';
import { ErrorBanner } from '../../components/fpa/ErrorBanner';
import { postFpaJson } from '../../lib/fpaApi';
import { exportRowsToExcel } from '../../utils/fpaExport';

type VarName = 'revenue' | 'cogs_pct' | 'opex_pct' | 'tax_rate';

type SensRes = {
  matrix: { v1_pct: number; v2_pct: number; net_profit: number }[][];
  tornado_data: { variable: string; downside: number; upside: number; swing: number }[];
  commentary: string;
  base_net_profit: number;
  variable1: VarName;
  variable2: VarName;
};

function heatColor(v: number, min: number, max: number) {
  if (max === min) return 'rgb(30,41,59)';
  const t = (v - min) / (max - min);
  const r = Math.round(180 + 75 * (1 - t));
  const g = Math.round(60 + 160 * t);
  const b = Math.round(80 + 40 * (1 - t));
  return `rgb(${r},${g},${b})`;
}

export default function SensitivityAnalysis() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<SensRes | null>(null);
  const [v1, setV1] = useState<VarName>('revenue');
  const [v2, setV2] = useState<VarName>('opex_pct');
  const [steps, setSteps] = useState<5 | 9 | 13>(9);

  const run = async () => {
    setErr('');
    setLoading(true);
    try {
      const out = await postFpaJson<SensRes>('/api/fpa/sensitivity', {
        variable1: v1,
        variable2: v2,
        steps,
      });
      setRes(out);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const { minP, maxP } = useMemo(() => {
    if (!res?.matrix.length) return { minP: 0, maxP: 1 };
    let minP = Infinity;
    let maxP = -Infinity;
    for (const row of res.matrix) for (const c of row) {
      minP = Math.min(minP, c.net_profit);
      maxP = Math.max(maxP, c.net_profit);
    }
    return { minP, maxP };
  }, [res]);

  return (
    <FpaPageShell title="Sensitivity analysis" subtitle="2D grid · tornado drivers">
      <ErrorBanner message={err} />
      <div className="flex flex-wrap gap-3">
        <label className="text-sm text-slate-300">
          Variable 1
          <select
            className="mt-1 block rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
            value={v1}
            onChange={(e) => setV1(e.target.value as VarName)}
          >
            {(['revenue', 'cogs_pct', 'opex_pct', 'tax_rate'] as const).map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-300">
          Variable 2
          <select
            className="mt-1 block rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
            value={v2}
            onChange={(e) => setV2(e.target.value as VarName)}
          >
            {(['revenue', 'cogs_pct', 'opex_pct', 'tax_rate'] as const).map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-300">
          Steps
          <select
            className="mt-1 block rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
            value={steps}
            onChange={(e) => setSteps(Number(e.target.value) as 5 | 9 | 13)}
          >
            {[5, 9, 13].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="mt-6 inline-flex items-center gap-2 self-end rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          Run
        </button>
        {loading ? <LoadingSpinner /> : null}
      </div>

      {res ? (
        <div className="mt-8 space-y-8">
          <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/40 p-3">
            <table className="border-collapse text-xs">
              <tbody>
                {res.matrix.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className="border border-slate-800 px-2 py-1 text-right text-xs font-medium text-white"
                        style={{ backgroundColor: heatColor(cell.net_profit, minP, maxP) }}
                        title={`${res.variable1} ${cell.v1_pct}% × ${res.variable2} ${cell.v2_pct}%`}
                      >
                        {(cell.net_profit / 1e6).toFixed(2)}M
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">
              Rows: {res.variable1} % · Cols: {res.variable2} % · Colour: net profit ({minP.toFixed(0)} → {maxP.toFixed(0)})
            </p>
          </div>

          <div className="h-64 rounded-xl border border-slate-700 bg-slate-900/40 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={res.tornado_data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="variable" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="swing" fill="#fbbf24" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
            <h3 className="font-semibold text-white">Commentary</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{res.commentary}</p>
          </div>

          <button
            type="button"
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            onClick={() => {
              const flat = res.matrix.flatMap((row, i) =>
                row.map((c, j) => ({
                  i,
                  j,
                  v1_pct: c.v1_pct,
                  v2_pct: c.v2_pct,
                  net_profit: c.net_profit,
                }))
              );
              exportRowsToExcel('sensitivity.xlsx', [
                { name: 'Grid', rows: flat as unknown as Record<string, unknown>[] },
                { name: 'Tornado', rows: res.tornado_data as unknown as Record<string, unknown>[] },
              ]);
            }}
          >
            Export Excel
          </button>
        </div>
      ) : null}
    </FpaPageShell>
  );
}
