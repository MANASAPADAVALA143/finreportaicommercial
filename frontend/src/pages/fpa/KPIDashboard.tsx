import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Download, FileText, Activity, AlertTriangle } from 'lucide-react';
import KPICard from '../../components/fpa/kpi/KPICard';
import KPISpeedometer from '../../components/fpa/kpi/KPISpeedometer';
import MonthlyTrendChart from '../../components/fpa/kpi/MonthlyTrendChart';
import KPIHeatmap from '../../components/fpa/kpi/KPIHeatmap';
import AIInsights from '../../components/fpa/kpi/AIInsights';
import KPIAlerts from '../../components/fpa/kpi/KPIAlerts';
import {
  kpiAlerts,
  monthlyTrendData,
  heatmapData
} from '../../data/kpiMockData';
import { loadFPAActual, loadFPABudget, checkDataAvailability, getMissingDataMessage, calculateRealKPIs } from '../../utils/fpaDataLoader';

const KPIDashboard: React.FC = () => {
  const navigate = useNavigate();
  
  // Check data availability
  const dataCheck = checkDataAvailability(['fpa_actual', 'fpa_budget']);
  const [actualData, setActualData] = useState<any>(null);
  const [budgetData, setBudgetData] = useState<any>(null);
  const [realKPIs, setRealKPIs] = useState<any>(null);

  useEffect(() => {
    if (dataCheck.available) {
      const actual = loadFPAActual();
      const budget = loadFPABudget();
      setActualData(actual);
      setBudgetData(budget);
      
      // Calculate real KPIs from uploaded data
      if (actual && budget) {
        const calculated = calculateRealKPIs(actual, budget);
        setRealKPIs(calculated);
      }
    }
  }, [dataCheck.available]);
  
  const [period, setPeriod] = useState('Oct 2025');
  const [view, setView] = useState('Monthly');
  const [lastUpdated] = useState(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handleRefresh = () => {
    window.location.reload();
  };

  const handleExportPDF = () => {
    alert('📄 Exporting KPI Dashboard to PDF... (Coming soon)');
    setShowExportMenu(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 p-6">
      {/* Data Missing Warning Banner */}
      {!dataCheck.available && (
        <div className="bg-yellow-50 border-b-2 border-yellow-400 px-6 py-4 rounded-lg mb-6">
          <div className="max-w-[1800px] mx-auto flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-yellow-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-yellow-900">
                ⚠️ {getMissingDataMessage(dataCheck.missing)}
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                KPI Dashboard requires both Actual and Budget data.
              </p>
            </div>
            <button
              onClick={() => navigate('/fpa')}
              className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-medium"
            >
              Upload Data
            </button>
          </div>
        </div>
      )}
      
      {/* Header */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/fpa')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft size={24} className="text-gray-700" />
              </button>
              <div>
                <div className="flex items-center gap-3">
                  <Activity size={32} className="text-blue-600" />
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">CFO KPI Dashboard</h1>
                    <p className="text-gray-600 mt-1">Financial Performance at a Glance</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right mr-4">
                <div className="text-sm text-gray-600">Last updated</div>
                <div className="text-lg font-semibold text-gray-900">{lastUpdated}</div>
              </div>
              <button
                onClick={handleRefresh}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <RefreshCw size={18} />
                Refresh
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Download size={18} />
                  Export
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                    <button
                      onClick={handleExportPDF}
                      className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-gray-700 rounded-lg"
                    >
                      <FileText size={16} className="text-red-600" />
                      PDF Report
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Period:</span>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
              >
                <option>Oct 2025</option>
                <option>Sep 2025</option>
                <option>Aug 2025</option>
                <option>Q3 2025</option>
                <option>YTD 2025</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">View:</span>
              <select
                value={view}
                onChange={(e) => setView(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
              >
                <option>Monthly</option>
                <option>Quarterly</option>
                <option>YTD</option>
                <option>Annual</option>
              </select>
            </div>

            <div className="border-l border-gray-300 pl-6 ml-auto">
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span><span className="font-semibold text-gray-900">Company:</span> FinReport AI Commercial</span>
                <span><span className="font-semibold text-gray-900">Currency:</span> INR</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Revenue KPIs Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-blue-600 rounded-full"></div>
          Revenue Metrics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {realKPIs && realKPIs.revenueKPIs ? (
            realKPIs.revenueKPIs.map((kpi: any, idx: number) => (
              <KPICard key={kpi.id} kpi={kpi} delay={idx * 0.1} />
            ))
          ) : (
            <div className="col-span-4 text-center py-8 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-500">Upload data to see revenue KPIs</p>
            </div>
          )}
        </div>
      </div>

      {/* Profitability KPIs Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-green-600 rounded-full"></div>
          Profitability Metrics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {realKPIs && realKPIs.profitabilityKPIs ? (
            realKPIs.profitabilityKPIs.map((kpi: any, idx: number) => (
              <KPICard key={kpi.id} kpi={kpi} delay={idx * 0.1} />
            ))
          ) : (
            <div className="col-span-4 text-center py-8 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-500">Upload data to see profitability KPIs</p>
            </div>
          )}
        </div>
      </div>

      {/* Liquidity KPIs Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-purple-600 rounded-full"></div>
          Liquidity & Cash Metrics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {realKPIs && realKPIs.liquidityKPIs ? (
            realKPIs.liquidityKPIs.map((kpi: any, idx: number) => (
              <KPICard key={kpi.id} kpi={kpi} delay={idx * 0.1} />
            ))
          ) : (
            <div className="col-span-4 text-center py-8 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-500">Upload data to see liquidity KPIs</p>
            </div>
          )}
        </div>
      </div>

      {/* Efficiency KPIs Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-amber-600 rounded-full"></div>
          Working Capital Efficiency
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {realKPIs && realKPIs.efficiencyKPIs ? (
            realKPIs.efficiencyKPIs.map((kpi: any, idx: number) => (
              <KPICard key={kpi.id} kpi={kpi} delay={idx * 0.1} />
            ))
          ) : (
            <div className="col-span-4 text-center py-8 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-500">Upload data to see efficiency KPIs</p>
            </div>
          )}
        </div>
      </div>

      {/* Speedometer Gauges Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-indigo-600 rounded-full"></div>
          Margin Performance Gauges
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <KPISpeedometer
            title="Gross Margin"
            value={43.9}
            target={51.4}
            unit="%"
          />
          <KPISpeedometer
            title="EBITDA Margin"
            value={26.2}
            target={25.7}
            unit="%"
          />
          <KPISpeedometer
            title="Net Profit Margin"
            value={15.5}
            target={23.1}
            unit="%"
          />
        </div>
      </div>

      {/* Trend Charts Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-cyan-600 rounded-full"></div>
          12-Month Performance Trends
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MonthlyTrendChart data={monthlyTrendData} type="revenue" />
          <MonthlyTrendChart data={monthlyTrendData} type="margins" />
        </div>
      </div>

      {/* Heatmap Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <KPIHeatmap data={heatmapData} />
      </div>

      {/* AI Insights & Alerts Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AIInsights kpis={realKPIs?.allKPIs || []} />
          <KPIAlerts alerts={kpiAlerts} />
        </div>
      </div>

      {/* Summary Footer */}
      <div className="max-w-[1800px] mx-auto">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl shadow-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold mb-2">Dashboard Summary</h3>
              <p className="text-blue-100 text-sm">
                Monitoring {realKPIs?.allKPIs?.length || 0} key performance indicators • 
                {kpiAlerts.filter(a => a.severity === 'critical').length} critical alerts • 
                {kpiAlerts.filter(a => a.severity === 'warning').length} warnings
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-2xl font-bold">{(realKPIs?.allKPIs || []).filter(k => k.status === 'excellent' || k.status === 'good').length}</div>
                <div className="text-sm text-blue-100">On Target</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{(realKPIs?.allKPIs || []).filter(k => k.status === 'warning').length}</div>
                <div className="text-sm text-blue-100">Warning</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{(realKPIs?.allKPIs || []).filter(k => k.status === 'critical').length}</div>
                <div className="text-sm text-blue-100">Critical</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default KPIDashboard;
