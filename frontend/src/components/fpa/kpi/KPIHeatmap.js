import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
const KPIHeatmap = ({ data }) => {
    const [selectedCell, setSelectedCell] = useState(null);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
    const kpiNames = Array.from(new Set(data.map(d => d.kpiName)));
    const getCellColor = (status) => {
        switch (status) {
            case 'excellent':
            case 'good':
                return 'bg-green-500 hover:bg-green-600';
            case 'warning':
                return 'bg-amber-500 hover:bg-amber-600';
            case 'critical':
                return 'bg-red-500 hover:bg-red-600';
            default:
                return 'bg-gray-300 hover:bg-gray-400';
        }
    };
    const getCellEmoji = (status) => {
        switch (status) {
            case 'excellent':
            case 'good':
                return '🟢';
            case 'warning':
                return '🟡';
            case 'critical':
                return '🔴';
            default:
                return '⚪';
        }
    };
    const getStatusLabel = (status) => {
        switch (status) {
            case 'excellent':
                return 'Excellent';
            case 'good':
                return 'On Target';
            case 'warning':
                return 'Warning';
            case 'critical':
                return 'Critical';
            default:
                return 'Unknown';
        }
    };
    const getCellData = (kpiName, month) => {
        return data.find(d => d.kpiName === kpiName && d.month === month);
    };
    return (_jsxs("div", { className: "bg-white rounded-xl border-2 border-gray-200 p-6 shadow-sm", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "KPI Performance Heatmap" }), _jsx("p", { className: "text-sm text-gray-600 mb-6", children: "Monthly performance tracking - Click any cell for details" }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "bg-gray-50", children: [_jsx("th", { className: "py-3 px-4 text-left font-semibold text-gray-700 border-b-2 border-gray-200", children: "KPI" }), months.map(month => (_jsx("th", { className: "py-3 px-3 text-center font-semibold text-gray-700 border-b-2 border-gray-200", children: month }, month)))] }) }), _jsx("tbody", { children: kpiNames.map((kpiName, idx) => (_jsxs("tr", { className: idx % 2 === 0 ? 'bg-white' : 'bg-gray-50', children: [_jsx("td", { className: "py-3 px-4 font-medium text-gray-900 border-b border-gray-200", children: kpiName }), months.map(month => {
                                        const cellData = getCellData(kpiName, month);
                                        if (!cellData)
                                            return _jsx("td", { className: "py-3 px-3 border-b border-gray-200" }, month);
                                        return (_jsx("td", { className: "py-3 px-3 border-b border-gray-200", children: _jsx("button", { onClick: () => setSelectedCell(cellData), className: `w-10 h-10 rounded-lg transition-all duration-200 flex items-center justify-center text-xl ${getCellColor(cellData.status)} cursor-pointer transform hover:scale-110 shadow-sm`, title: `${kpiName} - ${month}: ${getStatusLabel(cellData.status)}`, children: getCellEmoji(cellData.status) }) }, month));
                                    })] }, kpiName))) })] }) }), _jsx("div", { className: "mt-6 pt-4 border-t border-gray-200", children: _jsxs("div", { className: "flex items-center justify-center gap-6 text-sm", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xl", children: "\uD83D\uDFE2" }), _jsx("span", { className: "text-gray-700", children: "On Target" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xl", children: "\uD83D\uDFE1" }), _jsx("span", { className: "text-gray-700", children: "Warning" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xl", children: "\uD83D\uDD34" }), _jsx("span", { className: "text-gray-700", children: "Critical" })] })] }) }), selectedCell && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50", onClick: () => setSelectedCell(null), children: _jsxs("div", { className: "bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("h4", { className: "text-xl font-bold text-gray-900", children: selectedCell.kpiName }), _jsx("button", { onClick: () => setSelectedCell(null), className: "text-gray-400 hover:text-gray-600 text-2xl", children: "\u00D7" })] }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between py-2 border-b border-gray-200", children: [_jsx("span", { className: "text-gray-600", children: "Month:" }), _jsx("span", { className: "font-semibold text-gray-900", children: selectedCell.month })] }), _jsxs("div", { className: "flex items-center justify-between py-2 border-b border-gray-200", children: [_jsx("span", { className: "text-gray-600", children: "Actual Value:" }), _jsx("span", { className: "font-semibold text-gray-900", children: selectedCell.kpiName.includes('Margin')
                                                ? `${selectedCell.value.toFixed(1)}%`
                                                : selectedCell.kpiName.includes('Ratio')
                                                    ? `${selectedCell.value.toFixed(1)}x`
                                                    : selectedCell.kpiName.includes('DSO')
                                                        ? `${selectedCell.value.toFixed(0)} days`
                                                        : `₹${(selectedCell.value / 10000000).toFixed(2)}Cr` })] }), _jsxs("div", { className: "flex items-center justify-between py-2 border-b border-gray-200", children: [_jsx("span", { className: "text-gray-600", children: "Target:" }), _jsx("span", { className: "font-semibold text-gray-900", children: selectedCell.kpiName.includes('Margin')
                                                ? `${selectedCell.target.toFixed(1)}%`
                                                : selectedCell.kpiName.includes('Ratio')
                                                    ? `${selectedCell.target.toFixed(1)}x`
                                                    : selectedCell.kpiName.includes('DSO')
                                                        ? `${selectedCell.target.toFixed(0)} days`
                                                        : `₹${(selectedCell.target / 10000000).toFixed(2)}Cr` })] }), _jsxs("div", { className: "flex items-center justify-between py-2 border-b border-gray-200", children: [_jsx("span", { className: "text-gray-600", children: "Variance:" }), _jsxs("span", { className: `font-semibold ${selectedCell.value >= selectedCell.target ? 'text-green-600' : 'text-red-600'}`, children: [selectedCell.value > selectedCell.target ? '+' : '', (selectedCell.value - selectedCell.target).toFixed(1), selectedCell.kpiName.includes('Margin') ? 'pp' : ''] })] }), _jsxs("div", { className: "flex items-center justify-between py-2", children: [_jsx("span", { className: "text-gray-600", children: "Status:" }), _jsx("span", { className: `px-3 py-1 rounded-full font-semibold ${selectedCell.status === 'excellent' || selectedCell.status === 'good'
                                                ? 'bg-green-100 text-green-700'
                                                : selectedCell.status === 'warning'
                                                    ? 'bg-amber-100 text-amber-700'
                                                    : 'bg-red-100 text-red-700'}`, children: getStatusLabel(selectedCell.status) })] })] }), _jsx("button", { onClick: () => setSelectedCell(null), className: "mt-6 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors", children: "Close" })] }) }))] }));
};
export default KPIHeatmap;
