import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// FP&A Variance Analysis - Waterfall Chart Component (Budget to Actual Bridge)
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer, ReferenceLine } from 'recharts';
import { formatCurrency } from '../../utils/varianceUtils';
export const WaterfallChart = ({ data, currency = "INR", title = "Variance Waterfall: Budget to Actual" }) => {
    // Calculate cumulative values for waterfall effect
    const chartData = data.map((item, index) => {
        if (item.type === "start") {
            return {
                name: item.name,
                value: item.value,
                start: 0,
                displayValue: item.value,
                type: item.type,
                color: "#3b82f6" // blue
            };
        }
        else if (item.type === "end") {
            return {
                name: item.name,
                value: item.value,
                start: 0,
                displayValue: item.value,
                type: item.type,
                color: "#1e40af" // dark blue
            };
        }
        else {
            // Calculate starting position based on previous items
            let cumulativeValue = data[0].value; // Start with budget
            for (let i = 1; i < index; i++) {
                if (data[i].type !== "start" && data[i].type !== "end") {
                    cumulativeValue += data[i].value;
                }
            }
            const isIncrease = item.type === "increase";
            const start = isIncrease ? cumulativeValue : cumulativeValue + item.value;
            const displayValue = Math.abs(item.value);
            return {
                name: item.name,
                value: displayValue,
                start: start,
                displayValue: item.value,
                type: item.type,
                color: isIncrease ? "#10b981" : "#ef4444" // green or red
            };
        }
    });
    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            const isStart = data.type === "start";
            const isEnd = data.type === "end";
            return (_jsxs("div", { className: "bg-white border-2 border-gray-200 rounded-lg shadow-lg p-4", children: [_jsx("p", { className: "font-semibold text-gray-900 mb-2", children: data.name }), _jsx("p", { className: `text-lg font-bold ${isStart || isEnd
                            ? 'text-blue-600'
                            : data.type === "increase"
                                ? 'text-green-600'
                                : 'text-red-600'}`, children: formatCurrency(Math.abs(data.displayValue), currency) }), !isStart && !isEnd && (_jsx("p", { className: "text-sm text-gray-600 mt-1", children: data.type === "increase" ? "✅ Favorable" : "⚠️ Unfavorable" }))] }));
        }
        return null;
    };
    const CustomLabel = (props) => {
        const { x, y, width, value, payload } = props;
        // Safety check - return null if payload is undefined
        if (!payload || payload.displayValue === undefined) {
            return null;
        }
        const displayValue = payload.displayValue;
        const isPositive = displayValue >= 0;
        return (_jsx("text", { x: x + width / 2, y: isPositive ? y - 10 : y + 25, fill: payload.type === "increase" ? "#10b981" : payload.type === "decrease" ? "#ef4444" : "#3b82f6", textAnchor: "middle", fontSize: 12, fontWeight: "600", children: formatCurrency(Math.abs(displayValue), currency) }));
    };
    return (_jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: [_jsxs("div", { className: "mb-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-1", children: title }), _jsx("p", { className: "text-sm text-gray-600", children: "Visual bridge showing how budget translates to actual performance" })] }), _jsx(ResponsiveContainer, { width: "100%", height: 400, children: _jsxs(BarChart, { data: chartData, margin: { top: 40, right: 30, left: 40, bottom: 80 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#e5e7eb" }), _jsx(XAxis, { dataKey: "name", angle: -45, textAnchor: "end", height: 100, interval: 0, tick: { fontSize: 11, fill: '#6b7280' } }), _jsx(YAxis, { tickFormatter: (value) => formatCurrency(value, currency), tick: { fontSize: 11, fill: '#6b7280' } }), _jsx(Tooltip, { content: _jsx(CustomTooltip, {}) }), _jsx(ReferenceLine, { y: 0, stroke: "#9ca3af", strokeWidth: 2 }), _jsx(Bar, { dataKey: "start", stackId: "a", fill: "transparent" }), _jsx(Bar, { dataKey: "value", stackId: "a", label: _jsx(CustomLabel, {}), children: chartData.map((entry, index) => (_jsx(Cell, { fill: entry.color }, `cell-${index}`))) })] }) }), _jsxs("div", { className: "flex items-center justify-center gap-6 mt-4 text-sm", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "w-4 h-4 bg-blue-500 rounded" }), _jsx("span", { className: "text-gray-700", children: "Budget" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "w-4 h-4 bg-green-500 rounded" }), _jsx("span", { className: "text-gray-700", children: "Favorable" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "w-4 h-4 bg-red-500 rounded" }), _jsx("span", { className: "text-gray-700", children: "Unfavorable" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "w-4 h-4 bg-blue-900 rounded" }), _jsx("span", { className: "text-gray-700", children: "Actual" })] })] })] }));
};
