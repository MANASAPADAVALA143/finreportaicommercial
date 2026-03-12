import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Edit2, Check, X } from 'lucide-react';
const BudgetTable = ({ data, onDataChange }) => {
    const [editingCell, setEditingCell] = useState(null);
    const [editValue, setEditValue] = useState('');
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formatCurrency = (value) => {
        const crore = value / 10000000;
        const lakh = value / 100000;
        if (Math.abs(crore) >= 1)
            return `₹${crore.toFixed(2)}Cr`;
        return `₹${lakh.toFixed(2)}L`;
    };
    const calculateTotal = (monthly) => {
        return Object.values(monthly).reduce((sum, val) => sum + val, 0);
    };
    const handleCellClick = (item, month) => {
        if (item.isEditable) {
            setEditingCell({ id: item.id, month });
            setEditValue(item.monthly[month].toString());
        }
    };
    const handleSave = () => {
        if (!editingCell)
            return;
        const numValue = parseFloat(editValue);
        if (isNaN(numValue) || numValue < 0) {
            alert('Please enter a valid positive number');
            return;
        }
        const updatedData = data.map(item => {
            if (item.id === editingCell.id) {
                return {
                    ...item,
                    monthly: {
                        ...item.monthly,
                        [editingCell.month]: numValue
                    }
                };
            }
            return item;
        });
        onDataChange(updatedData);
        setEditingCell(null);
        setEditValue('');
    };
    const handleCancel = () => {
        setEditingCell(null);
        setEditValue('');
    };
    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            handleSave();
        }
        else if (e.key === 'Escape') {
            handleCancel();
        }
    };
    const getCellStyle = (item) => {
        if (item.isHeader) {
            return 'bg-blue-50 font-semibold text-gray-900';
        }
        return 'bg-white hover:bg-gray-50';
    };
    const getIndentStyle = (indent = 0) => {
        return `pl-${indent * 4 + 4}`;
    };
    return (_jsx("div", { className: "overflow-x-auto border border-gray-200 rounded-lg", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "bg-gradient-to-r from-blue-600 to-blue-700 text-white sticky top-0 z-10", children: _jsxs("tr", { children: [_jsx("th", { className: "py-3 px-4 text-left font-semibold min-w-[250px]", children: "Line Item" }), monthLabels.map(label => (_jsx("th", { className: "py-3 px-3 text-right font-semibold min-w-[110px]", children: label }, label))), _jsx("th", { className: "py-3 px-4 text-right font-semibold min-w-[120px] bg-blue-800", children: "Total" }), _jsx("th", { className: "py-3 px-4 text-right font-semibold min-w-[120px] bg-blue-800", children: "FY2024 Actual" }), _jsx("th", { className: "py-3 px-4 text-right font-semibold min-w-[100px] bg-blue-800", children: "% Change" })] }) }), _jsx("tbody", { children: data.map((item, idx) => {
                        const total = calculateTotal(item.monthly);
                        const priorYear = item.priorYearActual || 0;
                        const changePercent = priorYear > 0 ? ((total - priorYear) / priorYear) * 100 : 0;
                        return (_jsxs("tr", { className: `border-b border-gray-100 ${getCellStyle(item)} transition-colors`, children: [_jsx("td", { className: `py-2 px-4 ${getIndentStyle(item.indent)}`, children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: item.isHeader ? 'text-base font-bold' : 'text-sm', children: item.category }), item.department && (_jsx("span", { className: "text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full", children: item.department }))] }) }), months.map(month => {
                                    const isEditing = editingCell?.id === item.id && editingCell?.month === month;
                                    const value = item.monthly[month];
                                    return (_jsx("td", { className: `py-2 px-3 text-right ${item.isEditable ? 'cursor-pointer group' : ''}`, onClick: () => handleCellClick(item, month), children: isEditing ? (_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("input", { type: "number", value: editValue, onChange: (e) => setEditValue(e.target.value), onKeyDown: handleKeyDown, className: "w-full px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-right", autoFocus: true }), _jsx("button", { onClick: (e) => {
                                                        e.stopPropagation();
                                                        handleSave();
                                                    }, className: "p-1 text-green-600 hover:bg-green-50 rounded", children: _jsx(Check, { size: 14 }) }), _jsx("button", { onClick: (e) => {
                                                        e.stopPropagation();
                                                        handleCancel();
                                                    }, className: "p-1 text-red-600 hover:bg-red-50 rounded", children: _jsx(X, { size: 14 }) })] })) : (_jsxs("div", { className: "flex items-center justify-end gap-1", children: [_jsx("span", { children: formatCurrency(value) }), item.isEditable && (_jsx(Edit2, { size: 12, className: "opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity" }))] })) }, month));
                                }), _jsx("td", { className: "py-2 px-4 text-right font-semibold bg-gray-50", children: formatCurrency(total) }), _jsx("td", { className: "py-2 px-4 text-right text-gray-600 bg-gray-50", children: priorYear > 0 ? formatCurrency(priorYear) : '-' }), _jsx("td", { className: `py-2 px-4 text-right font-medium bg-gray-50 ${changePercent > 0 ? 'text-green-600' : changePercent < 0 ? 'text-red-600' : 'text-gray-600'}`, children: priorYear > 0 ? `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%` : '-' })] }, item.id));
                    }) })] }) }));
};
export default BudgetTable;
