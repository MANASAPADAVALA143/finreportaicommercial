import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from 'recharts';
const KPISpeedometer = ({ title, value, target, unit = '%' }) => {
    // Calculate percentage of target achieved
    const percentOfTarget = (value / target) * 100;
    // Determine color based on performance
    const getColor = () => {
        if (percentOfTarget >= 110)
            return '#3B82F6'; // Blue - exceeding
        if (percentOfTarget >= 90)
            return '#10B981'; // Green - on target
        if (percentOfTarget >= 60)
            return '#F59E0B'; // Amber - warning
        return '#EF4444'; // Red - critical
    };
    const getStatus = () => {
        if (percentOfTarget >= 110)
            return 'Exceeding';
        if (percentOfTarget >= 90)
            return 'On Target';
        if (percentOfTarget >= 60)
            return 'Below Target';
        return 'Critical';
    };
    const data = [
        {
            name: title,
            value: Math.min(percentOfTarget, 120), // Cap at 120% for visual
            fill: getColor()
        }
    ];
    return (_jsxs("div", { className: "bg-white rounded-xl border-2 border-gray-200 p-6 shadow-sm", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-2 text-center", children: title }), _jsxs("div", { className: "relative h-48", children: [_jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(RadialBarChart, { cx: "50%", cy: "70%", innerRadius: "60%", outerRadius: "90%", barSize: 20, data: data, startAngle: 180, endAngle: 0, children: [_jsx(PolarAngleAxis, { type: "number", domain: [0, 120], angleAxisId: 0, tick: false }), _jsx(RadialBar, { background: true, dataKey: "value", cornerRadius: 10, fill: getColor() })] }) }), _jsxs("div", { className: "absolute inset-0 flex flex-col items-center justify-center", style: { top: '35%' }, children: [_jsxs("div", { className: "text-4xl font-bold text-gray-900", children: [value.toFixed(1), unit] }), _jsxs("div", { className: "text-sm text-gray-500 mt-1", children: ["of ", target.toFixed(1), unit] })] })] }), _jsxs("div", { className: "mt-4 text-center", children: [_jsxs("div", { className: `inline-flex items-center gap-2 px-4 py-2 rounded-lg ${percentOfTarget >= 110 ? 'bg-blue-100 text-blue-700' :
                            percentOfTarget >= 90 ? 'bg-green-100 text-green-700' :
                                percentOfTarget >= 60 ? 'bg-amber-100 text-amber-700' :
                                    'bg-red-100 text-red-700'}`, children: [_jsx("span", { className: "text-2xl", children: percentOfTarget >= 110 ? '🚀' :
                                    percentOfTarget >= 90 ? '✅' :
                                        percentOfTarget >= 60 ? '⚠️' : '🔴' }), _jsx("span", { className: "font-semibold", children: getStatus() })] }), _jsxs("div", { className: "mt-2 text-sm text-gray-600", children: [value > target ? '+' : '', (value - target).toFixed(1), "pp ", value > target ? 'above' : 'below', " target"] })] }), _jsx("div", { className: "mt-4 pt-4 border-t border-gray-200", children: _jsxs("div", { className: "flex items-center justify-between text-xs", children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-red-500" }), _jsx("span", { className: "text-gray-600", children: "<60%" })] }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-amber-500" }), _jsx("span", { className: "text-gray-600", children: "60-90%" })] }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-green-500" }), _jsx("span", { className: "text-gray-600", children: "90-110%" })] }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-blue-500" }), _jsx("span", { className: "text-gray-600", children: ">110%" })] })] }) })] }));
};
export default KPISpeedometer;
