import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, } from 'recharts';
const SCENARIO_CONFIG = {
    base: { label: 'Base', color: '#3B82F6' },
    growth: { label: 'Growth', color: '#10B981' },
    conservative: { label: 'Conservative', color: '#F59E0B' },
    stress: { label: 'Stress', color: '#EF4444' },
};
function fmtCr(n) {
    return `₹${n.toFixed(1)} Cr`;
}
const FY25_ACTUAL = {
    revenue: 36,
    grossProfit: 25,
    grossMarginPct: 69.4,
    ebitda: 5.2,
    ebitdaMarginPct: 14.4,
    netProfit: 3.1,
    endCash: 16.2,
};
export const CompareView = ({ results, fy25Actual = FY25_ACTUAL, }) => {
    const scenarios = ['base', 'growth', 'conservative', 'stress'];
    const mergedRev = results.base.monthlyPL.map((m, i) => {
        const row = { month: m.month };
        scenarios.forEach((s) => (row[s] = results[s].monthlyPL[i]?.revenue ?? 0));
        return row;
    });
    const mergedEbitda = results.base.monthlyPL.map((m, i) => {
        const row = { month: m.month };
        scenarios.forEach((s) => (row[s] = results[s].monthlyPL[i]?.ebitda ?? 0));
        return row;
    });
    const metrics = [
        { key: 'revenue', label: 'Revenue' },
        { key: 'grossProfit', label: 'Gross Profit' },
        { key: 'grossMarginPct', label: 'Gross Margin %', isPct: true },
        { key: 'ebitda', label: 'EBITDA' },
        { key: 'ebitdaMarginPct', label: 'EBITDA Margin %', isPct: true },
        { key: 'netProfit', label: 'Net Profit' },
        { key: 'endCash', label: 'End Cash' },
    ];
    const fmt = (v, isPct) => isPct ? `${v.toFixed(1)}%` : fmtCr(v);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "rounded-lg bg-[#111827] border border-[#1E2D45] p-4", children: [_jsx("h3", { className: "text-sm font-semibold text-[#F1F5F9] mb-4", children: "Revenue \u2014 All Scenarios" }), _jsx(ResponsiveContainer, { width: "100%", height: 260, children: _jsxs(LineChart, { data: mergedRev, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#1E2D45" }), _jsx(XAxis, { dataKey: "month", stroke: "#94A3B8", tick: { fontSize: 11 } }), _jsx(YAxis, { stroke: "#94A3B8", tick: { fontSize: 11 }, tickFormatter: (v) => v.toFixed(1) }), _jsx(Tooltip, { contentStyle: { backgroundColor: '#0D1426', border: '1px solid #1E2D45' }, formatter: (v) => [fmtCr(v), ''] }), _jsx(Legend, {}), scenarios.map((s) => (_jsx(Line, { type: "monotone", dataKey: s, stroke: SCENARIO_CONFIG[s].color, strokeWidth: 2, dot: false, name: SCENARIO_CONFIG[s].label }, s)))] }) })] }), _jsxs("div", { className: "rounded-lg bg-[#111827] border border-[#1E2D45] p-4", children: [_jsx("h3", { className: "text-sm font-semibold text-[#F1F5F9] mb-4", children: "EBITDA \u2014 All Scenarios" }), _jsx(ResponsiveContainer, { width: "100%", height: 260, children: _jsxs(LineChart, { data: mergedEbitda, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#1E2D45" }), _jsx(XAxis, { dataKey: "month", stroke: "#94A3B8", tick: { fontSize: 11 } }), _jsx(YAxis, { stroke: "#94A3B8", tick: { fontSize: 11 }, tickFormatter: (v) => v.toFixed(1) }), _jsx(Tooltip, { contentStyle: { backgroundColor: '#0D1426', border: '1px solid #1E2D45' }, formatter: (v) => [fmtCr(v), ''] }), _jsx(Legend, {}), scenarios.map((s) => (_jsx(Line, { type: "monotone", dataKey: s, stroke: SCENARIO_CONFIG[s].color, strokeWidth: 2, dot: false, name: SCENARIO_CONFIG[s].label }, s)))] }) })] })] }), _jsx("div", { className: "rounded-lg bg-[#111827] border border-[#1E2D45] overflow-hidden", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-[#1E2D45]", children: [_jsx("th", { className: "text-left py-3 px-4 text-[#94A3B8] font-medium", children: "Metric" }), _jsx("th", { className: "text-right py-3 px-4 text-[#F1F5F9] font-medium", children: "FY25 Actual" }), scenarios.map((s) => (_jsx("th", { className: "text-right py-3 px-4 font-medium", style: { color: SCENARIO_CONFIG[s].color }, children: SCENARIO_CONFIG[s].label }, s)))] }) }), _jsx("tbody", { className: "text-[#F1F5F9]", children: metrics.map((m) => {
                                const isPct = m.key.includes('Margin') || m.key.includes('Pct');
                                const getVal = (s) => {
                                    if (m.key === 'grossProfit')
                                        return s.annualKPIs.revenue * (s.annualKPIs.grossMarginPct / 100);
                                    return s.annualKPIs[m.key];
                                };
                                const actualVal = fy25Actual[m.key];
                                return (_jsxs("tr", { className: "border-b border-[#1E2D45]", children: [_jsx("td", { className: "py-2 px-4 text-[#94A3B8]", children: m.label }), _jsx("td", { className: "text-right py-2 px-4 text-[#F1F5F9]", children: fmt(actualVal ?? 0, isPct) }), scenarios.map((s) => (_jsx("td", { className: "text-right py-2 px-4", style: { color: SCENARIO_CONFIG[s].color }, children: fmt(getVal(results[s]) ?? 0, isPct) }, s)))] }, m.key));
                            }) })] }) })] }));
};
