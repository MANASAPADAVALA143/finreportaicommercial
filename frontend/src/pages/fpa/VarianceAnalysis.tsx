// FP&A Variance Analysis - Main Page
import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, ChevronDown, Upload, X, FileText, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { VarianceSummaryCards } from '../../components/fpa/VarianceSummaryCards';
import { VarianceTable } from '../../components/fpa/VarianceTable';
import { AICommentary } from '../../components/fpa/AICommentary';
import { AlertsPanel } from '../../components/fpa/AlertsPanel';
import {
  calculateKPISummaries,
  extractVarianceAlerts,
  getPeriodLabel,
  formatCurrency,
  LS_FPA_CURRENCY_KEY,
  LS_APP_CURRENCY_FALLBACK_KEY,
  LS_CURRENCY_FORMAT_KEY,
} from '../../utils/varianceUtils';
import type { PeriodType, CompareType, DepartmentType, CurrencyType, CurrencyFormatLocale } from '../../types/fpa';
import { postCfoAgentRun } from '../../services/cfoAgents';
import { useClient } from '../../context/ClientContext';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || '';
const DEFAULT_OWNER_BY_DEPARTMENT: Record<string, string> = {
  marketing: 'Head of Marketing',
  operations: 'Operations Director',
  finance: 'CFO',
  technology: 'CTO',
  sales: 'Sales Director',
  hr: 'HR Director',
  it: 'CTO',
  'all depts': 'CFO',
};

const buildFallbackTrend = (variancePct: number): number[] => {
  const drift = variancePct / 100;
  return Array.from({ length: 12 }, (_, i) => {
    const t = (i + 1) / 12;
    return Number((1 + drift * t).toFixed(4));
  });
};

const resolveOwner = (department: string): string => {
  const key = String(department || 'All Depts').trim().toLowerCase();
  return DEFAULT_OWNER_BY_DEPARTMENT[key] || 'CFO';
};

const scoreMateriality = (variance: number, variancePct: number, totalBudget: number) => {
  const pctFactor = Math.abs(variancePct) / 100;
  const absFactor = totalBudget > 0 ? Math.abs(variance) / totalBudget : 0;
  return pctFactor * 0.5 + absFactor * 0.5;
};

