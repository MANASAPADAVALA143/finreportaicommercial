import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Upload,
  TrendingUp,
  CheckCircle,
  Clock,
  Lock,
  AlertCircle,
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Sparkles,
  Save,
  RefreshCw,
  Edit2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import BudgetTable from '../../components/fpa/BudgetTable';
import { budgetVersions, departmentBudgets, budgetSummary } from '../../data/budgetMockData';
import { BudgetLineItem, BudgetStatus, BudgetApproach } from '../../types/budget';
import { callAI } from '../../services/aiProvider';
import { loadFPABudget, loadFPAPriorYear, checkDataAvailability, getMissingDataMessage, convertBudgetToLineItems } from '../../utils/fpaDataLoader';

const BudgetManagement: React.FC = () => {
  const navigate = useNavigate();
  
  // Check data availability
  const dataCheck = checkDataAvailability(['fpa_budget']);
  const [budgetDataFromStorage, setBudgetDataFromStorage] = useState<any>(null);
  const [priorYearData, setPriorYearData] = useState<any>(null);

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
  
  const [budgetData, setBudgetData] = useState<BudgetLineItem[]>([]);
  const [currentStatus, setCurrentStatus] = useState<BudgetStatus>('Approved');
  const [budgetApproach, setBudgetApproach] = useState<BudgetApproach>('Bottom-Up');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('All Departments');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [aiSuggesting, setAiSuggesting] = useState(false);

  const formatCurrency = (value: number): string => {
    const crore = value / 10000000;
    return `₹${crore.toFixed(2)}Cr`;
  };

  const getStatusColor = (status: BudgetStatus) => {
    const colors = {
      'Draft': 'bg-gray-100 text-gray-700 border-gray-300',
      'Under Review': 'bg-yellow-100 text-yellow-700 border-yellow-300',
      'Approved': 'bg-green-100 text-green-700 border-green-300',
      'Locked': 'bg-blue-100 text-blue-700 border-blue-300'
    };
    return colors[status];
  };

  const getStatusIcon = (status: BudgetStatus) => {
    const icons = {
      'Draft': <Clock size={16} />,
      'Under Review': <AlertCircle size={16} />,
      'Approved': <CheckCircle size={16} />,
      'Locked': <Lock size={16} />
    };
    return icons[status];
  };

  const handleStatusChange = (newStatus: BudgetStatus) => {
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
    } catch (error: any) {
      alert('❌ Failed to download template: ' + error.message);
    }
  };

  const handleFileUpload = async () => {
    if (!uploadedFile) {
      alert('⚠️ Please select a file first');
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows: any[] = XLSX.utils.sheet_to_json(sheet);

          // Parse uploaded data and update budget
          // This is a simplified version - in production, you'd do more validation
          alert('✅ Budget data uploaded successfully!');
          setShowUploadModal(false);
          setUploadedFile(null);
        } catch (error: any) {
          alert('❌ Failed to parse file: ' + error.message);
        }
      };
      reader.readAsArrayBuffer(uploadedFile);
    } catch (error: any) {
      alert('❌ Failed to upload file: ' + error.message);
    }
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
    } catch (error: any) {
      alert('❌ Failed to get AI suggestions: ' + error.message);
    } finally {
      setAiSuggesting(false);
    }
  };

  const exportBudgetPDF = () => {
    alert('📄 Exporting to PDF... (Coming soon)');
  };

  const exportBudgetExcel = () => {
    try {
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Budget Summary
      const summaryData = [
        ['FY2025 Annual Budget Summary'],
        [],
        ['Metric', 'FY2025 Budget', 'FY2024 Actual', 'Change %'],
        ['Total Revenue', budgetSummary.totalRevenue, budgetSummary.priorYearRevenue, ((budgetSummary.totalRevenue - budgetSummary.priorYearRevenue) / budgetSummary.priorYearRevenue * 100).toFixed(1) + '%'],
        ['Total Expenses', budgetSummary.totalExpenses, budgetSummary.priorYearExpenses, ((budgetSummary.totalExpenses - budgetSummary.priorYearExpenses) / budgetSummary.priorYearExpenses * 100).toFixed(1) + '%'],
        ['Net Profit', budgetSummary.netProfit, budgetSummary.priorYearNetProfit, ((budgetSummary.netProfit - budgetSummary.priorYearNetProfit) / budgetSummary.priorYearNetProfit * 100).toFixed(1) + '%'],
        ['EBITDA', budgetSummary.ebitda, budgetSummary.priorYearEbitda, ((budgetSummary.ebitda - budgetSummary.priorYearEbitda) / budgetSummary.priorYearEbitda * 100).toFixed(1) + '%']
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
    } catch (error: any) {
      alert('❌ Failed to export: ' + error.message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-6">
      {/* Data Missing Warning Banner */}
      {!dataCheck.available && (
        <div className="bg-yellow-50 border-b-2 border-yellow-400 px-6 py-4 mb-6">
          <div className="max-w-[1800px] mx-auto flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-yellow-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-yellow-900">
                ⚠️ {getMissingDataMessage(dataCheck.missing)}
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                Go to FP&A Suite and upload your Budget Trial Balance to manage budgets.
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/fpa')}
              className="p-2 hover:bg-white rounded-lg transition-colors"
            >
              <ArrowLeft size={24} className="text-gray-700" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Budget Management</h1>
              <p className="text-gray-600 mt-1">FY2025 Annual Budget Planning & Control</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Download size={18} />
              Template
            </button>
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Upload size={18} />
              Upload
            </button>
            <button
              onClick={handleAISuggestion}
              disabled={aiSuggesting}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-colors disabled:opacity-50"
            >
              <Sparkles size={18} />
              {aiSuggesting ? 'Generating...' : 'AI Suggest'}
            </button>
            <div className="relative group">
              <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                <Download size={18} />
                Export
              </button>
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                <button
                  onClick={exportBudgetExcel}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-gray-700 rounded-t-lg"
                >
                  <FileSpreadsheet size={16} className="text-green-600" />
                  Excel
                </button>
                <button
                  onClick={exportBudgetPDF}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-gray-700 rounded-b-lg"
                >
                  <FileText size={16} className="text-red-600" />
                  PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Control Bar */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            {/* Status Section */}
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">Budget Status:</span>
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${getStatusColor(currentStatus)}`}>
                {getStatusIcon(currentStatus)}
                <span className="font-semibold">{currentStatus}</span>
              </div>
              
              {currentStatus !== 'Locked' && (
                <div className="flex items-center gap-2">
                  {currentStatus === 'Draft' && (
                    <button
                      onClick={() => handleStatusChange('Under Review')}
                      className="px-3 py-1.5 text-sm bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 transition-colors"
                    >
                      Submit for Review
                    </button>
                  )}
                  {currentStatus === 'Under Review' && (
                    <>
                      <button
                        onClick={() => handleStatusChange('Approved')}
                        className="px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleStatusChange('Draft')}
                        className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        Send Back
                      </button>
                    </>
                  )}
                  {currentStatus === 'Approved' && (
                    <button
                      onClick={() => handleStatusChange('Locked')}
                      className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                    >
                      Lock Budget
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Approach Toggle */}
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">Approach:</span>
              <div className="flex items-center bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setBudgetApproach('Top-Down')}
                  className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                    budgetApproach === 'Top-Down'
                      ? 'bg-white text-blue-600 font-semibold shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Top-Down
                </button>
                <button
                  onClick={() => setBudgetApproach('Bottom-Up')}
                  className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                    budgetApproach === 'Bottom-Up'
                      ? 'bg-white text-blue-600 font-semibold shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Bottom-Up
                </button>
              </div>
            </div>

            {/* Department Filter */}
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">Department:</span>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
              >
                <option>All Departments</option>
                <option>Sales</option>
                <option>HR</option>
                <option>IT</option>
                <option>Marketing</option>
                <option>Operations</option>
                <option>Finance</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Budget Summary Cards */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { label: 'Total Revenue', value: budgetSummary.totalRevenue, prior: budgetSummary.priorYearRevenue, color: 'blue' },
            { label: 'Total Expenses', value: budgetSummary.totalExpenses, prior: budgetSummary.priorYearExpenses, color: 'red' },
            { label: 'Net Profit', value: budgetSummary.netProfit, prior: budgetSummary.priorYearNetProfit, color: 'green' },
            { label: 'EBITDA', value: budgetSummary.ebitda, prior: budgetSummary.priorYearEbitda, color: 'purple' }
          ].map((item, idx) => {
            const change = ((item.value - item.prior) / item.prior) * 100;
            return (
              <div key={idx} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-medium text-gray-600">{item.label}</span>
                  <TrendingUp className={`text-${item.color}-500`} size={20} />
                </div>
                <div className="text-2xl font-bold text-gray-900 mb-2">
                  {formatCurrency(item.value)}
                </div>
                <div className="text-sm text-gray-500">
                  vs FY2024: {formatCurrency(item.prior)}
                </div>
                <div className={`text-sm font-semibold mt-2 ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}% YoY
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Budget Version Control */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">Version History:</span>
              <div className="flex items-center gap-2">
                {budgetVersions.map(version => (
                  <button
                    key={version.id}
                    className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                      version.isCurrent
                        ? 'bg-blue-100 border-blue-300 text-blue-700 font-semibold'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {version.name}
                  </button>
                ))}
              </div>
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
              <Save size={16} />
              Save as New Version
            </button>
          </div>
        </div>
      </div>

      {/* Main Budget Table */}
      <div className="max-w-[1800px] mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Monthly Budget Breakdown</h2>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <Edit2 size={14} />
                Click any cell to edit
              </span>
            </div>
          </div>
          <BudgetTable data={budgetData} onDataChange={setBudgetData} />
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Upload Budget Data</h3>
            <div className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <Upload size={48} className="mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-600 mb-2">
                  Drag and drop your Excel file here, or click to browse
                </p>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => setUploadedFile(e.target.files?.[0] || null)}
                  className="hidden"
                  id="file-upload"
                />
                <label
                  htmlFor="file-upload"
                  className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors"
                >
                  Choose File
                </label>
                {uploadedFile && (
                  <p className="text-sm text-green-600 mt-2">✓ {uploadedFile.name}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleFileUpload}
                  disabled={!uploadedFile}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Upload & Apply
                </button>
                <button
                  onClick={() => {
                    setShowUploadModal(false);
                    setUploadedFile(null);
                  }}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetManagement;
