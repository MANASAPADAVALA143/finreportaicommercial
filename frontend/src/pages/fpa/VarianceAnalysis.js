import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
export const VarianceAnalysis = () => {
    const navigate = useNavigate();
    // Check data availability
    const dataCheck = checkDataAvailability(['fpa_actual', 'fpa_budget']);
    const [actualData, setActualData] = useState(null);
    const [budgetData, setBudgetData] = useState(null);
    const [realVarianceData, setRealVarianceData] = useState([]);
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
    const [periodType, setPeriodType] = useState('monthly');
    const [month, setMonth] = useState(10); // October
    const [quarter, setQuarter] = useState(3);
    const [year, setYear] = useState(2025);
    const [compareType, setCompareType] = useState('budget');
    const [department, setDepartment] = useState('all');
    const [currency, setCurrency] = useState('INR');
    // UI State
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [uploadedFile, setUploadedFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadedData, setUploadedData] = useState([]);
    // Use real uploaded data if available, otherwise use mock data
    const currentVarianceData = realVarianceData.length > 0 ? realVarianceData : (uploadedData.length > 0 ? uploadedData : varianceData);
    // Calculate summary data
    const kpiSummaries = calculateKPISummaries(currentVarianceData);
    const alerts = extractVarianceAlerts(currentVarianceData);
    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            setUploadedFile(file);
        }
    };
    const handleUploadData = async () => {
        if (!uploadedFile)
            return;
        setUploading(true);
        try {
            const data = await uploadedFile.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet);
            // Helper: parse number from cell (handles commas and string numbers)
            const parseNum = (val) => {
                if (val == null || val === '')
                    return 0;
                if (typeof val === 'number' && !Number.isNaN(val))
                    return val;
                const s = String(val).replace(/,/g, '');
                const n = parseFloat(s);
                return Number.isNaN(n) ? 0 : n;
            };
            // Map uploaded data to VarianceRow format
            // Expected columns: Category, Actual, Budget, YTDActual, YTDBudget
            const mappedData = rows.map((row, index) => {
                const actual = parseNum(row['Actual'] ?? row['actual'] ?? 0);
                const budget = parseNum(row['Budget'] ?? row['budget'] ?? 0);
                const ytdActual = parseNum(row['YTD Actual'] ?? row['YTDActual'] ?? row['ytdActual'] ?? actual * 6);
                const ytdBudget = parseNum(row['YTD Budget'] ?? row['YTDBudget'] ?? row['ytdBudget'] ?? budget * 6);
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
                    priorYear: parseNum(row['Prior Year'] ?? row['priorYear'] ?? 0),
                    priorYearVariancePct: 0,
                    hasChildren: false,
                    isExpanded: false,
                    threshold: threshold,
                    level: 0
                };
            });
            setUploadedData(mappedData);
            setShowUploadModal(false);
            alert(`✅ Successfully uploaded ${mappedData.length} variance items!`);
        }
        catch (error) {
            alert('❌ Failed to upload file: ' + error.message);
        }
        finally {
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
            { wch: 12 } // Is Header
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Variance Template');
        XLSX.writeFile(wb, 'Variance_Analysis_Template.xlsx');
        alert('✅ Template downloaded! Fill it with your data and upload.');
    };
    const handleExport = (format) => {
        if (format === 'excel') {
            exportToExcel();
        }
        else {
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
                { wch: 15 } // Status
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
                { wch: 12 } // Threshold
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
                { wch: 15 } // Status
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
                { wch: 50 } // Message
            ];
            XLSX.utils.book_append_sheet(workbook, alertsSheet, 'Alerts');
            // Generate filename
            const filename = `Variance_Analysis_${periodLabel.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
            // Download the file
            XLSX.writeFile(workbook, filename);
            alert('✅ Excel file downloaded successfully!');
        }
        catch (error) {
            alert('❌ Failed to export to Excel: ' + error.message);
        }
    };
    const periodLabel = getPeriodLabel(periodType, month, quarter, year);
    return (_jsxs("div", { className: "min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50", children: [!dataCheck.available && (_jsx("div", { className: "bg-yellow-50 border-b-2 border-yellow-400 px-6 py-4", children: _jsxs("div", { className: "max-w-[1600px] mx-auto flex items-center gap-3", children: [_jsx(AlertTriangle, { className: "w-6 h-6 text-yellow-600 flex-shrink-0" }), _jsxs("div", { className: "flex-1", children: [_jsxs("p", { className: "font-semibold text-yellow-900", children: ["\u26A0\uFE0F ", getMissingDataMessage(dataCheck.missing)] }), _jsx("p", { className: "text-sm text-yellow-700 mt-1", children: "Go to FP&A Suite and click \"Upload Data\" to provide the required trial balance files." })] }), _jsx("button", { onClick: () => navigate('/fpa'), className: "px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-medium", children: "Upload Data" })] }) })), _jsx("div", { className: "bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40", children: _jsxs("div", { className: "max-w-[1600px] mx-auto px-6 py-4", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("button", { onClick: () => navigate('/fpa'), className: "p-2 hover:bg-gray-100 rounded-lg transition", children: _jsx(ArrowLeft, { className: "w-5 h-5 text-gray-600" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "\uD83D\uDCCA Variance Analysis" }), _jsx("p", { className: "text-sm text-gray-600", children: "Budget vs Actual Performance" })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("button", { onClick: () => setShowUploadModal(true), className: "px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center gap-2 font-medium", children: [_jsx(Upload, { className: "w-4 h-4" }), "Upload Data"] }), _jsxs("div", { className: "relative", children: [_jsxs("button", { onClick: () => setShowExportMenu(!showExportMenu), className: "px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition flex items-center gap-2 font-medium", children: [_jsx(Download, { className: "w-4 h-4" }), "Export", _jsx(ChevronDown, { className: "w-4 h-4" })] }), showExportMenu && (_jsxs("div", { className: "absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50", children: [_jsx("button", { onClick: () => handleExport('pdf'), className: "w-full px-4 py-2 text-left hover:bg-gray-50 transition text-sm text-gray-700", children: "Export as PDF" }), _jsx("button", { onClick: () => handleExport('excel'), className: "w-full px-4 py-2 text-left hover:bg-gray-50 transition text-sm text-gray-700", children: "Export as Excel" }), _jsx("button", { onClick: () => handleExport('powerpoint'), className: "w-full px-4 py-2 text-left hover:bg-gray-50 transition text-sm text-gray-700", children: "Export as PowerPoint" })] }))] })] })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-4", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("label", { className: "text-sm font-medium text-gray-700", children: "Period:" }), _jsx("div", { className: "flex bg-gray-100 rounded-lg p-1", children: ['monthly', 'quarterly', 'ytd', 'annual'].map((type) => (_jsx("button", { onClick: () => setPeriodType(type), className: `px-3 py-1 rounded text-sm font-medium transition ${periodType === type
                                                    ? 'bg-white text-blue-600 shadow-sm'
                                                    : 'text-gray-600 hover:text-gray-900'}`, children: type.charAt(0).toUpperCase() + type.slice(1) }, type))) })] }), periodType === 'monthly' && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("label", { className: "text-sm font-medium text-gray-700", children: "View:" }), _jsx("select", { value: month, onChange: (e) => setMonth(Number(e.target.value)), className: "px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent", children: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (_jsxs("option", { value: i + 1, children: [m, " ", year] }, i))) })] })), periodType === 'quarterly' && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("label", { className: "text-sm font-medium text-gray-700", children: "View:" }), _jsxs("select", { value: quarter, onChange: (e) => setQuarter(Number(e.target.value)), className: "px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent", children: [_jsxs("option", { value: 1, children: ["Q1 ", year] }), _jsxs("option", { value: 2, children: ["Q2 ", year] }), _jsxs("option", { value: 3, children: ["Q3 ", year] }), _jsxs("option", { value: 4, children: ["Q4 ", year] })] })] })), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("label", { className: "text-sm font-medium text-gray-700", children: "Compare:" }), _jsxs("select", { value: compareType, onChange: (e) => setCompareType(e.target.value), className: "px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent", children: [_jsx("option", { value: "budget", children: "Budget" }), _jsx("option", { value: "lastYear", children: "Last Year" }), _jsx("option", { value: "lastQuarter", children: "Last Quarter" }), _jsx("option", { value: "forecast", children: "Forecast" })] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("label", { className: "text-sm font-medium text-gray-700", children: "Department:" }), _jsxs("select", { value: department, onChange: (e) => setDepartment(e.target.value), className: "px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent", children: [_jsx("option", { value: "all", children: "All Departments" }), _jsx("option", { value: "sales", children: "Sales" }), _jsx("option", { value: "operations", children: "Operations" }), _jsx("option", { value: "hr", children: "HR" }), _jsx("option", { value: "it", children: "IT" }), _jsx("option", { value: "marketing", children: "Marketing" }), _jsx("option", { value: "finance", children: "Finance" })] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("label", { className: "text-sm font-medium text-gray-700", children: "Currency:" }), _jsxs("select", { value: currency, onChange: (e) => setCurrency(e.target.value), className: "px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent", children: [_jsx("option", { value: "INR", children: "INR (\u20B9)" }), _jsx("option", { value: "USD", children: "USD ($)" }), _jsx("option", { value: "EUR", children: "EUR (\u20AC)" }), _jsx("option", { value: "GBP", children: "GBP (\u00A3)" })] })] })] })] }) }), _jsx("div", { className: "max-w-[1600px] mx-auto px-6 py-8", children: _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-4 gap-6", children: [_jsxs("div", { className: "lg:col-span-3 space-y-6", children: [_jsx(VarianceSummaryCards, { summaries: kpiSummaries, currency: currency }), _jsx(VarianceTable, { data: currentVarianceData, currency: currency }), _jsx(WaterfallChart, { data: waterfallData, currency: currency }), _jsx(TrendChart, { data: trendData, currency: currency }), _jsx(DepartmentChart, { data: departmentData, currency: currency }), _jsx(AICommentary, { varianceData: currentVarianceData, period: periodLabel, entityName: "FinReport AI Commercial", currency: currency })] }), _jsx("div", { className: "lg:col-span-1", children: _jsx("div", { className: "sticky top-24", children: _jsx(AlertsPanel, { alerts: alerts, currency: currency }) }) })] }) }), showUploadModal && (_jsx("div", { className: "fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto", children: [_jsxs("div", { className: "flex items-center justify-between p-6 border-b border-gray-200", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "p-2 bg-blue-100 rounded-lg", children: _jsx(Upload, { className: "w-6 h-6 text-blue-600" }) }), _jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Upload Variance Data" }), _jsx("p", { className: "text-sm text-gray-600", children: "Import your own Excel file for analysis" })] })] }), _jsx("button", { onClick: () => {
                                        setShowUploadModal(false);
                                        setUploadedFile(null);
                                    }, className: "p-2 hover:bg-gray-100 rounded-lg transition", children: _jsx(X, { className: "w-5 h-5 text-gray-600" }) })] }), _jsxs("div", { className: "p-6 space-y-6", children: [_jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: [_jsx("h3", { className: "font-semibold text-blue-900 mb-2", children: "\uD83D\uDCCB Required Columns:" }), _jsxs("ul", { className: "text-sm text-blue-800 space-y-1", children: [_jsxs("li", { children: ["\u2022 ", _jsx("strong", { children: "Category" }), " - Line item name (e.g., \"Total Revenue\", \"Cost of Sales\")"] }), _jsxs("li", { children: ["\u2022 ", _jsx("strong", { children: "Actual" }), " - Actual amount for current period"] }), _jsxs("li", { children: ["\u2022 ", _jsx("strong", { children: "Budget" }), " - Budget amount for current period"] }), _jsxs("li", { children: ["\u2022 ", _jsx("strong", { children: "YTD Actual" }), " - Year-to-date actual (optional)"] }), _jsxs("li", { children: ["\u2022 ", _jsx("strong", { children: "YTD Budget" }), " - Year-to-date budget (optional)"] }), _jsxs("li", { children: ["\u2022 ", _jsx("strong", { children: "Prior Year" }), " - Prior year comparison (optional)"] }), _jsxs("li", { children: ["\u2022 ", _jsx("strong", { children: "Is Header" }), " - TRUE/FALSE for header rows (optional)"] })] })] }), _jsxs("div", { className: "flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-lg", children: [_jsxs("div", { children: [_jsx("h4", { className: "font-semibold text-gray-900", children: "Need a template?" }), _jsx("p", { className: "text-sm text-gray-600", children: "Download our Excel template with sample data" })] }), _jsxs("button", { onClick: handleDownloadTemplate, className: "px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg transition flex items-center gap-2 text-sm font-medium", children: [_jsx(Download, { className: "w-4 h-4" }), "Download Template"] })] }), _jsxs("div", { className: "space-y-3", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Upload Your Excel File" }), _jsxs("div", { className: "border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition", children: [_jsx("input", { type: "file", accept: ".xlsx,.xls", onChange: handleFileSelect, className: "hidden", id: "variance-file-input" }), _jsxs("label", { htmlFor: "variance-file-input", className: "cursor-pointer flex flex-col items-center", children: [_jsx(Upload, { className: "w-12 h-12 text-gray-400 mb-3" }), _jsx("span", { className: "text-sm font-medium text-gray-700 mb-1", children: "Click to upload or drag and drop" }), _jsx("span", { className: "text-xs text-gray-500", children: "Excel files only (.xlsx, .xls)" })] })] }), uploadedFile && (_jsxs("div", { className: "flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(FileText, { className: "w-5 h-5 text-green-600" }), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-green-900", children: uploadedFile.name }), _jsxs("p", { className: "text-xs text-green-700", children: [(uploadedFile.size / 1024).toFixed(1), " KB"] })] })] }), _jsx("button", { onClick: () => setUploadedFile(null), className: "p-1 hover:bg-green-100 rounded transition", children: _jsx(X, { className: "w-4 h-4 text-green-600" }) })] }))] })] }), _jsxs("div", { className: "flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50", children: [_jsx("button", { onClick: () => {
                                        setShowUploadModal(false);
                                        setUploadedFile(null);
                                    }, className: "px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition font-medium", children: "Cancel" }), _jsx("button", { onClick: handleUploadData, disabled: !uploadedFile || uploading, className: "px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2", children: uploading ? (_jsxs(_Fragment, { children: [_jsx(RefreshCw, { className: "w-4 h-4 animate-spin" }), "Uploading..."] })) : (_jsxs(_Fragment, { children: [_jsx(Upload, { className: "w-4 h-4" }), "Upload & Analyze"] })) })] })] }) }))] }));
};
