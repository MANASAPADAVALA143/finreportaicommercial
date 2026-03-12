import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Sparkles, GitBranch, Plus, Copy, AlertTriangle, Upload, ArrowLeft, TrendingUp, Users, DollarSign, Clock } from 'lucide-react';
import { loadFPAActual, checkDataAvailability, getMissingDataMessage } from '../../utils/fpaDataLoader';
import { scenarios as initialScenarios, sensitivityData } from '../../data/scenarioMockData';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, ComposedChart } from 'recharts';
import { callAI } from '../../services/aiProvider';
import toast from 'react-hot-toast';
import { parseTrialBalance, calculateScenarioResults, calculateWorkingCapital, calculateDriverBasedRevenue, saveFPAData, loadFPAData } from '../../services/fpaDataService';
const ScenarioPlanning = () => {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);
    // Check data availability
    const dataCheck = checkDataAvailability(['fpa_actual']);
    const [actualData, setActualData] = useState(null);
    useEffect(() => {
        if (dataCheck.available) {
            setActualData(loadFPAActual());
        }
    }, [dataCheck.available]);
    const [scenarios, setScenarios] = useState(initialScenarios);
    const [activeScenarioId, setActiveScenarioId] = useState('base');
    const [chartMetric, setChartMetric] = useState('revenue');
    const [aiAnalysis, setAiAnalysis] = useState(null);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadedData, setUploadedData] = useState(null);
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
    const [revenueDrivers, setRevenueDrivers] = useState({
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
    const [sliders, setSliders] = useState({
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
    const formatCurrency = (value) => {
        const crore = value / 10000000;
        const lakh = value / 100000;
        if (Math.abs(crore) >= 1)
            return `₹${crore.toFixed(2)}Cr`;
        return `₹${lakh.toFixed(2)}L`;
    };
    const activeScenario = scenarios.find(s => s.id === activeScenarioId) || scenarios[1];
    const handleSliderChange = (key, value) => {
        setSliders(prev => ({ ...prev, [key]: value }));
        // In a real app, this would trigger recalculation of all scenarios
    };
    const resetSlider = (key, baseValue) => {
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
            const best = scenarios.find(s => s.type === 'best');
            const base = scenarios.find(s => s.type === 'base');
            const worst = scenarios.find(s => s.type === 'worst');
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
        }
        catch (error) {
            alert('❌ Failed to generate analysis: ' + error.message);
        }
        finally {
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
    const handleFileUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file)
            return;
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
                    revenueMultiplier = 1.15; // +15% revenue
                    cogsAdjust = 0.95; // -5% COGS efficiency
                    payrollGrowth = 1.05; // +5% payroll
                    opexGrowth = 0.95; // -5% opex
                }
                else if (scenario.type === 'worst') {
                    revenueMultiplier = 0.85; // -15% revenue
                    cogsAdjust = 1.05; // +5% COGS increase
                    payrollGrowth = 1.12; // +12% payroll
                    opexGrowth = 1.10; // +10% opex
                }
                else if (scenario.type === 'custom') {
                    revenueMultiplier = 1.05; // +5% revenue
                    cogsAdjust = 1.0; // no change
                    payrollGrowth = 1.08; // +8% payroll
                    opexGrowth = 1.03; // +3% opex
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
            toast.success(`✅ Data uploaded — scenarios updated!\nRevenue: ${formatCurrency(parsedData.totalRevenue)}, Net Profit: ${formatCurrency(baseResults.netProfit)}`, { id: loadingToast, duration: 5000 });
        }
        catch (error) {
            toast.error(`❌ ${error.message}`, { id: loadingToast });
        }
        finally {
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
        }
        catch (error) {
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
        if (!best || !base || !worst || !custom)
            return [];
        const openingCash = actualData?.cashAndEquivalents || 0;
        // If no real data, return empty
        if (!actualData)
            return [];
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
    return (_jsxs("div", { className: "min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 p-6", children: [!dataCheck.available && (_jsx("div", { className: "bg-yellow-50 border-b-2 border-yellow-400 px-6 py-4 rounded-lg mb-6", children: _jsxs("div", { className: "max-w-[1800px] mx-auto flex items-center gap-3", children: [_jsx(AlertTriangle, { className: "w-6 h-6 text-yellow-600 flex-shrink-0" }), _jsxs("div", { className: "flex-1", children: [_jsxs("p", { className: "font-semibold text-yellow-900", children: ["\u26A0\uFE0F ", getMissingDataMessage(dataCheck.missing)] }), _jsx("p", { className: "text-sm text-yellow-700 mt-1", children: "Scenario Planning requires Actual TB to model what-if scenarios." })] }), _jsx("button", { onClick: () => navigate('/fpa'), className: "px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-medium", children: "Upload Data" })] }) })), _jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsx("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("button", { onClick: () => navigate('/fpa'), className: "p-2 hover:bg-gray-100 rounded-lg transition-colors", children: _jsx(ArrowLeft, { size: 24, className: "text-gray-700" }) }), _jsx("div", { children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx(GitBranch, { size: 32, className: "text-blue-600" }), _jsxs("div", { children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900", children: "\uD83C\uDFAF Scenario Planning" }), _jsx("p", { className: "text-gray-600 mt-1", children: "Model financial outcomes across multiple scenarios" })] })] }) })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("input", { ref: fileInputRef, type: "file", accept: ".xlsx,.xls,.csv", onChange: handleFileUpload, className: "hidden" }), _jsxs("button", { onClick: handleUploadClick, disabled: uploading, className: "flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50", children: [_jsx(Upload, { size: 18 }), uploading ? 'Uploading...' : 'Upload Data'] }), _jsxs("button", { onClick: () => setShowNewScenarioModal(true), className: "flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors", children: [_jsx(Plus, { size: 18 }), "New Scenario"] }), _jsxs("button", { onClick: generateAIAnalysis, disabled: aiGenerating, className: "flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-colors disabled:opacity-50", children: [_jsx(Sparkles, { size: 18 }), aiGenerating ? 'Analyzing...' : 'AI Analysis'] }), _jsxs("button", { onClick: handleExport, className: "flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors", children: [_jsx(Download, { size: 18 }), "Export"] })] })] }) }) }), _jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6", children: scenarios.map(scenario => (_jsxs("div", { onClick: () => setActiveScenarioId(scenario.id), className: `bg-white rounded-xl shadow-sm p-6 cursor-pointer transition-all ${scenario.id === activeScenarioId
                            ? 'ring-4 ring-offset-2'
                            : 'hover:shadow-md'}`, style: {
                            borderTop: `4px solid ${scenario.color}`
                        }, children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-2xl", children: scenario.type === 'best' ? '🟢' : scenario.type === 'base' ? '🔵' : scenario.type === 'worst' ? '🔴' : '⚙️' }), _jsx("h3", { className: "font-bold text-gray-900", children: scenario.name.toUpperCase() })] }), scenario.isActive && (_jsx("span", { className: "text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-semibold", children: "ACTIVE" }))] }), _jsx("p", { className: "text-xs text-gray-600 mb-4", children: scenario.description }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-500", children: "Revenue" }), _jsx("div", { className: "text-2xl font-bold text-gray-900", children: formatCurrency(scenario.results.revenue) })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-500", children: "Net Profit" }), _jsx("div", { className: "text-xl font-bold", style: { color: scenario.color }, children: formatCurrency(scenario.results.netProfit) })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-500", children: "Net Margin" }), _jsxs("div", { className: "text-lg font-semibold text-gray-700", children: [scenario.results.netMargin.toFixed(1), "%"] })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-500", children: "Runway" }), _jsxs("div", { className: `text-lg font-semibold ${scenario.results.runway < 8 ? 'text-red-600' : scenario.results.runway < 12 ? 'text-amber-600' : 'text-green-600'}`, children: [scenario.results.runway, " months ", scenario.results.runway < 8 && '🔴'] })] })] }), _jsx("button", { className: "w-full mt-4 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors", children: scenario.type === 'custom' ? 'Edit' : 'View Details' })] }, scenario.id))) }) }), _jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsx("h2", { className: "text-xl font-bold text-gray-900", children: "What-If Analysis" }), _jsx("button", { onClick: resetAllSliders, className: "text-sm text-blue-600 hover:text-blue-700 font-medium", children: "Reset All to Base" })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-bold text-gray-700 mb-4 uppercase", children: "Revenue Assumptions" }), _jsx("div", { className: "space-y-4", children: [
                                                { key: 'revenueGrowth', label: 'Revenue Growth %', min: -20, max: 30, base: 27, unit: '%' },
                                                { key: 'domesticMix', label: 'Domestic Sales Mix', min: 50, max: 90, base: 76, unit: '%' },
                                                { key: 'exportGrowth', label: 'Export Sales Growth', min: -30, max: 50, base: 25, unit: '%' },
                                                { key: 'newCustomerRev', label: 'New Customer Revenue', min: 0, max: 5, base: 2, unit: 'Cr' }
                                            ].map(slider => (_jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm text-gray-700", children: slider.label }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("span", { className: "text-xs text-gray-500", children: ["Base: ", slider.base, slider.unit] }), _jsxs("span", { className: "text-sm font-bold text-blue-600", children: ["Current: ", sliders[slider.key], slider.unit] }), _jsx("button", { onClick: () => resetSlider(slider.key, slider.base), className: "text-xs text-gray-400 hover:text-gray-600", children: "Reset" })] })] }), _jsx("input", { type: "range", min: slider.min, max: slider.max, step: 0.1, value: sliders[slider.key], onChange: (e) => handleSliderChange(slider.key, parseFloat(e.target.value)), className: "w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" }), _jsxs("div", { className: "flex justify-between text-xs text-gray-500", children: [_jsxs("span", { children: [slider.min, slider.unit] }), _jsxs("span", { children: [slider.max, slider.unit] })] })] }, slider.key))) })] }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-bold text-gray-700 mb-4 uppercase", children: "Cost & Market Assumptions" }), _jsx("div", { className: "space-y-4", children: [
                                                { key: 'cogsPercent', label: 'COGS %', min: 30, max: 70, base: 56, unit: '%' },
                                                { key: 'payrollGrowth', label: 'Payroll Growth %', min: 0, max: 20, base: 12, unit: '%' },
                                                { key: 'opexGrowth', label: 'Opex Growth %', min: -10, max: 25, base: 15, unit: '%' },
                                                { key: 'marketGrowth', label: 'Market Growth Rate', min: 0, max: 20, base: 10, unit: '%' },
                                                { key: 'priceChange', label: 'Price Change %', min: -15, max: 15, base: 0, unit: '%' },
                                                { key: 'churnPercent', label: 'Customer Churn %', min: 0, max: 20, base: 5, unit: '%' }
                                            ].map(slider => (_jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm text-gray-700", children: slider.label }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("span", { className: "text-xs text-gray-500", children: ["Base: ", slider.base, slider.unit] }), _jsxs("span", { className: "text-sm font-bold text-blue-600", children: ["Current: ", sliders[slider.key], slider.unit] }), _jsx("button", { onClick: () => resetSlider(slider.key, slider.base), className: "text-xs text-gray-400 hover:text-gray-600", children: "Reset" })] })] }), _jsx("input", { type: "range", min: slider.min, max: slider.max, step: 0.1, value: sliders[slider.key], onChange: (e) => handleSliderChange(slider.key, parseFloat(e.target.value)), className: "w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" }), _jsxs("div", { className: "flex justify-between text-xs text-gray-500", children: [_jsxs("span", { children: [slider.min, slider.unit] }), _jsxs("span", { children: [slider.max, slider.unit] })] })] }, slider.key))) })] })] })] }) }), _jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Users, { className: "text-purple-600", size: 24 }), _jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold text-gray-900", children: "\uD83C\uDFAF Driver-Based Revenue Model" }), _jsx("p", { className: "text-sm text-gray-600", children: "Build revenue from business drivers (like Anaplan)" })] })] }), _jsxs("label", { className: "flex items-center gap-2 cursor-pointer", children: [_jsx("span", { className: "text-sm text-gray-700", children: "Driver Model:" }), _jsxs("div", { className: "relative", children: [_jsx("input", { type: "checkbox", checked: driverModelEnabled, onChange: (e) => setDriverModelEnabled(e.target.checked), className: "sr-only peer" }), _jsx("div", { className: "w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600" })] }), _jsx("span", { className: `text-sm font-semibold ${driverModelEnabled ? 'text-purple-600' : 'text-gray-400'}`, children: driverModelEnabled ? 'ON' : 'OFF' })] })] }), driverModelEnabled && (_jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-6", children: [_jsxs("div", { className: "bg-blue-50 rounded-lg p-4", children: [_jsxs("h3", { className: "text-sm font-bold text-blue-900 mb-4 flex items-center gap-2", children: [_jsx(Users, { size: 16 }), "CUSTOMER DRIVERS"] }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { children: [_jsx("label", { className: "text-xs text-gray-700 block mb-1", children: "Total Customers" }), _jsx("input", { type: "number", value: revenueDrivers.totalCustomers, onChange: (e) => setRevenueDrivers({ ...revenueDrivers, totalCustomers: parseInt(e.target.value) || 0 }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs text-gray-700 block mb-1", children: "Customer Growth %" }), _jsx("input", { type: "range", min: "0", max: "50", value: revenueDrivers.customerGrowthPct, onChange: (e) => setRevenueDrivers({ ...revenueDrivers, customerGrowthPct: parseFloat(e.target.value) }), className: "w-full" }), _jsxs("div", { className: "text-xs text-gray-600 text-right", children: [revenueDrivers.customerGrowthPct, "%"] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs text-gray-700 block mb-1", children: "Churn Rate %" }), _jsx("input", { type: "range", min: "0", max: "20", value: revenueDrivers.churnRatePct, onChange: (e) => setRevenueDrivers({ ...revenueDrivers, churnRatePct: parseFloat(e.target.value) }), className: "w-full" }), _jsxs("div", { className: "text-xs text-gray-600 text-right", children: [revenueDrivers.churnRatePct, "%"] })] })] })] }), _jsxs("div", { className: "bg-green-50 rounded-lg p-4", children: [_jsxs("h3", { className: "text-sm font-bold text-green-900 mb-4 flex items-center gap-2", children: [_jsx(DollarSign, { size: 16 }), "PRICING DRIVERS"] }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { children: [_jsx("label", { className: "text-xs text-gray-700 block mb-1", children: "Avg Selling Price (\u20B9)" }), _jsx("input", { type: "number", value: revenueDrivers.averageSellingPrice, onChange: (e) => setRevenueDrivers({ ...revenueDrivers, averageSellingPrice: parseFloat(e.target.value) || 0 }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs text-gray-700 block mb-1", children: "Price Change %" }), _jsx("input", { type: "range", min: "-15", max: "15", value: revenueDrivers.priceChangePct, onChange: (e) => setRevenueDrivers({ ...revenueDrivers, priceChangePct: parseFloat(e.target.value) }), className: "w-full" }), _jsxs("div", { className: "text-xs text-gray-600 text-right", children: [revenueDrivers.priceChangePct > 0 ? '+' : '', revenueDrivers.priceChangePct, "%"] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs text-gray-700 block mb-1", children: "Product Mix Premium %" }), _jsx("input", { type: "range", min: "0", max: "50", value: revenueDrivers.productMixPremiumPct, onChange: (e) => setRevenueDrivers({ ...revenueDrivers, productMixPremiumPct: parseFloat(e.target.value) }), className: "w-full" }), _jsxs("div", { className: "text-xs text-gray-600 text-right", children: [revenueDrivers.productMixPremiumPct, "%"] })] })] })] }), _jsxs("div", { className: "bg-purple-50 rounded-lg p-4", children: [_jsxs("h3", { className: "text-sm font-bold text-purple-900 mb-4 flex items-center gap-2", children: [_jsx(TrendingUp, { size: 16 }), "VOLUME & OUTPUT"] }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { children: [_jsx("label", { className: "text-xs text-gray-700 block mb-1", children: "Purchases per Customer" }), _jsx("input", { type: "number", step: "0.1", value: revenueDrivers.purchasesPerCustomer, onChange: (e) => setRevenueDrivers({ ...revenueDrivers, purchasesPerCustomer: parseFloat(e.target.value) || 0 }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" })] }), (() => {
                                                    const result = calculateDriverBasedRevenue(revenueDrivers);
                                                    const simpleGrowthRevenue = uploadedData ? uploadedData.totalRevenue * 1.27 : 0;
                                                    const difference = result.calculatedRevenue - simpleGrowthRevenue;
                                                    return (_jsxs("div", { className: "mt-4 pt-4 border-t border-purple-200", children: [_jsx("div", { className: "text-xs text-gray-600 mb-2", children: "CALCULATED REVENUE:" }), _jsx("div", { className: "text-2xl font-bold text-purple-900 mb-1", children: formatCurrency(result.calculatedRevenue) }), _jsxs("div", { className: "text-xs text-gray-600 space-y-1", children: [_jsxs("div", { children: ["= ", result.endingCustomers.toLocaleString(), " customers"] }), _jsxs("div", { children: ["\u00D7 \u20B9", result.effectivePrice.toFixed(0), " avg price"] }), _jsxs("div", { children: ["\u00D7 ", revenueDrivers.purchasesPerCustomer, " purchases"] }), _jsxs("div", { className: "pt-2 mt-2 border-t border-purple-200", children: [_jsx("strong", { children: "vs Simple Growth:" }), " ", formatCurrency(simpleGrowthRevenue)] }), _jsxs("div", { className: difference >= 0 ? 'text-green-600' : 'text-red-600', children: [_jsx("strong", { children: "Difference:" }), " ", difference >= 0 ? '+' : '', formatCurrency(Math.abs(difference))] })] })] }));
                                                })()] })] })] })), !driverModelEnabled && (_jsxs("div", { className: "text-center py-8 text-gray-500", children: [_jsx(Users, { className: "mx-auto mb-2 text-gray-400", size: 48 }), _jsx("p", { className: "text-sm", children: "Turn on Driver Model to build revenue from customer, pricing, and volume drivers" })] }))] }) }), uploadedData && (_jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Clock, { className: "text-orange-600", size: 24 }), _jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold text-gray-900", children: "\uD83D\uDCB0 Working Capital & Cash Flow Impact" }), _jsx("p", { className: "text-sm text-gray-600", children: "DSO, DPO, DIO affect actual cash runway" })] })] }), _jsxs("button", { onClick: () => setShowWorkingCapital(!showWorkingCapital), className: "text-sm text-blue-600 hover:text-blue-700 font-medium", children: [showWorkingCapital ? 'Hide' : 'Show', " Details"] })] }), showWorkingCapital && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-4 mb-6", children: [_jsxs("div", { children: [_jsx("label", { className: "text-xs text-gray-700 block mb-2", children: "DSO (Days Sales Outstanding)" }), _jsx("input", { type: "range", min: "20", max: "80", value: wcDrivers.dso, onChange: (e) => setWcDrivers({ ...wcDrivers, dso: parseInt(e.target.value) }), className: "w-full" }), _jsxs("div", { className: "flex justify-between text-xs text-gray-600 mt-1", children: [_jsx("span", { children: "20 days" }), _jsxs("span", { className: "font-bold text-blue-600", children: [wcDrivers.dso, " days"] }), _jsx("span", { children: "80 days" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs text-gray-700 block mb-2", children: "DPO (Days Payable Outstanding)" }), _jsx("input", { type: "range", min: "20", max: "80", value: wcDrivers.dpo, onChange: (e) => setWcDrivers({ ...wcDrivers, dpo: parseInt(e.target.value) }), className: "w-full" }), _jsxs("div", { className: "flex justify-between text-xs text-gray-600 mt-1", children: [_jsx("span", { children: "20 days" }), _jsxs("span", { className: "font-bold text-green-600", children: [wcDrivers.dpo, " days"] }), _jsx("span", { children: "80 days" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs text-gray-700 block mb-2", children: "DIO (Days Inventory Outstanding)" }), _jsx("input", { type: "range", min: "20", max: "120", value: wcDrivers.dio, onChange: (e) => setWcDrivers({ ...wcDrivers, dio: parseInt(e.target.value) }), className: "w-full" }), _jsxs("div", { className: "flex justify-between text-xs text-gray-600 mt-1", children: [_jsx("span", { children: "20 days" }), _jsxs("span", { className: "font-bold text-amber-600", children: [wcDrivers.dio, " days"] }), _jsx("span", { children: "120 days" })] })] })] }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "bg-gray-50", children: _jsxs("tr", { children: [_jsx("th", { className: "py-3 px-4 text-left font-semibold text-gray-700", children: "Working Capital Metric" }), _jsx("th", { className: "py-3 px-4 text-right font-semibold text-green-700", children: "Best Case" }), _jsx("th", { className: "py-3 px-4 text-right font-semibold text-blue-700", children: "Base Case" }), _jsx("th", { className: "py-3 px-4 text-right font-semibold text-red-700", children: "Worst Case" })] }) }), _jsx("tbody", { children: (() => {
                                                    const best = scenarios.find(s => s.type === 'best');
                                                    const base = scenarios.find(s => s.type === 'base');
                                                    const worst = scenarios.find(s => s.type === 'worst');
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
                                                    return (_jsxs(_Fragment, { children: [_jsxs("tr", { className: "border-b border-gray-100 hover:bg-gray-50", children: [_jsx("td", { className: "py-3 px-4 font-medium text-gray-900", children: "DSO (days)" }), _jsx("td", { className: "py-3 px-4 text-right text-green-700", children: Math.round(wcDrivers.dso * 0.8) }), _jsx("td", { className: "py-3 px-4 text-right text-blue-700", children: wcDrivers.dso }), _jsx("td", { className: "py-3 px-4 text-right text-red-700", children: Math.round(wcDrivers.dso * 1.2) })] }), _jsxs("tr", { className: "border-b border-gray-100 hover:bg-gray-50", children: [_jsx("td", { className: "py-3 px-4 font-medium text-gray-900", children: "DPO (days)" }), _jsx("td", { className: "py-3 px-4 text-right text-green-700", children: Math.round(wcDrivers.dpo * 1.1) }), _jsx("td", { className: "py-3 px-4 text-right text-blue-700", children: wcDrivers.dpo }), _jsx("td", { className: "py-3 px-4 text-right text-red-700", children: Math.round(wcDrivers.dpo * 0.9) })] }), _jsxs("tr", { className: "border-b border-gray-100 hover:bg-gray-50", children: [_jsx("td", { className: "py-3 px-4 font-medium text-gray-900", children: "DIO (days)" }), _jsx("td", { className: "py-3 px-4 text-right text-green-700", children: Math.round(wcDrivers.dio * 0.85) }), _jsx("td", { className: "py-3 px-4 text-right text-blue-700", children: wcDrivers.dio }), _jsx("td", { className: "py-3 px-4 text-right text-red-700", children: Math.round(wcDrivers.dio * 1.15) })] }), _jsxs("tr", { className: "border-b border-gray-200 hover:bg-gray-50 bg-amber-50", children: [_jsx("td", { className: "py-3 px-4 font-bold text-gray-900", children: "CCC (Cash Conversion Cycle)" }), _jsxs("td", { className: `py-3 px-4 text-right font-bold ${cccBest < 60 ? 'text-green-700' : 'text-amber-700'}`, children: [Math.round(cccBest), " days"] }), _jsxs("td", { className: `py-3 px-4 text-right font-bold ${cccBase < 60 ? 'text-green-700' : 'text-amber-700'}`, children: [Math.round(cccBase), " days"] }), _jsxs("td", { className: `py-3 px-4 text-right font-bold ${cccWorst > 90 ? 'text-red-700' : 'text-amber-700'}`, children: [Math.round(cccWorst), " days ", cccWorst > 90 && '🔴'] })] }), _jsxs("tr", { className: "border-b border-gray-100 hover:bg-gray-50", children: [_jsx("td", { className: "py-3 px-4 font-medium text-gray-900", children: "Accounts Receivable" }), _jsx("td", { className: "py-3 px-4 text-right text-gray-700", children: formatCurrency(bestWC.accountsReceivable) }), _jsx("td", { className: "py-3 px-4 text-right text-gray-700", children: formatCurrency(baseWC.accountsReceivable) }), _jsx("td", { className: "py-3 px-4 text-right text-gray-700", children: formatCurrency(worstWC.accountsReceivable) })] }), _jsxs("tr", { className: "border-b border-gray-100 hover:bg-gray-50", children: [_jsx("td", { className: "py-3 px-4 font-medium text-gray-900", children: "Inventory" }), _jsx("td", { className: "py-3 px-4 text-right text-gray-700", children: formatCurrency(bestWC.inventory) }), _jsx("td", { className: "py-3 px-4 text-right text-gray-700", children: formatCurrency(baseWC.inventory) }), _jsx("td", { className: "py-3 px-4 text-right text-gray-700", children: formatCurrency(worstWC.inventory) })] }), _jsxs("tr", { className: "border-b border-gray-100 hover:bg-gray-50", children: [_jsx("td", { className: "py-3 px-4 font-medium text-gray-900", children: "Accounts Payable" }), _jsxs("td", { className: "py-3 px-4 text-right text-gray-700", children: ["(", formatCurrency(bestWC.accountsPayable), ")"] }), _jsxs("td", { className: "py-3 px-4 text-right text-gray-700", children: ["(", formatCurrency(baseWC.accountsPayable), ")"] }), _jsxs("td", { className: "py-3 px-4 text-right text-gray-700", children: ["(", formatCurrency(worstWC.accountsPayable), ")"] })] }), _jsxs("tr", { className: "border-b border-gray-200 hover:bg-gray-50 bg-blue-50", children: [_jsx("td", { className: "py-3 px-4 font-bold text-gray-900", children: "Working Capital Required" }), _jsx("td", { className: "py-3 px-4 text-right font-bold text-green-700", children: formatCurrency(bestWC.workingCapital) }), _jsx("td", { className: "py-3 px-4 text-right font-bold text-blue-700", children: formatCurrency(baseWC.workingCapital) }), _jsx("td", { className: "py-3 px-4 text-right font-bold text-red-700", children: formatCurrency(worstWC.workingCapital) })] }), _jsxs("tr", { className: "border-b border-gray-100 hover:bg-gray-50", children: [_jsx("td", { className: "py-3 px-4 font-medium text-gray-900", children: "Operating Cash Flow" }), _jsx("td", { className: "py-3 px-4 text-right font-semibold text-green-700", children: formatCurrency(bestWC.operatingCashFlow) }), _jsx("td", { className: "py-3 px-4 text-right font-semibold text-blue-700", children: formatCurrency(baseWC.operatingCashFlow) }), _jsx("td", { className: "py-3 px-4 text-right font-semibold text-red-700", children: formatCurrency(worstWC.operatingCashFlow) })] }), _jsxs("tr", { className: "border-b border-gray-100 hover:bg-gray-50", children: [_jsx("td", { className: "py-3 px-4 font-medium text-gray-900", children: "Free Cash Flow" }), _jsx("td", { className: "py-3 px-4 text-right font-semibold text-green-700", children: formatCurrency(bestWC.freeCashFlow) }), _jsx("td", { className: "py-3 px-4 text-right font-semibold text-blue-700", children: formatCurrency(baseWC.freeCashFlow) }), _jsx("td", { className: "py-3 px-4 text-right font-semibold text-red-700", children: formatCurrency(worstWC.freeCashFlow) })] }), _jsxs("tr", { className: "border-t-2 border-gray-300 bg-purple-50", children: [_jsx("td", { className: "py-3 px-4 font-bold text-gray-900", children: "ACTUAL Runway (months)" }), _jsx("td", { className: "py-3 px-4 text-right font-bold text-green-700 text-lg", children: bestWC.actualRunway }), _jsx("td", { className: "py-3 px-4 text-right font-bold text-blue-700 text-lg", children: baseWC.actualRunway }), _jsxs("td", { className: `py-3 px-4 text-right font-bold text-lg ${worstWC.actualRunway < 8 ? 'text-red-700' : 'text-amber-700'}`, children: [worstWC.actualRunway, " ", worstWC.actualRunway < 8 && '🔴'] })] })] }));
                                                })() })] }) }), _jsx("div", { className: "mt-4 p-4 bg-blue-50 rounded-lg", children: _jsxs("p", { className: "text-xs text-blue-900", children: [_jsx("strong", { children: "\uD83D\uDCA1 Working Capital Impact:" }), " Reducing DSO by 10 days frees up cash tied in receivables. Lower CCC (Cash Conversion Cycle) means faster cash conversion and improved runway. Target: Keep CCC below 60 days for healthy cash flow."] }) })] }))] }) })), _jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Scenario Comparison Chart" }), _jsx("div", { className: "flex items-center gap-2", children: ['revenue', 'netProfit', 'ebitda', 'cash'].map(metric => (_jsx("button", { onClick: () => setChartMetric(metric), className: `px-3 py-1.5 text-sm rounded-lg transition-colors ${chartMetric === metric
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: metric === 'revenue' ? 'Revenue' : metric === 'netProfit' ? 'Net Profit' : metric === 'ebitda' ? 'EBITDA' : 'Cash' }, metric))) })] }), _jsx(ResponsiveContainer, { width: "100%", height: 400, children: _jsxs(ComposedChart, { data: chartData, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#E5E7EB" }), _jsx(XAxis, { dataKey: "month", tick: { fontSize: 11 } }), _jsx(YAxis, { tickFormatter: (val) => `₹${val.toFixed(1)}Cr`, tick: { fontSize: 12 } }), _jsx(Tooltip, { formatter: (value) => formatCurrency(value * 10000000), contentStyle: { backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px' } }), _jsx(Legend, {}), chartMetric === 'revenue' && (_jsxs(_Fragment, { children: [_jsx(Area, { type: "monotone", dataKey: "Best Case", fill: "#10B981", stroke: "none", fillOpacity: 0.1 }), _jsx(Area, { type: "monotone", dataKey: "Worst Case", fill: "#EF4444", stroke: "none", fillOpacity: 0.1 }), _jsx(Line, { type: "monotone", dataKey: "Best Case", stroke: "#10B981", strokeWidth: 3, dot: false }), _jsx(Line, { type: "monotone", dataKey: "Base Case", stroke: "#3B82F6", strokeWidth: 3, dot: false }), _jsx(Line, { type: "monotone", dataKey: "Worst Case", stroke: "#EF4444", strokeWidth: 3, dot: false }), _jsx(Line, { type: "monotone", dataKey: "Custom", stroke: "#8B5CF6", strokeWidth: 2, strokeDasharray: "5 5", dot: false })] })), chartMetric === 'netProfit' && (_jsxs(_Fragment, { children: [_jsx(Area, { type: "monotone", dataKey: "Best Case NP", fill: "#10B981", stroke: "none", fillOpacity: 0.1 }), _jsx(Area, { type: "monotone", dataKey: "Worst Case NP", fill: "#EF4444", stroke: "none", fillOpacity: 0.1 }), _jsx(Line, { type: "monotone", dataKey: "Best Case NP", name: "Best Case", stroke: "#10B981", strokeWidth: 3, dot: false }), _jsx(Line, { type: "monotone", dataKey: "Base Case NP", name: "Base Case", stroke: "#3B82F6", strokeWidth: 3, dot: false }), _jsx(Line, { type: "monotone", dataKey: "Worst Case NP", name: "Worst Case", stroke: "#EF4444", strokeWidth: 3, dot: false }), _jsx(Line, { type: "monotone", dataKey: "Custom NP", name: "Custom", stroke: "#8B5CF6", strokeWidth: 2, strokeDasharray: "5 5", dot: false })] })), chartMetric === 'ebitda' && (_jsxs(_Fragment, { children: [_jsx(Area, { type: "monotone", dataKey: "Best Case EBITDA", fill: "#10B981", stroke: "none", fillOpacity: 0.1 }), _jsx(Area, { type: "monotone", dataKey: "Worst Case EBITDA", fill: "#EF4444", stroke: "none", fillOpacity: 0.1 }), _jsx(Line, { type: "monotone", dataKey: "Best Case EBITDA", name: "Best Case", stroke: "#10B981", strokeWidth: 3, dot: false }), _jsx(Line, { type: "monotone", dataKey: "Base Case EBITDA", name: "Base Case", stroke: "#3B82F6", strokeWidth: 3, dot: false }), _jsx(Line, { type: "monotone", dataKey: "Worst Case EBITDA", name: "Worst Case", stroke: "#EF4444", strokeWidth: 3, dot: false }), _jsx(Line, { type: "monotone", dataKey: "Custom EBITDA", name: "Custom", stroke: "#8B5CF6", strokeWidth: 2, strokeDasharray: "5 5", dot: false })] })), chartMetric === 'cash' && (_jsxs(_Fragment, { children: [_jsx(Area, { type: "monotone", dataKey: "Best Case Cash", fill: "#10B981", stroke: "none", fillOpacity: 0.1 }), _jsx(Area, { type: "monotone", dataKey: "Worst Case Cash", fill: "#EF4444", stroke: "none", fillOpacity: 0.1 }), _jsx(Line, { type: "monotone", dataKey: "Best Case Cash", name: "Best Case", stroke: "#10B981", strokeWidth: 3, dot: false }), _jsx(Line, { type: "monotone", dataKey: "Base Case Cash", name: "Base Case", stroke: "#3B82F6", strokeWidth: 3, dot: false }), _jsx(Line, { type: "monotone", dataKey: "Worst Case Cash", name: "Worst Case", stroke: "#EF4444", strokeWidth: 3, dot: false }), _jsx(Line, { type: "monotone", dataKey: "Custom Cash", name: "Custom", stroke: "#8B5CF6", strokeWidth: 2, strokeDasharray: "5 5", dot: false })] }))] }) })] }) }), _jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: [_jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Scenario Comparison Table" }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "bg-gray-50", children: _jsxs("tr", { children: [_jsx("th", { className: "py-3 px-4 text-left font-semibold text-gray-700", children: "Metric" }), scenarios.map(s => (_jsx("th", { className: "py-3 px-4 text-right font-semibold", style: { color: s.color }, children: s.name }, s.id)))] }) }), _jsx("tbody", { children: [
                                            { label: 'Total Revenue', key: 'revenue', format: formatCurrency },
                                            { label: 'Gross Profit', key: 'grossProfit', format: formatCurrency },
                                            { label: 'Gross Margin %', key: 'grossMargin', format: (v) => v.toFixed(1) + '%' },
                                            { label: 'EBITDA', key: 'ebitda', format: formatCurrency },
                                            { label: 'EBITDA Margin %', key: 'ebitdaMargin', format: (v) => v.toFixed(1) + '%' },
                                            { label: 'Net Profit', key: 'netProfit', format: formatCurrency },
                                            { label: 'Net Margin %', key: 'netMargin', format: (v) => v.toFixed(1) + '%' },
                                            { label: 'Year-End Cash', key: 'cashPosition', format: formatCurrency },
                                            { label: 'Cash Runway', key: 'runway', format: (v) => v + ' months' },
                                            { label: 'Break-Even Month', key: 'breakEvenMonth', format: (v) => v }
                                        ].map((row, idx) => (_jsxs("tr", { className: "border-b border-gray-100 hover:bg-gray-50", children: [_jsx("td", { className: "py-3 px-4 font-medium text-gray-900", children: row.label }), scenarios.map(s => (_jsx("td", { className: "py-3 px-4 text-right text-gray-700", children: row.format(s.results[row.key]) }, s.id)))] }, idx))) })] }) })] }) }), _jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: [_jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Sensitivity Analysis" }), _jsx("p", { className: "text-sm text-gray-600 mb-4", children: "Impact on Net Profit when variables change" }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "bg-gray-50", children: _jsxs("tr", { children: [_jsx("th", { className: "py-3 px-4 text-left font-semibold text-gray-700", children: "Variable" }), _jsx("th", { className: "py-3 px-4 text-right font-semibold text-gray-700", children: "-20%" }), _jsx("th", { className: "py-3 px-4 text-right font-semibold text-gray-700", children: "-10%" }), _jsx("th", { className: "py-3 px-4 text-right font-semibold text-blue-700 bg-blue-50", children: "BASE" }), _jsx("th", { className: "py-3 px-4 text-right font-semibold text-gray-700", children: "+10%" }), _jsx("th", { className: "py-3 px-4 text-right font-semibold text-gray-700", children: "+20%" }), _jsx("th", { className: "py-3 px-4 text-center font-semibold text-gray-700", children: "Sensitivity" })] }) }), _jsx("tbody", { children: sensitivityData.map((item, idx) => (_jsxs("tr", { className: "border-b border-gray-100 hover:bg-gray-50", children: [_jsx("td", { className: "py-3 px-4 font-medium text-gray-900", children: item.variable }), _jsx("td", { className: `py-3 px-4 text-right font-semibold ${item.minus20 < 0 ? 'text-red-600' : item.minus20 < item.base ? 'text-amber-600' : 'text-green-600'}`, children: formatCurrency(item.minus20) }), _jsx("td", { className: `py-3 px-4 text-right font-semibold ${item.minus10 < 0 ? 'text-red-600' : item.minus10 < item.base ? 'text-amber-600' : 'text-green-600'}`, children: formatCurrency(item.minus10) }), _jsx("td", { className: "py-3 px-4 text-right font-bold text-blue-700 bg-blue-50", children: formatCurrency(item.base) }), _jsx("td", { className: `py-3 px-4 text-right font-semibold ${item.plus10 > item.base ? 'text-green-600' : 'text-amber-600'}`, children: formatCurrency(item.plus10) }), _jsx("td", { className: `py-3 px-4 text-right font-semibold ${item.plus20 > item.plus10 ? 'text-green-600' : 'text-amber-600'}`, children: formatCurrency(item.plus20) }), _jsx("td", { className: "py-3 px-4 text-center", children: _jsxs("span", { className: `px-3 py-1 rounded-full text-xs font-semibold ${item.sensitivity === 'high'
                                                            ? 'bg-red-100 text-red-700'
                                                            : item.sensitivity === 'medium'
                                                                ? 'bg-amber-100 text-amber-700'
                                                                : 'bg-green-100 text-green-700'}`, children: [item.sensitivity.toUpperCase(), " ", item.sensitivity === 'high' ? '🔴' : item.sensitivity === 'medium' ? '🟡' : '🟢'] }) })] }, idx))) })] }) })] }) }), aiAnalysis && (_jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsxs("div", { className: "bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border-2 border-purple-200 p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Sparkles, { className: "text-purple-600", size: 24 }), _jsx("h3", { className: "text-lg font-bold text-gray-900", children: "\uD83E\uDD16 AI Strategic Analysis \u2014 Powered by Nova" })] }), _jsxs("button", { onClick: copyForBoardPack, className: "flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors", children: [_jsx(Copy, { size: 16 }), "Copy for Board Pack"] })] }), _jsx("div", { className: "bg-white rounded-lg p-4 text-sm text-gray-700 whitespace-pre-line", children: aiAnalysis })] }) })), scenarios.find(s => s.type === 'worst')?.results.runway < 8 && (_jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsx("div", { className: "bg-red-50 border-2 border-red-200 rounded-xl p-6", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx(AlertTriangle, { className: "text-red-600 flex-shrink-0", size: 24 }), _jsxs("div", { children: [_jsx("h3", { className: "font-bold text-red-900 mb-2", children: "\u26A0\uFE0F CRITICAL: Worst Case Scenario Alert" }), _jsxs("p", { className: "text-sm text-red-800", children: ["In the worst case scenario, cash runway drops to only", ' ', _jsxs("span", { className: "font-bold", children: [scenarios.find(s => s.type === 'worst')?.results.runway, " months"] }), ". This requires immediate contingency planning. Consider:"] }), _jsxs("ul", { className: "mt-2 text-sm text-red-800 list-disc list-inside space-y-1", children: [_jsx("li", { children: "Freeze all non-essential hiring" }), _jsx("li", { children: "Reduce discretionary spending by 20-30%" }), _jsx("li", { children: "Accelerate AR collections" }), _jsx("li", { children: "Explore short-term financing options" })] })] })] }) }) }))] }));
};
export default ScenarioPlanning;
