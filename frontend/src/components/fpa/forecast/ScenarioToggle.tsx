import React from 'react';
import { Scenario } from '../../../types/forecast';

interface ScenarioToggleProps {
  scenario: Scenario;
  onScenarioChange: (scenario: Scenario) => void;
}

const ScenarioToggle: React.FC<ScenarioToggleProps> = ({ scenario, onScenarioChange }) => {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-gray-700">Scenario:</span>
        <span className="text-xs text-gray-500">(affects all forecasts)</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onScenarioChange('best')}
          className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
            scenario === 'best'
              ? 'border-green-500 bg-green-50'
              : 'border-gray-200 bg-white hover:border-green-300'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl">🟢</span>
            <div className="text-left">
              <div className={`font-semibold ${scenario === 'best' ? 'text-green-700' : 'text-gray-700'}`}>
                Best Case
              </div>
              <div className="text-xs text-gray-500">+15% revenue, -5% costs</div>
            </div>
          </div>
        </button>

        <button
          onClick={() => onScenarioChange('base')}
          className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
            scenario === 'base'
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 bg-white hover:border-blue-300'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl">🔵</span>
            <div className="text-left">
              <div className={`font-semibold ${scenario === 'base' ? 'text-blue-700' : 'text-gray-700'}`}>
                Base Case
              </div>
              <div className="text-xs text-gray-500">Expected scenario</div>
            </div>
          </div>
        </button>

        <button
          onClick={() => onScenarioChange('worst')}
          className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
            scenario === 'worst'
              ? 'border-red-500 bg-red-50'
              : 'border-gray-200 bg-white hover:border-red-300'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl">🔴</span>
            <div className="text-left">
              <div className={`font-semibold ${scenario === 'worst' ? 'text-red-700' : 'text-gray-700'}`}>
                Worst Case
              </div>
              <div className="text-xs text-gray-500">-15% revenue, +10% costs</div>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
};

export default ScenarioToggle;
