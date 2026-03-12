import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const KPI_CONFIG = [
    { key: 'revenue', label: 'Revenue', format: '₹Cr', higherIsBetter: true },
    { key: 'grossMarginPct', label: 'Gross Margin', format: '%', higherIsBetter: true },
    { key: 'ebitda', label: 'EBITDA', format: '₹Cr', higherIsBetter: true },
    { key: 'ebitdaMarginPct', label: 'EBITDA Margin', format: '%', higherIsBetter: true },
    { key: 'netProfit', label: 'Net Profit', format: '₹Cr', higherIsBetter: true },
    { key: 'endCash', label: 'End Cash', format: '₹Cr', higherIsBetter: true },
];
function formatValue(value, format) {
    if (format === '₹Cr')
        return `₹${value.toFixed(1)} Cr`;
    return `${value.toFixed(1)}%`;
}
export const ScenarioKPIBar = ({ kpis, baseKPIs, isBaseCase }) => {
    return (_jsx("div", { className: "flex flex-wrap gap-2 p-4 bg-[#111827] border-b border-[#1E2D45]", children: KPI_CONFIG.map((c) => {
            const val = kpis[c.key];
            const baseVal = baseKPIs[c.key];
            const delta = isBaseCase ? 0 : val - baseVal;
            const isPositive = c.higherIsBetter ? delta >= 0 : delta <= 0;
            const isZero = Math.abs(delta) < 0.01;
            return (_jsxs("div", { className: "flex-1 min-w-[120px] rounded-lg bg-[#0D1426] border border-[#1E2D45] p-3", children: [_jsx("div", { className: "text-[10px] text-[#94A3B8] uppercase tracking-wider mb-0.5", children: c.label }), _jsx("div", { className: "text-lg font-bold text-[#F1F5F9]", children: formatValue(val, c.format) }), isBaseCase ? (_jsx("div", { className: "text-xs text-[#64748B]", children: "\u2014 Base" })) : (_jsxs("div", { className: `text-xs font-medium ${isZero ? 'text-[#64748B]' : isPositive ? 'text-[#10B981]' : 'text-[#EF4444]'}`, children: [isZero ? '—' : isPositive ? '▲' : '▼', ' ', isZero
                                ? ''
                                : `${delta >= 0 ? '+' : ''}${c.format === '₹Cr'
                                    ? `₹${delta.toFixed(1)} Cr`
                                    : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp`} vs Base`] }))] }, c.key));
        }) }));
};
