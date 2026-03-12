import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { formatCurrency, formatPercentage, getVarianceIcon } from '../../utils/varianceUtils';
export const DepartmentChart = ({ data, currency = "INR", title = "Department-wise Variance", onDepartmentClick }) => {
    // Prepare data for horizontal bar chart
    const chartData = data.map(dept => ({
        ...dept,
        actualPct: (dept.actual / dept.budget) * 100,
        budgetPct: 100
    }));
    const getBarColor = (dept) => {
        if (dept.threshold === "ok")
            return "#6b7280"; // gray
        if (dept.favorable)
            return "#10b981"; // green
        if (dept.threshold === "critical")
            return "#ef4444"; // red
        if (dept.threshold === "warning")
            return "#f59e0b"; // amber
        return "#6b7280";
    };
    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const dept = payload[0].payload;
            return (_jsxs("div", { className: "bg-white border-2 border-gray-200 rounded-lg shadow-lg p-4", children: [_jsx("p", { className: "font-semibold text-gray-900 mb-2", children: dept.department }), _jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsx("span", { className: "text-sm text-gray-600", children: "Actual:" }), _jsx("span", { className: "text-sm font-bold text-blue-600", children: formatCurrency(dept.actual, currency) })] }), _jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsx("span", { className: "text-sm text-gray-600", children: "Budget:" }), _jsx("span", { className: "text-sm font-semibold text-gray-700", children: formatCurrency(dept.budget, currency) })] }), _jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsx("span", { className: "text-sm text-gray-600", children: "Variance:" }), _jsx("span", { className: "text-sm font-semibold text-gray-700", children: formatCurrency(dept.variance, currency) })] }), _jsxs("div", { className: "flex items-center justify-between gap-4 pt-2 border-t border-gray-200", children: [_jsx("span", { className: "text-sm text-gray-600", children: "Status:" }), _jsxs("span", { className: `text-sm font-bold ${dept.favorable ? 'text-green-600' : 'text-red-600'}`, children: [formatPercentage(dept.variancePct), " ", getVarianceIcon(dept.favorable, dept.threshold)] })] })] })] }));
        }
        return null;
    };
    return (_jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: [_jsxs("div", { className: "mb-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-1", children: title }), _jsx("p", { className: "text-sm text-gray-600", children: "Spend by department vs budget allocation" })] }), _jsx("div", { className: "space-y-4", children: data.map((dept, index) => {
                    const percentage = (dept.actual / dept.budget) * 100;
                    const isOverBudget = percentage > 100;
                    const barColor = getBarColor(dept);
                    return (_jsxs("div", { className: "group cursor-pointer hover:bg-gray-50 p-3 rounded-lg transition", onClick: () => onDepartmentClick?.(dept.department), children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "font-semibold text-gray-900 w-32", children: dept.department }), _jsxs("span", { className: "text-sm text-gray-600", children: [formatCurrency(dept.actual, currency), " / ", formatCurrency(dept.budget, currency)] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: `font-bold text-sm ${dept.favorable ? 'text-green-600' : 'text-red-600'}`, children: formatPercentage(dept.variancePct) }), _jsx("span", { className: "text-sm", children: getVarianceIcon(dept.favorable, dept.threshold) })] })] }), _jsxs("div", { className: "relative h-8 bg-gray-100 rounded-lg overflow-hidden", children: [_jsx("div", { className: "absolute inset-y-0 left-0 right-0 border-r-2 border-gray-400 border-dashed", style: { width: '100%' } }), _jsx("div", { className: "absolute inset-y-0 left-0 rounded-lg transition-all duration-500 flex items-center justify-end pr-2", style: {
                                            width: `${Math.min(percentage, 120)}%`,
                                            backgroundColor: barColor,
                                            opacity: 0.8
                                        }, children: percentage > 15 && (_jsxs("span", { className: "text-xs font-semibold text-white", children: [percentage.toFixed(1), "%"] })) }), percentage <= 15 && (_jsxs("span", { className: "absolute inset-y-0 left-2 flex items-center text-xs font-semibold text-gray-700", children: [percentage.toFixed(1), "%"] }))] })] }, dept.department));
                }) }), _jsxs("div", { className: "flex items-center justify-center gap-6 mt-6 pt-6 border-t border-gray-200 text-sm", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "w-4 h-4 bg-green-500 rounded" }), _jsx("span", { className: "text-gray-700", children: "\u2705 Under Budget (Favorable)" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "w-4 h-4 bg-red-500 rounded" }), _jsx("span", { className: "text-gray-700", children: "\uD83D\uDD34 Over Budget (Unfavorable)" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "w-4 h-4 border-2 border-dashed border-gray-400 rounded bg-white" }), _jsx("span", { className: "text-gray-700", children: "Budget Target (100%)" })] })] }), _jsx("div", { className: "grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-gray-200", children: (() => {
                    const totalActual = data.reduce((sum, d) => sum + d.actual, 0);
                    const totalBudget = data.reduce((sum, d) => sum + d.budget, 0);
                    const totalVariance = totalActual - totalBudget;
                    const variancePct = ((totalVariance / totalBudget) * 100).toFixed(1);
                    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-sm text-gray-600 mb-1", children: "Total Actual" }), _jsx("div", { className: "text-lg font-bold text-blue-600", children: formatCurrency(totalActual, currency) })] }), _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-sm text-gray-600 mb-1", children: "Total Budget" }), _jsx("div", { className: "text-lg font-bold text-gray-700", children: formatCurrency(totalBudget, currency) })] }), _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-sm text-gray-600 mb-1", children: "Total Variance" }), _jsxs("div", { className: `text-lg font-bold ${totalVariance >= 0 ? 'text-red-600' : 'text-green-600'}`, children: [totalVariance >= 0 ? '+' : '', variancePct, "%"] })] })] }));
                })() })] }));
};
