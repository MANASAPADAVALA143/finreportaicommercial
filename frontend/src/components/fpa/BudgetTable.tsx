import React, { useMemo, useState } from 'react';
import { BudgetLineItem, MonthlyBudget } from '../../types/budget';
import { Edit2, Check, X } from 'lucide-react';
import {
  BUDGET_MONTH_KEYS,
  BUDGET_SECTION_CONFIG,
  getBudgetRowStatus,
  getBudgetSection,
  getMonthCellStyle,
  sumMonthlyValues,
  type BudgetSection,
} from '../../utils/budgetUtils';

interface BudgetTableProps {
  data: BudgetLineItem[];
  onDataChange: (updatedData: BudgetLineItem[]) => void;
  currency?: string;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  GBP: '£',
  EUR: '€',
  INR: '₹',
  AED: 'د.إ',
};

const SECTION_ORDER: BudgetSection[] = ['REVENUE', 'COGS', 'EXPENSE', 'OTHER'];

const BudgetTable: React.FC<BudgetTableProps> = ({ data, onDataChange, currency = 'USD' }) => {
  const [editingCell, setEditingCell] = useState<{ id: string; month: keyof MonthlyBudget } | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const formatCurrency = (value: number): string => {
    const symbol = CURRENCY_SYMBOL[String(currency).toUpperCase()] || '$';
    if (String(currency).toUpperCase() !== 'INR') {
      const abs = Math.abs(Number(value) || 0);
      if (abs >= 1000000) return `${symbol}${(value / 1000000).toFixed(2)}M`;
      if (abs >= 1000) return `${symbol}${(value / 1000).toFixed(1)}K`;
      return `${symbol}${Math.round(value).toLocaleString()}`;
    }
    const crore = value / 10000000;
    const lakh = value / 100000;
    if (Math.abs(crore) >= 1) return `${symbol}${crore.toFixed(2)}Cr`;
    return `${symbol}${lakh.toFixed(2)}L`;
  };

  const displayName = (item: BudgetLineItem) =>
    String(item.lineItem || item.category || 'Line item');

  const groupedRows = useMemo(() => {
    const rows = data.filter((r) => !r.isHeader);
    const buckets: Record<BudgetSection, BudgetLineItem[]> = {
      REVENUE: [],
      COGS: [],
      EXPENSE: [],
      OTHER: [],
    };
    rows.forEach((row) => {
      const section = getBudgetSection(row.accountType, displayName(row));
      buckets[section].push(row);
    });
    return SECTION_ORDER.flatMap((section) => {
      const items = buckets[section];
      if (!items.length) return [];
      return [{ type: 'section' as const, section }, ...items.map((item) => ({ type: 'row' as const, item, section }))];
    });
  }, [data]);

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
    const updatedData = data.map((item) => {
      if (item.id === editingCell.id) {
        return {
          ...item,
          monthly: { ...item.monthly, [editingCell.month]: numValue },
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
    if (e.key === 'Enter') handleSave();
    else if (e.key === 'Escape') handleCancel();
  };

  return (
    <div className="overflow-x-auto border border-slate-700 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-gradient-to-r from-slate-800 to-slate-900 text-slate-100 sticky top-0 z-10">
          <tr>
            <th className="py-3 px-4 text-left font-semibold min-w-[220px]">Account</th>
            <th className="py-3 px-3 text-left font-semibold min-w-[100px]">Status</th>
            <th className="py-3 px-3 text-left font-semibold min-w-[110px]">Department</th>
            {monthLabels.map((label) => (
              <th key={label} className="py-3 px-3 text-right font-semibold min-w-[96px]">
                {label}
              </th>
            ))}
            <th className="py-3 px-4 text-right font-semibold min-w-[110px] bg-slate-900">Total</th>
            <th className="py-3 px-4 text-right font-semibold min-w-[110px] bg-slate-900">FY2024</th>
            <th className="py-3 px-4 text-right font-semibold min-w-[90px] bg-slate-900">% Chg</th>
          </tr>
        </thead>
        <tbody className="bg-slate-950 text-slate-100">
          {groupedRows.map((entry, idx) => {
            if (entry.type === 'section') {
              const cfg = BUDGET_SECTION_CONFIG[entry.section];
              return (
                <tr key={`section-${entry.section}`} className={`${cfg.bg} border-b ${cfg.border}`}>
                  <td colSpan={17} className={`px-4 py-2 text-xs font-bold tracking-widest uppercase ${cfg.text}`}>
                    {cfg.label}
                  </td>
                </tr>
              );
            }

            const item = entry.item;
            const status = getBudgetRowStatus(item);
            const total = sumMonthlyValues(item.monthly);
            const priorYear = item.priorYearActual || 0;
            const changePercent = priorYear > 0 ? ((total - priorYear) / priorYear) * 100 : 0;
            const accountName = displayName(item);

            return (
              <tr key={item.id || idx} className={`border-b border-slate-800 ${status.bg} hover:bg-slate-900/60`}>
                <td className="py-2 px-4">
                  <div className="font-medium text-sm text-slate-100">{accountName}</div>
                  {item.lineItem && item.category && item.category !== item.lineItem && (
                    <div className="text-xs text-slate-500">{item.category}</div>
                  )}
                </td>
                <td className="py-2 px-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border border-slate-700 ${status.color}`}>
                    {status.label}
                  </span>
                </td>
                <td className="py-2 px-3 text-xs text-slate-400">{item.department || 'General'}</td>
                {BUDGET_MONTH_KEYS.map((month) => {
                  const isEditing = editingCell?.id === item.id && editingCell?.month === month;
                  const budgetVal = item.monthly[month];
                  const actualVal = item.monthlyActuals?.[month] || 0;
                  const cellClass = getMonthCellStyle(
                    actualVal,
                    budgetVal,
                    item.accountType,
                    accountName,
                  );

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
                            className="w-full px-2 py-1 border border-blue-500 rounded bg-slate-900 text-right text-slate-100"
                            autoFocus
                          />
                          <button onClick={(e) => { e.stopPropagation(); handleSave(); }} className="p-1 text-emerald-400">
                            <Check size={14} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleCancel(); }} className="p-1 text-red-400">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <span className={cellClass}>{formatCurrency(budgetVal)}</span>
                          {item.isEditable && (
                            <Edit2 size={12} className="opacity-0 group-hover:opacity-100 text-blue-400" />
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="py-2 px-4 text-right font-semibold text-slate-100 bg-slate-900/50">
                  {formatCurrency(total)}
                </td>
                <td className="py-2 px-4 text-right text-slate-400 bg-slate-900/50">
                  {priorYear > 0 ? formatCurrency(priorYear) : '—'}
                </td>
                <td
                  className={`py-2 px-4 text-right font-medium bg-slate-900/50 ${
                    priorYear <= 0
                      ? 'text-slate-500'
                      : changePercent > 0
                        ? 'text-emerald-400'
                        : changePercent < 0
                          ? 'text-red-400'
                          : 'text-slate-400'
                  }`}
                >
                  {priorYear > 0 ? `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%` : '—'}
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
