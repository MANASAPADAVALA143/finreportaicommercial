import React, { useState } from 'react';
import { BudgetLineItem, MonthlyBudget } from '../../types/budget';
import { Edit2, Check, X } from 'lucide-react';

interface BudgetTableProps {
  data: BudgetLineItem[];
  onDataChange: (updatedData: BudgetLineItem[]) => void;
}

const BudgetTable: React.FC<BudgetTableProps> = ({ data, onDataChange }) => {
  const [editingCell, setEditingCell] = useState<{ id: string; month: keyof MonthlyBudget } | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const formatCurrency = (value: number): string => {
    const crore = value / 10000000;
    const lakh = value / 100000;
    if (Math.abs(crore) >= 1) return `₹${crore.toFixed(2)}Cr`;
    return `₹${lakh.toFixed(2)}L`;
  };

  const calculateTotal = (monthly: MonthlyBudget): number => {
    return Object.values(monthly).reduce((sum, val) => sum + val, 0);
  };

  const handleCellClick = (item: BudgetLineItem, month: keyof MonthlyBudget) => {
    if (item.isEditable) {
      setEditingCell({ id: item.id, month });
      setEditValue(item.monthly[month].toString());
    }
  };

  const handleSave = () => {
    if (!editingCell) return;
    
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const getCellStyle = (item: BudgetLineItem) => {
    if (item.isHeader) {
      return 'bg-blue-50 font-semibold text-gray-900';
    }
    return 'bg-white hover:bg-gray-50';
  };

  const getIndentStyle = (indent: number = 0) => {
    return `pl-${indent * 4 + 4}`;
  };

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-gradient-to-r from-blue-600 to-blue-700 text-white sticky top-0 z-10">
          <tr>
            <th className="py-3 px-4 text-left font-semibold min-w-[250px]">Line Item</th>
            {monthLabels.map(label => (
              <th key={label} className="py-3 px-3 text-right font-semibold min-w-[110px]">{label}</th>
            ))}
            <th className="py-3 px-4 text-right font-semibold min-w-[120px] bg-blue-800">Total</th>
            <th className="py-3 px-4 text-right font-semibold min-w-[120px] bg-blue-800">FY2024 Actual</th>
            <th className="py-3 px-4 text-right font-semibold min-w-[100px] bg-blue-800">% Change</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item, idx) => {
            const total = calculateTotal(item.monthly);
            const priorYear = item.priorYearActual || 0;
            const changePercent = priorYear > 0 ? ((total - priorYear) / priorYear) * 100 : 0;
            
            return (
              <tr
                key={item.id}
                className={`border-b border-gray-100 ${getCellStyle(item)} transition-colors`}
              >
                <td className={`py-2 px-4 ${getIndentStyle(item.indent)}`}>
                  <div className="flex items-center gap-2">
                    <span className={item.isHeader ? 'text-base font-bold' : 'text-sm'}>
                      {item.category}
                    </span>
                    {item.department && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        {item.department}
                      </span>
                    )}
                  </div>
                </td>
                {months.map(month => {
                  const isEditing = editingCell?.id === item.id && editingCell?.month === month;
                  const value = item.monthly[month];

                  return (
                    <td
                      key={month}
                      className={`py-2 px-3 text-right ${item.isEditable ? 'cursor-pointer group' : ''}`}
                      onClick={() => handleCellClick(item, month)}
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="w-full px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-right"
                            autoFocus
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSave();
                            }}
                            className="p-1 text-green-600 hover:bg-green-50 rounded"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancel();
                            }}
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <span>{formatCurrency(value)}</span>
                          {item.isEditable && (
                            <Edit2 size={12} className="opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity" />
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="py-2 px-4 text-right font-semibold bg-gray-50">
                  {formatCurrency(total)}
                </td>
                <td className="py-2 px-4 text-right text-gray-600 bg-gray-50">
                  {priorYear > 0 ? formatCurrency(priorYear) : '-'}
                </td>
                <td className={`py-2 px-4 text-right font-medium bg-gray-50 ${
                  changePercent > 0 ? 'text-green-600' : changePercent < 0 ? 'text-red-600' : 'text-gray-600'
                }`}>
                  {priorYear > 0 ? `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%` : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default BudgetTable;
