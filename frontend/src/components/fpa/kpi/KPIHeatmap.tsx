import React, { useState } from 'react';
import { HeatmapCell } from '../../../types/kpi';

interface KPIHeatmapProps {
  data: HeatmapCell[];
}

const KPIHeatmap: React.FC<KPIHeatmapProps> = ({ data }) => {
  const [selectedCell, setSelectedCell] = useState<HeatmapCell | null>(null);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
  const kpiNames = Array.from(new Set(data.map(d => d.kpiName)));

  const getCellColor = (status: string) => {
    switch (status) {
      case 'excellent':
      case 'good':
        return 'bg-green-500 hover:bg-green-600';
      case 'warning':
        return 'bg-amber-500 hover:bg-amber-600';
      case 'critical':
        return 'bg-red-500 hover:bg-red-600';
      default:
        return 'bg-gray-300 hover:bg-gray-400';
    }
  };

  const getCellEmoji = (status: string) => {
    switch (status) {
      case 'excellent':
      case 'good':
        return '🟢';
      case 'warning':
        return '🟡';
      case 'critical':
        return '🔴';
      default:
        return '⚪';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'excellent':
        return 'Excellent';
      case 'good':
        return 'On Target';
      case 'warning':
        return 'Warning';
      case 'critical':
        return 'Critical';
      default:
        return 'Unknown';
    }
  };

  const getCellData = (kpiName: string, month: string): HeatmapCell | undefined => {
    return data.find(d => d.kpiName === kpiName && d.month === month);
  };

  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">KPI Performance Heatmap</h3>
      <p className="text-sm text-gray-600 mb-6">Monthly performance tracking - Click any cell for details</p>

      {/* Heatmap Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="py-3 px-4 text-left font-semibold text-gray-700 border-b-2 border-gray-200">
                KPI
              </th>
              {months.map(month => (
                <th key={month} className="py-3 px-3 text-center font-semibold text-gray-700 border-b-2 border-gray-200">
                  {month}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kpiNames.map((kpiName, idx) => (
              <tr key={kpiName} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="py-3 px-4 font-medium text-gray-900 border-b border-gray-200">
                  {kpiName}
                </td>
                {months.map(month => {
                  const cellData = getCellData(kpiName, month);
                  if (!cellData) return <td key={month} className="py-3 px-3 border-b border-gray-200"></td>;
                  
                  return (
                    <td
                      key={month}
                      className="py-3 px-3 border-b border-gray-200"
                    >
                      <button
                        onClick={() => setSelectedCell(cellData)}
                        className={`w-10 h-10 rounded-lg transition-all duration-200 flex items-center justify-center text-xl ${getCellColor(cellData.status)} cursor-pointer transform hover:scale-110 shadow-sm`}
                        title={`${kpiName} - ${month}: ${getStatusLabel(cellData.status)}`}
                      >
                        {getCellEmoji(cellData.status)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xl">🟢</span>
            <span className="text-gray-700">On Target</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🟡</span>
            <span className="text-gray-700">Warning</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🔴</span>
            <span className="text-gray-700">Critical</span>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedCell && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setSelectedCell(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xl font-bold text-gray-900">{selectedCell.kpiName}</h4>
              <button
                onClick={() => setSelectedCell(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-gray-200">
                <span className="text-gray-600">Month:</span>
                <span className="font-semibold text-gray-900">{selectedCell.month}</span>
              </div>
              
              <div className="flex items-center justify-between py-2 border-b border-gray-200">
                <span className="text-gray-600">Actual Value:</span>
                <span className="font-semibold text-gray-900">
                  {selectedCell.kpiName.includes('Margin') 
                    ? `${selectedCell.value.toFixed(1)}%`
                    : selectedCell.kpiName.includes('Ratio')
                    ? `${selectedCell.value.toFixed(1)}x`
                    : selectedCell.kpiName.includes('DSO')
                    ? `${selectedCell.value.toFixed(0)} days`
                    : `₹${(selectedCell.value / 10000000).toFixed(2)}Cr`
                  }
                </span>
              </div>
              
              <div className="flex items-center justify-between py-2 border-b border-gray-200">
                <span className="text-gray-600">Target:</span>
                <span className="font-semibold text-gray-900">
                  {selectedCell.kpiName.includes('Margin') 
                    ? `${selectedCell.target.toFixed(1)}%`
                    : selectedCell.kpiName.includes('Ratio')
                    ? `${selectedCell.target.toFixed(1)}x`
                    : selectedCell.kpiName.includes('DSO')
                    ? `${selectedCell.target.toFixed(0)} days`
                    : `₹${(selectedCell.target / 10000000).toFixed(2)}Cr`
                  }
                </span>
              </div>
              
              <div className="flex items-center justify-between py-2 border-b border-gray-200">
                <span className="text-gray-600">Variance:</span>
                <span className={`font-semibold ${
                  selectedCell.value >= selectedCell.target ? 'text-green-600' : 'text-red-600'
                }`}>
                  {selectedCell.value > selectedCell.target ? '+' : ''}
                  {(selectedCell.value - selectedCell.target).toFixed(1)}
                  {selectedCell.kpiName.includes('Margin') ? 'pp' : ''}
                </span>
              </div>
              
              <div className="flex items-center justify-between py-2">
                <span className="text-gray-600">Status:</span>
                <span className={`px-3 py-1 rounded-full font-semibold ${
                  selectedCell.status === 'excellent' || selectedCell.status === 'good'
                    ? 'bg-green-100 text-green-700'
                    : selectedCell.status === 'warning'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {getStatusLabel(selectedCell.status)}
                </span>
              </div>
            </div>
            
            <button
              onClick={() => setSelectedCell(null)}
              className="mt-6 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default KPIHeatmap;
