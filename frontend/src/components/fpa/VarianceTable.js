import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// FP&A Variance Analysis - Main P&L Variance Table Component
import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatCurrency, formatPercentage, getVarianceIcon, getVarianceArrow, getVisibleRows, toggleRowExpansion } from '../../utils/varianceUtils';
export const VarianceTable = ({ data: initialData, currency = "INR", onRowClick }) => {
    const [data, setData] = useState(initialData);
    useEffect(() => {
        setData(initialData);
    }, [initialData]);
    const handleToggleExpand = (rowId) => {
        setData(toggleRowExpansion(data, rowId));
    };
    const visibleRows = getVisibleRows(data);
    return (_jsx("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden", children: _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full", children: [_jsx("thead", { children: _jsxs("tr", { className: "bg-gradient-to-r from-blue-600 to-blue-700 text-white", children: [_jsx("th", { className: "px-6 py-4 text-left text-sm font-semibold w-64", children: "Category" }), _jsx("th", { className: "px-4 py-4 text-right text-sm font-semibold w-32", children: "Actual (Oct)" }), _jsx("th", { className: "px-4 py-4 text-right text-sm font-semibold w-32", children: "Budget (Oct)" }), _jsx("th", { className: "px-4 py-4 text-right text-sm font-semibold w-32", children: "Variance" }), _jsx("th", { className: "px-4 py-4 text-right text-sm font-semibold w-24", children: "Var %" }), _jsx("th", { className: "px-4 py-4 text-right text-sm font-semibold w-32", children: "YTD Actual" }), _jsx("th", { className: "px-4 py-4 text-right text-sm font-semibold w-32", children: "YTD Budget" }), _jsx("th", { className: "px-4 py-4 text-right text-sm font-semibold w-24", children: "YTD Var %" }), _jsx("th", { className: "px-4 py-4 text-right text-sm font-semibold w-24", children: "PY Var %" })] }) }), _jsx("tbody", { className: "divide-y divide-gray-200", children: visibleRows.map((row, index) => (_jsx(TableRow, { row: row, currency: currency, onToggle: handleToggleExpand, onClick: onRowClick, isEven: index % 2 === 0 }, row.id))) })] }) }) }));
};
const TableRow = ({ row, currency, onToggle, onClick, isEven }) => {
    const indentLevel = row.level || 0;
    const paddingLeft = 24 + (indentLevel * 24); // 24px base + 24px per level
    const getRowBg = () => {
        if (row.isHeader)
            return "bg-gray-50";
        if (row.threshold === "critical" && !row.favorable)
            return "bg-red-50/50";
        if (row.threshold === "warning" && !row.favorable)
            return "bg-amber-50/50";
        if (row.threshold === "critical" && row.favorable)
            return "bg-green-50/50";
        return isEven ? "bg-white" : "bg-gray-50/30";
    };
    const getCategoryStyle = () => {
        if (row.isHeader)
            return "font-bold text-gray-900";
        if (row.level === 0)
            return "font-semibold text-gray-800";
        return "text-gray-700";
    };
    const getVarianceStyle = (favorable, threshold) => {
        if (threshold === "ok")
            return "text-gray-600";
        if (favorable)
            return "text-green-600 font-semibold";
        if (threshold === "critical")
            return "text-red-600 font-bold";
        if (threshold === "warning")
            return "text-amber-600 font-semibold";
        return "text-gray-600";
    };
    return (_jsxs("tr", { className: `${getRowBg()} hover:bg-blue-50/50 transition-colors cursor-pointer`, onClick: () => onClick?.(row), children: [_jsx("td", { className: `px-6 py-3 ${getCategoryStyle()}`, style: { paddingLeft: `${paddingLeft}px` }, children: _jsxs("div", { className: "flex items-center gap-2", children: [row.hasChildren && (_jsx("button", { onClick: (e) => {
                                e.stopPropagation();
                                onToggle(row.id);
                            }, className: "hover:bg-gray-200 rounded p-1 transition", children: row.isExpanded ? (_jsx(ChevronDown, { className: "w-4 h-4 text-gray-600" })) : (_jsx(ChevronRight, { className: "w-4 h-4 text-gray-600" })) })), _jsx("span", { children: row.category }), row.threshold !== "ok" && !row.isHeader && (_jsx("span", { className: "text-sm", children: getVarianceIcon(row.favorable, row.threshold) }))] }) }), _jsx("td", { className: `px-4 py-3 text-right ${row.isHeader ? 'font-bold' : ''}`, children: formatCurrency(row.actual, currency) }), _jsx("td", { className: `px-4 py-3 text-right text-gray-600 ${row.isHeader ? 'font-semibold' : ''}`, children: formatCurrency(row.budget, currency) }), _jsx("td", { className: `px-4 py-3 text-right ${getVarianceStyle(row.favorable, row.threshold)}`, children: formatCurrency(row.variance, currency) }), _jsx("td", { className: `px-4 py-3 text-right ${getVarianceStyle(row.favorable, row.threshold)}`, children: _jsxs("div", { className: "flex items-center justify-end gap-1", children: [_jsx("span", { className: "text-xs", children: getVarianceArrow(row.variance) }), _jsx("span", { children: formatPercentage(row.variancePct) })] }) }), _jsx("td", { className: `px-4 py-3 text-right ${row.isHeader ? 'font-bold' : ''}`, children: formatCurrency(row.ytdActual, currency) }), _jsx("td", { className: `px-4 py-3 text-right text-gray-600 ${row.isHeader ? 'font-semibold' : ''}`, children: formatCurrency(row.ytdBudget, currency) }), _jsx("td", { className: `px-4 py-3 text-right ${getVarianceStyle(row.favorable, row.threshold)}`, children: _jsxs("div", { className: "flex items-center justify-end gap-1", children: [_jsx("span", { className: "text-xs", children: getVarianceArrow(row.ytdVariance) }), _jsx("span", { children: formatPercentage(row.ytdVariancePct) })] }) }), _jsx("td", { className: `px-4 py-3 text-right ${row.priorYearVariancePct && row.priorYearVariancePct > 0
                    ? 'text-green-600'
                    : 'text-red-600'}`, children: row.priorYearVariancePct ? formatPercentage(row.priorYearVariancePct) : '−' })] }));
};
