// FP&A Variance Analysis - Main P&L Variance Table Component
import { useState, useEffect } from 'react';
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

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

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
              <th className="px-4 py-4 text-left text-sm font-semibold w-28">Account Type</th>
              <th className="px-4 py-4 text-left text-sm font-semibold w-40">Owner</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-32">Actual (Oct)</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-32">Budget (Oct)</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-32">Variance</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-24">Var %</th>
              <th className="px-4 py-4 text-left text-sm font-semibold w-32">Materiality</th>
              <th className="px-4 py-4 text-left text-sm font-semibold w-28">Trend</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-32">YTD Actual</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-32">YTD Budget</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-24">YTD Var %</th>
              <th className="px-4 py-4 text-right text-sm font-semibold w-24">PY Var %</th>
              <th className="px-4 py-4 text-left text-sm font-semibold w-44">Actions</th>
              <th className="px-4 py-4 text-left text-sm font-semibold w-36">Status</th>
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

  const accountType = row.accountType || (/revenue|income|sales/i.test(row.category) ? 'income' : 'expense');
  const accountTypeLabel = accountType === 'income' ? 'Income' : accountType === 'expense' ? 'Expense' : 'Other';
  const statusBadge = row.isHeader
    ? '—'
    : accountType === 'income'
      ? (row.actual > row.budget ? 'Favorable' : 'Below Target')
      : (row.actual > row.budget ? 'Over Budget' : 'Favorable');

  return (
    <>
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
            {(row.hasChildren || row.decomposition) && (
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

        {/* Account Type */}
        <td className="px-4 py-3 text-sm">
          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
            accountType === 'income'
              ? 'bg-green-100 text-green-700'
              : accountType === 'expense'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-gray-100 text-gray-700'
          }`}>
            {accountTypeLabel}
          </span>
        </td>

        {/* Owner */}
        <td className="px-4 py-3 text-sm text-gray-700">
          {row.owner || '—'}
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

        {/* Materiality */}
        <td className="px-4 py-3">
          {!row.isHeader ? (
            <span
              className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                row.materialityBand === 'critical'
                  ? 'bg-red-100 text-red-700'
                  : row.materialityBand === 'monitor'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-green-100 text-green-700'
              }`}
              title={`Score ${(row.materialityScore || 0).toFixed(3)}`}
            >
              {(row.materialityBand || 'low').toUpperCase()}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>

        {/* Trend sparkline */}
        <td className="px-4 py-3">
          {!row.isHeader && row.trend?.length ? (
            <div className="flex items-end gap-[2px] h-7">
              {row.trend.slice(-12).map((v, i) => {
                const pct = Math.max(8, Math.min(100, Math.round(v * 60)));
                return (
                  <span
                    key={`${row.id}-spark-${i}`}
                    className="w-1.5 bg-blue-400 rounded-sm"
                    style={{ height: `${pct}%` }}
                    title={`M${i + 1}: ${v.toFixed(2)}`}
                  />
                );
              })}
            </div>
          ) : (
            <span className="text-gray-400">—</span>
          )}
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

        {/* Actions */}
        <td className="px-4 py-3">
          {!row.isHeader ? (
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              onClick={(e) => {
                e.stopPropagation();
                alert('Transaction drill-down coming soon — connect your ERP');
              }}
            >
              View Transactions
            </button>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>

        {/* Status */}
        <td className="px-4 py-3">
          {!row.isHeader ? (
            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
              statusBadge === 'Favorable'
                ? 'bg-green-100 text-green-700'
                : statusBadge === 'Over Budget' || statusBadge === 'Below Target'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-gray-100 text-gray-700'
            }`}>
              {statusBadge}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
      </tr>

      {!!row.decomposition && row.isExpanded && !row.isHeader && (
        <tr className="bg-indigo-50/60">
          <td colSpan={15} className="px-8 py-3 text-sm text-indigo-900">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <span className="font-semibold">Volume impact:</span> {formatCurrency(row.decomposition.volume, currency)}
              </div>
              <div>
                <span className="font-semibold">Price/Cost impact:</span> {formatCurrency(row.decomposition.price, currency)}
              </div>
              <div>
                <span className="font-semibold">Mix/Efficiency:</span> {formatCurrency(row.decomposition.mix, currency)}
              </div>
            </div>
            {row.decomposition.note ? (
              <div className="mt-1 text-xs text-indigo-700">{row.decomposition.note}</div>
            ) : null}
          </td>
        </tr>
      )}
    </>
  );
};
