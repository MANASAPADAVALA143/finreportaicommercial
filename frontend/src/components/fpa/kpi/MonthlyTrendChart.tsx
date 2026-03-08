import React from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { MonthlyKPIData } from '../../../types/kpi';

interface MonthlyTrendChartProps {
  data: MonthlyKPIData[];
  type: 'revenue' | 'margins';
}

const MonthlyTrendChart: React.FC<MonthlyTrendChartProps> = ({ data, type }) => {
  if (type === 'revenue') {
    return (
      <div className="bg-white rounded-xl border-2 border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue & Profit Trend (12 Months)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 12 }}
              stroke="#6B7280"
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 12 }}
              stroke="#6B7280"
              tickFormatter={(value) => `₹${(value / 10000000).toFixed(0)}Cr`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 12 }}
              stroke="#6B7280"
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #E5E7EB',
                borderRadius: '8px',
                padding: '12px'
              }}
              formatter={(value: any, name: string) => {
                if (name === 'Monthly Revenue') return [`₹${(value / 10000000).toFixed(2)}Cr`, name];
                if (name === 'Revenue Target') return [`₹${(value / 10000000).toFixed(2)}Cr`, name];
                return [`${value.toFixed(1)}%`, name];
              }}
            />
            <Legend
              wrapperStyle={{ paddingTop: '20px' }}
              iconType="line"
            />
            
            {/* Revenue Bar Chart */}
            <Bar
              yAxisId="left"
              dataKey="revenue"
              name="Monthly Revenue"
              fill="#3B82F6"
              radius={[8, 8, 0, 0]}
            />
            
            {/* Revenue Target Line */}
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="revenueTarget"
              name="Revenue Target"
              stroke="#9CA3AF"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
            />
            
            {/* Net Profit % Line */}
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="netProfitPercent"
              name="Net Profit %"
              stroke="#10B981"
              strokeWidth={3}
              dot={{ fill: '#10B981', r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Margins trend chart
  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Margin Trends (12 Months)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 12 }}
            stroke="#6B7280"
          />
          <YAxis
            tick={{ fontSize: 12 }}
            stroke="#6B7280"
            domain={[0, 60]}
            tickFormatter={(value) => `${value}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #E5E7EB',
              borderRadius: '8px',
              padding: '12px'
            }}
            formatter={(value: any, name: string) => [`${value.toFixed(1)}%`, name]}
          />
          <Legend
            wrapperStyle={{ paddingTop: '20px' }}
            iconType="line"
          />
          
          {/* Reference lines for industry benchmarks */}
          <ReferenceLine y={50} label="Gross Target" stroke="#94A3B8" strokeDasharray="3 3" />
          <ReferenceLine y={25} label="EBITDA Target" stroke="#94A3B8" strokeDasharray="3 3" />
          
          {/* Gross Margin Line */}
          <Line
            type="monotone"
            dataKey="grossMargin"
            name="Gross Margin %"
            stroke="#3B82F6"
            strokeWidth={3}
            dot={{ fill: '#3B82F6', r: 4 }}
          />
          
          {/* EBITDA Margin Line */}
          <Line
            type="monotone"
            dataKey="ebitdaMargin"
            name="EBITDA Margin %"
            stroke="#10B981"
            strokeWidth={3}
            dot={{ fill: '#10B981', r: 4 }}
          />
          
          {/* Net Margin Line */}
          <Line
            type="monotone"
            dataKey="netMargin"
            name="Net Margin %"
            stroke="#8B5CF6"
            strokeWidth={3}
            dot={{ fill: '#8B5CF6', r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      
      {/* Legend explanation */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="grid grid-cols-3 gap-4 text-xs text-gray-600">
          <div>
            <span className="font-semibold text-blue-600">Gross Margin:</span> Revenue - COGS
          </div>
          <div>
            <span className="font-semibold text-green-600">EBITDA Margin:</span> Operating profit before D&A
          </div>
          <div>
            <span className="font-semibold text-purple-600">Net Margin:</span> Bottom-line profitability
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonthlyTrendChart;
