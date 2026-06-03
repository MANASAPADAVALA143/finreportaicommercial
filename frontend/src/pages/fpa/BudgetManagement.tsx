import React, { useState, useEffect, useCallback } from 'react';
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
  Edit2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import BudgetTable from '../../components/fpa/BudgetTable';
import { budgetVersions, departmentBudgets, budgetSummary } from '../../data/budgetMockData';
import { BudgetLineItem, BudgetStatus, BudgetApproach, MonthlyBudget } from '../../types/budget';
import { callAI } from '../../services/aiProvider';
import { loadFPABudget, loadFPAPriorYear, checkDataAvailability, getMissingDataMessage, convertBudgetToLineItems } from '../../utils/fpaDataLoader';
import { postCfoAgentRun } from '../../services/cfoAgents';
import { useClient } from '../../context/ClientContext';

const SELECTED_BUDGET_PERIOD = 'FY2025';
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  GBP: '£',
  EUR: '€',
  INR: '₹',
  AED: 'د.إ',
};

function sumMonthlyBudget(m?: MonthlyBudget): number {
  if (!m) return 0;
  return Object.values(m).reduce((s, v) => s + (Number(v) || 0), 0);
}

function inferDepartmentFromCategory(category: string, existing?: string): string {
  if (existing && String(existing).trim()) return String(existing);
  const c = category.toLowerCase();
  if (/marketing|advert/i.test(c)) return 'Marketing';
  if (/hr|payroll|benefit|people/i.test(c)) return 'HR';
  if (/\bit\b|technology|software/i.test(c)) return 'IT';
  if (/sales|revenue|domestic|export|service/i.test(c)) return 'Sales';
  if (/operat|raw material|direct labor|cogs|cost of/i.test(c)) return 'Operations';
  if (/financ|admin|audit/i.test(c)) return 'Finance';
  return 'General';
}

function sumByKeywords(rows: BudgetLineItem[], keywords: RegExp): number {
  return rows
    .filter((r) => !r.isHeader)
    .filter((r) => {
      const label = `${r.category || ''} ${(r as BudgetLineItem & { lineItem?: string }).lineItem || ''}`.toLowerCase();
      return keywords.test(label);
    })
    .reduce((s, r) => s + sumMonthlyBudget(r.monthly), 0);
}

function buildBudgetCfoLineItems(rows: BudgetLineItem[]) {
  return rows
    .filter((r) => !r.isHeader)
    .map((r) => {
      const anyRow = r as BudgetLineItem & { fy2024Actual?: number; lineItem?: string };
      const prior = Number(anyRow.priorYearActual ?? anyRow.fy2024Actual ?? 0) || 0;
      const dept = inferDepartmentFromCategory(r.category, r.department);
      const account = String(anyRow.lineItem || r.category || 'Line');
      return {
        account,
        department: dept,
        budget: prior,
        actual: sumMonthlyBudget(r.monthly),
      };
    })
    .filter((x) => x.budget > 0 || x.actual > 0);
}

