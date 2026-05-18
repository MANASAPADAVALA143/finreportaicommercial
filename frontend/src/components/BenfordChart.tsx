import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type DigitScore = {
  observed_pct:  number;
  expected_pct:  number;
  deviation_pct: number;
};

type Props = {
  /** New format — both in % — preferred */
  digit_scores?: Record<string, DigitScore>;
  chi2?:         number;
  p_value?:      number;
  /** Legacy format fallback */
  observed?: Record<string, number>;
  expected?: Record<string, number>;
};

export default function BenfordChart({ digit_scores, chi2, p_value, observed, expected }: Props) {
  const data = Array.from({ length: 9 }, (_, i) => {
    const d = String(i + 1);
    if (digit_scores?.[d]) {
      return {
        digit:    d,
        'Expected %': Number(digit_scores[d].expected_pct.toFixed(2)),
        'Observed %': Number(digit_scores[d].observed_pct.toFixed(2)),
      };
    }
    // Legacy fallback: convert raw count to % using total
    const totalObs = Object.values(observed ?? {}).reduce((s, v) => s + v, 0) || 1;
    return {
      digit:    d,
      'Expected %': Number(expected?.[d] ?? 0),
      'Observed %': Number(((observed?.[d] ?? 0) / totalObs * 100).toFixed(2)),
    };
  });

  const flagged    = p_value !== undefined && p_value < 0.05;
  const pDisplay   = p_value !== undefined ? p_value.toFixed(4) : '—';
  const chi2Display = chi2 !== undefined ? chi2.toFixed(2) : '—';

  return (
    <div className="rounded-xl border border-[#1e293b] bg-[#141B2D] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Benford's Law — Leading Digit Distribution (%)</h3>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-slate-400">
            χ² = <span className={flagged ? 'font-bold text-orange-400' : 'text-slate-200'}>{chi2Display}</span>
          </span>
          <span className={`rounded px-2 py-0.5 font-semibold ${
            flagged
              ? 'bg-red-500/20 text-red-300'
              : 'bg-emerald-500/20 text-emerald-300'
          }`}>
            p = {pDisplay} {flagged ? '⚠️ Deviated' : '✅ Normal'}
          </span>
        </div>
      </div>
      {flagged && (
        <p className="mb-2 text-xs text-orange-300">
          ⚠️ Leading-digit distribution deviates significantly from Benford's Law — possible fabrication or manipulation (p &lt; 0.05)
        </p>
      )}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="digit" stroke="#94A3B8" label={{ value: 'Leading Digit', position: 'insideBottom', offset: -2, fill: '#94A3B8', fontSize: 11 }} />
            <YAxis stroke="#94A3B8" tickFormatter={(v) => `${v}%`} domain={[0, 35]} />
            <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
            <Legend />
            <Bar dataKey="Expected %" fill="#F5A623" name="Expected %" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Observed %" fill="#EF4444" name="Observed %" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
