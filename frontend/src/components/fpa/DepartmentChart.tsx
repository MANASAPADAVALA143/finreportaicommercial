// FP&A Variance Analysis - Department Breakdown Chart Component
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import type { DepartmentVariance } from '../../types/fpa';
import { formatCurrency, formatPercentage, getVarianceIcon } from '../../utils/varianceUtils';

interface Props {
  data: DepartmentVariance[];
  currency?: string;
  title?: string;
  onDepartmentClick?: (department: string) => void;
}

export const DepartmentChart = ({ data, currency = "INR", title = "Department-wise Variance", onDepartmentClick }: Props) => {
  // Prepare data for horizontal bar chart
  const chartData = data.map(dept => ({
    ...dept,
    actualPct: (dept.actual / dept.budget) * 100,
    budgetPct: 100
  }));

  const getBarColor = (dept: DepartmentVariance) => {
    if (dept.threshold === "ok") return "#6b7280"; // gray
    if (dept.favorable) return "#10b981"; // green
    if (dept.threshold === "critical") return "#ef4444"; // red
    if (dept.threshold === "warning") return "#f59e0b"; // amber
    return "#6b7280";
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const dept = payload[0].payload as DepartmentVariance;
      
      return (
        <div className="bg-white border-2 border-gray-200 rounded-lg shadow-lg p-4">
          <p className="font-semibold text-gray-900 mb-2">{dept.department}</p>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">Actual:</span>
              <span className="text-sm font-bold text-blue-600">{formatCurrency(dept.actual, currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">Budget:</span>
              <span className="text-sm font-semibold text-gray-700">{formatCurrency(dept.budget, currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">Variance:</span>
              <span className="text-sm font-semibold text-gray-700">{formatCurrency(dept.variance, currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-200">
              <span className="text-sm text-gray-600">Status:</span>
              <span className={`text-sm font-bold ${
                dept.favorable ? 'text-green-600' : 'text-red-600'
              }`}>
                {formatPercentage(dept.variancePct)} {getVarianceIcon(dept.favorable, dept.threshold)}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-gray-900 mb-1">{title}</h3>
        <p className="text-sm text-gray-600">Spend by department vs budget allocation</p>
      </div>

      {/* Horizontal Bar Chart */}
      <div className="space-y-4">
        {data.map((dept, index) => {
          const percentage = (dept.actual / dept.budget) * 100;
          const isOverBudget = percentage > 100;
          const barColor = getBarColor(dept);
          
          return (
            <div
              key={dept.department}
              className="group cursor-pointer hover:bg-gray-50 p-3 rounded-lg transition"
              onClick={() => onDepartmentClick?.(dept.department)}
            >
              {/* Department Name & Amounts */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-900 w-32">{dept.department}</span>
                  <span className="text-sm text-gray-600">
                    {formatCurrency(dept.actual, currency)} / {formatCurrency(dept.budget, currency)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`font-bold text-sm ${
                    dept.favorable ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {formatPercentage(dept.variancePct)}
                  </span>
                  <span className="text-sm">{getVarianceIcon(dept.favorable, dept.threshold)}</span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="relative h-8 bg-gray-100 rounded-lg overflow-hidden">
                {/* Budget line (100%) */}
                <div className="absolute inset-y-0 left-0 right-0 border-r-2 border-gray-400 border-dashed" style={{ width: '100%' }}></div>
                
                {/* Actual bar */}
                <div
                  className="absolute inset-y-0 left-0 rounded-lg transition-all duration-500 flex items-center justify-end pr-2"
                  style={{
                    width: `${Math.min(percentage, 120)}%`,
                    backgroundColor: barColor,
                    opacity: 0.8
                  }}
                >
                  {percentage > 15 && (
                    <span className="text-xs font-semibold text-white">
                      {percentage.toFixed(1)}%
                    </span>
                  )}
                </div>
                
                {/* Label if bar is too small */}
                {percentage <= 15 && (
                  <span className="absolute inset-y-0 left-2 flex items-center text-xs font-semibold text-gray-700">
                    {percentage.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-6 pt-6 border-t border-gray-200 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-500 rounded"></div>
          <span className="text-gray-700">✅ Under Budget (Favorable)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-500 rounded"></div>
          <span className="text-gray-700">🔴 Over Budget (Unfavorable)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-dashed border-gray-400 rounded bg-white"></div>
          <span className="text-gray-700">Budget Target (100%)</span>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-gray-200">
        {(() => {
          const totalActual = data.reduce((sum, d) => sum + d.actual, 0);
          const totalBudget = data.reduce((sum, d) => sum + d.budget, 0);
          const totalVariance = totalActual - totalBudget;
          const variancePct = ((totalVariance / totalBudget) * 100).toFixed(1);
          
          return (
            <>
              <div className="text-center">
                <div className="text-sm text-gray-600 mb-1">Total Actual</div>
                <div className="text-lg font-bold text-blue-600">{formatCurrency(totalActual, currency)}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-600 mb-1">Total Budget</div>
                <div className="text-lg font-bold text-gray-700">{formatCurrency(totalBudget, currency)}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-600 mb-1">Total Variance</div>
                <div className={`text-lg font-bold ${totalVariance >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {totalVariance >= 0 ? '+' : ''}{variancePct}%
                </div>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
};
