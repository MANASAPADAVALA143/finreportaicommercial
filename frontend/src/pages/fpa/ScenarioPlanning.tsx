import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  Sparkles,
  GitBranch,
  Plus,
  Copy,
  AlertTriangle,
  Upload,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Play,
  Save,
  Users,
  DollarSign,
  Clock
} from 'lucide-react';
import { loadFPAActual, checkDataAvailability, getMissingDataMessage } from '../../utils/fpaDataLoader';
import { Scenario } from '../../types/scenario';
import { scenarios as initialScenarios, sensitivityData } from '../../data/scenarioMockData';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  ComposedChart
} from 'recharts';
import { callAI } from '../../services/aiProvider';
import toast from 'react-hot-toast';
import {
  parseTrialBalance,
  calculateScenarioResults,
  calculateWorkingCapital,
  calculateDriverBasedRevenue,
  saveFPAData,
  loadFPAData,
  UploadedFinancialData,
  RevenueDrivers
} from '../../services/fpaDataService';

const ScenarioPlanning: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Check data availability
  const dataCheck = checkDataAvailability(['fpa_actual']);
  const [actualData, setActualData] = useState<any>(null);

  useEffect(() => {
    if (dataCheck.available) {
      setActualData(loadFPAActual());
    }
  }, [dataCheck.available]);
  
  const [scenarios, setScenarios] = useState<Scenario[]>(initialScenarios);
  const [activeScenarioId, setActiveScenarioId] = useState('base');
  const [chartMetric, setChartMetric] = useState<'revenue' | 'netProfit' | 'ebitda' | 'cash'>('revenue');
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedData, setUploadedData] = useState<UploadedFinancialData | null>(null);
  const [driverModelEnabled, setDriverModelEnabled] = useState(false);
  const [showWorkingCapital, setShowWorkingCapital] = useState(false);

  // Load data from localStorage on mount
  useEffect(() => {
    const storedData = loadFPAData();
    if (storedData) {
      setUploadedData(storedData);
      toast.success(`📊 Loaded data from ${storedData.fileName}`);
    }
  }, []);

  // Driver-Based Revenue state
  const [revenueDrivers, setRevenueDrivers] = useState<RevenueDrivers>({
    totalCustomers: 12000,
    customerGrowthPct: 15,
    newCustomerAcquisition: 1800,
    churnRatePct: 5,
    averageSellingPrice: 2917,
    priceChangePct: 0,
    productMixPremiumPct: 20,
    purchasesPerCustomer: 3.0,
    conversionRatePct: 3
  });

  // Working Capital drivers
  const [wcDrivers, setWcDrivers] = useState({
    dso: 46,
    dpo: 38,
    dio: 58
  });

  // Slider values (starting from base case)
  const [sliders, setSliders] = useState<Record<string, number>>({
    revenueGrowth: 27,
    domesticMix: 76,
    exportGrowth: 25,
    newCustomerRev: 2,
    cogsPercent: 56,
    payrollGrowth: 12,
    opexGrowth: 15,
    adminPercent: 4.4,
    marketGrowth: 10,
    priceChange: 0,
    churnPercent: 5
  });

  const formatCurrency = (value: number): string => {
    const crore = value / 10000000;
    const lakh = value / 100000;
    if (Math.abs(crore) >= 1) return `₹${crore.toFixed(2)}Cr`;
    return `₹${lakh.toFixed(2)}L`;
  };

  const activeScenario = scenarios.find(s => s.id === activeScenarioId) || scenarios[1];

  const handleSliderChange = (key: string, value: number) => {
    setSliders(prev => ({ ...prev, [key]: value }));
    // In a real app, this would trigger recalculation of all scenarios
  };

  const resetSlider = (key: string, baseValue: number) => {
    setSliders(prev => ({ ...prev, [key]: baseValue }));
  };

  const resetAllSliders = () => {
    setSliders({
      revenueGrowth: 27,
      domesticMix: 76,
      exportGrowth: 25,
      newCustomerRev: 2,
      cogsPercent: 56,
      payrollGrowth: 12,
      opexGrowth: 15,
      adminPercent: 4.4,
      marketGrowth: 10,
      priceChange: 0,
      churnPercent: 5
    });
  };

  const generateAIAnalysis = async () => {
    setAiGenerating(true);
    try {
      const best = scenarios.find(s => s.type === 'best')!;
      const base = scenarios.find(s => s.type === 'base')!;
      const worst = scenarios.find(s => s.type === 'worst')!;

      const prompt = `You are a CFO strategic advisor. Analyze these 3 scenarios and provide strategic recommendations.

BEST CASE (Revenue +15%, Costs -5%):
- Revenue: ${formatCurrency(best.results.revenue)}, Net Profit: ${formatCurrency(best.results.netProfit)} (${best.results.netMargin.toFixed(1)}% margin)
- Runway: ${best.results.runway} months

BASE CASE (Expected):
- Revenue: ${formatCurrency(base.results.revenue)}, Net Profit: ${formatCurrency(base.results.netProfit)} (${base.results.netMargin.toFixed(1)}% margin)
- Runway: ${base.results.runway} months

WORST CASE (Revenue -15%, Costs +10%):
- Revenue: ${formatCurrency(worst.results.revenue)}, Net Profit: ${formatCurrency(worst.results.netProfit)} (${worst.results.netMargin.toFixed(1)}% margin)
- Runway: ${worst.results.runway} months ← CRITICAL

KEY SENSITIVITIES:
- Revenue growth and COGS % are HIGH sensitivity variables
- Worst case runway of ${worst.results.runway} months requires immediate action plan

Provide:
1. RECOMMENDED STRATEGY (which scenario to plan for and why)
2. EARLY WARNING SIGNALS (what metrics to watch monthly)
3. CONTINGENCY PLAN (if worst case materializes, what to do)
4. UPSIDE OPPORTUNITIES (how to achieve best case)
5. BOARD RECOMMENDATION (1 paragraph for board presentation)

CFO language, specific and actionable, max 250 words.`;

      const response = await callAI(prompt);
      setAiAnalysis(response);
    } catch (error: any) {
      alert('❌ Failed to generate analysis: ' + error.message);
    } finally {
      setAiGenerating(false);
    }
  };

  const copyForBoardPack = () => {
    if (aiAnalysis) {
      navigator.clipboard.writeText(aiAnalysis);
      alert('✅ Copied to clipboard for board pack!');
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const loadingToast = toast.loading('📊 Parsing your financial data...');

    try {
      // Use shared service to parse file
      const parsedData = await parseTrialBalance(file);
      
      // Save to localStorage for all FP&A modules
      saveFPAData(parsedData);
      setUploadedData(parsedData);
      
      // Calculate baseline metrics
      const baseResults = calculateScenarioResults(parsedData, {
        revenue: 1,
        cogsAdjust: 1,
        payrollGrowth: 1,
        opexGrowth: 1
      });
      
      // Update scenarios with CORRECT calculation
      const updatedScenarios = scenarios.map(scenario => {
        let revenueMultiplier = 1;
        let cogsAdjust = 1;
        let payrollGrowth = 1;
        let opexGrowth = 1;
        
        if (scenario.type === 'best') {
          revenueMultiplier = 1.15;  // +15% revenue
          cogsAdjust = 0.95;         // -5% COGS efficiency
          payrollGrowth = 1.05;      // +5% payroll
          opexGrowth = 0.95;         // -5% opex
        } else if (scenario.type === 'worst') {
          revenueMultiplier = 0.85;  // -15% revenue
          cogsAdjust = 1.05;         // +5% COGS increase
          payrollGrowth = 1.12;      // +12% payroll
          opexGrowth = 1.10;         // +10% opex
        } else if (scenario.type === 'custom') {
          revenueMultiplier = 1.05;  // +5% revenue
          cogsAdjust = 1.0;          // no change
          payrollGrowth = 1.08;      // +8% payroll
          opexGrowth = 1.03;         // +3% opex
        }
        
        const results = calculateScenarioResults(parsedData, {
          revenue: revenueMultiplier,
          cogsAdjust,
          payrollGrowth,
          opexGrowth
        });

        return {
          ...scenario,
          results: {
            revenue: Math.round(results.revenue),
            grossProfit: Math.round(results.grossProfit),
            grossMargin: parseFloat(results.grossMargin.toFixed(1)),
            ebitda: Math.round(results.ebitda),
            ebitdaMargin: parseFloat(results.ebitdaMargin.toFixed(1)),
            netProfit: Math.round(results.netProfit),
            netMargin: parseFloat(results.netMargin.toFixed(1)),
            cashPosition: Math.round(results.cashPosition),
            breakEvenMonth: results.breakEvenMonth,
            runway: results.runway
          }
        };
      });

      setScenarios(updatedScenarios);
      
      toast.success(
        `✅ Data uploaded — scenarios updated!\nRevenue: ${formatCurrency(parsedData.totalRevenue)}, Net Profit: ${formatCurrency(baseResults.netProfit)}`,
        { id: loadingToast, duration: 5000 }
      );

    } catch (error: any) {
      toast.error(`❌ ${error.message}`, { id: loadingToast });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleExport = () => {
    const XLSX = require('xlsx');
    try {
      const workbook = XLSX.utils.book_new();
      
      // Scenario comparison sheet
      const comparisonData = scenarios.map(s => ({
        Scenario: s.name,
        Revenue: formatCurrency(s.results.revenue),
        'Gross Profit': formatCurrency(s.results.grossProfit),
        'Gross Margin %': s.results.grossMargin.toFixed(1) + '%',
        EBITDA: formatCurrency(s.results.ebitda),
        'EBITDA Margin %': s.results.ebitdaMargin.toFixed(1) + '%',
        'Net Profit': formatCurrency(s.results.netProfit),
        'Net Margin %': s.results.netMargin.toFixed(1) + '%',
        'Cash Position': formatCurrency(s.results.cashPosition),
        'Runway (months)': s.results.runway,
        'Break-Even Month': s.results.breakEvenMonth
      }));
      const ws1 = XLSX.utils.json_to_sheet(comparisonData);
      XLSX.utils.book_append_sheet(workbook, ws1, 'Scenario Comparison');

      // Sensitivity analysis sheet
      const sensitivitySheet = XLSX.utils.json_to_sheet(sensitivityData.map(item => ({
        Variable: item.variable,
        'Base Value': item.baseValue,
        '-20%': formatCurrency(item.minus20),
        '-10%': formatCurrency(item.minus10),
        'Base': formatCurrency(item.base),
        '+10%': formatCurrency(item.plus10),
        '+20%': formatCurrency(item.plus20),
        'Impact': formatCurrency(item.impactOnNetProfit),
        'Sensitivity': item.sensitivity.toUpperCase()
      })));
      XLSX.utils.book_append_sheet(workbook, sensitivitySheet, 'Sensitivity Analysis');

      XLSX.writeFile(workbook, `Scenario_Analysis_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('✅ Scenario analysis exported to Excel!');
    } catch (error: any) {
      toast.error('❌ Failed to export: ' + error.message);
    }
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BUG FIX 2 & 3: Chart data for ALL metrics (revenue, netProfit, ebitda, cash)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  const chartData = useMemo(() => {
    const best = scenarios.find(s => s.type === 'best');
    const base = scenarios.find(s => s.type === 'base');
    const worst = scenarios.find(s => s.type === 'worst');
    const custom = scenarios.find(s => s.type === 'custom');
    
    if (!best || !base || !worst || !custom) return [];
    
    const openingCash = actualData?.cashAndEquivalents || 0;
    
    // If no real data, return empty
    if (!actualData) return [];
    
    // Generate 12 months of data
    return Array.from({ length: 12 }, (_, i) => {
      const month = ['Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 
                     'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26', 'Nov 26', 'Dec 26'][i];
      
      // Progressive growth throughout year (monthly compounding)
      const growthFactor = (i + 1) / 12;
      
      return {
        month,
        // Revenue data (in Crores for chart)
        'Best Case': (best.results.revenue * growthFactor) / 10000000,
        'Base Case': (base.results.revenue * growthFactor) / 10000000,
        'Worst Case': (worst.results.revenue * growthFactor) / 10000000,
        'Custom': (custom.results.revenue * growthFactor) / 10000000,
        
        // Net Profit data
        'Best Case NP': (best.results.netProfit * growthFactor) / 10000000,
        'Base Case NP': (base.results.netProfit * growthFactor) / 10000000,
        'Worst Case NP': (worst.results.netProfit * growthFactor) / 10000000,
        'Custom NP': (custom.results.netProfit * growthFactor) / 10000000,
        
        // EBITDA data
        'Best Case EBITDA': (best.results.ebitda * growthFactor) / 10000000,
        'Base Case EBITDA': (base.results.ebitda * growthFactor) / 10000000,
        'Worst Case EBITDA': (worst.results.ebitda * growthFactor) / 10000000,
        'Custom EBITDA': (custom.results.ebitda * growthFactor) / 10000000,
        
        // Cash Position data
        'Best Case Cash': (openingCash + (best.results.netProfit * growthFactor * 0.8)) / 10000000,
        'Base Case Cash': (openingCash + (base.results.netProfit * growthFactor * 0.8)) / 10000000,
        'Worst Case Cash': (openingCash + (worst.results.netProfit * growthFactor * 0.8)) / 10000000,
        'Custom Cash': (openingCash + (custom.results.netProfit * growthFactor * 0.8)) / 10000000,
      };
    });
  }, [scenarios, uploadedData]);

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
                Scenario Planning requires Actual TB to model what-if scenarios.
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/fpa')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft size={24} className="text-gray-700" />
              </button>
              <div>
                <div className="flex items-center gap-3">
                  <GitBranch size={32} className="text-blue-600" />
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">🎯 Scenario Planning</h1>
                    <p className="text-gray-600 mt-1">Model financial outcomes across multiple scenarios</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={handleUploadClick}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                <Upload size={18} />
                {uploading ? 'Uploading...' : 'Upload Data'}
              </button>
              <button
                onClick={() => setShowNewScenarioModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <Plus size={18} />
                New Scenario
              </button>
              <button
                onClick={generateAIAnalysis}
                disabled={aiGenerating}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-colors disabled:opacity-50"
              >
                <Sparkles size={18} />
                {aiGenerating ? 'Analyzing...' : 'AI Analysis'}
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Download size={18} />
                Export
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Scenario Cards */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {scenarios.map(scenario => (
            <div
              key={scenario.id}
              onClick={() => setActiveScenarioId(scenario.id)}
              className={`bg-white rounded-xl shadow-sm p-6 cursor-pointer transition-all ${
                scenario.id === activeScenarioId
                  ? 'ring-4 ring-offset-2'
                  : 'hover:shadow-md'
              }`}
              style={{
                borderTop: `4px solid ${scenario.color}`
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">
                    {scenario.type === 'best' ? '🟢' : scenario.type === 'base' ? '🔵' : scenario.type === 'worst' ? '🔴' : '⚙️'}
                  </span>
                  <h3 className="font-bold text-gray-900">{scenario.name.toUpperCase()}</h3>
                </div>
                {scenario.isActive && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-semibold">
                    ACTIVE
                  </span>
                )}
              </div>
              
              <p className="text-xs text-gray-600 mb-4">{scenario.description}</p>

              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-500">Revenue</div>
                  <div className="text-2xl font-bold text-gray-900">{formatCurrency(scenario.results.revenue)}</div>
                </div>

                <div>
                  <div className="text-xs text-gray-500">Net Profit</div>
                  <div className="text-xl font-bold" style={{ color: scenario.color }}>
                    {formatCurrency(scenario.results.netProfit)}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-gray-500">Net Margin</div>
                  <div className="text-lg font-semibold text-gray-700">{scenario.results.netMargin.toFixed(1)}%</div>
                </div>

                <div>
                  <div className="text-xs text-gray-500">Runway</div>
                  <div className={`text-lg font-semibold ${
                    scenario.results.runway < 8 ? 'text-red-600' : scenario.results.runway < 12 ? 'text-amber-600' : 'text-green-600'
                  }`}>
                    {scenario.results.runway} months {scenario.results.runway < 8 && '🔴'}
                  </div>
                </div>
              </div>

              <button className="w-full mt-4 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors">
                {scenario.type === 'custom' ? 'Edit' : 'View Details'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* What-If Sliders */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">What-If Analysis</h2>
            <button
              onClick={resetAllSliders}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Reset All to Base
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue Assumptions */}
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-4 uppercase">Revenue Assumptions</h3>
              <div className="space-y-4">
                {[
                  { key: 'revenueGrowth', label: 'Revenue Growth %', min: -20, max: 30, base: 27, unit: '%' },
                  { key: 'domesticMix', label: 'Domestic Sales Mix', min: 50, max: 90, base: 76, unit: '%' },
                  { key: 'exportGrowth', label: 'Export Sales Growth', min: -30, max: 50, base: 25, unit: '%' },
                  { key: 'newCustomerRev', label: 'New Customer Revenue', min: 0, max: 5, base: 2, unit: 'Cr' }
                ].map(slider => (
                  <div key={slider.key} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{slider.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">Base: {slider.base}{slider.unit}</span>
                        <span className="text-sm font-bold text-blue-600">
                          Current: {sliders[slider.key as keyof typeof sliders]}{slider.unit}
                        </span>
                        <button
                          onClick={() => resetSlider(slider.key, slider.base)}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={slider.min}
                      max={slider.max}
                      step={0.1}
                      value={sliders[slider.key as keyof typeof sliders]}
                      onChange={(e) => handleSliderChange(slider.key, parseFloat(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{slider.min}{slider.unit}</span>
                      <span>{slider.max}{slider.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cost & Market Assumptions */}
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-4 uppercase">Cost & Market Assumptions</h3>
              <div className="space-y-4">
                {[
                  { key: 'cogsPercent', label: 'COGS %', min: 30, max: 70, base: 56, unit: '%' },
                  { key: 'payrollGrowth', label: 'Payroll Growth %', min: 0, max: 20, base: 12, unit: '%' },
                  { key: 'opexGrowth', label: 'Opex Growth %', min: -10, max: 25, base: 15, unit: '%' },
                  { key: 'marketGrowth', label: 'Market Growth Rate', min: 0, max: 20, base: 10, unit: '%' },
                  { key: 'priceChange', label: 'Price Change %', min: -15, max: 15, base: 0, unit: '%' },
                  { key: 'churnPercent', label: 'Customer Churn %', min: 0, max: 20, base: 5, unit: '%' }
                ].map(slider => (
                  <div key={slider.key} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{slider.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">Base: {slider.base}{slider.unit}</span>
                        <span className="text-sm font-bold text-blue-600">
                          Current: {sliders[slider.key as keyof typeof sliders]}{slider.unit}
                        </span>
                        <button
                          onClick={() => resetSlider(slider.key, slider.base)}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={slider.min}
                      max={slider.max}
                      step={0.1}
                      value={sliders[slider.key as keyof typeof sliders]}
                      onChange={(e) => handleSliderChange(slider.key, parseFloat(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{slider.min}{slider.unit}</span>
                      <span>{slider.max}{slider.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* DRIVER-BASED REVENUE MODEL */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Users className="text-purple-600" size={24} />
              <div>
                <h2 className="text-xl font-bold text-gray-900">🎯 Driver-Based Revenue Model</h2>
                <p className="text-sm text-gray-600">Build revenue from business drivers (like Anaplan)</p>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-700">Driver Model:</span>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={driverModelEnabled}
                  onChange={(e) => setDriverModelEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
              </div>
              <span className={`text-sm font-semibold ${driverModelEnabled ? 'text-purple-600' : 'text-gray-400'}`}>
                {driverModelEnabled ? 'ON' : 'OFF'}
              </span>
            </label>
          </div>

          {driverModelEnabled && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Customer Drivers */}
              <div className="bg-blue-50 rounded-lg p-4">
                <h3 className="text-sm font-bold text-blue-900 mb-4 flex items-center gap-2">
                  <Users size={16} />
                  CUSTOMER DRIVERS
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-700 block mb-1">Total Customers</label>
                    <input
                      type="number"
                      value={revenueDrivers.totalCustomers}
                      onChange={(e) => setRevenueDrivers({...revenueDrivers, totalCustomers: parseInt(e.target.value) || 0})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-700 block mb-1">Customer Growth %</label>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      value={revenueDrivers.customerGrowthPct}
                      onChange={(e) => setRevenueDrivers({...revenueDrivers, customerGrowthPct: parseFloat(e.target.value)})}
                      className="w-full"
                    />
                    <div className="text-xs text-gray-600 text-right">{revenueDrivers.customerGrowthPct}%</div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-700 block mb-1">Churn Rate %</label>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      value={revenueDrivers.churnRatePct}
                      onChange={(e) => setRevenueDrivers({...revenueDrivers, churnRatePct: parseFloat(e.target.value)})}
                      className="w-full"
                    />
                    <div className="text-xs text-gray-600 text-right">{revenueDrivers.churnRatePct}%</div>
                  </div>
                </div>
              </div>

              {/* Pricing Drivers */}
              <div className="bg-green-50 rounded-lg p-4">
                <h3 className="text-sm font-bold text-green-900 mb-4 flex items-center gap-2">
                  <DollarSign size={16} />
                  PRICING DRIVERS
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-700 block mb-1">Avg Selling Price (₹)</label>
                    <input
                      type="number"
                      value={revenueDrivers.averageSellingPrice}
                      onChange={(e) => setRevenueDrivers({...revenueDrivers, averageSellingPrice: parseFloat(e.target.value) || 0})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-700 block mb-1">Price Change %</label>
                    <input
                      type="range"
                      min="-15"
                      max="15"
                      value={revenueDrivers.priceChangePct}
                      onChange={(e) => setRevenueDrivers({...revenueDrivers, priceChangePct: parseFloat(e.target.value)})}
                      className="w-full"
                    />
                    <div className="text-xs text-gray-600 text-right">{revenueDrivers.priceChangePct > 0 ? '+' : ''}{revenueDrivers.priceChangePct}%</div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-700 block mb-1">Product Mix Premium %</label>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      value={revenueDrivers.productMixPremiumPct}
                      onChange={(e) => setRevenueDrivers({...revenueDrivers, productMixPremiumPct: parseFloat(e.target.value)})}
                      className="w-full"
                    />
                    <div className="text-xs text-gray-600 text-right">{revenueDrivers.productMixPremiumPct}%</div>
                  </div>
                </div>
              </div>

              {/* Volume Drivers & Calculated Revenue */}
              <div className="bg-purple-50 rounded-lg p-4">
                <h3 className="text-sm font-bold text-purple-900 mb-4 flex items-center gap-2">
                  <TrendingUp size={16} />
                  VOLUME & OUTPUT
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-700 block mb-1">Purchases per Customer</label>
                    <input
                      type="number"
                      step="0.1"
                      value={revenueDrivers.purchasesPerCustomer}
                      onChange={(e) => setRevenueDrivers({...revenueDrivers, purchasesPerCustomer: parseFloat(e.target.value) || 0})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  
                  {/* Calculated Revenue */}
                  {(() => {
                    const result = calculateDriverBasedRevenue(revenueDrivers);
                    const simpleGrowthRevenue = uploadedData ? uploadedData.totalRevenue * 1.27 : 0;
                    const difference = result.calculatedRevenue - simpleGrowthRevenue;
                    
                    return (
                      <div className="mt-4 pt-4 border-t border-purple-200">
                        <div className="text-xs text-gray-600 mb-2">CALCULATED REVENUE:</div>
                        <div className="text-2xl font-bold text-purple-900 mb-1">
                          {formatCurrency(result.calculatedRevenue)}
                        </div>
                        <div className="text-xs text-gray-600 space-y-1">
                          <div>= {result.endingCustomers.toLocaleString()} customers</div>
                          <div>× ₹{result.effectivePrice.toFixed(0)} avg price</div>
                          <div>× {revenueDrivers.purchasesPerCustomer} purchases</div>
                          <div className="pt-2 mt-2 border-t border-purple-200">
                            <strong>vs Simple Growth:</strong> {formatCurrency(simpleGrowthRevenue)}
                          </div>
                          <div className={difference >= 0 ? 'text-green-600' : 'text-red-600'}>
                            <strong>Difference:</strong> {difference >= 0 ? '+' : ''}{formatCurrency(Math.abs(difference))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {!driverModelEnabled && (
            <div className="text-center py-8 text-gray-500">
              <Users className="mx-auto mb-2 text-gray-400" size={48} />
              <p className="text-sm">Turn on Driver Model to build revenue from customer, pricing, and volume drivers</p>
            </div>
          )}
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* WORKING CAPITAL & CASH FLOW MODEL */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {uploadedData && (
        <div className="max-w-[1800px] mx-auto mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <Clock className="text-orange-600" size={24} />
                <div>
                  <h2 className="text-xl font-bold text-gray-900">💰 Working Capital & Cash Flow Impact</h2>
                  <p className="text-sm text-gray-600">DSO, DPO, DIO affect actual cash runway</p>
                </div>
              </div>
              <button
                onClick={() => setShowWorkingCapital(!showWorkingCapital)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                {showWorkingCapital ? 'Hide' : 'Show'} Details
              </button>
            </div>

            {showWorkingCapital && (
              <>
                {/* WC Drivers */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div>
                    <label className="text-xs text-gray-700 block mb-2">DSO (Days Sales Outstanding)</label>
                    <input
                      type="range"
                      min="20"
                      max="80"
                      value={wcDrivers.dso}
                      onChange={(e) => setWcDrivers({...wcDrivers, dso: parseInt(e.target.value)})}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-600 mt-1">
                      <span>20 days</span>
                      <span className="font-bold text-blue-600">{wcDrivers.dso} days</span>
                      <span>80 days</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-700 block mb-2">DPO (Days Payable Outstanding)</label>
                    <input
                      type="range"
                      min="20"
                      max="80"
                      value={wcDrivers.dpo}
                      onChange={(e) => setWcDrivers({...wcDrivers, dpo: parseInt(e.target.value)})}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-600 mt-1">
                      <span>20 days</span>
                      <span className="font-bold text-green-600">{wcDrivers.dpo} days</span>
                      <span>80 days</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-700 block mb-2">DIO (Days Inventory Outstanding)</label>
                    <input
                      type="range"
                      min="20"
                      max="120"
                      value={wcDrivers.dio}
                      onChange={(e) => setWcDrivers({...wcDrivers, dio: parseInt(e.target.value)})}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-600 mt-1">
                      <span>20 days</span>
                      <span className="font-bold text-amber-600">{wcDrivers.dio} days</span>
                      <span>120 days</span>
                    </div>
                  </div>
                </div>

                {/* WC Comparison Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="py-3 px-4 text-left font-semibold text-gray-700">Working Capital Metric</th>
                        <th className="py-3 px-4 text-right font-semibold text-green-700">Best Case</th>
                        <th className="py-3 px-4 text-right font-semibold text-blue-700">Base Case</th>
                        <th className="py-3 px-4 text-right font-semibold text-red-700">Worst Case</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const best = scenarios.find(s => s.type === 'best')!;
                        const base = scenarios.find(s => s.type === 'base')!;
                        const worst = scenarios.find(s => s.type === 'worst')!;
                        
                        const bestWC = calculateWorkingCapital(uploadedData, {
                          revenue: best.results.revenue,
                          cogs: best.results.revenue * 0.53,
                          netProfit: best.results.netProfit
                        });
                        const baseWC = calculateWorkingCapital(uploadedData, {
                          revenue: base.results.revenue,
                          cogs: base.results.revenue * 0.56,
                          netProfit: base.results.netProfit
                        });
                        const worstWC = calculateWorkingCapital(uploadedData, {
                          revenue: worst.results.revenue,
                          cogs: worst.results.revenue * 0.59,
                          netProfit: worst.results.netProfit
                        });
                        
                        const cccBest = wcDrivers.dso * 0.8 + wcDrivers.dio * 0.85 - wcDrivers.dpo * 1.1;
                        const cccBase = wcDrivers.dso + wcDrivers.dio - wcDrivers.dpo;
                        const cccWorst = wcDrivers.dso * 1.2 + wcDrivers.dio * 1.15 - wcDrivers.dpo * 0.9;
                        
                        return (
                          <>
                            <tr className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-3 px-4 font-medium text-gray-900">DSO (days)</td>
                              <td className="py-3 px-4 text-right text-green-700">{Math.round(wcDrivers.dso * 0.8)}</td>
                              <td className="py-3 px-4 text-right text-blue-700">{wcDrivers.dso}</td>
                              <td className="py-3 px-4 text-right text-red-700">{Math.round(wcDrivers.dso * 1.2)}</td>
                            </tr>
                            <tr className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-3 px-4 font-medium text-gray-900">DPO (days)</td>
                              <td className="py-3 px-4 text-right text-green-700">{Math.round(wcDrivers.dpo * 1.1)}</td>
                              <td className="py-3 px-4 text-right text-blue-700">{wcDrivers.dpo}</td>
                              <td className="py-3 px-4 text-right text-red-700">{Math.round(wcDrivers.dpo * 0.9)}</td>
                            </tr>
                            <tr className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-3 px-4 font-medium text-gray-900">DIO (days)</td>
                              <td className="py-3 px-4 text-right text-green-700">{Math.round(wcDrivers.dio * 0.85)}</td>
                              <td className="py-3 px-4 text-right text-blue-700">{wcDrivers.dio}</td>
                              <td className="py-3 px-4 text-right text-red-700">{Math.round(wcDrivers.dio * 1.15)}</td>
                            </tr>
                            <tr className="border-b border-gray-200 hover:bg-gray-50 bg-amber-50">
                              <td className="py-3 px-4 font-bold text-gray-900">CCC (Cash Conversion Cycle)</td>
                              <td className={`py-3 px-4 text-right font-bold ${cccBest < 60 ? 'text-green-700' : 'text-amber-700'}`}>
                                {Math.round(cccBest)} days
                              </td>
                              <td className={`py-3 px-4 text-right font-bold ${cccBase < 60 ? 'text-green-700' : 'text-amber-700'}`}>
                                {Math.round(cccBase)} days
                              </td>
                              <td className={`py-3 px-4 text-right font-bold ${cccWorst > 90 ? 'text-red-700' : 'text-amber-700'}`}>
                                {Math.round(cccWorst)} days {cccWorst > 90 && '🔴'}
                              </td>
                            </tr>
                            <tr className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-3 px-4 font-medium text-gray-900">Accounts Receivable</td>
                              <td className="py-3 px-4 text-right text-gray-700">{formatCurrency(bestWC.accountsReceivable)}</td>
                              <td className="py-3 px-4 text-right text-gray-700">{formatCurrency(baseWC.accountsReceivable)}</td>
                              <td className="py-3 px-4 text-right text-gray-700">{formatCurrency(worstWC.accountsReceivable)}</td>
                            </tr>
                            <tr className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-3 px-4 font-medium text-gray-900">Inventory</td>
                              <td className="py-3 px-4 text-right text-gray-700">{formatCurrency(bestWC.inventory)}</td>
                              <td className="py-3 px-4 text-right text-gray-700">{formatCurrency(baseWC.inventory)}</td>
                              <td className="py-3 px-4 text-right text-gray-700">{formatCurrency(worstWC.inventory)}</td>
                            </tr>
                            <tr className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-3 px-4 font-medium text-gray-900">Accounts Payable</td>
                              <td className="py-3 px-4 text-right text-gray-700">({formatCurrency(bestWC.accountsPayable)})</td>
                              <td className="py-3 px-4 text-right text-gray-700">({formatCurrency(baseWC.accountsPayable)})</td>
                              <td className="py-3 px-4 text-right text-gray-700">({formatCurrency(worstWC.accountsPayable)})</td>
                            </tr>
                            <tr className="border-b border-gray-200 hover:bg-gray-50 bg-blue-50">
                              <td className="py-3 px-4 font-bold text-gray-900">Working Capital Required</td>
                              <td className="py-3 px-4 text-right font-bold text-green-700">{formatCurrency(bestWC.workingCapital)}</td>
                              <td className="py-3 px-4 text-right font-bold text-blue-700">{formatCurrency(baseWC.workingCapital)}</td>
                              <td className="py-3 px-4 text-right font-bold text-red-700">{formatCurrency(worstWC.workingCapital)}</td>
                            </tr>
                            <tr className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-3 px-4 font-medium text-gray-900">Operating Cash Flow</td>
                              <td className="py-3 px-4 text-right font-semibold text-green-700">{formatCurrency(bestWC.operatingCashFlow)}</td>
                              <td className="py-3 px-4 text-right font-semibold text-blue-700">{formatCurrency(baseWC.operatingCashFlow)}</td>
                              <td className="py-3 px-4 text-right font-semibold text-red-700">{formatCurrency(worstWC.operatingCashFlow)}</td>
                            </tr>
                            <tr className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-3 px-4 font-medium text-gray-900">Free Cash Flow</td>
                              <td className="py-3 px-4 text-right font-semibold text-green-700">{formatCurrency(bestWC.freeCashFlow)}</td>
                              <td className="py-3 px-4 text-right font-semibold text-blue-700">{formatCurrency(baseWC.freeCashFlow)}</td>
                              <td className="py-3 px-4 text-right font-semibold text-red-700">{formatCurrency(worstWC.freeCashFlow)}</td>
                            </tr>
                            <tr className="border-t-2 border-gray-300 bg-purple-50">
                              <td className="py-3 px-4 font-bold text-gray-900">ACTUAL Runway (months)</td>
                              <td className="py-3 px-4 text-right font-bold text-green-700 text-lg">{bestWC.actualRunway}</td>
                              <td className="py-3 px-4 text-right font-bold text-blue-700 text-lg">{baseWC.actualRunway}</td>
                              <td className={`py-3 px-4 text-right font-bold text-lg ${worstWC.actualRunway < 8 ? 'text-red-700' : 'text-amber-700'}`}>
                                {worstWC.actualRunway} {worstWC.actualRunway < 8 && '🔴'}
                              </td>
                            </tr>
                          </>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                  <p className="text-xs text-blue-900">
                    <strong>💡 Working Capital Impact:</strong> Reducing DSO by 10 days frees up cash tied in receivables. Lower CCC (Cash Conversion Cycle) means faster cash conversion and improved runway. Target: Keep CCC below 60 days for healthy cash flow.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Multi-Scenario Chart */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Scenario Comparison Chart</h2>
            <div className="flex items-center gap-2">
              {['revenue', 'netProfit', 'ebitda', 'cash'].map(metric => (
                <button
                  key={metric}
                  onClick={() => setChartMetric(metric as any)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    chartMetric === metric
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {metric === 'revenue' ? 'Revenue' : metric === 'netProfit' ? 'Net Profit' : metric === 'ebitda' ? 'EBITDA' : 'Cash'}
                </button>
              ))}
            </div>
          </div>

          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(val) => `₹${val.toFixed(1)}Cr`} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value: any) => formatCurrency(value * 10000000)}
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Legend />
              
              {/* BUG FIX 2 & 3: Correct dataKey mapping for each metric tab */}
              {chartMetric === 'revenue' && (
                <>
                  <Area type="monotone" dataKey="Best Case" fill="#10B981" stroke="none" fillOpacity={0.1} />
                  <Area type="monotone" dataKey="Worst Case" fill="#EF4444" stroke="none" fillOpacity={0.1} />
                  <Line type="monotone" dataKey="Best Case" stroke="#10B981" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Base Case" stroke="#3B82F6" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Worst Case" stroke="#EF4444" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Custom" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                </>
              )}
              
              {chartMetric === 'netProfit' && (
                <>
                  <Area type="monotone" dataKey="Best Case NP" fill="#10B981" stroke="none" fillOpacity={0.1} />
                  <Area type="monotone" dataKey="Worst Case NP" fill="#EF4444" stroke="none" fillOpacity={0.1} />
                  <Line type="monotone" dataKey="Best Case NP" name="Best Case" stroke="#10B981" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Base Case NP" name="Base Case" stroke="#3B82F6" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Worst Case NP" name="Worst Case" stroke="#EF4444" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Custom NP" name="Custom" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                </>
              )}
              
              {chartMetric === 'ebitda' && (
                <>
                  <Area type="monotone" dataKey="Best Case EBITDA" fill="#10B981" stroke="none" fillOpacity={0.1} />
                  <Area type="monotone" dataKey="Worst Case EBITDA" fill="#EF4444" stroke="none" fillOpacity={0.1} />
                  <Line type="monotone" dataKey="Best Case EBITDA" name="Best Case" stroke="#10B981" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Base Case EBITDA" name="Base Case" stroke="#3B82F6" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Worst Case EBITDA" name="Worst Case" stroke="#EF4444" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Custom EBITDA" name="Custom" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                </>
              )}
              
              {chartMetric === 'cash' && (
                <>
                  <Area type="monotone" dataKey="Best Case Cash" fill="#10B981" stroke="none" fillOpacity={0.1} />
                  <Area type="monotone" dataKey="Worst Case Cash" fill="#EF4444" stroke="none" fillOpacity={0.1} />
                  <Line type="monotone" dataKey="Best Case Cash" name="Best Case" stroke="#10B981" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Base Case Cash" name="Base Case" stroke="#3B82F6" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Worst Case Cash" name="Worst Case" stroke="#EF4444" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Custom Cash" name="Custom" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Comparison Table */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Scenario Comparison Table</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="py-3 px-4 text-left font-semibold text-gray-700">Metric</th>
                  {scenarios.map(s => (
                    <th key={s.id} className="py-3 px-4 text-right font-semibold" style={{ color: s.color }}>
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Total Revenue', key: 'revenue', format: formatCurrency },
                  { label: 'Gross Profit', key: 'grossProfit', format: formatCurrency },
                  { label: 'Gross Margin %', key: 'grossMargin', format: (v: number) => v.toFixed(1) + '%' },
                  { label: 'EBITDA', key: 'ebitda', format: formatCurrency },
                  { label: 'EBITDA Margin %', key: 'ebitdaMargin', format: (v: number) => v.toFixed(1) + '%' },
                  { label: 'Net Profit', key: 'netProfit', format: formatCurrency },
                  { label: 'Net Margin %', key: 'netMargin', format: (v: number) => v.toFixed(1) + '%' },
                  { label: 'Year-End Cash', key: 'cashPosition', format: formatCurrency },
                  { label: 'Cash Runway', key: 'runway', format: (v: number) => v + ' months' },
                  { label: 'Break-Even Month', key: 'breakEvenMonth', format: (v: string) => v }
                ].map((row, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-900">{row.label}</td>
                    {scenarios.map(s => (
                      <td key={s.id} className="py-3 px-4 text-right text-gray-700">
                        {row.format((s.results as any)[row.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Sensitivity Analysis */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Sensitivity Analysis</h2>
          <p className="text-sm text-gray-600 mb-4">Impact on Net Profit when variables change</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="py-3 px-4 text-left font-semibold text-gray-700">Variable</th>
                  <th className="py-3 px-4 text-right font-semibold text-gray-700">-20%</th>
                  <th className="py-3 px-4 text-right font-semibold text-gray-700">-10%</th>
                  <th className="py-3 px-4 text-right font-semibold text-blue-700 bg-blue-50">BASE</th>
                  <th className="py-3 px-4 text-right font-semibold text-gray-700">+10%</th>
                  <th className="py-3 px-4 text-right font-semibold text-gray-700">+20%</th>
                  <th className="py-3 px-4 text-center font-semibold text-gray-700">Sensitivity</th>
                </tr>
              </thead>
              <tbody>
                {sensitivityData.map((item, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-900">{item.variable}</td>
                    <td className={`py-3 px-4 text-right font-semibold ${
                      item.minus20 < 0 ? 'text-red-600' : item.minus20 < item.base ? 'text-amber-600' : 'text-green-600'
                    }`}>
                      {formatCurrency(item.minus20)}
                    </td>
                    <td className={`py-3 px-4 text-right font-semibold ${
                      item.minus10 < 0 ? 'text-red-600' : item.minus10 < item.base ? 'text-amber-600' : 'text-green-600'
                    }`}>
                      {formatCurrency(item.minus10)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-blue-700 bg-blue-50">
                      {formatCurrency(item.base)}
                    </td>
                    <td className={`py-3 px-4 text-right font-semibold ${
                      item.plus10 > item.base ? 'text-green-600' : 'text-amber-600'
                    }`}>
                      {formatCurrency(item.plus10)}
                    </td>
                    <td className={`py-3 px-4 text-right font-semibold ${
                      item.plus20 > item.plus10 ? 'text-green-600' : 'text-amber-600'
                    }`}>
                      {formatCurrency(item.plus20)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        item.sensitivity === 'high'
                          ? 'bg-red-100 text-red-700'
                          : item.sensitivity === 'medium'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {item.sensitivity.toUpperCase()} {item.sensitivity === 'high' ? '🔴' : item.sensitivity === 'medium' ? '🟡' : '🟢'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* AI Analysis */}
      {aiAnalysis && (
        <div className="max-w-[1800px] mx-auto mb-6">
          <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border-2 border-purple-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Sparkles className="text-purple-600" size={24} />
                <h3 className="text-lg font-bold text-gray-900">🤖 AI Strategic Analysis — Powered by Nova</h3>
              </div>
              <button
                onClick={copyForBoardPack}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Copy size={16} />
                Copy for Board Pack
              </button>
            </div>
            <div className="bg-white rounded-lg p-4 text-sm text-gray-700 whitespace-pre-line">
              {aiAnalysis}
            </div>
          </div>
        </div>
      )}

      {/* Worst Case Warning */}
      {scenarios.find(s => s.type === 'worst')?.results.runway < 8 && (
        <div className="max-w-[1800px] mx-auto mb-6">
          <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-red-600 flex-shrink-0" size={24} />
              <div>
                <h3 className="font-bold text-red-900 mb-2">⚠️ CRITICAL: Worst Case Scenario Alert</h3>
                <p className="text-sm text-red-800">
                  In the worst case scenario, cash runway drops to only{' '}
                  <span className="font-bold">{scenarios.find(s => s.type === 'worst')?.results.runway} months</span>.
                  This requires immediate contingency planning. Consider:
                </p>
                <ul className="mt-2 text-sm text-red-800 list-disc list-inside space-y-1">
                  <li>Freeze all non-essential hiring</li>
                  <li>Reduce discretionary spending by 20-30%</li>
                  <li>Accelerate AR collections</li>
                  <li>Explore short-term financing options</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScenarioPlanning;
