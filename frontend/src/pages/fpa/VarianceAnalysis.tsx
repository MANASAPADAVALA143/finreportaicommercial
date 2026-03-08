// FP&A Variance Analysis - Main Page
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, ChevronDown, Upload, X, FileText, RefreshCw, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { VarianceSummaryCards } from '../../components/fpa/VarianceSummaryCards';
import { VarianceTable } from '../../components/fpa/VarianceTable';
import { WaterfallChart } from '../../components/fpa/WaterfallChart';
import { TrendChart } from '../../components/fpa/TrendChart';
import { DepartmentChart } from '../../components/fpa/DepartmentChart';
import { AICommentary } from '../../components/fpa/AICommentary';
import { AlertsPanel } from '../../components/fpa/AlertsPanel';
import { varianceData, departmentData, trendData, waterfallData } from '../../data/varianceMockData';
import { calculateKPISummaries, extractVarianceAlerts, getPeriodLabel } from '../../utils/varianceUtils';
import { loadFPAActual, loadFPABudget, checkDataAvailability, getMissingDataMessage, convertToVarianceData } from '../../utils/fpaDataLoader';
import type { PeriodType, CompareType, DepartmentType, CurrencyType } from '../../types/fpa';

export const VarianceAnalysis = () => {
  const navigate = useNavigate();

  // Check data availability
  const dataCheck = checkDataAvailability(['fpa_actual', 'fpa_budget']);
  const [actualData, setActualData] = useState<any>(null);
  const [budgetData, setBudgetData] = useState<any>(null);
  const [realVarianceData, setRealVarianceData] = useState<any[]>([]);

  useEffect(() => {
    if (dataCheck.available) {
      const actual = loadFPAActual();
      const budget = loadFPABudget();
      setActualData(actual);
      setBudgetData(budget);
      
      // Convert uploaded data to variance format
      if (actual && budget) {
        const converted = convertToVarianceData(actual, budget);
        setRealVarianceData(converted);
      }
    }
  }, [dataCheck.available]);

  // Period Selection State
  const [periodType, setPeriodType] = useState<PeriodType>('monthly');
  const [month, setMonth] = useState(10); // October
  const [quarter, setQuarter] = useState(3);
  const [year, setYear] = useState(2025);
  const [compareType, setCompareType] = useState<CompareType>('budget');
  const [department, setDepartment] = useState<DepartmentType>('all');
  const [currency, setCurrency] = useState<CurrencyType>('INR');

  // UI State
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedData, setUploadedData] = useState<any[]>([]);

  // Use real uploaded data if available, otherwise use mock data
  const currentVarianceData = realVarianceData.length > 0 ? realVarianceData : (uploadedData.length > 0 ? uploadedData : varianceData);

  // Calculate summary data
  const kpiSummaries = calculateKPISummaries(currentVarianceData);
  const alerts = extractVarianceAlerts(currentVarianceData);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
    }
  };

  const handleUploadData = async () => {
    if (!uploadedFile) return;

    setUploading(true);
    try {
      const data = await uploadedFile.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);

      // Map uploaded data to VarianceRow format
      // Expected columns: Category, Actual, Budget, YTDActual, YTDBudget
      const mappedData = rows.map((row, index) => {
        const actual = parseFloat(row['Actual'] || row['actual'] || 0);
        const budget = parseFloat(row['Budget'] || row['budget'] || 0);
        const ytdActual = parseFloat(row['YTD Actual'] || row['YTDActual'] || row['ytdActual'] || actual * 6);
        const ytdBudget = parseFloat(row['YTD Budget'] || row['YTDBudget'] || row['ytdBudget'] || budget * 6);
        const variance = actual - budget;
        const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;
        const ytdVariance = ytdActual - ytdBudget;
        const ytdVariancePct = ytdBudget !== 0 ? (ytdVariance / ytdBudget) * 100 : 0;

        // Determine if favorable based on category
        const category = String(row['Category'] || row['category'] || `Item ${index + 1}`);
        const isRevenue = category.toLowerCase().includes('revenue') || category.toLowerCase().includes('income');
        const favorable = isRevenue ? variance > 0 : variance < 0;

        // Calculate threshold
        const absVariancePct = Math.abs(variancePct);
        const threshold = absVariancePct > 10 ? 'critical' : absVariancePct > 5 ? 'warning' : 'ok';

        return {
          id: `uploaded-${index}`,
          category,
          isHeader: row['Is Header'] === 'TRUE' || row['isHeader'] === true || false,
          actual,
          budget,
          variance,
          variancePct,
          favorable,
          ytdActual,
          ytdBudget,
          ytdVariance,
          ytdVariancePct,
          priorYear: parseFloat(row['Prior Year'] || row['priorYear'] || 0),
          priorYearVariancePct: 0,
          hasChildren: false,
          isExpanded: false,
          threshold: threshold as 'critical' | 'warning' | 'ok',
          level: 0
        };
      });

      setUploadedData(mappedData);
      setShowUploadModal(false);
      alert(`✅ Successfully uploaded ${mappedData.length} variance items!`);
    } catch (error: any) {
      alert('❌ Failed to upload file: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = () => {
    // Create a template Excel file
    const templateData = [
      ['Variance Analysis Upload Template'],
      ['Fill in your variance data below. Required columns: Category, Actual, Budget'],
      [],
      ['Category', 'Actual', 'Budget', 'YTD Actual', 'YTD Budget', 'Prior Year', 'Is Header'],
      ['Total Revenue', 33000000, 35000000, 198000000, 210000000, 28000000, 'TRUE'],
      ['Domestic Sales', 25000000, 26000000, 150000000, 156000000, 22000000, 'FALSE'],
      ['Export Sales', 8000000, 9000000, 48000000, 54000000, 6000000, 'FALSE'],
      ['Cost of Sales', 18500000, 17000000, 111000000, 102000000, 15000000, 'FALSE'],
      ['Gross Profit', 14500000, 18000000, 87000000, 108000000, 13000000, 'TRUE'],
      ['Operating Expenses', 7650000, 6800000, 45900000, 40800000, 6500000, 'TRUE'],
      ['Employee Benefits', 3200000, 3000000, 19200000, 18000000, 2800000, 'FALSE'],
      ['Administrative Expenses', 1450000, 1200000, 8700000, 7200000, 1100000, 'FALSE'],
      ['NET PROFIT', 5100000, 8100000, 30600000, 48600000, 4840000, 'TRUE']
    ];

    const ws = XLSX.utils.aoa_to_sheet(templateData);
    
    // Style the template
    ws['!cols'] = [
      { wch: 30 }, // Category
      { wch: 15 }, // Actual
      { wch: 15 }, // Budget
      { wch: 15 }, // YTD Actual
      { wch: 15 }, // YTD Budget
      { wch: 15 }, // Prior Year
      { wch: 12 }  // Is Header
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Variance Template');
    XLSX.writeFile(wb, 'Variance_Analysis_Template.xlsx');
    
    alert('✅ Template downloaded! Fill it with your data and upload.');
  };

  const handleExport = (format: 'pdf' | 'excel' | 'powerpoint') => {
    if (format === 'excel') {
      exportToExcel();
    } else {
      alert(`Exporting to ${format.toUpperCase()}... (Coming soon)`);
    }
    setShowExportMenu(false);
  };

  const exportToExcel = () => {
    try {
      // Create a new workbook
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Variance Summary
      const summaryData = [
        ['Variance Analysis Report'],
        ['Period:', periodLabel],
        ['Currency:', currency],
        ['Compare Against:', compareType],
        ['Department:', department],
        ['Generated:', new Date().toLocaleString()],
        [],
        ['KPI SUMMARY'],
        ['Metric', 'Actual', 'Budget', 'Variance', 'Variance %', 'Status'],
        ...kpiSummaries.map(kpi => [
          kpi.label,
          kpi.actual,
          kpi.budget,
          kpi.variance,
          kpi.variancePct.toFixed(2) + '%',
          kpi.favorable ? 'Favorable' : 'Unfavorable'
        ])
      ];

      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      
      // Style summary sheet
      summarySheet['!cols'] = [
        { wch: 25 }, // Metric
        { wch: 15 }, // Actual
        { wch: 15 }, // Budget
        { wch: 15 }, // Variance
        { wch: 12 }, // Variance %
        { wch: 15 }  // Status
      ];

      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

      // Sheet 2: Detailed Variance Table
      const detailData = [
        ['DETAILED VARIANCE ANALYSIS'],
        ['Period:', periodLabel],
        [],
        ['Category', 'Actual (Oct)', 'Budget (Oct)', 'Variance', 'Var %', 'YTD Actual', 'YTD Budget', 'YTD Var %', 'PY Var %', 'Threshold'],
        ...currentVarianceData
          .filter(row => !row.parentId) // Only include top-level and expanded items
          .map(row => [
            row.category,
            row.actual,
            row.budget,
            row.variance,
            row.variancePct.toFixed(2) + '%',
            row.ytdActual,
            row.ytdBudget,
            row.ytdVariancePct.toFixed(2) + '%',
            row.priorYearVariancePct ? row.priorYearVariancePct.toFixed(2) + '%' : 'N/A',
            row.threshold.toUpperCase()
          ])
      ];

      const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
      
      // Style detail sheet
      detailSheet['!cols'] = [
        { wch: 30 }, // Category
        { wch: 15 }, // Actual
        { wch: 15 }, // Budget
        { wch: 15 }, // Variance
        { wch: 10 }, // Var %
        { wch: 15 }, // YTD Actual
        { wch: 15 }, // YTD Budget
        { wch: 12 }, // YTD Var %
        { wch: 12 }, // PY Var %
        { wch: 12 }  // Threshold
      ];

      XLSX.utils.book_append_sheet(workbook, detailSheet, 'Detailed Variance');

      // Sheet 3: Department Breakdown
      const deptData = [
        ['DEPARTMENT VARIANCE ANALYSIS'],
        ['Period:', periodLabel],
        [],
        ['Department', 'Actual', 'Budget', 'Variance', 'Variance %', 'Status'],
        ...departmentData.map(dept => [
          dept.department,
          dept.actual,
          dept.budget,
          dept.variance,
          dept.variancePct.toFixed(2) + '%',
          dept.favorable ? 'Under Budget' : 'Over Budget'
        ])
      ];

      const deptSheet = XLSX.utils.aoa_to_sheet(deptData);
      
      deptSheet['!cols'] = [
        { wch: 20 }, // Department
        { wch: 15 }, // Actual
        { wch: 15 }, // Budget
        { wch: 15 }, // Variance
        { wch: 12 }, // Variance %
        { wch: 15 }  // Status
      ];

      XLSX.utils.book_append_sheet(workbook, deptSheet, 'Department Analysis');

      // Sheet 4: Alerts
      const alertsData = [
        ['VARIANCE ALERTS'],
        ['Period:', periodLabel],
        [],
        ['Severity', 'Category', 'Variance', 'Variance %', 'Message'],
        ...alerts.slice(0, 20).map(alert => [
          alert.threshold.toUpperCase(),
          alert.category,
          alert.variance,
          alert.variancePct.toFixed(2) + '%',
          alert.message
        ])
      ];

      const alertsSheet = XLSX.utils.aoa_to_sheet(alertsData);
      
      alertsSheet['!cols'] = [
        { wch: 12 }, // Severity
        { wch: 30 }, // Category
        { wch: 15 }, // Variance
        { wch: 12 }, // Variance %
        { wch: 50 }  // Message
      ];

      XLSX.utils.book_append_sheet(workbook, alertsSheet, 'Alerts');

      // Generate filename
      const filename = `Variance_Analysis_${periodLabel.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

      // Download the file
      XLSX.writeFile(workbook, filename);
      
      alert('✅ Excel file downloaded successfully!');
    } catch (error: any) {
      alert('❌ Failed to export to Excel: ' + error.message);
    }
  };

  const periodLabel = getPeriodLabel(periodType, month, quarter, year);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      {/* Data Missing Warning Banner */}
      {!dataCheck.available && (
        <div className="bg-yellow-50 border-b-2 border-yellow-400 px-6 py-4">
          <div className="max-w-[1600px] mx-auto flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-yellow-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-yellow-900">
                ⚠️ {getMissingDataMessage(dataCheck.missing)}
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                Go to FP&A Suite and click "Upload Data" to provide the required trial balance files.
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
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/fpa')}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">📊 Variance Analysis</h1>
                <p className="text-sm text-gray-600">Budget vs Actual Performance</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {/* Upload Button */}
              <button
                onClick={() => setShowUploadModal(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center gap-2 font-medium"
              >
                <Upload className="w-4 h-4" />
                Upload Data
              </button>

              {/* Export Button */}
              <div className="relative">
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition flex items-center gap-2 font-medium"
                >
                  <Download className="w-4 h-4" />
                  Export
                  <ChevronDown className="w-4 h-4" />
                </button>

              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                  <button
                    onClick={() => handleExport('pdf')}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 transition text-sm text-gray-700"
                  >
                    Export as PDF
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 transition text-sm text-gray-700"
                  >
                    Export as Excel
                  </button>
                  <button
                    onClick={() => handleExport('powerpoint')}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 transition text-sm text-gray-700"
                  >
                    Export as PowerPoint
                  </button>
                </div>
              )}
            </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Period Type */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Period:</label>
              <div className="flex bg-gray-100 rounded-lg p-1">
                {(['monthly', 'quarterly', 'ytd', 'annual'] as PeriodType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setPeriodType(type)}
                    className={`px-3 py-1 rounded text-sm font-medium transition ${
                      periodType === type
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Month/Quarter Selector */}
            {periodType === 'monthly' && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">View:</label>
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (
                    <option key={i} value={i + 1}>{m} {year}</option>
                  ))}
                </select>
              </div>
            )}

            {periodType === 'quarterly' && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">View:</label>
                <select
                  value={quarter}
                  onChange={(e) => setQuarter(Number(e.target.value))}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value={1}>Q1 {year}</option>
                  <option value={2}>Q2 {year}</option>
                  <option value={3}>Q3 {year}</option>
                  <option value={4}>Q4 {year}</option>
                </select>
              </div>
            )}

            {/* Compare Type */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Compare:</label>
              <select
                value={compareType}
                onChange={(e) => setCompareType(e.target.value as CompareType)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="budget">Budget</option>
                <option value="lastYear">Last Year</option>
                <option value="lastQuarter">Last Quarter</option>
                <option value="forecast">Forecast</option>
              </select>
            </div>

            {/* Department Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Department:</label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value as DepartmentType)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Departments</option>
                <option value="sales">Sales</option>
                <option value="operations">Operations</option>
                <option value="hr">HR</option>
                <option value="it">IT</option>
                <option value="marketing">Marketing</option>
                <option value="finance">Finance</option>
              </select>
            </div>

            {/* Currency */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Currency:</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyType)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Content Area (3 columns) */}
          <div className="lg:col-span-3 space-y-6">
            {/* KPI Summary Cards */}
            <VarianceSummaryCards summaries={kpiSummaries} currency={currency} />

            {/* Variance Table */}
            <VarianceTable data={currentVarianceData} currency={currency} />

            {/* Waterfall Chart */}
            <WaterfallChart data={waterfallData} currency={currency} />

            {/* Trend Chart */}
            <TrendChart data={trendData} currency={currency} />

            {/* Department Chart */}
            <DepartmentChart data={departmentData} currency={currency} />

            {/* AI Commentary */}
            <AICommentary
              varianceData={currentVarianceData}
              period={periodLabel}
              entityName="FinReport AI Commercial"
              currency={currency}
            />
          </div>

          {/* Sidebar (1 column) */}
          <div className="lg:col-span-1">
            <div className="sticky top-24">
              <AlertsPanel alerts={alerts} currency={currency} />
            </div>
          </div>
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Upload className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Upload Variance Data</h2>
                  <p className="text-sm text-gray-600">Import your own Excel file for analysis</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowUploadModal(false);
                  setUploadedFile(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Instructions */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-2">📋 Required Columns:</h3>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• <strong>Category</strong> - Line item name (e.g., "Total Revenue", "Cost of Sales")</li>
                  <li>• <strong>Actual</strong> - Actual amount for current period</li>
                  <li>• <strong>Budget</strong> - Budget amount for current period</li>
                  <li>• <strong>YTD Actual</strong> - Year-to-date actual (optional)</li>
                  <li>• <strong>YTD Budget</strong> - Year-to-date budget (optional)</li>
                  <li>• <strong>Prior Year</strong> - Prior year comparison (optional)</li>
                  <li>• <strong>Is Header</strong> - TRUE/FALSE for header rows (optional)</li>
                </ul>
              </div>

              {/* Download Template Button */}
              <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <div>
                  <h4 className="font-semibold text-gray-900">Need a template?</h4>
                  <p className="text-sm text-gray-600">Download our Excel template with sample data</p>
                </div>
                <button
                  onClick={handleDownloadTemplate}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg transition flex items-center gap-2 text-sm font-medium"
                >
                  <Download className="w-4 h-4" />
                  Download Template
                </button>
              </div>

              {/* File Upload Area */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700">
                  Upload Your Excel File
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition">
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="variance-file-input"
                  />
                  <label
                    htmlFor="variance-file-input"
                    className="cursor-pointer flex flex-col items-center"
                  >
                    <Upload className="w-12 h-12 text-gray-400 mb-3" />
                    <span className="text-sm font-medium text-gray-700 mb-1">
                      Click to upload or drag and drop
                    </span>
                    <span className="text-xs text-gray-500">Excel files only (.xlsx, .xls)</span>
                  </label>
                </div>

                {uploadedFile && (
                  <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-green-600" />
                      <div>
                        <p className="text-sm font-medium text-green-900">{uploadedFile.name}</p>
                        <p className="text-xs text-green-700">
                          {(uploadedFile.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setUploadedFile(null)}
                      className="p-1 hover:bg-green-100 rounded transition"
                    >
                      <X className="w-4 h-4 text-green-600" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => {
                  setShowUploadModal(false);
                  setUploadedFile(null);
                }}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleUploadData}
                disabled={!uploadedFile || uploading}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {uploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload & Analyze
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
