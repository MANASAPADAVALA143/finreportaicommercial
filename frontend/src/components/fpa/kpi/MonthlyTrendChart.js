import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
const MonthlyTrendChart = ({ data, type }) => {
    if (type === 'revenue') {
        return (_jsxs("div", { className: "bg-white rounded-xl border-2 border-gray-200 p-6 shadow-sm", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Revenue & Profit Trend (12 Months)" }), _jsx(ResponsiveContainer, { width: "100%", height: 300, children: _jsxs(ComposedChart, { data: data, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#E5E7EB" }), _jsx(XAxis, { dataKey: "month", tick: { fontSize: 12 }, stroke: "#6B7280" }), _jsx(YAxis, { yAxisId: "left", tick: { fontSize: 12 }, stroke: "#6B7280", tickFormatter: (value) => `₹${(value / 10000000).toFixed(0)}Cr` }), _jsx(YAxis, { yAxisId: "right", orientation: "right", tick: { fontSize: 12 }, stroke: "#6B7280", tickFormatter: (value) => `${value}%` }), _jsx(Tooltip, { contentStyle: {
                                    backgroundColor: '#fff',
                                    border: '1px solid #E5E7EB',
                                    borderRadius: '8px',
                                    padding: '12px'
                                }, formatter: (value, name) => {
                                    if (name === 'Monthly Revenue')
                                        return [`₹${(value / 10000000).toFixed(2)}Cr`, name];
                                    if (name === 'Revenue Target')
                                        return [`₹${(value / 10000000).toFixed(2)}Cr`, name];
                                    return [`${value.toFixed(1)}%`, name];
                                } }), _jsx(Legend, { wrapperStyle: { paddingTop: '20px' }, iconType: "line" }), _jsx(Bar, { yAxisId: "left", dataKey: "revenue", name: "Monthly Revenue", fill: "#3B82F6", radius: [8, 8, 0, 0] }), _jsx(Line, { yAxisId: "left", type: "monotone", dataKey: "revenueTarget", name: "Revenue Target", stroke: "#9CA3AF", strokeWidth: 2, strokeDasharray: "5 5", dot: false }), _jsx(Line, { yAxisId: "right", type: "monotone", dataKey: "netProfitPercent", name: "Net Profit %", stroke: "#10B981", strokeWidth: 3, dot: { fill: '#10B981', r: 4 } })] }) })] }));
    }
    // Margins trend chart
    return (_jsxs("div", { className: "bg-white rounded-xl border-2 border-gray-200 p-6 shadow-sm", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Margin Trends (12 Months)" }), _jsx(ResponsiveContainer, { width: "100%", height: 300, children: _jsxs(ComposedChart, { data: data, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#E5E7EB" }), _jsx(XAxis, { dataKey: "month", tick: { fontSize: 12 }, stroke: "#6B7280" }), _jsx(YAxis, { tick: { fontSize: 12 }, stroke: "#6B7280", domain: [0, 60], tickFormatter: (value) => `${value}%` }), _jsx(Tooltip, { contentStyle: {
                                backgroundColor: '#fff',
                                border: '1px solid #E5E7EB',
                                borderRadius: '8px',
                                padding: '12px'
                            }, formatter: (value, name) => [`${value.toFixed(1)}%`, name] }), _jsx(Legend, { wrapperStyle: { paddingTop: '20px' }, iconType: "line" }), _jsx(ReferenceLine, { y: 50, label: "Gross Target", stroke: "#94A3B8", strokeDasharray: "3 3" }), _jsx(ReferenceLine, { y: 25, label: "EBITDA Target", stroke: "#94A3B8", strokeDasharray: "3 3" }), _jsx(Line, { type: "monotone", dataKey: "grossMargin", name: "Gross Margin %", stroke: "#3B82F6", strokeWidth: 3, dot: { fill: '#3B82F6', r: 4 } }), _jsx(Line, { type: "monotone", dataKey: "ebitdaMargin", name: "EBITDA Margin %", stroke: "#10B981", strokeWidth: 3, dot: { fill: '#10B981', r: 4 } }), _jsx(Line, { type: "monotone", dataKey: "netMargin", name: "Net Margin %", stroke: "#8B5CF6", strokeWidth: 3, dot: { fill: '#8B5CF6', r: 4 } })] }) }), _jsx("div", { className: "mt-4 pt-4 border-t border-gray-200", children: _jsxs("div", { className: "grid grid-cols-3 gap-4 text-xs text-gray-600", children: [_jsxs("div", { children: [_jsx("span", { className: "font-semibold text-blue-600", children: "Gross Margin:" }), " Revenue - COGS"] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold text-green-600", children: "EBITDA Margin:" }), " Operating profit before D&A"] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold text-purple-600", children: "Net Margin:" }), " Bottom-line profitability"] })] }) })] }));
};
export default MonthlyTrendChart;
