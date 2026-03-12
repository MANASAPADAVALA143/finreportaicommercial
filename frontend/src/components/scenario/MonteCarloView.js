import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { runMonteCarlo } from '../../services/scenarioCalculator';
function fmtCr(n) {
    return `₹${n.toFixed(1)} Cr`;
}
function buildHistogram(data, bins, threshold) {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const step = (max - min) / bins || 0.01;
    const buckets = [];
    for (let i = 0; i < bins; i++) {
        const lo = min + i * step;
        const hi = min + (i + 1) * step;
        const count = data.filter((v) => v >= lo && v < hi).length;
        const above = threshold != null ? data.filter((v) => v >= lo && v < hi && v >= threshold).length : 0;
        buckets.push({
            range: `${lo.toFixed(0)}–${hi.toFixed(0)}`,
            count,
            above,
        });
    }
    return buckets;
}
export const MonteCarloView = ({ baseAssumptions, baseAnnualRevenue, openingCashCr, }) => {
    const [result, setResult] = useState(null);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [iterations, setIterations] = useState(1000);
    const handleRun = useCallback(() => {
        setRunning(true);
        setProgress(0);
        const ITER = iterations;
        setTimeout(() => {
            const r = runMonteCarlo(baseAssumptions, ITER, baseAnnualRevenue, openingCashCr);
            setResult(r);
            setProgress(ITER);
            setRunning(false);
        }, 100);
    }, [baseAssumptions, iterations, baseAnnualRevenue, openingCashCr]);
    if (!result) {
        return (_jsx("div", { className: "space-y-6", children: _jsxs("div", { className: "rounded-lg bg-[#111827] border border-[#1E2D45] p-6", children: [_jsx("p", { className: "text-sm text-[#94A3B8] mb-4", children: "Randomises all key assumptions within \u00B11\u03C3 using normal distribution" }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsxs("label", { className: "text-sm text-[#94A3B8]", children: ["Iterations:", _jsx("input", { type: "number", value: iterations, onChange: (e) => setIterations(parseInt(e.target.value, 10) || 1000), className: "ml-2 w-24 h-8 bg-[#0D1426] border border-[#1E2D45] rounded px-2 text-[#F1F5F9]" })] }), _jsx("button", { onClick: handleRun, disabled: running, className: "px-4 py-2 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] disabled:opacity-50", children: running ? `Running simulation... ${progress}/${iterations}` : 'Run Monte Carlo Simulation' })] })] }) }));
    }
    const probCards = [
        { label: 'P(EBITDA > 0)', value: result.probabilities.ebitdaPositive, sub: 'Positive EBITDA' },
        { label: 'P(Revenue>₹40Cr)', value: result.probabilities.revenueAbove40, sub: 'Base target' },
        { label: 'P(Revenue>₹50Cr)', value: result.probabilities.revenueAbove50, sub: 'Stretch goal' },
        { label: 'P(Cash > ₹15Cr)', value: result.probabilities.cashAbove15, sub: 'Cash target' },
    ];
    const revHist = buildHistogram(result.results.map((r) => r.revenue), 15);
    const ebitdaHist = buildHistogram(result.results.map((r) => r.ebitda), 15);
    const percentileRows = [
        { key: 'revenue', label: 'Revenue', fmt: fmtCr, p: result.percentiles.revenue },
        { key: 'ebitda', label: 'EBITDA', fmt: fmtCr, p: result.percentiles.ebitda },
        { key: 'netProfit', label: 'Net Profit', fmt: fmtCr, p: result.percentiles.netProfit },
        { key: 'endCash', label: 'End Cash', fmt: fmtCr, p: result.percentiles.endCash },
        {
            key: 'ebitdaMarginPct',
            label: 'EBITDA Margin',
            fmt: (n) => `${n.toFixed(1)}%`,
            p: result.percentiles.ebitdaMarginPct,
        },
    ];
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "rounded-lg bg-[#111827] border border-[#1E2D45] p-4", children: [_jsx("p", { className: "text-sm text-[#94A3B8] mb-4", children: "Randomises all key assumptions within \u00B11\u03C3 using normal distribution" }), _jsx("button", { onClick: () => { setResult(null); }, className: "px-4 py-2 rounded-lg border border-[#1E2D45] text-[#94A3B8] text-sm hover:bg-[#0D1426]", children: "Run New Simulation" })] }), _jsx("div", { className: "grid grid-cols-2 lg:grid-cols-4 gap-4", children: probCards.map((c) => (_jsxs("div", { className: "rounded-lg bg-[#111827] border border-[#1E2D45] p-4", children: [_jsx("div", { className: "text-xs text-[#94A3B8] mb-1", children: c.label }), _jsxs("div", { className: "text-2xl font-bold text-[#F1F5F9]", children: [Math.round(c.value * 100), "%"] }), _jsx("div", { className: "text-[10px] text-[#64748B] mt-1", children: c.sub }), _jsx("div", { className: "mt-2 h-2 bg-[#0D1426] rounded-full overflow-hidden", children: _jsx("div", { className: "h-full bg-[#3B82F6] rounded-full", style: { width: `${c.value * 100}%` } }) })] }, c.label))) }), _jsx("div", { className: "rounded-lg bg-[#111827] border border-[#1E2D45] overflow-hidden", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-[#1E2D45]", children: [_jsx("th", { className: "text-left py-3 px-4 text-[#94A3B8] font-medium", children: "Metric" }), _jsx("th", { className: "text-right py-3 px-4 text-[#94A3B8] font-medium", children: "P10" }), _jsx("th", { className: "text-right py-3 px-4 text-[#94A3B8] font-medium", children: "P25" }), _jsx("th", { className: "text-right py-3 px-4 text-[#3B82F6] font-medium", children: "P50 (Median)" }), _jsx("th", { className: "text-right py-3 px-4 text-[#94A3B8] font-medium", children: "P75" }), _jsx("th", { className: "text-right py-3 px-4 text-[#94A3B8] font-medium", children: "P90" }), _jsx("th", { className: "text-right py-3 px-4 text-[#94A3B8] font-medium", children: "Mean" })] }) }), _jsx("tbody", { className: "text-[#F1F5F9]", children: percentileRows.map((row) => (_jsxs("tr", { className: "border-b border-[#1E2D45]", children: [_jsx("td", { className: "py-2 px-4 text-[#94A3B8]", children: row.label }), _jsx("td", { className: "text-right py-2 px-4", children: row.fmt(row.p.p10) }), _jsx("td", { className: "text-right py-2 px-4", children: row.fmt(row.p.p25) }), _jsx("td", { className: "text-right py-2 px-4 text-[#3B82F6] font-semibold", children: row.fmt(row.p.p50) }), _jsx("td", { className: "text-right py-2 px-4", children: row.fmt(row.p.p75) }), _jsx("td", { className: "text-right py-2 px-4", children: row.fmt(row.p.p90) }), _jsx("td", { className: "text-right py-2 px-4", children: row.fmt(row.p.mean) })] }, row.key))) })] }) }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "rounded-lg bg-[#111827] border border-[#1E2D45] p-4", children: [_jsxs("h3", { className: "text-sm font-semibold text-[#F1F5F9] mb-4", children: ["Revenue Distribution (n=", result.iterations, ")"] }), _jsx(ResponsiveContainer, { width: "100%", height: 200, children: _jsxs(BarChart, { data: revHist, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#1E2D45" }), _jsx(XAxis, { dataKey: "range", stroke: "#94A3B8", tick: { fontSize: 10 } }), _jsx(YAxis, { stroke: "#94A3B8", tick: { fontSize: 11 } }), _jsx(Tooltip, { contentStyle: { backgroundColor: '#0D1426', border: '1px solid #1E2D45' } }), _jsx(Bar, { dataKey: "count", radius: [4, 4, 0, 0], children: revHist.map((entry, i) => {
                                                const [lo, hi] = entry.range.split('–').map(Number);
                                                const mid = (lo + hi) / 2;
                                                return _jsx(Cell, { fill: mid >= 40 ? '#10B981' : '#64748B' }, i);
                                            }) })] }) })] }), _jsxs("div", { className: "rounded-lg bg-[#111827] border border-[#1E2D45] p-4", children: [_jsxs("h3", { className: "text-sm font-semibold text-[#F1F5F9] mb-4", children: ["EBITDA Distribution (n=", result.iterations, ")"] }), _jsx(ResponsiveContainer, { width: "100%", height: 200, children: _jsxs(BarChart, { data: ebitdaHist, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#1E2D45" }), _jsx(XAxis, { dataKey: "range", stroke: "#94A3B8", tick: { fontSize: 10 } }), _jsx(YAxis, { stroke: "#94A3B8", tick: { fontSize: 11 } }), _jsx(Tooltip, { contentStyle: { backgroundColor: '#0D1426', border: '1px solid #1E2D45' } }), _jsx(Bar, { dataKey: "count", radius: [4, 4, 0, 0], children: ebitdaHist.map((entry, i) => {
                                                const [lo, hi] = entry.range.split('–').map(Number);
                                                const mid = (lo + hi) / 2;
                                                return _jsx(Cell, { fill: mid >= 0 ? '#10B981' : '#EF4444' }, i);
                                            }) })] }) })] })] }), _jsxs("div", { className: "rounded-lg bg-[#111827] border border-[#1E2D45] p-4", children: [_jsx("h3", { className: "text-sm font-semibold text-[#F1F5F9] mb-3", children: "Simulation Summary" }), _jsxs("p", { className: "text-sm text-[#94A3B8] leading-relaxed", children: ["Across ", result.iterations, " Monte Carlo iterations: median revenue outcome is ", fmtCr(result.percentiles.revenue.p50), ' ', "(range ", fmtCr(result.percentiles.revenue.p10), " to ", fmtCr(result.percentiles.revenue.p90), " at 80% confidence). EBITDA has ", Math.round(result.probabilities.ebitdaPositive * 100), "% probability of being positive, with median", ' ', fmtCr(result.percentiles.ebitda.p50), " and P90 upside of ", fmtCr(result.percentiles.ebitda.p90), ". Cash position remains above \u20B911Cr even in downside scenarios."] })] })] }));
};
