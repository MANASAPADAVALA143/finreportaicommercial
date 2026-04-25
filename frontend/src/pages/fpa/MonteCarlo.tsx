import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Play } from 'lucide-react';
import { FpaPageShell } from '../../components/fpa/FpaPageShell';
import { LoadingSpinner } from '../../components/fpa/LoadingSpinner';
import { ErrorBanner } from '../../components/fpa/ErrorBanner';
import { CFO_ANALYSIS_MODEL, postFpaJson } from '../../lib/fpaApi';
import { callAI } from '../../services/aiProvider';

type MCRes = {
  p10_month_end: number;
  p50_month_end: number;
  p90_month_end: number;
  p10: number[];
  p50: number[];
  p90: number[];
  months: number[];
  histogram_data: { bin_start: number; bin_end: number; count: number }[];
  runway_probability: Record<string, number>;
  runway_positive_all_months_pct: number;
  commentary: string;
};

export default function MonteCarlo() {
  const [nSim, setNSim] = useState(5000);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<MCRes | null>(null);
  const [extraAi, setExtraAi] = useState('');

  const run = async () => {
    setErr('');
    setLoading(true);
    setExtraAi('');
    try {
      const out = await postFpaJson<MCRes>('/api/fpa/monte-carlo', {
        n_simulations: nSim,
        months: 12,
      });
      setRes(out);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);

  const lineData =
    res?.months.map((m, i) => ({
      m,
      p10: res.p10[i],
      p50: res.p50[i],
      p90: res.p90[i],
    })) ?? [];

  const askLocal = async () => {
    if (!res) return;
    const prompt = `In 120 words, interpret this Monte Carlo summary for a CFO:\nP10 end cash: ${res.p10_month_end}\nP50: ${res.p50_month_end}\nP90: ${res.p90_month_end}\nRunway table: ${JSON.stringify(res.runway_probability)}`;
    const t = await callAI(prompt, { modelId: CFO_ANALYSIS_MODEL, maxTokens: 400 });
    setExtraAi(t);
  };

  return (
    <FpaPageShell title="Monte Carlo" subtitle="12-month cash paths · triangular drivers">
      <ErrorBanner message={err} />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm text-slate-300">
          Simulations
          <select
            className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm"
            value={nSim}
            onChange={(e) => setNSim(Number(e.target.value))}
          >
            {[1000, 5000, 10000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          Run simulation
        </button>
        {loading ? <LoadingSpinner label="Simulating…" /> : null}
        {res ? (
          <button
            type="button"
            onClick={() => askLocal().catch((e) => setErr(String(e)))}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Optional: client-side AI note
          </button>
        ) : null}
      </div>

      {res ? (
        <div className="mt-8 space-y-8">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <div className="text-xs text-slate-400">P10 cash (12m)</div>
              <div className="text-xl font-bold text-rose-300">{fmt(res.p10_month_end)}</div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <div className="text-xs text-slate-400">P50 cash (12m)</div>
              <div className="text-xl font-bold text-sky-300">{fmt(res.p50_month_end)}</div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <div className="text-xs text-slate-400">P90 cash (12m)</div>
              <div className="text-xl font-bold text-emerald-300">{fmt(res.p90_month_end)}</div>
            </div>
          </div>

          <div className="h-64 rounded-xl border border-slate-700 bg-slate-900/40 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={res.histogram_data.map((b) => ({ ...b, label: `${(b.bin_start / 1e6).toFixed(1)}M` }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#38bdf8" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="h-72 rounded-xl border border-slate-700 bg-slate-900/40 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="m" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Line type="monotone" dataKey="p10" stroke="#f87171" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="p50" stroke="#38bdf8" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="p90" stroke="#4ade80" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-sm text-slate-200">
            <div className="font-semibold text-white">Probability cash &lt; 0</div>
            <ul className="mt-2 list-inside list-disc text-slate-300">
              {Object.entries(res.runway_probability).map(([k, v]) => (
                <li key={k}>
                  {k}: {v.toFixed(1)}%
                </li>
              ))}
            </ul>
            <p className="mt-3 text-slate-400">
              Positive path proxy (all months &gt; 0 &amp; ending &gt; 0):{' '}
              <span className="font-semibold text-emerald-300">{res.runway_positive_all_months_pct.toFixed(1)}%</span>
            </p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
            <h3 className="mb-2 font-semibold text-white">Server AI commentary</h3>
            <p className="whitespace-pre-wrap text-sm text-slate-300">{res.commentary}</p>
            {extraAi ? (
              <p className="mt-4 whitespace-pre-wrap border-t border-slate-700 pt-4 text-sm text-slate-400">{extraAi}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </FpaPageShell>
  );
}
