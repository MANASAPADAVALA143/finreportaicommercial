// FP&A Variance Analysis - Trend Chart Component (12-month trend)
import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, ComposedChart } from 'recharts';
import type { TrendDataPoint, TrendMetric } from '../../types/fpa';
import { formatCurrency } from '../../utils/varianceUtils';

interface Props {
  data: TrendDataPoint[];
  currency?: string;
  title?: string;
}

export const TrendChart = ({ data, currency = "INR", title = "12-Month Performance Trend" }: Props) => {
  const [selectedMetric, setSelectedMetric] = useState<TrendMetric>('revenue');

  const metricOptions: { value: TrendMetric; label: string }[] = [
    { value: 'revenue', label: 'Revenue' },
    { value: 'grossProfit', label: 'Gross Profit' },
    { value: 'ebitda', label: 'EBITDA' },
    { value: 'netProfit', label: 'Net Profit' }
  ];

  const getMetricData = (metric: TrendMetric) => {
    const metricMap = {
      revenue: { actual: 'actualRevenue', budget: 'budgetRevenue' },
      grossProfit: { actual: 'actualGrossProfit', budget: 'budgetGrossProfit' },
      ebitda: { actual: 'actualEBITDA', budget: 'budgetEBITDA' },
      netProfit: { actual: 'actualProfit', budget: 'budgetProfit' }
    };
    return metricMap[metric];
  };

  const currentMetric = getMetricData(selectedMetric);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const actual = payload.find((p: any) => p.dataKey === currentMetric.actual);
      const budget = payload.find((p: any) => p.dataKey === currentMetric.budget);
      
      if (actual && budget) {
        const variance = actual.value - budget.value;
        const variancePct = ((variance / budget.value) * 100).toFixed(1);
        
        return (
          <div className="bg-white border-2 border-gray-200 rounded-lg shadow-lg p-4">
            <p className="font-semibold text-gray-900 mb-2">{label}</p>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-gray-600">Actual:</span>
                <span className="text-sm font-bold text-blue-600">{formatCurrency(actual.value, currency)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-gray-600">Budget:</span>
                <span className="text-sm font-semibold text-gray-700">{formatCurrency(budget.value, currency)}</span>
              </div>
              <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-200">
                <span className="text-sm text-gray-600">Variance:</span>
                <span className={`text-sm font-bold ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {variance >= 0 ? '+' : ''}{variancePct}%
                </span>
              </div>
            </div>
          </div>
        );
      }
    }
    return null;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">{title}</h3>
          <p className="text-sm text-gray-600">Actual vs Budget performance over time</p>
        </div>
        
        {/* Metric Selector */}
        <div className="flex items-center gap-2">
          {metricOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setSelectedMetric(option.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                selectedMetric === option.value
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: '#6b7280' }}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis
            tickFormatter={(value) => formatCurrency(value, currency)}
            tick={{ fontSize: 11, fill: '#6b7280' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: '20px' }}
            iconType="line"
          />
          
          {/* Budget Line (Dashed) */}
          <Line
            type="monotone"
            dataKey={currentMetric.budget}
            stroke="#94a3b8"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={{ fill: '#94a3b8', r: 4 }}
            name="Budget"
            activeDot={{ r: 6 }}
          />
          
          {/* Actual Line (Solid) */}
          <Line
            type="monotone"
            dataKey={currentMetric.actual}
            stroke="#3b82f6"
            strokeWidth={3}
            dot={{ fill: '#3b82f6', r: 5 }}
            name="Actual"
            activeDot={{ r: 7 }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-gray-200">
        {(() => {
          const actualKey = currentMetric.actual as keyof TrendDataPoint;
          const budgetKey = currentMetric.budget as keyof TrendDataPoint;
          
          const totalActual = data.reduce((sum, d) => sum + (Number(d[actualKey]) || 0), 0);
          const totalBudget = data.reduce((sum, d) => sum + (Number(d[budgetKey]) || 0), 0);
          const totalVariance = totalActual - totalBudget;
          const variancePct = ((totalVariance / totalBudget) * 100).toFixed(1);
          
          return (
            <>
              <div className="text-center">
                <div className="text-sm text-gray-600 mb-1">Total Actual (12M)</div>
                <div className="text-xl font-bold text-blue-600">{formatCurrency(totalActual, currency)}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-600 mb-1">Total Budget (12M)</div>
                <div className="text-xl font-bold text-gray-700">{formatCurrency(totalBudget, currency)}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-600 mb-1">Total Variance</div>
                <div className={`text-xl font-bold ${totalVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
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
