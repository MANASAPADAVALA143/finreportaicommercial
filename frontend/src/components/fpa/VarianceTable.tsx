// FP&A Variance Analysis - Main P&L Variance Table Component
import { useState } from 'react';
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react';
import type { VarianceRow } from '../../types/fpa';
import { 
  formatCurrency, 
  formatCurrencyFull, 
  formatPercentage, 
  getVarianceColor, 
  getVarianceIcon,
  getVarianceArrow,
  getVisibleRows,
  toggleRowExpansion
} from '../../utils/varianceUtils';

interface Props {
  data: VarianceRow[];
  currency?: string;
  onRowClick?: (row: VarianceRow) => void;
}

export const VarianceTable = ({ data: initialData, currency = "INR", onRowClick }: Props) => {
  const [data, setData] = useState(initialData);

  const handleToggleExpand = (rowId: string) => {
    setData(toggleRowExpansion(data, rowId));
  };

  const visibleRows = getVisibleRows(data);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Table Header */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
              <th className="px-6 py-4 text-left text-sm font-semibold w-64">Category</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-32">Actual (Oct)</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-32">Budget (Oct)</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-32">Variance</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-24">Var %</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-32">YTD Actual</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-32">YTD Budget</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-24">YTD Var %</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-24">PY Var %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {visibleRows.map((row, index) => (
              <TableRow
                key={row.id}
                row={row}
                currency={currency}
                onToggle={handleToggleExpand}
                onClick={onRowClick}
                isEven={index % 2 === 0}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface TableRowProps {
  row: VarianceRow;
  currency: string;
  onToggle: (rowId: string) => void;
  onClick?: (row: VarianceRow) => void;
  isEven: boolean;
}

const TableRow = ({ row, currency, onToggle, onClick, isEven }: TableRowProps) => {
  const indentLevel = row.level || 0;
  const paddingLeft = 24 + (indentLevel * 24); // 24px base + 24px per level

  const getRowBg = () => {
    if (row.isHeader) return "bg-gray-50";
    if (row.threshold === "critical" && !row.favorable) return "bg-red-50/50";
    if (row.threshold === "warning" && !row.favorable) return "bg-amber-50/50";
    if (row.threshold === "critical" && row.favorable) return "bg-green-50/50";
    return isEven ? "bg-white" : "bg-gray-50/30";
  };

  const getCategoryStyle = () => {
    if (row.isHeader) return "font-bold text-gray-900";
    if (row.level === 0) return "font-semibold text-gray-800";
    return "text-gray-700";
  };

  const getVarianceStyle = (favorable: boolean, threshold: string) => {
    if (threshold === "ok") return "text-gray-600";
    if (favorable) return "text-green-600 font-semibold";
    if (threshold === "critical") return "text-red-600 font-bold";
    if (threshold === "warning") return "text-amber-600 font-semibold";
    return "text-gray-600";
  };

  return (
    <tr
      className={`${getRowBg()} hover:bg-blue-50/50 transition-colors cursor-pointer`}
      onClick={() => onClick?.(row)}
    >
      {/* Category Name */}
      <td
        className={`px-6 py-3 ${getCategoryStyle()}`}
        style={{ paddingLeft: `${paddingLeft}px` }}
      >
        <div className="flex items-center gap-2">
          {/* Expand/Collapse Icon */}
          {row.hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggle(row.id);
              }}
              className="hover:bg-gray-200 rounded p-1 transition"
            >
              {row.isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-600" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-600" />
              )}
            </button>
          )}
          
          {/* Category Name */}
          <span>{row.category}</span>
          
          {/* Alert Icon */}
          {row.threshold !== "ok" && !row.isHeader && (
            <span className="text-sm">{getVarianceIcon(row.favorable, row.threshold)}</span>
          )}
        </div>
      </td>

      {/* Actual (Oct) */}
      <td className={`px-4 py-3 text-right ${row.isHeader ? 'font-bold' : ''}`}>
        {formatCurrency(row.actual, currency)}
      </td>

      {/* Budget (Oct) */}
      <td className={`px-4 py-3 text-right text-gray-600 ${row.isHeader ? 'font-semibold' : ''}`}>
        {formatCurrency(row.budget, currency)}
      </td>

      {/* Variance */}
      <td className={`px-4 py-3 text-right ${getVarianceStyle(row.favorable, row.threshold)}`}>
        {formatCurrency(row.variance, currency)}
      </td>

      {/* Variance % */}
      <td className={`px-4 py-3 text-right ${getVarianceStyle(row.favorable, row.threshold)}`}>
        <div className="flex items-center justify-end gap-1">
          <span className="text-xs">{getVarianceArrow(row.variance)}</span>
          <span>{formatPercentage(row.variancePct)}</span>
        </div>
      </td>

      {/* YTD Actual */}
      <td className={`px-4 py-3 text-right ${row.isHeader ? 'font-bold' : ''}`}>
        {formatCurrency(row.ytdActual, currency)}
      </td>

      {/* YTD Budget */}
      <td className={`px-4 py-3 text-right text-gray-600 ${row.isHeader ? 'font-semibold' : ''}`}>
        {formatCurrency(row.ytdBudget, currency)}
      </td>

      {/* YTD Variance % */}
      <td className={`px-4 py-3 text-right ${getVarianceStyle(row.favorable, row.threshold)}`}>
        <div className="flex items-center justify-end gap-1">
          <span className="text-xs">{getVarianceArrow(row.ytdVariance)}</span>
          <span>{formatPercentage(row.ytdVariancePct)}</span>
        </div>
      </td>

      {/* Prior Year Variance % */}
      <td className={`px-4 py-3 text-right ${
        row.priorYearVariancePct && row.priorYearVariancePct > 0 
          ? 'text-green-600' 
          : 'text-red-600'
      }`}>
        {row.priorYearVariancePct ? formatPercentage(row.priorYearVariancePct) : '−'}
      </td>
    </tr>
  );
};