export const VarianceAnalysis = () => {
  const navigate = useNavigate();
  const { activeClient } = useClient();
  const tenantId = activeClient?.companyId || 'default';

  // No auto-load from localStorage — only data from this page's "Upload Data" is shown (clean for video)
  const [uploadedDataOnly, setUploadedDataOnly] = useState<any[]>([]);

  // Period Selection State
  const [periodType, setPeriodType] = useState<PeriodType>('monthly');
  const [month, setMonth] = useState(10); // October
  const [quarter, setQuarter] = useState(3);
  const [year] = useState(2025);
  const [compareType, setCompareType] = useState<CompareType>('budget');
  const [department, setDepartment] = useState<DepartmentType>('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [currency, setCurrency] = useState<CurrencyType>(() => {
    const stored = (localStorage.getItem(LS_FPA_CURRENCY_KEY) || localStorage.getItem(LS_APP_CURRENCY_FALLBACK_KEY) || 'USD').toUpperCase();
    if (['INR', 'USD', 'EUR', 'GBP', 'AED'].includes(stored)) return stored as CurrencyType;
    return 'USD';
  });
  const [currencyFormat, setCurrencyFormat] = useState<CurrencyFormatLocale>(() => {
    const stored = String(localStorage.getItem(LS_CURRENCY_FORMAT_KEY) || 'GLOBAL').toUpperCase();
    return stored === 'IN' ? 'IN' : 'GLOBAL';
  });

  // UI State
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const lastVarianceSyncKey = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem(LS_FPA_CURRENCY_KEY, currency);
  }, [currency]);

  useEffect(() => {
    localStorage.setItem(LS_CURRENCY_FORMAT_KEY, currencyFormat);
  }, [currencyFormat]);

  // Only data uploaded on this page — no localStorage, no demo data (clean for video)
  const currentVarianceData = useMemo(() => {
    const scoped = uploadedDataOnly.filter((row) => {
      if (row.isHeader) return true;
      const deptOk = department === 'all' || String(row.department || '').toLowerCase() === String(department).toLowerCase();
      const ownerOk = ownerFilter === 'all' || String(row.owner || '').toLowerCase() === ownerFilter.toLowerCase();
      return deptOk && ownerOk;
    });
    const headers = scoped.filter((r) => r.isHeader);
    const rows = scoped
      .filter((r) => !r.isHeader)
      .sort((a, b) => (b.materialityScore || 0) - (a.materialityScore || 0));
    return [...headers, ...rows];
  }, [uploadedDataOnly, department, ownerFilter]);

  // Recompute cards, table, and alerts when data or selected period (month/quarter/year) changes
  const kpiSummaries = useMemo(
    () => calculateKPISummaries(currentVarianceData),
    [currentVarianceData, month, quarter, year, periodType]
  );
  const alerts = useMemo(
    () => extractVarianceAlerts(currentVarianceData),
    [currentVarianceData, month, quarter, year, periodType]
  );

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

      // Helper: parse number from cell (handles commas and string numbers)
      const parseNum = (val: unknown): number => {
        if (val == null || val === '') return 0;
        if (typeof val === 'number' && !Number.isNaN(val)) return val;
        const s = String(val).replace(/,/g, '');
        const n = parseFloat(s);
        return Number.isNaN(n) ? 0 : n;
      };

      // BUG 2 FIX: Normalise scale (Lakhs vs Crores). If budget is 10x+ larger than actual, assume budget in Lakhs → convert to Crores.
      const normalise = (val: number, referenceVal: number): number => {
        if (referenceVal != null && referenceVal !== 0 && val > referenceVal * 50) return val / 100;
        return val;
      };

      const uploadCurrency = String(rows[0]?.Currency || rows[0]?.currency || '').toUpperCase();
      if (['INR', 'USD', 'EUR', 'GBP', 'AED'].includes(uploadCurrency)) {
        setCurrency(uploadCurrency as CurrencyType);
      }

      // Map uploaded data to VarianceRow format
      // Expected columns: Category, Actual, Budget, YTDActual, YTDBudget
      const baseMappedData = rows.flatMap((row, index) => {
        let actual = parseNum(row['Actual'] ?? row['actual'] ?? 0);
        let budget = parseNum(row['Budget'] ?? row['budget'] ?? 0);
        let priorYear = parseNum(row['Prior Year'] ?? row['priorYear'] ?? 0);
        const unitsActual = parseNum(row['Actual Units'] ?? row['actual_units'] ?? row['Units Actual'] ?? 0);
        const unitsBudget = parseNum(row['Budget Units'] ?? row['budget_units'] ?? row['Units Budget'] ?? 0);
        const actualPrice = parseNum(row['Actual Price'] ?? row['actual_price'] ?? 0);
        const budgetPrice = parseNum(row['Budget Price'] ?? row['budget_price'] ?? 0);
        // Apply scale normalisation: budget and priorYear to same scale as actual
        budget = normalise(budget, actual);
        priorYear = normalise(priorYear, actual);
        let ytdActual = parseNum(row['YTD Actual'] ?? row['YTDActual'] ?? row['ytdActual'] ?? actual * 6);
        let ytdBudget = parseNum(row['YTD Budget'] ?? row['YTDBudget'] ?? row['ytdBudget'] ?? budget * 6);
        ytdBudget = normalise(ytdBudget, ytdActual);
        const rawAccountType = String(
          row['Account_Type'] ??
          row['Account Type'] ??
          row['account_type'] ??
          row['accountType'] ??
          ''
        ).trim().toLowerCase();
        const category = String(row['Category'] || row['category'] || `Item ${index + 1}`);
        const categoryLower = category.toLowerCase();
        const inferredType: "income" | "expense" | "other" =
          rawAccountType.includes('income') || rawAccountType.includes('revenue')
            ? 'income'
            : rawAccountType.includes('expense') || rawAccountType.includes('cost')
              ? 'expense'
              : rawAccountType.includes('asset') || rawAccountType.includes('liability') || rawAccountType.includes('equity')
                ? 'other'
                : (/revenue|income|sales/.test(categoryLower) ? 'income' : /expense|cost|cogs|payroll|rent|marketing|admin|depreciation|interest/.test(categoryLower) ? 'expense' : 'other');

        // Exclude balance-sheet and unknown non-P&L accounts from variance logic.
        if (inferredType === 'other') return [];

        const variance = actual - budget;
        const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;
        const ytdVariance = ytdActual - ytdBudget;
        const ytdVariancePct = ytdBudget !== 0 ? (ytdVariance / ytdBudget) * 100 : 0;

        // Determine if favorable based on category
        const departmentName = String(row['Department'] || row['department'] || 'All Depts');
        const favorable = inferredType === 'income' ? variance > 0 : variance < 0;

        // Calculate threshold
        const absVariancePct = Math.abs(variancePct);
        const threshold = absVariancePct > 10 ? 'critical' : absVariancePct > 5 ? 'warning' : 'ok';

        let volumeImpact = 0;
        let priceImpact = 0;
        let mixImpact = 0;
        let decompNote = '';
        if (unitsActual > 0 && unitsBudget > 0 && actualPrice > 0 && budgetPrice > 0) {
          volumeImpact = (unitsActual - unitsBudget) * budgetPrice;
          priceImpact = (actualPrice - budgetPrice) * unitsActual;
          mixImpact = variance - volumeImpact - priceImpact;
          decompNote = 'Unit/price-based decomposition';
        } else {
          const revGrowthPct = budget !== 0 ? ((actual - budget) / budget) : 0;
          volumeImpact = revGrowthPct * budget;
          priceImpact = variance - volumeImpact;
          mixImpact = 0;
          decompNote = 'Proxy decomposition (units not provided)';
        }

        return [{
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
          priorYear,
          priorYearVariancePct: 0,
          hasChildren: false,
          isExpanded: false,
          threshold: threshold as 'critical' | 'warning' | 'ok',
          level: 0,
          department: departmentName,
          owner: resolveOwner(departmentName),
          trend: buildFallbackTrend(variancePct),
          decomposition: {
            volume: volumeImpact,
            price: priceImpact,
            mix: mixImpact,
            note: decompNote,
          },
          accountType: inferredType,
        }];
      });

      const totalBudget = baseMappedData.filter((r) => !r.isHeader).reduce((sum, r) => sum + r.budget, 0);
      const mappedData = baseMappedData.map((r) => {
        const score = scoreMateriality(r.variance, r.variancePct, totalBudget);
        const materialityBand = score > 0.15 ? 'critical' : score >= 0.05 ? 'monitor' : 'low';
        return {
          ...r,
          materialityScore: score,
          materialityBand,
        };
      });

      setUploadedDataOnly(mappedData);
      setShowUploadModal(false);
      alert(`✅ Successfully uploaded ${mappedData.length} variance items!`);
    } catch (error: any) {
      alert('❌ Failed to upload file: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = () => {
    // Empty template for upload — no demo data (clean for video / production)
    const templateData = [
      ['Variance Analysis Upload Template'],
      ['Fill in your variance data below. Required columns: Category, Actual, Budget'],
      [],
      ['Category', 'Actual', 'Budget', 'YTD Actual', 'YTD Budget', 'Prior Year', 'Is Header'],
      ['', 0, 0, 0, 0, 0, 'FALSE']
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

      // Sheet 3: Department Breakdown (empty — no demo data)
      const deptData = [
        ['DEPARTMENT VARIANCE ANALYSIS'],
        ['Period:', periodLabel],
        [],
        ['Department', 'Actual', 'Budget', 'Variance', 'Variance %', 'Status']
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
  const revenueContext = useMemo(() => {
    const rows = currentVarianceData.filter((r) => !r.isHeader);
    const revenueRows = rows.filter((r) => r.accountType === 'income' || /revenue|sales|income/i.test(r.category));
    const cogsRows = rows.filter((r) => r.accountType === 'expense' && /cogs|cost of sales|cost of goods/i.test(r.category));
    const revBudget = revenueRows.reduce((s, r) => s + r.budget, 0);
    const revActual = revenueRows.reduce((s, r) => s + r.actual, 0);
    const cogsBudget = cogsRows.reduce((s, r) => s + r.budget, 0);
    const cogsActual = cogsRows.reduce((s, r) => s + r.actual, 0);
    const gmBudget = revBudget > 0 ? ((revBudget - cogsBudget) / revBudget) * 100 : 0;
    const gmActual = revActual > 0 ? ((revActual - cogsActual) / revActual) * 100 : 0;
    const erosion = gmActual - gmBudget;
    return {
      revBudget,
      revActual,
      revVariance: revActual - revBudget,
      revVariancePct: revBudget > 0 ? ((revActual - revBudget) / revBudget) * 100 : 0,
      cogsVariance: cogsActual - cogsBudget,
      gmBudget,
      gmActual,
      erosion,
    };
  }, [currentVarianceData]);

  const ownerOptions = useMemo(() => {
    const set = new Set(
      uploadedDataOnly
        .filter((r) => !r.isHeader)
        .map((r) => String(r.owner || '').trim())
        .filter(Boolean)
    );
    return ['all', ...Array.from(set)];
  }, [uploadedDataOnly]);

  const varianceClassification = useMemo(() => {
    const rows = currentVarianceData.filter((r) => !r.isHeader);
    const revenueRows = rows.filter((r) => r.accountType === 'income');
    const expenseRows = rows.filter((r) => r.accountType === 'expense');
    const revenueBudget = revenueRows.reduce((s, r) => s + r.budget, 0);
    const revenueActual = revenueRows.reduce((s, r) => s + r.actual, 0);
    const costBudget = expenseRows.reduce((s, r) => s + r.budget, 0);
    const costActual = expenseRows.reduce((s, r) => s + r.actual, 0);
    const netBudget = revenueBudget - costBudget;
    const netActual = revenueActual - costActual;
    const revenuePct = revenueBudget !== 0 ? ((revenueActual - revenueBudget) / revenueBudget) * 100 : 0;
    const costPct = costBudget !== 0 ? ((costActual - costBudget) / costBudget) * 100 : 0;
    const cogsBudget = expenseRows
      .filter((r) => /cogs|cost of sales|cost of goods/i.test(r.category))
      .reduce((s, r) => s + r.budget, 0);
    const cogsActual = expenseRows
      .filter((r) => /cogs|cost of sales|cost of goods/i.test(r.category))
      .reduce((s, r) => s + r.actual, 0);
    const budgetCogsPct = revenueBudget > 0 ? (cogsBudget / revenueBudget) * 100 : 0;
    const actualCogsPct = revenueActual > 0 ? (cogsActual / revenueActual) * 100 : 0;
    const status =
      revenuePct > costPct && netActual > netBudget
        ? 'High Growth with Margin Expansion'
        : revenueActual >= revenueBudget && costActual > costBudget
          ? 'Growth with Margin Pressure'
          : revenueActual < revenueBudget && costActual > costBudget
            ? 'Underperforming'
            : 'Contracting';
    return {
      revenueBudget, revenueActual, revenuePct,
      costBudget, costActual, costPct,
      netBudget, netActual,
      budgetCogsPct, actualCogsPct,
      status,
    };
  }, [currentVarianceData]);

  const topCostOverruns = useMemo(
    () =>
      currentVarianceData
        .filter((r) => !r.isHeader && r.accountType === 'expense' && r.actual > r.budget)
        .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
        .slice(0, 3),
    [currentVarianceData]
  );
  const topFavorableVariances = useMemo(
    () =>
      currentVarianceData
        .filter((r) => !r.isHeader && ((r.accountType === 'income' && r.actual > r.budget) || (r.accountType === 'expense' && r.actual < r.budget)))
        .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
        .slice(0, 3),
    [currentVarianceData]
  );

  const runAnalysisSyncCommandCenter = async () => {
    if (!API_BASE || !currentVarianceData.length) return;
    try {
      const deptLabel = department === 'all' ? 'All Depts' : String(department);
      const line_items = currentVarianceData
        .filter((row) => !row.isHeader)
        .map((row) => ({
          account: row.category,
          department: deptLabel,
          budget: row.budget,
          actual: row.actual,
        }));
      await postCfoAgentRun(
        'fpa_variance',
        {
          line_items,
          period: periodLabel,
          company_id: tenantId,
        },
        tenantId
      );
      console.info('[CFO] fpa_variance synced silently');
    } catch (e: unknown) {
      console.warn('[CFO] fpa_variance sync failed', e);
    }
  };

  useEffect(() => {
    if (!API_BASE || !currentVarianceData.length) return;
    const rows = currentVarianceData.filter((r) => !r.isHeader);
    if (!rows.length) return;
    const totalBudget = rows.reduce((s, r) => s + (Number(r.budget) || 0), 0);
    const totalActual = rows.reduce((s, r) => s + (Number(r.actual) || 0), 0);
    const key = `${tenantId}:${rows.length}:${totalBudget.toFixed(2)}:${totalActual.toFixed(2)}`;
    if (lastVarianceSyncKey.current === key) return;
    lastVarianceSyncKey.current = key;
    void runAnalysisSyncCommandCenter();
  }, [currentVarianceData, tenantId, API_BASE, department]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
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

            {/* Owner Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Owner:</label>
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {ownerOptions.map((o) => (
                  <option key={o} value={o}>
                    {o === 'all' ? 'All Owners' : o}
                  </option>
                ))}
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
                <option value="USD">USD ($)</option>
                <option value="INR">INR (₹)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="AED">AED (د.إ)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Currency Format:</label>
              <select
                value={currencyFormat}
                onChange={(e) => setCurrencyFormat(e.target.value as CurrencyFormatLocale)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="GLOBAL">GLOBAL ($/£ + M/K)</option>
                <option value="IN">IN (₹ + L/Cr)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1600px] mx-auto px-6 py-8">
        {currentVarianceData.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-600 text-lg mb-2">No variance data yet</p>
            <p className="text-gray-500 text-sm mb-6">Use the Upload Data button above to add your variance file and see the analysis.</p>
            <button
              onClick={() => setShowUploadModal(true)}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
            >
              Upload Data
            </button>
          </div>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Content Area (3 columns) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Revenue linkage context */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-base font-bold text-gray-900 mb-3">Revenue & Gross Margin Context</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
                  <p className="text-xs text-blue-700 font-semibold">Revenue Actual vs Budget</p>
                  <p className="text-sm text-gray-900 mt-1">
                    {formatCurrency(revenueContext.revActual, currency, currencyFormat)} vs {formatCurrency(revenueContext.revBudget, currency, currencyFormat)}
                  </p>
                  <p className={`text-sm font-semibold ${revenueContext.revVariance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {revenueContext.revVariancePct >= 0 ? '▲' : '▼'} {Math.abs(revenueContext.revVariancePct).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-lg bg-purple-50 border border-purple-100 p-3">
                  <p className="text-xs text-purple-700 font-semibold">Gross Margin (Actual vs Budget)</p>
                  <p className="text-sm text-gray-900 mt-1">{revenueContext.gmActual.toFixed(1)}% vs {revenueContext.gmBudget.toFixed(1)}%</p>
                  <p className={`text-sm font-semibold ${revenueContext.erosion >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {revenueContext.erosion >= 0 ? 'Improved' : 'Eroded'} {Math.abs(revenueContext.erosion).toFixed(1)} pts
                  </p>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
                  <p className="text-xs text-amber-700 font-semibold">Gross Margin Impact</p>
                  <p className="text-sm text-gray-900 mt-1">
                    {revenueContext.erosion < 0
                      ? `Gross margin eroded by ${Math.abs(revenueContext.erosion).toFixed(1)} pts as COGS rose faster than revenue`
                      : `Gross margin improved by ${Math.abs(revenueContext.erosion).toFixed(1)} pts`}
                  </p>
                </div>
              </div>
            </div>

            {/* KPI Summary Cards */}
            <VarianceSummaryCards summaries={kpiSummaries} currency={currency} currencyFormat={currencyFormat} />

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-base font-bold text-gray-900 mb-3">Variance Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg bg-green-50 border border-green-100 p-3">
                  <p className="font-semibold text-green-800">Revenue Performance</p>
                  <p>Actual {formatCurrency(varianceClassification.revenueActual, currency, currencyFormat)} vs Budget {formatCurrency(varianceClassification.revenueBudget, currency, currencyFormat)}</p>
                  <p className="font-semibold text-green-700">{varianceClassification.revenuePct >= 0 ? '+' : ''}{varianceClassification.revenuePct.toFixed(1)}% (favorable when positive)</p>
                </div>
                <div className="rounded-lg bg-red-50 border border-red-100 p-3">
                  <p className="font-semibold text-red-800">Cost Performance</p>
                  <p>Actual {formatCurrency(varianceClassification.costActual, currency, currencyFormat)} vs Budget {formatCurrency(varianceClassification.costBudget, currency, currencyFormat)}</p>
                  <p className="font-semibold text-red-700">{varianceClassification.costPct >= 0 ? '+' : ''}{varianceClassification.costPct.toFixed(1)}% (over budget when positive)</p>
                </div>
                <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
                  <p className="font-semibold text-blue-800">Profit/Margin Impact</p>
                  <p>Net Profit {formatCurrency(varianceClassification.netActual, currency, currencyFormat)} vs {formatCurrency(varianceClassification.netBudget, currency, currencyFormat)}</p>
                  <p className="font-semibold text-blue-700">COGS% {varianceClassification.actualCogsPct.toFixed(1)}% vs {varianceClassification.budgetCogsPct.toFixed(1)}%</p>
                </div>
              </div>
              <p className="mt-3 text-sm font-semibold text-gray-800">Status: {varianceClassification.status}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <p className="text-sm font-semibold text-red-700 mb-2">Expense Variance Drivers</p>
                  <ul className="text-sm text-gray-700 space-y-1">
                    {topCostOverruns.length ? topCostOverruns.map((r) => (
                      <li key={`over-${r.id}`}>{r.category}: {r.variancePct.toFixed(1)}% over budget</li>
                    )) : <li>No material overruns</li>}
                  </ul>
                </div>
                <div>
                  <p className="text-sm font-semibold text-green-700 mb-2">Favorable Variances</p>
                  <ul className="text-sm text-gray-700 space-y-1">
                    {topFavorableVariances.length ? topFavorableVariances.map((r) => (
                      <li key={`fav-${r.id}`}>{r.category}: {Math.abs(r.variancePct).toFixed(1)}% {r.accountType === 'income' ? 'above budget' : 'under budget'}</li>
                    )) : <li>No favorable variances</li>}
                  </ul>
                </div>
              </div>
            </div>

            {/* Variance Table */}
            <VarianceTable data={currentVarianceData} currency={currency} currencyFormat={currencyFormat} />

            {/* AI Commentary */}
            <AICommentary
              varianceData={currentVarianceData}
              period={periodLabel}
              entityName={activeClient?.name || 'FinReport AI'}
              currency={currency}
              currencyFormat={currencyFormat}
            />
          </div>

          {/* Sidebar (1 column) */}
          <div className="lg:col-span-1">
            <div className="sticky top-24">
              <AlertsPanel alerts={alerts} currency={currency} currencyFormat={currencyFormat} />
            </div>
          </div>
        </div>
        )}
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
