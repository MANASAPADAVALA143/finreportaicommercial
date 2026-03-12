import React from 'react';

const KPI_CONFIG = [
  { key: 'revenue' as const, label: 'Revenue', format: '₹Cr' as const, higherIsBetter: true },
  { key: 'grossMarginPct' as const, label: 'Gross Margin', format: '%' as const, higherIsBetter: true },
  { key: 'ebitda' as const, label: 'EBITDA', format: '₹Cr' as const, higherIsBetter: true },
  { key: 'ebitdaMarginPct' as const, label: 'EBITDA Margin', format: '%' as const, higherIsBetter: true },
  { key: 'netProfit' as const, label: 'Net Profit', format: '₹Cr' as const, higherIsBetter: true },
  { key: 'endCash' as const, label: 'End Cash', format: '₹Cr' as const, higherIsBetter: true },
];

interface AnnualKPIs {
  revenue: number;
  grossMarginPct: number;
  ebitda: number;
  ebitdaMarginPct: number;
  netProfit: number;
  endCash: number;
}

function formatValue(value: number, format: '₹Cr' | '%'): string {
  if (format === '₹Cr') return `₹${value.toFixed(1)} Cr`;
  return `${value.toFixed(1)}%`;
}

interface ScenarioKPIBarProps {
  kpis: AnnualKPIs;
  baseKPIs: AnnualKPIs;
  isBaseCase: boolean;
}

export const ScenarioKPIBar: React.FC<ScenarioKPIBarProps> = ({ kpis, baseKPIs, isBaseCase }) => {
  return (
    <div className="flex flex-wrap gap-2 p-4 bg-[#111827] border-b border-[#1E2D45]">
      {KPI_CONFIG.map((c) => {
        const val = kpis[c.key];
        const baseVal = baseKPIs[c.key];
        const delta = isBaseCase ? 0 : val - baseVal;
        const isPositive = c.higherIsBetter ? delta >= 0 : delta <= 0;
        const isZero = Math.abs(delta) < 0.01;

        return (
          <div
            key={c.key}
            className="flex-1 min-w-[120px] rounded-lg bg-[#0D1426] border border-[#1E2D45] p-3"
          >
            <div className="text-[10px] text-[#94A3B8] uppercase tracking-wider mb-0.5">
              {c.label}
            </div>
            <div className="text-lg font-bold text-[#F1F5F9]">{formatValue(val, c.format)}</div>
            {isBaseCase ? (
              <div className="text-xs text-[#64748B]">— Base</div>
            ) : (
              <div
                className={`text-xs font-medium ${
                  isZero ? 'text-[#64748B]' : isPositive ? 'text-[#10B981]' : 'text-[#EF4444]'
                }`}
              >
                {isZero ? '—' : isPositive ? '▲' : '▼'}{' '}
                {isZero
                  ? ''
                  : `${delta >= 0 ? '+' : ''}${
                      c.format === '₹Cr'
                        ? `₹${delta.toFixed(1)} Cr`
                        : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp`
                    } vs Base`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
