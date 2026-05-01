import React from 'react';

type Props = { pct: number; label?: string };

export const MatchRateGauge: React.FC<Props> = ({ pct, label = 'Match Rate' }) => {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = clamped >= 95 ? '#16a34a' : clamped >= 85 ? '#ea580c' : '#dc2626';
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;

  return (
    <div className="flex flex-col items-center justify-center py-2">
      <svg width={140} height={140} viewBox="0 0 120 120" className="drop-shadow-sm">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="64" textAnchor="middle" className="fill-slate-800" style={{ fontSize: 20, fontWeight: 700 }}>
          {clamped.toFixed(1)}%
        </text>
      </svg>
      <p className="text-sm font-medium text-slate-600 mt-1">{label}</p>
    </div>
  );
};
