// FP&A Variance Analysis - Waterfall Chart Component (Budget to Actual Bridge)
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { WaterfallItem } from '../../types/fpa';
import { formatCurrency } from '../../utils/varianceUtils';

interface Props {
  data: WaterfallItem[];
  currency?: string;
  title?: string;
}

export const WaterfallChart = ({ data, currency = "INR", title = "Variance Waterfall: Budget to Actual" }: Props) => {
  // Calculate cumulative values for waterfall effect
  const chartData = data.map((item, index) => {
    if (item.type === "start") {
      return {
        name: item.name,
        value: item.value,
        start: 0,
        displayValue: item.value,
        type: item.type,
        color: "#3b82f6" // blue
      };
    } else if (item.type === "end") {
      return {
        name: item.name,
        value: item.value,
        start: 0,
        displayValue: item.value,
        type: item.type,
        color: "#1e40af" // dark blue
      };
    } else {
      // Calculate starting position based on previous items
      let cumulativeValue = data[0].value; // Start with budget
      for (let i = 1; i < index; i++) {
        if (data[i].type !== "start" && data[i].type !== "end") {
          cumulativeValue += data[i].value;
        }
      }
      
      const isIncrease = item.type === "increase";
      const start = isIncrease ? cumulativeValue : cumulativeValue + item.value;
      const displayValue = Math.abs(item.value);
      
      return {
        name: item.name,
        value: displayValue,
        start: start,
        displayValue: item.value,
        type: item.type,
        color: isIncrease ? "#10b981" : "#ef4444" // green or red
      };
    }
  });

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const isStart = data.type === "start";
      const isEnd = data.type === "end";
      
      return (
        <div className="bg-white border-2 border-gray-200 rounded-lg shadow-lg p-4">
          <p className="font-semibold text-gray-900 mb-2">{data.name}</p>
          <p className={`text-lg font-bold ${
            isStart || isEnd 
              ? 'text-blue-600' 
              : data.type === "increase" 
                ? 'text-green-600' 
                : 'text-red-600'
          }`}>
            {formatCurrency(Math.abs(data.displayValue), currency)}
          </p>
          {!isStart && !isEnd && (
            <p className="text-sm text-gray-600 mt-1">
              {data.type === "increase" ? "✅ Favorable" : "⚠️ Unfavorable"}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  const CustomLabel = (props: any) => {
    const { x, y, width, value, payload } = props;
    
    // Safety check - return null if payload is undefined
    if (!payload || payload.displayValue === undefined) {
      return null;
    }
    
    const displayValue = payload.displayValue;
    const isPositive = displayValue >= 0;
    
    return (
      <text
        x={x + width / 2}
        y={isPositive ? y - 10 : y + 25}
        fill={payload.type === "increase" ? "#10b981" : payload.type === "decrease" ? "#ef4444" : "#3b82f6"}
        textAnchor="middle"
        fontSize={12}
        fontWeight="600"
      >
        {formatCurrency(Math.abs(displayValue), currency)}
      </text>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-gray-900 mb-1">{title}</h3>
        <p className="text-sm text-gray-600">Visual bridge showing how budget translates to actual performance</p>
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <BarChart
          data={chartData}
          margin={{ top: 40, right: 30, left: 40, bottom: 80 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="name"
            angle={-45}
            textAnchor="end"
            height={100}
            interval={0}
            tick={{ fontSize: 11, fill: '#6b7280' }}
          />
          <YAxis
            tickFormatter={(value) => formatCurrency(value, currency)}
            tick={{ fontSize: 11, fill: '#6b7280' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={2} />
          
          {/* Invisible bar for stacking */}
          <Bar dataKey="start" stackId="a" fill="transparent" />
          
          {/* Visible bars */}
          <Bar dataKey="value" stackId="a" label={<CustomLabel />}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-500 rounded"></div>
          <span className="text-gray-700">Budget</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-500 rounded"></div>
          <span className="text-gray-700">Favorable</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-500 rounded"></div>
          <span className="text-gray-700">Unfavorable</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-900 rounded"></div>
          <span className="text-gray-700">Actual</span>
        </div>
      </div>
    </div>
  );
};
