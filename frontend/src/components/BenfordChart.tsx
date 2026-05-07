import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type Props = {
  observed: Record<string, number>;
  expected: Record<string, number>;
};

export default function BenfordChart({ observed, expected }: Props) {
  const data = Array.from({ length: 9 }, (_, i) => {
    const d = String(i + 1);
    return {
      digit: d,
      expected: Number(expected[d] ?? 0),
      observed: Number(observed[d] ?? 0),
    };
  });

  return (
    <div className="rounded-xl border border-[#1e293b] bg-[#141B2D] p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">Benford's Law — Leading Digit Distribution</h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="digit" stroke="#94A3B8" />
            <YAxis stroke="#94A3B8" />
            <Tooltip />
            <Legend />
            <Bar dataKey="expected" fill="#F5A623" name="Expected %" />
            <Bar dataKey="observed" fill="#EF4444" name="Observed count" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