const BudgetManagement: React.FC = () => {
  const navigate = useNavigate();
  const { activeClient } = useClient();
  const tenantId = activeClient?.companyId || 'default';
  
  // Check data availability
  const dataCheck = checkDataAvailability(['fpa_budget']);
  const [budgetDataFromStorage, setBudgetDataFromStorage] = useState<any>(null);
  const [priorYearData, setPriorYearData] = useState<any>(null);

  useEffect(() => {
    // Read from fpa_budget (master upload) or fpa_actual as fallback
    const budget = loadFPABudget() || loadFPAActual();
    const prior  = loadFPAPriorYear();
    if (!budget) return;
    setBudgetDataFromStorage(budget);
    setPriorYearData(prior);
    // convertBudgetToLineItems now has a fast path for lineItems arrays
    const converted = convertBudgetToLineItems(budget) as BudgetLineItem[];
    if (converted.length > 0) {
      setBudgetData(converted);
    }
  }, []);
  
  const [budgetData, setBudgetData] = useState<BudgetLineItem[]>([]);
  const [currentStatus, setCurrentStatus] = useState<BudgetStatus>('Approved');
  const [budgetApproach, setBudgetApproach] = useState<BudgetApproach>('Bottom-Up');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('All Departments');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [cfoSyncing, setCfoSyncing] = useState(false);
  const displayCurrency = (localStorage.getItem('fpa_currency') || 'USD').toUpperCase();

  const syncBudgetToCommandCenter = useCallback(async () => {
    const line_items = buildBudgetCfoLineItems(budgetData);
    if (line_items.length === 0) {
      console.warn('[CFO] fpa_budget: no line items to sync');
      return;
    }
    await postCfoAgentRun(
      'fpa_budget',
      {
        line_items,
        overspend_threshold_pct: 15,
        period: SELECTED_BUDGET_PERIOD,
        company_id: tenantId,
      },
      tenantId
    );
  }, [budgetData, tenantId]);

  const formatCurrency = (value: number): string => {
    const symbol = CURRENCY_SYMBOL[displayCurrency] || '$';
    const abs = Math.abs(Number(value) || 0);
    if (displayCurrency === 'INR') {
      const crore = value / 10000000;
      return `${symbol}${crore.toFixed(2)}Cr`;
    }
    if (abs >= 1000000) return `${symbol}${(value / 1000000).toFixed(2)}M`;
    if (abs >= 1000) return `${symbol}${(value / 1000).toFixed(1)}K`;
    return `${symbol}${Math.round(value).toLocaleString()}`;
  };

  // Compute summary cards from budgetData when we have line items; otherwise use mock
  const computedSummary = React.useMemo(() => {
    if (!budgetData || budgetData.length === 0) return null;
    const isRevenueRow = (item: BudgetLineItem) => {
      if (item.isHeader) return false;
      const accType = String((item as any).accountType || '').toLowerCase();
      if (accType === 'income' || accType === 'revenue') return true;
      if (accType === 'expense' || accType === 'cost') return false;
      const name = String(item.category || (item as any).lineItem || '').toLowerCase();
      return (/^(total\s+)?(revenue|income|sales|license|service|subscri|maintenance|support.*rev)/i.test(name)
        && !/cost|expense|salary|commission/i.test(name));
    };
    const isExpenseRow = (item: BudgetLineItem) => {
      if (item.isHeader) return false;
      const accType = String((item as any).accountType || '').toLowerCase();
      if (accType === 'expense' || accType === 'cost') return true;
      if (accType === 'income' || accType === 'revenue') return false;
      const name = String(item.category || (item as any).lineItem || '').toLowerCase();
      // Broad match: cost/expense items, cloud, infra, staff, etc.
      return /expense|cost|cogs|payroll|marketing|admin|depreciation|operating|salary|salaries|cloud|infra|staff|overhead|interest|support.staff|implementation.staff/i.test(name);
    };
    const sumMonthly = (item: BudgetLineItem) =>
      Object.values(item.monthly || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    const totalRevenue = budgetData.filter(isRevenueRow).reduce((s, r) => s + sumMonthly(r), 0);
    const totalExpenses = budgetData.filter(isExpenseRow).reduce((s, r) => s + sumMonthly(r), 0);
    const fallbackRevenue = Number(budgetDataFromStorage?.totalRevenue || 0) || 0;
    const resolvedRevenue = totalRevenue > 0 ? totalRevenue : fallbackRevenue;
    const addBackTax =
      Number(budgetDataFromStorage?.corporationTax || 0) +
      Number(budgetDataFromStorage?.deferredTax || 0);
    const addBackInterest =
      Number(budgetDataFromStorage?.loanInterest || 0) +
      Number(budgetDataFromStorage?.leaseInterest || 0) +
      Number(budgetDataFromStorage?.interestExpense || 0);
    const addBackDA =
      Number(budgetDataFromStorage?.depreciationPpe || 0) +
      Number(budgetDataFromStorage?.amortisation || budgetDataFromStorage?.amortization || 0) +
      Number(budgetDataFromStorage?.depreciationRou || 0) +
      Number(budgetDataFromStorage?.depreciation || 0);
    const addBackFromRows =
      sumByKeywords(budgetData, /(corporation tax|deferred tax)/i) +
      sumByKeywords(budgetData, /(loan interest|lease interest|\binterest\b)/i) +
      sumByKeywords(budgetData, /(depreciation|amorti[sz]ation)/i);
    const resolvedNetProfit = resolvedRevenue - totalExpenses;
    const resolvedEbitda = resolvedNetProfit + Math.max(addBackTax + addBackInterest + addBackDA, addBackFromRows);
    const priorRevenue = Number(priorYearData?.totalRevenue || 0) || budgetSummary.priorYearRevenue;
    const priorExpenses =
      Number(priorYearData?.costOfGoodsSold || 0) +
      Number(priorYearData?.totalOperatingExpenses || 0) ||
      budgetSummary.priorYearExpenses;
    const priorNetProfit = priorRevenue - priorExpenses;
    const priorEbitda =
      priorNetProfit +
      Number(priorYearData?.corporationTax || 0) +
      Number(priorYearData?.deferredTax || 0) +
      Number(priorYearData?.loanInterest || priorYearData?.interestExpense || 0) +
      Number(priorYearData?.leaseInterest || 0) +
      Number(priorYearData?.depreciationPpe || priorYearData?.depreciation || 0) +
      Number(priorYearData?.amortisation || priorYearData?.amortization || 0) +
      Number(priorYearData?.depreciationRou || 0);
    return {
      totalRevenue: resolvedRevenue,
      totalExpenses,
      netProfit: resolvedNetProfit,
      ebitda: resolvedEbitda,
      priorYearRevenue: priorRevenue,
      priorYearExpenses: priorExpenses,
      priorYearNetProfit: priorNetProfit,
      priorYearEbitda: priorEbitda || priorNetProfit
    };
  }, [budgetData, budgetDataFromStorage, priorYearData]);

  const displaySummary = computedSummary || budgetSummary;

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
    if (newStatus === 'Approved') {
      void syncBudgetToCommandCenter().catch((e) =>
        console.warn('[CFO] fpa_budget sync failed', e)
      );
    }
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
    if (!uploadedFile) { alert('⚠️ Please select a file first'); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames.find(n => /budget|monthly|upload/i.test(n)) || workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Smart header detection — skip title/instruction rows (same as variance parser)
        const rawAll: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
        const HDR_RE = /^(line.?item|category|account|name|description|q1|q2|q3|q4|jan|feb|mar|annual|budget)/i;
        let headerRowIdx = 0;
        for (let i = 0; i < Math.min(5, rawAll.length); i++) {
          const vals = rawAll[i].map((v: any) => String(v ?? '').trim());
          if (vals.filter((v: string) => HDR_RE.test(v)).length >= 2) { headerRowIdx = i; break; }
        }
        const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerRowIdx });
        if (rows.length === 0) { alert('❌ No data rows found.'); return; }

        const header = Object.keys(rows[0]);

        // Find key columns
        const findCol = (re: RegExp) => header.find(h => re.test(h.trim())) ?? null;
        const categoryCol = findCol(/^(line.?item|category|account|name|description)/i);
        const deptCol     = findCol(/^department|dept/i);
        const ownerCol    = findCol(/^owner|responsible/i);
        const annualCol   = findCol(/annual.?budget|fy.*total|total.*budget|annual/i);
        const priorCol    = findCol(/fy.*actual|prior.*year|last.*year|actual.*fy/i);

        if (!categoryCol) { alert(`❌ Could not find a "Line Item" or "Category" column.\nFound: ${header.join(', ')}`); return; }

        const parseNum = (val: any): number => {
          if (val == null || val === '') return 0;
          const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
          return isNaN(n) ? 0 : n;
        };

        // Quarterly columns → expand to monthly (3 months each)
        const monthColToKey: Record<string, (keyof MonthlyBudget)[]> = {
          'jan': ['jan'], 'feb': ['feb'], 'mar': ['mar'], 'apr': ['apr'],
          'may': ['may'], 'jun': ['jun'], 'jul': ['jul'], 'aug': ['aug'],
          'sep': ['sep'], 'oct': ['oct'], 'nov': ['nov'], 'dec': ['dec'],
        };
        // Q1-Q4 mapping depends on whether calendar year (Q1=Jan-Mar) or fiscal year (Q1=Apr-Jun)
        // Default to calendar year; detect from column names
        const isCalendarYear = !header.some(h => /q1.*apr|apr.*q1/i.test(h));
        const qToMonths: Record<string, (keyof MonthlyBudget)[]> = isCalendarYear
          ? { q1: ['jan','feb','mar'], q2: ['apr','may','jun'], q3: ['jul','aug','sep'], q4: ['oct','nov','dec'] }
          : { q1: ['apr','may','jun'], q2: ['jul','aug','sep'], q3: ['oct','nov','dec'], q4: ['jan','feb','mar'] };

        const lineItems: BudgetLineItem[] = [];
        let totalRevenue = 0, totalExpenses = 0, totalPriorRevenue = 0;

        for (const row of rows) {
          const category = String((row as any)[categoryCol] ?? '').trim();
          if (!category || /^(line item|category|account)/i.test(category)) continue;

          const monthly: MonthlyBudget = { jan:0,feb:0,mar:0,apr:0,may:0,jun:0,jul:0,aug:0,sep:0,oct:0,nov:0,dec:0 };
          let annualBudget = annualCol ? parseNum((row as any)[annualCol]) : 0;
          const priorActual = priorCol ? parseNum((row as any)[priorCol]) : 0;

          // Map monthly columns
          header.forEach(h => {
            const norm = h.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
            const monthKeys = monthColToKey[norm] || qToMonths[norm.replace(/budget|q/g,'').replace(/^\s+/,'').replace(/q(\d)/,'q$1')]
              || qToMonths[norm.match(/q[1-4]/)?.[0] ?? ''];
            if (monthKeys) {
              const val = parseNum((row as any)[h]) / (monthKeys.length || 1);
              monthKeys.forEach(mk => { monthly[mk] = val; });
            }
          });

          // If we have annual budget but no monthly, distribute evenly
          if (annualBudget > 0 && Object.values(monthly).every(v => v === 0)) {
            const perMonth = annualBudget / 12;
            (Object.keys(monthly) as (keyof MonthlyBudget)[]).forEach(k => { monthly[k] = perMonth; });
          }
          if (annualBudget === 0) {
            annualBudget = Object.values(monthly).reduce((s, v) => s + v, 0);
          }

          const isRevenue = /revenue|sales|income|subscri|implement|support.*maint/i.test(category)
            && !/cost|expense|salary|commission/i.test(category);
          const isExpense = /cost|expense|salary|salaries|cloud|infra|marketing|admin|overhead|payroll/i.test(category);
          if (isRevenue) { totalRevenue += annualBudget; totalPriorRevenue += priorActual; }
          if (isExpense) totalExpenses += annualBudget;

          lineItems.push({
            id: `upload-${lineItems.length}-${category.slice(0,20).replace(/\s/g,'-')}`,
            category,
            isHeader: /^(revenue|cost of revenue|operating exp|gross profit|ebitda|total)/i.test(category) && annualBudget === 0,
            isEditable: true,
            monthly,
            priorYearActual: priorActual,
            indent: 0,
            ...(deptCol  ? { department: String((row as any)[deptCol]  ?? '') } : {}),
            ...(ownerCol ? { owner:      String((row as any)[ownerCol] ?? '') } : {}),
          } as BudgetLineItem);
        }

        if (lineItems.length === 0) { alert('❌ No valid rows found. Check your file format.'); return; }

        // Save to localStorage — include FULL monthly data so Forecasting + Budget modules work
        const budgetPayload = {
          totalRevenue,
          totalExpenses,
          netProfit: totalRevenue - totalExpenses,
          ebitda: (totalRevenue - totalExpenses) * 1.15,
          priorYearRevenue: totalPriorRevenue,
          rowCount: lineItems.length,
          lineItems: lineItems.map(r => ({
            account: r.category,
            category: r.category,
            budget: Object.values(r.monthly).reduce((s, v) => s + v, 0),
            monthly: r.monthly,            // ← full monthly breakdown
            monthlyBudgets: Object.values(r.monthly),
            accountType: isRevenue(r.category) ? 'income' : isExpense(r.category) ? 'expense' : 'other',
            department: (r as any).department || 'All Depts',
            owner: (r as any).owner || 'CFO',
            priorYearActual: r.priorYearActual || 0,
          })),
          uploadedAt: new Date().toISOString(),
          fileName: uploadedFile!.name,
        };

        function isRevenue(cat: string) {
          return /^(total\s+)?(revenue|income|sales|license|service|subscri|maintenance|support.*rev)/i.test(cat)
            && !/cost|expense|salary|commission/i.test(cat);
        }
        function isExpense(cat: string) {
          return /cost|expense|salary|salaries|cloud|infra|marketing|admin|overhead|payroll|depreciation|interest|staff/i.test(cat);
        }
        localStorage.setItem('fpa_budget', JSON.stringify(budgetPayload));
        localStorage.setItem('fpa_budget_tb', JSON.stringify(budgetPayload));
        localStorage.setItem('fpa_currency', 'AED');

        setBudgetData(lineItems);
        setShowUploadModal(false);
        setUploadedFile(null);
        alert(`✅ Loaded ${lineItems.length} budget line items from "${uploadedFile!.name}".\n\nRevenue: AED ${(totalRevenue/1000000).toFixed(1)}M | Expenses: AED ${(totalExpenses/1000000).toFixed(1)}M\n\nData saved — Forecasting Engine will now use these figures.`);
      } catch (error: any) {
        alert('❌ Failed to parse file: ' + (error?.message || String(error)));
      }
    };
    reader.readAsArrayBuffer(uploadedFile);
  };

  const handleAISuggestion = async () => {
    setAiSuggesting(true);
    try {
      const totalRevActual  = budgetData.filter((r: any) => /revenue|income/i.test(r.category || r.name || '')).reduce((s: number, r: any) => s + (r.annual || 0), 0) || 42000000;
      const totalExpActual  = budgetData.filter((r: any) => /cost|expense|salary|salaries/i.test(r.category || r.name || '')).reduce((s: number, r: any) => s + (r.annual || 0), 0) || 35000000;
      const netProfit       = totalRevActual - totalExpActual;
      const prompt = `
You are a financial planning expert for ${displayCurrency === 'AED' ? 'a UAE technology company (Al Futtaim Digital Services LLC)' : 'a technology company'}.
Based on FY2025 actuals, suggest a budget for FY2026. All amounts in ${displayCurrency}.

FY2025 Actuals:
- Total Revenue: ${formatCurrency(totalRevActual)}
- Total Expenses: ${formatCurrency(totalExpActual)}
- Net Profit: ${formatCurrency(netProfit)}
- EBITDA (est.): ${formatCurrency(netProfit * 1.15)}
${displayCurrency === 'AED' ? '- Key clients: ADNOC Digital, Emirates NBD, Emaar Properties, DEWA\n- UAE VAT rate: 5%' : ''}

Provide budget recommendations for FY2026 with:
1. Revenue growth % (consider UAE/regional market trends)
2. Cost optimisation areas (headcount, cloud, marketing)
3. Department-wise allocation suggestions
4. Key risks and assumptions

Format as a structured commentary using ${displayCurrency} currency.
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
      {dataCheck.available && budgetDataFromStorage && (
        <div className="bg-green-50 border-b border-green-200 px-6 py-3 rounded-lg mb-4">
          <div className="max-w-[1800px] mx-auto text-sm text-green-800">
            ✅ Data loaded from FP&A Suite upload (Budget TB — {Number(budgetDataFromStorage.rowCount || budgetData.length || 0)} accounts)
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

      {/* Budget Summary Cards — computed from budget data when available */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { label: 'Total Revenue', value: displaySummary.totalRevenue, prior: displaySummary.priorYearRevenue, color: 'blue' },
            { label: 'Total Expenses', value: displaySummary.totalExpenses, prior: displaySummary.priorYearExpenses, color: 'red' },
            { label: 'Net Profit', value: displaySummary.netProfit, prior: displaySummary.priorYearNetProfit, color: 'green' },
            { label: 'EBITDA', value: displaySummary.ebitda, prior: displaySummary.priorYearEbitda, color: 'purple' }
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
            <button
              type="button"
              disabled={cfoSyncing || budgetData.length === 0}
              onClick={() => {
                setCfoSyncing(true);
                void syncBudgetToCommandCenter()
                  .then(() => console.info('[CFO] fpa_budget synced silently'))
                  .catch((e: unknown) => console.warn('[CFO] fpa_budget sync failed', e))
                  .finally(() => setCfoSyncing(false));
              }}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              <Save size={16} />
              {cfoSyncing ? 'Syncing…' : 'Save as New Version'}
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
          <p className="text-xs text-gray-500 mb-3">
            * Monthly figures are annual budget / 12 (equal spread). Click any cell to adjust individual months.
          </p>
          <BudgetTable data={budgetData} onDataChange={setBudgetData} currency={displayCurrency} />
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
