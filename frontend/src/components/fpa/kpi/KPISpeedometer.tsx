import React from 'react';
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from 'recharts';

interface KPISpeedometerProps {
  title: string;
  value: number;
  target: number;
  unit?: string;
}

const KPISpeedometer: React.FC<KPISpeedometerProps> = ({ title, value, target, unit = '%' }) => {
  // Calculate percentage of target achieved
  const percentOfTarget = (value / target) * 100;
  
  // Determine color based on performance
  const getColor = () => {
    if (percentOfTarget >= 110) return '#3B82F6'; // Blue - exceeding
    if (percentOfTarget >= 90) return '#10B981'; // Green - on target
    if (percentOfTarget >= 60) return '#F59E0B'; // Amber - warning
    return '#EF4444'; // Red - critical
  };

  const getStatus = () => {
    if (percentOfTarget >= 110) return 'Exceeding';
    if (percentOfTarget >= 90) return 'On Target';
    if (percentOfTarget >= 60) return 'Below Target';
    return 'Critical';
  };

  const data = [
    {
      name: title,
      value: Math.min(percentOfTarget, 120), // Cap at 120% for visual
      fill: getColor()
    }
  ];

  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 p-6 shadow-sm">
      {/* Title */}
      <h3 className="text-lg font-semibold text-gray-900 mb-2 text-center">{title}</h3>
      
      {/* Gauge Chart */}
      <div className="relative h-48">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="70%"
            innerRadius="60%"
            outerRadius="90%"
            barSize={20}
            data={data}
            startAngle={180}
            endAngle={0}
          >
            <PolarAngleAxis
              type="number"
              domain={[0, 120]}
              angleAxisId={0}
              tick={false}
            />
            <RadialBar
              background
              dataKey="value"
              cornerRadius={10}
              fill={getColor()}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        
        {/* Center Value */}
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ top: '35%' }}>
          <div className="text-4xl font-bold text-gray-900">
            {value.toFixed(1)}{unit}
          </div>
          <div className="text-sm text-gray-500 mt-1">
            of {target.toFixed(1)}{unit}
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="mt-4 text-center">
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${
          percentOfTarget >= 110 ? 'bg-blue-100 text-blue-700' :
          percentOfTarget >= 90 ? 'bg-green-100 text-green-700' :
          percentOfTarget >= 60 ? 'bg-amber-100 text-amber-700' :
          'bg-red-100 text-red-700'
        }`}>
          <span className="text-2xl">
            {percentOfTarget >= 110 ? '🚀' :
             percentOfTarget >= 90 ? '✅' :
             percentOfTarget >= 60 ? '⚠️' : '🔴'}
          </span>
          <span className="font-semibold">{getStatus()}</span>
        </div>
        
        {/* Difference */}
        <div className="mt-2 text-sm text-gray-600">
          {value > target ? '+' : ''}{(value - target).toFixed(1)}pp {value > target ? 'above' : 'below'} target
        </div>
      </div>

      {/* Color Legend */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <span className="text-gray-600">&lt;60%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-amber-500"></div>
            <span className="text-gray-600">60-90%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span className="text-gray-600">90-110%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
            <span className="text-gray-600">&gt;110%</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default KPISpeedometer;
