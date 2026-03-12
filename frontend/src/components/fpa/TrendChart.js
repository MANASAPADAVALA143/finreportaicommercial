import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// FP&A Variance Analysis - Trend Chart Component (12-month trend)
import { useState } from 'react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from 'recharts';
import { formatCurrency } from '../../utils/varianceUtils';
export const TrendChart = ({ data, currency = "INR", title = "12-Month Performance Trend" }) => {
    const [selectedMetric, setSelectedMetric] = useState('revenue');
    const metricOptions = [
        { value: 'revenue', label: 'Revenue' },
        { value: 'grossProfit', label: 'Gross Profit' },
        { value: 'ebitda', label: 'EBITDA' },
        { value: 'netProfit', label: 'Net Profit' }
    ];
    const getMetricData = (metric) => {
        const metricMap = {
            revenue: { actual: 'actualRevenue', budget: 'budgetRevenue' },
            grossProfit: { actual: 'actualGrossProfit', budget: 'budgetGrossProfit' },
            ebitda: { actual: 'actualEBITDA', budget: 'budgetEBITDA' },
            netProfit: { actual: 'actualProfit', budget: 'budgetProfit' }
        };
        return metricMap[metric];
    };
    const currentMetric = getMetricData(selectedMetric);
    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            const actual = payload.find((p) => p.dataKey === currentMetric.actual);
            const budget = payload.find((p) => p.dataKey === currentMetric.budget);
            if (actual && budget) {
                const variance = actual.value - budget.value;
                const variancePct = ((variance / budget.value) * 100).toFixed(1);
                return (_jsxs("div", { className: "bg-white border-2 border-gray-200 rounded-lg shadow-lg p-4", children: [_jsx("p", { className: "font-semibold text-gray-900 mb-2", children: label }), _jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsx("span", { className: "text-sm text-gray-600", children: "Actual:" }), _jsx("span", { className: "text-sm font-bold text-blue-600", children: formatCurrency(actual.value, currency) })] }), _jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsx("span", { className: "text-sm text-gray-600", children: "Budget:" }), _jsx("span", { className: "text-sm font-semibold text-gray-700", children: formatCurrency(budget.value, currency) })] }), _jsxs("div", { className: "flex items-center justify-between gap-4 pt-2 border-t border-gray-200", children: [_jsx("span", { className: "text-sm text-gray-600", children: "Variance:" }), _jsxs("span", { className: `text-sm font-bold ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`, children: [variance >= 0 ? '+' : '', variancePct, "%"] })] })] })] }));
            }
        }
        return null;
    };
    return (_jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-1", children: title }), _jsx("p", { className: "text-sm text-gray-600", children: "Actual vs Budget performance over time" })] }), _jsx("div", { className: "flex items-center gap-2", children: metricOptions.map((option) => (_jsx("button", { onClick: () => setSelectedMetric(option.value), className: `px-4 py-2 rounded-lg text-sm font-medium transition ${selectedMetric === option.value
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: option.label }, option.value))) })] }), _jsx(ResponsiveContainer, { width: "100%", height: 350, children: _jsxs(ComposedChart, { data: data, margin: { top: 10, right: 30, left: 20, bottom: 5 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#e5e7eb" }), _jsx(XAxis, { dataKey: "month", tick: { fontSize: 11, fill: '#6b7280' }, angle: -45, textAnchor: "end", height: 80 }), _jsx(YAxis, { tickFormatter: (value) => formatCurrency(value, currency), tick: { fontSize: 11, fill: '#6b7280' } }), _jsx(Tooltip, { content: _jsx(CustomTooltip, {}) }), _jsx(Legend, { wrapperStyle: { paddingTop: '20px' }, iconType: "line" }), _jsx(Line, { type: "monotone", dataKey: currentMetric.budget, stroke: "#94a3b8", strokeWidth: 2, strokeDasharray: "5 5", dot: { fill: '#94a3b8', r: 4 }, name: "Budget", activeDot: { r: 6 } }), _jsx(Line, { type: "monotone", dataKey: currentMetric.actual, stroke: "#3b82f6", strokeWidth: 3, dot: { fill: '#3b82f6', r: 5 }, name: "Actual", activeDot: { r: 7 } })] }) }), _jsx("div", { className: "grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-gray-200", children: (() => {
                    const actualKey = currentMetric.actual;
                    const budgetKey = currentMetric.budget;
                    const totalActual = data.reduce((sum, d) => sum + (Number(d[actualKey]) || 0), 0);
                    const totalBudget = data.reduce((sum, d) => sum + (Number(d[budgetKey]) || 0), 0);
                    const totalVariance = totalActual - totalBudget;
                    const variancePct = ((totalVariance / totalBudget) * 100).toFixed(1);
                    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-sm text-gray-600 mb-1", children: "Total Actual (12M)" }), _jsx("div", { className: "text-xl font-bold text-blue-600", children: formatCurrency(totalActual, currency) })] }), _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-sm text-gray-600 mb-1", children: "Total Budget (12M)" }), _jsx("div", { className: "text-xl font-bold text-gray-700", children: formatCurrency(totalBudget, currency) })] }), _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-sm text-gray-600 mb-1", children: "Total Variance" }), _jsxs("div", { className: `text-xl font-bold ${totalVariance >= 0 ? 'text-green-600' : 'text-red-600'}`, children: [totalVariance >= 0 ? '+' : '', variancePct, "%"] })] })] }));
                })() })] }));
};
