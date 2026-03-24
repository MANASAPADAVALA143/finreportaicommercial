import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Upload, TrendingUp, CheckCircle, Clock, Lock, AlertCircle, AlertTriangle, FileSpreadsheet, FileText, Sparkles, Save, Edit2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import BudgetTable from '../../components/fpa/BudgetTable';
import { budgetVersions, departmentBudgets, budgetSummary } from '../../data/budgetMockData';
import { callAI } from '../../services/aiProvider';
import { loadFPABudget, loadFPAPriorYear, checkDataAvailability, getMissingDataMessage, convertBudgetToLineItems } from '../../utils/fpaDataLoader';
const BudgetManagement = () => {
    const navigate = useNavigate();
    // Check data availability
    const dataCheck = checkDataAvailability(['fpa_budget']);
    const [budgetDataFromStorage, setBudgetDataFromStorage] = useState(null);
    const [priorYearData, setPriorYearData] = useState(null);
    useEffect(() => {
        if (dataCheck.available) {
            const budget = loadFPABudget();
            setBudgetDataFromStorage(budget);
            setPriorYearData(loadFPAPriorYear()); // Optional
            // Convert budget data to line items
            if (budget) {
                const converted = convertBudgetToLineItems(budget);
                setBudgetData(converted);
            }
        }
    }, [dataCheck.available]);
    const [budgetData, setBudgetData] = useState([]);
    const [currentStatus, setCurrentStatus] = useState('Approved');
    const [budgetApproach, setBudgetApproach] = useState('Bottom-Up');
    const [selectedDepartment, setSelectedDepartment] = useState('All Departments');
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [uploadedFile, setUploadedFile] = useState(null);
    const [aiSuggesting, setAiSuggesting] = useState(false);
    const formatCurrency = (value) => {
        const crore = value / 10000000;
        return `₹${crore.toFixed(2)}Cr`;
    };
    // Compute summary cards from budgetData when we have line items; otherwise use mock
    const computedSummary = React.useMemo(() => {
        if (!budgetData || budgetData.length === 0)
            return null;
        const isRevenueRow = (item) => !item.isHeader && /revenue|sales|income/i.test(item.category) && !/cost of sales|cos|cogs/i.test(item.category);
        const isExpenseRow = (item) => !item.isHeader && (/expense|cost|cogs|payroll|marketing|admin|depreciation|operating/i.test(item.category));
        const sumMonthly = (item) => Object.values(item.monthly || {}).reduce((s, v) => s + (Number(v) || 0), 0);
        const totalRevenue = budgetData.filter(isRevenueRow).reduce((s, r) => s + sumMonthly(r), 0);
        const totalExpenses = budgetData.filter(isExpenseRow).reduce((s, r) => s + sumMonthly(r), 0);
        const netProfit = totalRevenue - totalExpenses;
        // EBITDA approx: net profit + depreciation (if we had it); else use same as net for display or derive from expense rows
        const ebitda = netProfit; // simplified; could add back depreciation if we have a row
        return {
            totalRevenue,
            totalExpenses,
            netProfit,
            ebitda,
            priorYearRevenue: budgetSummary.priorYearRevenue,
            priorYearExpenses: budgetSummary.priorYearExpenses,
            priorYearNetProfit: budgetSummary.priorYearNetProfit,
            priorYearEbitda: budgetSummary.priorYearEbitda
        };
    }, [budgetData]);
    const displaySummary = computedSummary || budgetSummary;
    const getStatusColor = (status) => {
        const colors = {
            'Draft': 'bg-gray-100 text-gray-700 border-gray-300',
            'Under Review': 'bg-yellow-100 text-yellow-700 border-yellow-300',
            'Approved': 'bg-green-100 text-green-700 border-green-300',
            'Locked': 'bg-blue-100 text-blue-700 border-blue-300'
        };
        return colors[status];
    };
    const getStatusIcon = (status) => {
        const icons = {
            'Draft': _jsx(Clock, { size: 16 }),
            'Under Review': _jsx(AlertCircle, { size: 16 }),
            'Approved': _jsx(CheckCircle, { size: 16 }),
            'Locked': _jsx(Lock, { size: 16 })
        };
        return icons[status];
    };
    const handleStatusChange = (newStatus) => {
        if (currentStatus === 'Locked') {
            alert('⚠️ Budget is locked and cannot be modified. Please unlock first.');
            return;
        }
        setCurrentStatus(newStatus);
        alert(`✅ Budget status updated to: ${newStatus}`);
    };
    const downloadTemplate = () => {
        try {
            const templateData = [
                ['Line Item', 'Department', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                ['Domestic Sales', 'Sales', 18000000, 17000000, 19000000, 17500000, 18500000, 20000000, 18000000, 17500000, 19000000, 19500000, 18000000, 21000000],
                ['Export Sales', 'Sales', 12000000, 11000000, 13000000, 11500000, 12500000, 13000000, 12000000, 11500000, 12000000, 12500000, 12000000, 14000000],
                ['Raw Materials', 'Operations', 9000000, 8500000, 9500000, 8700000, 9300000, 10000000, 9000000, 8700000, 9300000, 9600000, 9000000, 10500000],
                ['Direct Labor', 'Operations', 4000000, 3800000, 4200000, 3900000, 4100000, 4300000, 4000000, 3900000, 4100000, 4200000, 4000000, 4500000],
                ['Employee Salaries', 'HR', 4500000, 4500000, 4500000, 4500000, 4500000, 4500000, 4500000, 4500000, 4500000, 4500000, 4500000, 4500000],
                ['Marketing & Advertising', 'Marketing', 1500000, 1400000, 1600000, 1500000, 1500000, 1600000, 1500000, 1500000, 1500000, 1600000, 1500000, 1700000],
                ['IT & Technology', 'IT', 700000, 650000, 750000, 700000, 700000, 750000, 700000, 700000, 700000, 750000, 700000, 800000],
                ['Administrative Expenses', 'Finance', 900000, 850000, 950000, 900000, 900000, 950000, 900000, 900000, 900000, 950000, 900000, 1000000]
            ];
            const worksheet = XLSX.utils.aoa_to_sheet(templateData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Budget Template');
            XLSX.writeFile(workbook, 'Budget_Template_FY2025.xlsx');
            alert('✅ Budget template downloaded successfully!');
        }
        catch (error) {
            alert('❌ Failed to download template: ' + error.message);
        }
    };
    const handleFileUpload = async () => {
        if (!uploadedFile) {
            alert('⚠️ Please select a file first');
            return;
        }
        const monthColToKey = {
            'Jan': 'jan', 'Feb': 'feb', 'Mar': 'mar', 'Apr': 'apr', 'May': 'may', 'Jun': 'jun',
            'Jul': 'jul', 'Aug': 'aug', 'Sep': 'sep', 'Oct': 'oct', 'Nov': 'nov', 'Dec': 'dec'
        };
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames.find(n => /budget|monthly/i.test(n)) || workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                if (rows.length < 2) {
                    alert('❌ File must have a header row and at least one data row.');
                    return;
                }
                const header = (rows[0] || []).map((h) => String(h || '').trim());
                const categoryCol = header.findIndex((h) => /category|line item|item/i.test(h));
                if (categoryCol < 0) {
                    alert('❌ Could not find a "Category" or "Line Item" column.');
                    return;
                }
                const parseNum = (val) => {
                    if (val == null || val === '')
                        return 0;
                    const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
                    return isNaN(n) ? 0 : n;
                };
                // If values are small (e.g. 2.8, 3.1), assume Crores; else use as-is (already in rupees)
                const scale = (v) => {
                    if (v === 0)
                        return 0;
                    if (Math.abs(v) < 10000 && Math.abs(v) >= 0.01)
                        return v * 10000000; // Crores → rupees
                    return v;
                };
                const lineItems = [];
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i] || [];
                    const category = String(row[categoryCol] ?? '').trim();
                    if (!category)
                        continue;
                    const monthly = {
                        jan: 0, feb: 0, mar: 0, apr: 0, may: 0, jun: 0,
                        jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0
                    };
                    header.forEach((h, col) => {
                        const key = monthColToKey[h];
                        if (key && row[col] !== undefined && row[col] !== null && row[col] !== '') {
                            monthly[key] = scale(parseNum(row[col]));
                        }
                    });
                    lineItems.push({
                        id: `upload-${i}-${category.slice(0, 20).replace(/\s/g, '-')}`,
                        category,
                        isHeader: /total|revenue|expenses|profit|gross|operating/i.test(category) && category.length < 25,
                        isEditable: true,
                        monthly,
                        priorYearActual: 0,
                        indent: 0
                    });
                }
                if (lineItems.length === 0) {
                    alert('❌ No valid rows found. Ensure columns include Category and month names (Jan–Dec).');
                    return;
                }
                setBudgetData(lineItems);
                setShowUploadModal(false);
                setUploadedFile(null);
                alert(`✅ Loaded ${lineItems.length} budget line items from "${uploadedFile.name}". Cards will update from this data.`);
            }
            catch (error) {
                alert('❌ Failed to parse file: ' + (error?.message || String(error)));
            }
        };
        reader.readAsArrayBuffer(uploadedFile);
    };
    const handleAISuggestion = async () => {
        setAiSuggesting(true);
        try {
            const prompt = `
You are a financial planning expert. Based on FY2024 actuals, suggest a budget for FY2025.

FY2024 Actuals:
- Total Revenue: ₹338 Cr
- Total Expenses: ₹270 Cr
- Net Profit: ₹45.08 Cr
- EBITDA: ₹74 Cr

Provide budget recommendations for FY2025 with:
1. Revenue growth % (consider market trends, inflation)
2. Cost optimization areas
3. Department-wise allocation suggestions
4. Key assumptions

Format as a structured commentary.
`;
            const aiResponse = await callAI(prompt);
            alert('💡 AI Budget Suggestions:\n\n' + aiResponse);
        }
        catch (error) {
            alert('❌ Failed to get AI suggestions: ' + error.message);
        }
        finally {
            setAiSuggesting(false);
        }
    };
    const exportBudgetPDF = () => {
        alert('📄 Exporting to PDF... (Coming soon)');
    };
    const exportBudgetExcel = () => {
        try {
            const workbook = XLSX.utils.book_new();
            const summary = displaySummary;
            // Sheet 1: Budget Summary (uses computed values when budget data is loaded)
            const summaryData = [
                ['FY2025 Annual Budget Summary'],
                [],
                ['Metric', 'FY2025 Budget', 'FY2024 Actual', 'Change %'],
                ['Total Revenue', summary.totalRevenue, summary.priorYearRevenue, (summary.priorYearRevenue ? ((summary.totalRevenue - summary.priorYearRevenue) / summary.priorYearRevenue * 100).toFixed(1) : '0') + '%'],
                ['Total Expenses', summary.totalExpenses, summary.priorYearExpenses, (summary.priorYearExpenses ? ((summary.totalExpenses - summary.priorYearExpenses) / summary.priorYearExpenses * 100).toFixed(1) : '0') + '%'],
                ['Net Profit', summary.netProfit, summary.priorYearNetProfit, (summary.priorYearNetProfit ? ((summary.netProfit - summary.priorYearNetProfit) / Math.abs(summary.priorYearNetProfit) * 100).toFixed(1) : '0') + '%'],
                ['EBITDA', summary.ebitda, summary.priorYearEbitda, (summary.priorYearEbitda ? ((summary.ebitda - summary.priorYearEbitda) / summary.priorYearEbitda * 100).toFixed(1) : '0') + '%']
            ];
            const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
            XLSX.utils.book_append_sheet(workbook, ws1, 'Summary');
            // Sheet 2: Detailed Budget
            const detailHeader = ['Line Item', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Total', 'FY2024 Actual'];
            const detailRows = budgetData.map(item => {
                const total = Object.values(item.monthly).reduce((sum, val) => sum + val, 0);
                return [
                    item.category,
                    item.monthly.jan,
                    item.monthly.feb,
                    item.monthly.mar,
                    item.monthly.apr,
                    item.monthly.may,
                    item.monthly.jun,
                    item.monthly.jul,
                    item.monthly.aug,
                    item.monthly.sep,
                    item.monthly.oct,
                    item.monthly.nov,
                    item.monthly.dec,
                    total,
                    item.priorYearActual || 0
                ];
            });
            const ws2 = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]);
            XLSX.utils.book_append_sheet(workbook, ws2, 'Detailed Budget');
            // Sheet 3: Department Breakdown
            const deptHeader = ['Department', 'Total Budget', 'FY2024 Actual', 'Variance', 'Variance %', 'Status'];
            const deptRows = departmentBudgets.map(dept => [
                dept.department,
                dept.totalBudget,
                dept.priorYearActual,
                dept.variance,
                dept.variancePct.toFixed(1) + '%',
                dept.status
            ]);
            const ws3 = XLSX.utils.aoa_to_sheet([deptHeader, ...deptRows]);
            XLSX.utils.book_append_sheet(workbook, ws3, 'Department Breakdown');
            XLSX.writeFile(workbook, 'Budget_FY2025_Export.xlsx');
            alert('✅ Budget exported to Excel successfully!');
        }
        catch (error) {
            alert('❌ Failed to export: ' + error.message);
        }
    };
    return (_jsxs("div", { className: "min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-6", children: [!dataCheck.available && (_jsx("div", { className: "bg-yellow-50 border-b-2 border-yellow-400 px-6 py-4 mb-6", children: _jsxs("div", { className: "max-w-[1800px] mx-auto flex items-center gap-3", children: [_jsx(AlertTriangle, { className: "w-6 h-6 text-yellow-600 flex-shrink-0" }), _jsxs("div", { className: "flex-1", children: [_jsxs("p", { className: "font-semibold text-yellow-900", children: ["\u26A0\uFE0F ", getMissingDataMessage(dataCheck.missing)] }), _jsx("p", { className: "text-sm text-yellow-700 mt-1", children: "Go to FP&A Suite and upload your Budget Trial Balance to manage budgets." })] }), _jsx("button", { onClick: () => navigate('/fpa'), className: "px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-medium", children: "Upload Data" })] }) })), _jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("button", { onClick: () => navigate('/fpa'), className: "p-2 hover:bg-white rounded-lg transition-colors", children: _jsx(ArrowLeft, { size: 24, className: "text-gray-700" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900", children: "Budget Management" }), _jsx("p", { className: "text-gray-600 mt-1", children: "FY2025 Annual Budget Planning & Control" })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("button", { onClick: downloadTemplate, className: "flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors", children: [_jsx(Download, { size: 18 }), "Template"] }), _jsxs("button", { onClick: () => setShowUploadModal(true), className: "flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors", children: [_jsx(Upload, { size: 18 }), "Upload"] }), _jsxs("button", { onClick: handleAISuggestion, disabled: aiSuggesting, className: "flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-colors disabled:opacity-50", children: [_jsx(Sparkles, { size: 18 }), aiSuggesting ? 'Generating...' : 'AI Suggest'] }), _jsxs("div", { className: "relative group", children: [_jsxs("button", { className: "flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors", children: [_jsx(Download, { size: 18 }), "Export"] }), _jsxs("div", { className: "absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10", children: [_jsxs("button", { onClick: exportBudgetExcel, className: "w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-gray-700 rounded-t-lg", children: [_jsx(FileSpreadsheet, { size: 16, className: "text-green-600" }), "Excel"] }), _jsxs("button", { onClick: exportBudgetPDF, className: "w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-gray-700 rounded-b-lg", children: [_jsx(FileText, { size: 16, className: "text-red-600" }), "PDF"] })] })] })] })] }) }), _jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsx("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-4", children: _jsxs("div", { className: "flex items-center justify-between flex-wrap gap-4", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "Budget Status:" }), _jsxs("div", { className: `flex items-center gap-2 px-4 py-2 rounded-lg border ${getStatusColor(currentStatus)}`, children: [getStatusIcon(currentStatus), _jsx("span", { className: "font-semibold", children: currentStatus })] }), currentStatus !== 'Locked' && (_jsxs("div", { className: "flex items-center gap-2", children: [currentStatus === 'Draft' && (_jsx("button", { onClick: () => handleStatusChange('Under Review'), className: "px-3 py-1.5 text-sm bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 transition-colors", children: "Submit for Review" })), currentStatus === 'Under Review' && (_jsxs(_Fragment, { children: [_jsx("button", { onClick: () => handleStatusChange('Approved'), className: "px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors", children: "Approve" }), _jsx("button", { onClick: () => handleStatusChange('Draft'), className: "px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors", children: "Send Back" })] })), currentStatus === 'Approved' && (_jsx("button", { onClick: () => handleStatusChange('Locked'), className: "px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors", children: "Lock Budget" }))] }))] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "Approach:" }), _jsxs("div", { className: "flex items-center bg-gray-100 rounded-lg p-1", children: [_jsx("button", { onClick: () => setBudgetApproach('Top-Down'), className: `px-4 py-1.5 text-sm rounded-md transition-colors ${budgetApproach === 'Top-Down'
                                                    ? 'bg-white text-blue-600 font-semibold shadow-sm'
                                                    : 'text-gray-600 hover:text-gray-900'}`, children: "Top-Down" }), _jsx("button", { onClick: () => setBudgetApproach('Bottom-Up'), className: `px-4 py-1.5 text-sm rounded-md transition-colors ${budgetApproach === 'Bottom-Up'
                                                    ? 'bg-white text-blue-600 font-semibold shadow-sm'
                                                    : 'text-gray-600 hover:text-gray-900'}`, children: "Bottom-Up" })] })] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "Department:" }), _jsxs("select", { value: selectedDepartment, onChange: (e) => setSelectedDepartment(e.target.value), className: "px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700", children: [_jsx("option", { children: "All Departments" }), _jsx("option", { children: "Sales" }), _jsx("option", { children: "HR" }), _jsx("option", { children: "IT" }), _jsx("option", { children: "Marketing" }), _jsx("option", { children: "Operations" }), _jsx("option", { children: "Finance" })] })] })] }) }) }), _jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsx("div", { className: "grid grid-cols-1 md:grid-cols-4 gap-6", children: [
                        { label: 'Total Revenue', value: displaySummary.totalRevenue, prior: displaySummary.priorYearRevenue, color: 'blue' },
                        { label: 'Total Expenses', value: displaySummary.totalExpenses, prior: displaySummary.priorYearExpenses, color: 'red' },
                        { label: 'Net Profit', value: displaySummary.netProfit, prior: displaySummary.priorYearNetProfit, color: 'green' },
                        { label: 'EBITDA', value: displaySummary.ebitda, prior: displaySummary.priorYearEbitda, color: 'purple' }
                    ].map((item, idx) => {
                        const change = ((item.value - item.prior) / item.prior) * 100;
                        return (_jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("span", { className: "text-sm font-medium text-gray-600", children: item.label }), _jsx(TrendingUp, { className: `text-${item.color}-500`, size: 20 })] }), _jsx("div", { className: "text-2xl font-bold text-gray-900 mb-2", children: formatCurrency(item.value) }), _jsxs("div", { className: "text-sm text-gray-500", children: ["vs FY2024: ", formatCurrency(item.prior)] }), _jsxs("div", { className: `text-sm font-semibold mt-2 ${change >= 0 ? 'text-green-600' : 'text-red-600'}`, children: [change >= 0 ? '↑' : '↓', " ", Math.abs(change).toFixed(1), "% YoY"] })] }, idx));
                    }) }) }), _jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsx("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "Version History:" }), _jsx("div", { className: "flex items-center gap-2", children: budgetVersions.map(version => (_jsx("button", { className: `px-4 py-2 text-sm rounded-lg border transition-colors ${version.isCurrent
                                                ? 'bg-blue-100 border-blue-300 text-blue-700 font-semibold'
                                                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`, children: version.name }, version.id))) })] }), _jsxs("button", { className: "flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors", children: [_jsx(Save, { size: 16 }), "Save as New Version"] })] }) }) }), _jsx("div", { className: "max-w-[1800px] mx-auto", children: _jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Monthly Budget Breakdown" }), _jsx("div", { className: "flex items-center gap-2 text-sm text-gray-600", children: _jsxs("span", { className: "flex items-center gap-1", children: [_jsx(Edit2, { size: 14 }), "Click any cell to edit"] }) })] }), _jsx(BudgetTable, { data: budgetData, onDataChange: setBudgetData })] }) }), showUploadModal && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50", children: _jsxs("div", { className: "bg-white rounded-xl shadow-2xl p-6 w-full max-w-md", children: [_jsx("h3", { className: "text-xl font-bold text-gray-900 mb-4", children: "Upload Budget Data" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "border-2 border-dashed border-gray-300 rounded-lg p-6 text-center", children: [_jsx(Upload, { size: 48, className: "mx-auto text-gray-400 mb-2" }), _jsx("p", { className: "text-sm text-gray-600 mb-2", children: "Drag and drop your Excel file here, or click to browse" }), _jsx("input", { type: "file", accept: ".xlsx,.xls,.csv", onChange: (e) => setUploadedFile(e.target.files?.[0] || null), className: "hidden", id: "file-upload" }), _jsx("label", { htmlFor: "file-upload", className: "inline-block px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors", children: "Choose File" }), uploadedFile && (_jsxs("p", { className: "text-sm text-green-600 mt-2", children: ["\u2713 ", uploadedFile.name] }))] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("button", { onClick: handleFileUpload, disabled: !uploadedFile, className: "flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed", children: "Upload & Apply" }), _jsx("button", { onClick: () => {
                                                setShowUploadModal(false);
                                                setUploadedFile(null);
                                            }, className: "flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors", children: "Cancel" })] })] })] }) }))] }));
};
export default BudgetManagement;
