import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, FileText, Play } from 'lucide-react';
import { FpaPageShell } from '../../components/fpa/FpaPageShell';
import { LoadingSpinner } from '../../components/fpa/LoadingSpinner';
import { ErrorBanner } from '../../components/fpa/ErrorBanner';
import { postFpaJson } from '../../lib/fpaApi';
import { exportHtmlPrintPdf, exportRowsToExcel } from '../../utils/fpaExport';

type PVMLine = {
  name: string;
  actual_units: number;
  actual_price: number;
  budget_units: number;
  budget_price: number;
};

type PVMResponse = {
  price_effect: number;
  volume_effect: number;
  mix_effect: number;
  total_variance: number;
  commentary: string;
  waterfall_data: { name: string; value: number; type: string }[];
};

const emptyRow = (): PVMLine => ({
  name: '',
  actual_units: 0,
  actual_price: 0,
  budget_units: 0,
  budget_price: 0,
});

export default function PVMAnalysis() {
  const [actualRev, setActualRev] = useState(250000);
  const [budgetRev, setBudgetRev] = useState(220000);
  const [priorY, setPriorY] = useState(200000);
  const [products, setProducts] = useState<PVMLine[]>([emptyRow(), emptyRow()]);
  const [regions, setRegions] = useState<PVMLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<PVMResponse | null>(null);

  const run = async () => {
    setErr('');
    setLoading(true);
    try {
      const body = {
        actual_revenue: actualRev,
        budget_revenue: budgetRev,
        prior_year_revenue: priorY,
        products: products.filter((p) => p.name.trim() !== ''),
        regions: regions.filter((p) => p.name.trim() !== ''),
      };
      if (!body.products.length && !body.regions.length) {
        setErr('Add at least one product or region row with a name.');
        setLoading(false);
        return;
      }
      const out = await postFpaJson<PVMResponse>('/api/fpa/pvm-analysis', body);
      setRes(out);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);

  return (
    <FpaPageShell title="PVM Analysis" subtitle="Price · Volume · Mix bridge (budget → actual)">
      <div className="space-y-6">
        <ErrorBanner message={err} />
        <div className="grid gap-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4 md:grid-cols-3">
          <label className="text-sm text-slate-300">
            Actual revenue
            <input
              type="number"
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1"
              value={actualRev}
              onChange={(e) => setActualRev(Number(e.target.value))}
            />
          </label>
          <label className="text-sm text-slate-300">
            Budget revenue
            <input
              type="number"
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1"
              value={budgetRev}
              onChange={(e) => setBudgetRev(Number(e.target.value))}
            />
          </label>
          <label className="text-sm text-slate-300">
            Prior year revenue
            <input
              type="number"
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1"
              value={priorY}
              onChange={(e) => setPriorY(Number(e.target.value))}
            />
          </label>
        </div>

        <section className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
          <h2 className="mb-2 font-semibold text-slate-100">By product</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm text-slate-200">
              <thead>
                <tr className="border-b border-slate-600 text-slate-400">
                  <th className="p-2">Name</th>
                  <th className="p-2">Act units</th>
                  <th className="p-2">Act price</th>
                  <th className="p-2">Bud units</th>
                  <th className="p-2">Bud price</th>
                </tr>
              </thead>
              <tbody>
                {products.map((r, i) => (
                  <tr key={i} className="border-b border-slate-800">
                    {(['name', 'actual_units', 'actual_price', 'budget_units', 'budget_price'] as const).map((k) => (
                      <td key={k} className="p-1">
                        <input
                          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1"
                          value={k === 'name' ? r.name : String(r[k])}
                          onChange={(e) => {
                            const v = e.target.value;
                            setProducts((prev) =>
                              prev.map((row, j) =>
                                j === i
                                  ? {
                                      ...row,
                                      [k]: k === 'name' ? v : Number(v) || 0,
                                    }
                                  : row
                              )
                            );
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="mt-2 text-sm text-sky-400 hover:underline"
            onClick={() => setProducts((p) => [...p, emptyRow()])}
          >
            + Add product row
          </button>
        </section>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Run PVM analysis
          </button>
          {loading ? <LoadingSpinner /> : null}
        </div>

        {res ? (
          <div className="space-y-6">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ['Price effect', res.price_effect],
                ['Volume effect', res.volume_effect],
                ['Mix effect', res.mix_effect],
              ].map(([label, v]) => (
                <div key={String(label)} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
                  <div className="mt-1 text-2xl font-bold text-white">{fmt(Number(v))}</div>
                  <div className="text-xs text-slate-500">
                    {budgetRev ? `${(((Number(v) / budgetRev) * 100) || 0).toFixed(1)}% of budget` : ''}
                  </div>
                </div>
              ))}
            </div>

            <div className="h-72 rounded-xl border border-slate-700 bg-slate-900/40 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={res.waterfall_data} margin={{ top: 16, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <ReferenceLine y={0} stroke="#64748b" />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {res.waterfall_data.map((d, i) => (
                      <Cell
                        key={i}
                        fill={
                          d.type === 'total'
                            ? d.name === 'Actual'
                              ? '#a855f7'
                              : '#3b82f6'
                            : (d.value as number) >= 0
                              ? '#22c55e'
                              : '#ef4444'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
              <h3 className="mb-2 font-semibold text-white">AI commentary</h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{res.commentary}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800"
                onClick={() =>
                  exportRowsToExcel('pvm-export.xlsx', [
                    { name: 'Summary', rows: [{ metric: 'price', value: res.price_effect }] },
                    { name: 'Waterfall', rows: res.waterfall_data as unknown as Record<string, unknown>[] },
                  ])
                }
              >
                <Download className="h-4 w-4" />
                Excel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800"
                onClick={() =>
                  exportHtmlPrintPdf(
                    'PVM',
                    `<h1>PVM</h1><p>${res.commentary.replace(/</g, '')}</p>`
                  )
                }
              >
                <FileText className="h-4 w-4" />
                PDF (print)
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </FpaPageShell>
  );
}
