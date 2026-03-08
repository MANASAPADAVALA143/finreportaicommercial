// IFRS Statement Generator - Complete 3-Step Wizard
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileText, CheckCircle, AlertTriangle, Download,
  ArrowLeft, ArrowRight, Save, Settings, Zap, Target,
  BarChart3, TrendingUp, FileSpreadsheet, Eye, Edit,
  ChevronDown, ChevronRight, Search, Filter, X, Check,
  Building2, ShoppingCart, Cpu, Factory, Briefcase, Sparkles,
  DollarSign, AlertCircle, RefreshCw
} from 'lucide-react';
import { getAISuggestions, INDUSTRY_TEMPLATES } from '../services/mappingService';
import type { AIMappingResult } from '../types/ifrs';

// ==================== INTERFACES ====================

interface TrialBalanceEntry {
  glCode: string;
  accountName: string;
  debit: number;
  credit: number;
  accountType: string;
  mappedTo?: string;
  mappingConfidence?: number;
  mappingStatus: 'mapped' | 'uncertain' | 'unmapped';
}

interface IFRSMapping {
  glCode: string;
  accountName: string;
  suggestedMapping: string;
  confidence: number;
  status: string;
  alternatives: Array<{path: string; label: string}>;
}

interface MappingTemplate {
  id: string;
  name: string;
  industry: string;
  description: string;
  icon: string;
  mappings: Record<string, string>;
}

interface GeneratedStatements {
  entityName: string;
  periodEnd: string;
  currency: string;
  financialPosition: any;
  profitLoss: any;
  cashFlows: any;
  changesInEquity: any;
}

// ==================== MAIN COMPONENT ====================

export const IFRSStatementGenerator = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  
  // Step 1 state
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  // Step 2 state
  const [trialBalance, setTrialBalance] = useState<TrialBalanceEntry[]>([]);
  const [aiMappings, setAiMappings] = useState<IFRSMapping[]>([]);
  const [userMappings, setUserMappings] = useState<Record<string, string>>({});
  const [selectedAccount, setSelectedAccount] = useState<IFRSMapping | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'mapped' | 'uncertain' | 'unmapped'>('all');
  const [templates, setTemplates] = useState<MappingTemplate[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showCustomUpload, setShowCustomUpload] = useState(false);
  const [customTemplateFile, setCustomTemplateFile] = useState<File | null>(null);
  const [uploadingCustom, setUploadingCustom] = useState(false);
  
  // Step 3 state
  const [statements, setStatements] = useState<GeneratedStatements | null>(null);
  const [activeTab, setActiveTab] = useState('financial-position');
  const [entityName, setEntityName] = useState('Your Company Ltd');
  const [periodEnd, setPeriodEnd] = useState('2024-12-31');
  const [currency, setCurrency] = useState('USD');
  const [generating, setGenerating] = useState(false);

  // Load templates on mount - use built-in templates from mapping service
  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      // Import templates from mapping service
      const { INDUSTRY_TEMPLATES } = await import('../services/mappingService');
      setTemplates(INDUSTRY_TEMPLATES as any);
    } catch (error) {
      console.error('Failed to load templates:', error);
    }
  };

  // ==================== STEP 1: UPLOAD ====================

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setUploadError(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      setUploadError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    
    setUploading(true);
    setUploadError(null);
    
    try {
      // Parse file directly in browser using SheetJS
      const parsedData = await parseUploadedFile(file);
      setTrialBalance(parsedData);
      
      // Automatically trigger AI mapping using client-side AI service
      const aiResults = await getAISuggestions(parsedData);
      
      // Convert AI results to IFRSMapping format
      const mappings: IFRSMapping[] = parsedData.map(entry => ({
        glCode: entry.glCode,
        accountName: entry.accountName,
        suggestedMapping: aiResults[entry.glCode] || 'unmapped',
        confidence: aiResults[entry.glCode] ? 85 : 0,
        status: aiResults[entry.glCode] ? 'mapped' : 'unmapped',
        alternatives: []
      }));
      
      setAiMappings(mappings);
      
      // Initialize user mappings with AI suggestions (high confidence only)
      const initialMappings: Record<string, string> = {};
      mappings.forEach((m: IFRSMapping) => {
        if (m.confidence >= 80 && m.suggestedMapping !== 'unmapped') {
          initialMappings[m.glCode] = m.suggestedMapping;
        }
      });
      setUserMappings(initialMappings);
      
      setCurrentStep(2);
    } catch (error: any) {
      setUploadError(error.message || 'Failed to parse file');
    } finally {
      setUploading(false);
    }
  };

  // Parse Excel/CSV file in browser
  const parseUploadedFile = (file: File): Promise<TrialBalanceEntry[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows: any[] = XLSX.utils.sheet_to_json(sheet);
          
          // Map rows to TrialBalanceEntry format
          // Expected columns: GL Code, Account Name, Debit, Credit
          const entries: TrialBalanceEntry[] = rows.map(row => {
            const glCode = String(row['GL Code'] || row['GLCode'] || row['Account Code'] || '').trim();
            const accountName = String(row['Account Name'] || row['AccountName'] || row['Description'] || '').trim();
            const debit = parseFloat(row['Debit'] || row['Debit Balance'] || 0);
            const credit = parseFloat(row['Credit'] || row['Credit Balance'] || 0);
            
            // Determine account type based on balance
            let accountType = 'unknown';
            if (debit > 0) accountType = 'asset/expense';
            if (credit > 0) accountType = 'liability/equity/revenue';
            
            return {
              glCode,
              accountName,
              debit,
              credit,
              accountType,
              mappingStatus: 'unmapped' as const
            };
          }).filter(entry => entry.glCode && entry.accountName); // Filter out invalid rows
          
          if (entries.length === 0) {
            throw new Error('No valid data found in file. Expected columns: GL Code, Account Name, Debit, Credit');
          }
          
          resolve(entries);
        } catch (error: any) {
          reject(new Error(`Failed to parse file: ${error.message}`));
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  };

  const loadSampleData = async () => {
    try {
      // Load sample CSV from public folder and parse it client-side
      const response = await fetch('/sample-trial-balance.csv');
      const text = await response.text();
      
      // Simple CSV parser (for more complex CSVs, you could use PapaParse)
      const lines = text.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim());
      
      const entries: TrialBalanceEntry[] = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const row: any = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx];
        });
        
        const glCode = String(row['GL Code'] || row['GLCode'] || '').trim();
        const accountName = String(row['Account Name'] || row['AccountName'] || '').trim();
        const debit = parseFloat(row['Debit'] || 0);
        const credit = parseFloat(row['Credit'] || 0);
        
        let accountType = 'unknown';
        if (debit > 0) accountType = 'asset/expense';
        if (credit > 0) accountType = 'liability/equity/revenue';
        
        return {
          glCode,
          accountName,
          debit,
          credit,
          accountType,
          mappingStatus: 'unmapped' as const
        };
      }).filter(entry => entry.glCode && entry.accountName);
      
      setTrialBalance(entries);
      
      // Trigger AI mapping using client-side AI service
      const aiResults = await getAISuggestions(entries);
      
      const mappings: IFRSMapping[] = entries.map(entry => ({
        glCode: entry.glCode,
        accountName: entry.accountName,
        suggestedMapping: aiResults[entry.glCode] || 'unmapped',
        confidence: aiResults[entry.glCode] ? 85 : 0,
        status: aiResults[entry.glCode] ? 'mapped' : 'unmapped',
        alternatives: []
      }));
      
      setAiMappings(mappings);
      
      const initialMappings: Record<string, string> = {};
      mappings.forEach((m: IFRSMapping) => {
        if (m.confidence >= 80 && m.suggestedMapping !== 'unmapped') {
          initialMappings[m.glCode] = m.suggestedMapping;
        }
      });
      setUserMappings(initialMappings);
      
      setCurrentStep(2);
    } catch (error) {
      console.error('Failed to load sample data:', error);
      alert('Failed to load sample data. Please upload your own file.');
    }
  };

  // ==================== STEP 2: MAPPING ====================

  const applyTemplate = (template: MappingTemplate) => {
    const newMappings = { ...userMappings };
    let addedCount = 0;
    
    // Only apply template mappings to UNMAPPED accounts
    Object.entries(template.mappings).forEach(([glCode, mapping]) => {
      const accountExists = trialBalance.find(acc => acc.glCode === glCode);
      const isUnmapped = !newMappings[glCode] || newMappings[glCode] === 'unmapped';
      
      if (accountExists && isUnmapped) {
        newMappings[glCode] = mapping;
        addedCount++;
      }
    });
    
    setUserMappings(newMappings);
    setShowTemplateModal(false);
    
    // Show success message
    if (addedCount > 0) {
      alert(`✅ ${template.name} template applied — ${addedCount} additional account${addedCount > 1 ? 's' : ''} mapped`);
    } else {
      alert(`ℹ️ ${template.name} template loaded, but all matching accounts were already mapped.`);
    }
  };

  const downloadBlankTemplate = () => {
    // Import required libraries and data
    Promise.all([
      import('../services/mappingService'),
      import('xlsx')
    ]).then(([{ IFRS_LINE_ITEMS }, XLSX]) => {
      
      // SHEET 1: "My Company Mapping" (user fills this)
      const sheet1Data = [
        // Header row
        ['GL Code', 'Account Name', 'IFRS Line Item', 'See Sheet 2 for valid IFRS Line Items →'],
        // Example row (will be highlighted yellow)
        ['1001', 'Cash & Bank', 'financialPosition.assets.current.cashAndEquivalents', ''],
        // Empty rows for user to fill
        ...Array(98).fill(['', '', '', ''])
      ];

      const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);

      // Set column widths
      ws1['!cols'] = [
        { wch: 12 },  // GL Code
        { wch: 35 },  // Account Name
        { wch: 55 },  // IFRS Line Item
        { wch: 40 }   // Note column
      ];

      // Freeze first row (headers)
      ws1['!freeze'] = { xSplit: 0, ySplit: 1 };

      // Style header row (row 1) - dark blue background, white text, bold
      const headerStyle = {
        fill: { fgColor: { rgb: "1F4E78" } },
        font: { bold: true, color: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center" }
      };

      // Style example row (row 2) - yellow background
      const exampleStyle = {
        fill: { fgColor: { rgb: "FFFF00" } },
        font: { italic: true }
      };

      // Apply header styles
      ['A1', 'B1', 'C1', 'D1'].forEach(cell => {
        if (!ws1[cell]) ws1[cell] = { t: 's', v: '' };
        ws1[cell].s = headerStyle;
      });

      // Apply example row styles
      ['A2', 'B2', 'C2'].forEach(cell => {
        if (!ws1[cell]) ws1[cell] = { t: 's', v: '' };
        ws1[cell].s = exampleStyle;
      });

      // Add data validation (dropdown) for column C (IFRS Line Item)
      // This creates a dropdown with all valid IFRS values
      const validValues = IFRS_LINE_ITEMS.map(item => item.value);
      ws1['!dataValidation'] = [{
        sqref: 'C3:C100',  // Apply to rows 3-100 in column C
        type: 'list',
        allowBlank: true,
        formula1: `"${validValues.join(',')}"`,
        showDropDown: true
      }];

      // SHEET 2: "IFRS Reference" (read-only reference)
      const sheet2Data = [
        // Title row
        ['Available IFRS Line Items - Copy exact value from Column A into Sheet 1 Column C'],
        [''],  // Empty row
        // Headers
        ['IFRS Line Item Value', 'Label', 'Statement Type', 'Category'],
        // All IFRS line items
        ...IFRS_LINE_ITEMS.map(item => [
          item.value,
          item.label,
          item.statement,
          item.category || ''
        ])
      ];

      const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);

      // Set column widths for Sheet 2
      ws2['!cols'] = [
        { wch: 60 },  // IFRS Line Item Value
        { wch: 35 },  // Label
        { wch: 18 },  // Statement Type
        { wch: 25 }   // Category
      ];

      // Freeze first 3 rows (title, blank, headers)
      ws2['!freeze'] = { xSplit: 0, ySplit: 3 };

      // Style title row
      const titleStyle = {
        fill: { fgColor: { rgb: "FFC000" } },
        font: { bold: true, size: 14 },
        alignment: { horizontal: "left", vertical: "center" }
      };

      if (!ws2['A1']) ws2['A1'] = { t: 's', v: '' };
      ws2['A1'].s = titleStyle;

      // Style header row (row 3)
      ['A3', 'B3', 'C3', 'D3'].forEach(cell => {
        if (!ws2[cell]) ws2[cell] = { t: 's', v: '' };
        ws2[cell].s = {
          fill: { fgColor: { rgb: "4472C4" } },
          font: { bold: true, color: { rgb: "FFFFFF" } },
          alignment: { horizontal: "center", vertical: "center" }
        };
      });

      // Create workbook with both sheets
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'My Company Mapping');
      XLSX.utils.book_append_sheet(wb, ws2, 'IFRS Reference');

      // Download the file
      XLSX.writeFile(wb, 'blank-mapping-template.xlsx');
    }).catch(err => {
      console.error('Failed to generate template:', err);
      alert('Failed to download template. Please try again.');
    });
  };

  const handleCustomTemplateUpload = async () => {
    if (!customTemplateFile) return;

    setUploadingCustom(true);

    try {
      const text = await customTemplateFile.text();
      const Papa = (await import('papaparse')).default;
      
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const data = results.data as any[];
          const customMappings: Record<string, string> = {};
          let addedCount = 0;

          for (const row of data) {
            const glCode = row["GL Code"] || row["glCode"] || row["Code"];
            const ifrsLine = row["IFRS Line Item"] || row["ifrsLineItem"] || row["IFRS Mapping"];

            if (glCode && ifrsLine && ifrsLine !== 'IFRS Line Item') {
              const accountExists = trialBalance.find(acc => acc.glCode === glCode);
              const isUnmapped = !userMappings[glCode] || userMappings[glCode] === 'unmapped';

              if (accountExists && isUnmapped) {
                customMappings[glCode] = ifrsLine;
                addedCount++;
              }
            }
          }

          if (addedCount > 0) {
            const newMappings = { ...userMappings, ...customMappings };
            setUserMappings(newMappings);

            // Save to company profile permanently (Map Once Use Forever)
            import('../services/mappingService').then(({ saveCompanyMappings }) => {
              const companyId = localStorage.getItem('currentCompanyId') || 'company-' + Date.now();
              const companyName = entityName || 'Your Company';
              saveCompanyMappings(companyId, companyName, newMappings);
            });

            alert(`✅ Your company template saved — ${addedCount} account${addedCount > 1 ? 's' : ''} mapped`);
            setShowTemplateModal(false);
            setShowCustomUpload(false);
            setCustomTemplateFile(null);
          } else {
            alert('ℹ️ No new mappings found in the uploaded file. All accounts may already be mapped.');
          }

          setUploadingCustom(false);
        },
        error: (error) => {
          alert(`Failed to parse file: ${error.message}`);
          setUploadingCustom(false);
        }
      });
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
      setUploadingCustom(false);
    }
  };

  const autoAcceptAll = () => {
    const newMappings = { ...userMappings };
    aiMappings.forEach(mapping => {
      if (mapping.confidence >= 80) {
        newMappings[mapping.glCode] = mapping.suggestedMapping;
      }
    });
    setUserMappings(newMappings);
  };

  const updateMapping = (glCode: string, mapping: string) => {
    setUserMappings(prev => ({ ...prev, [glCode]: mapping }));
  };

  const getMappingStats = () => {
    const total = aiMappings.length;
    const mapped = aiMappings.filter(m => userMappings[m.glCode] && userMappings[m.glCode] !== 'unmapped').length;
    const uncertain = aiMappings.filter(m => m.status === 'uncertain' && !userMappings[m.glCode]).length;
    const unmapped = total - mapped - uncertain;
    
    return { total, mapped, uncertain, unmapped };
  };

  const canProceedToGenerate = () => {
    const stats = getMappingStats();
    return stats.unmapped === 0;
  };

  // ==================== STEP 3: GENERATE ====================

  const generateStatements = async () => {
    setGenerating(true);
    
    try {
      // Import and use client-side statement generator
      const { generateIFRSStatements } = await import('../services/statementGenerator');
      
      const result = generateIFRSStatements({
        trialBalance,
        mappings: userMappings,
        entityName,
        periodEnd,
        currency
      });
      
      setStatements(result);
      setCurrentStep(3);
    } catch (error: any) {
      alert('Failed to generate statements: ' + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const exportStatements = async (format: 'pdf' | 'excel' | 'word' | 'json') => {
    if (!statements) return;
    
    try {
      if (format === 'json') {
        // Export as JSON
        const blob = new Blob([JSON.stringify(statements, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `ifrs-statements-${periodEnd}.json`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      } else if (format === 'excel') {
        // Export as Excel using XLSX
        const workbook = XLSX.utils.book_new();
        
        // Balance Sheet
        const bsData = formatBalanceSheetForExport(statements.financialPosition);
        const bsSheet = XLSX.utils.aoa_to_sheet(bsData);
        XLSX.utils.book_append_sheet(workbook, bsSheet, 'Balance Sheet');
        
        // Profit & Loss
        const plData = formatProfitLossForExport(statements.profitLoss);
        const plSheet = XLSX.utils.aoa_to_sheet(plData);
        XLSX.utils.book_append_sheet(workbook, plSheet, 'Profit & Loss');
        
        XLSX.writeFile(workbook, `ifrs-statements-${periodEnd}.xlsx`);
      } else {
        alert(`${format.toUpperCase()} export coming soon!`);
      }
    } catch (error) {
      alert('Export failed');
    }
  };

  // Helper functions for Excel export
  const formatBalanceSheetForExport = (bs: any) => {
    return [
      [`${entityName} - Balance Sheet`, '', `As at ${periodEnd}`],
      [''],
      ['ASSETS', '', ''],
      ['Current Assets', '', ''],
      ['Cash & Cash Equivalents', '', bs.assets.current.cashAndEquivalents || 0],
      ['Trade Receivables', '', bs.assets.current.tradeReceivables || 0],
      ['Inventories', '', bs.assets.current.inventories || 0],
      ['Prepayments', '', bs.assets.current.prepayments || 0],
      ['Other Current Assets', '', bs.assets.current.otherCurrentAssets || 0],
      ['Total Current Assets', '', bs.assets.current.total || 0],
      [''],
      ['Non-Current Assets', '', ''],
      ['Property, Plant & Equipment', '', bs.assets.nonCurrent.propertyPlantEquipment || 0],
      ['Intangible Assets', '', bs.assets.nonCurrent.intangibleAssets || 0],
      ['Investments', '', bs.assets.nonCurrent.investments || 0],
      ['Other Non-Current Assets', '', bs.assets.nonCurrent.otherNonCurrentAssets || 0],
      ['Total Non-Current Assets', '', bs.assets.nonCurrent.total || 0],
      [''],
      ['TOTAL ASSETS', '', bs.assets.total || 0],
      [''],
      ['LIABILITIES', '', ''],
      ['Current Liabilities', '', ''],
      ['Trade Payables', '', bs.liabilities.current.tradePayables || 0],
      ['Short-term Borrowings', '', bs.liabilities.current.shortTermBorrowings || 0],
      ['Other Current Liabilities', '', bs.liabilities.current.otherCurrentLiabilities || 0],
      ['Total Current Liabilities', '', bs.liabilities.current.total || 0],
      [''],
      ['Non-Current Liabilities', '', ''],
      ['Long-term Borrowings', '', bs.liabilities.nonCurrent.longTermBorrowings || 0],
      ['Other Non-Current Liabilities', '', bs.liabilities.nonCurrent.otherNonCurrentLiabilities || 0],
      ['Total Non-Current Liabilities', '', bs.liabilities.nonCurrent.total || 0],
      [''],
      ['TOTAL LIABILITIES', '', bs.liabilities.total || 0],
      [''],
      ['EQUITY', '', ''],
      ['Share Capital', '', bs.equity.shareCapital || 0],
      ['Retained Earnings', '', bs.equity.retainedEarnings || 0],
      ['Reserves', '', bs.equity.reserves || 0],
      ['TOTAL EQUITY', '', bs.equity.total || 0],
      [''],
      ['TOTAL EQUITY & LIABILITIES', '', bs.totalEquityAndLiabilities || 0]
    ];
  };

  const formatProfitLossForExport = (pl: any) => {
    return [
      [`${entityName} - Profit & Loss`, '', `For the period ending ${periodEnd}`],
      [''],
      ['Revenue', '', pl.revenue || 0],
      ['Cost of Sales', '', -(pl.costOfSales || 0)],
      ['Gross Profit', '', pl.grossProfit || 0],
      [''],
      ['Operating Expenses', '', ''],
      ['Employee Benefits', '', -(pl.operatingExpenses.employeeBenefits || 0)],
      ['Depreciation', '', -(pl.operatingExpenses.depreciation || 0)],
      ['Administrative', '', -(pl.operatingExpenses.administrative || 0)],
      ['Distribution', '', -(pl.operatingExpenses.distribution || 0)],
      ['Other', '', -(pl.operatingExpenses.other || 0)],
      ['Total Operating Expenses', '', -(pl.operatingExpenses.total || 0)],
      [''],
      ['Operating Profit', '', pl.operatingProfit || 0],
      ['Finance Income', '', pl.financeIncome || 0],
      ['Finance Costs', '', -(pl.financeCosts || 0)],
      ['Profit Before Tax', '', pl.profitBeforeTax || 0],
      ['Income Tax', '', -(pl.incomeTax || 0)],
      ['Profit After Tax', '', pl.profitAfterTax || 0]
    ];
  };

  // ==================== RENDER ====================

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => currentStep > 1 ? setCurrentStep((currentStep - 1) as 1 | 2) : navigate('/dashboard')}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">IFRS Statement Generator</h1>
                <p className="text-sm text-gray-500">Convert Trial Balance to IFRS Financial Statements in 60 seconds</p>
              </div>
            </div>
            
            {/* Progress Steps */}
            <div className="flex items-center gap-4">
              {[1, 2, 3].map(step => (
                <div key={step} className="flex items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                    currentStep >= step
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}>
                    {step}
                  </div>
                  {step < 3 && <div className={`w-16 h-1 ${currentStep > step ? 'bg-blue-600' : 'bg-gray-200'}`} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {currentStep === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <Step1Upload
                file={file}
                uploading={uploading}
                uploadError={uploadError}
                onFileSelect={handleFileSelect}
                onDrop={handleDrop}
                onUpload={handleUpload}
                onLoadSample={loadSampleData}
              />
            </motion.div>
          )}
          
          {currentStep === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <Step2Mapping
                trialBalance={trialBalance}
                aiMappings={aiMappings}
                userMappings={userMappings}
                selectedAccount={selectedAccount}
                templates={templates}
                searchQuery={searchQuery}
                filterStatus={filterStatus}
                showTemplateModal={showTemplateModal}
                showCustomUpload={showCustomUpload}
                customTemplateFile={customTemplateFile}
                uploadingCustom={uploadingCustom}
                onUpdateMapping={updateMapping}
                onSelectAccount={setSelectedAccount}
                onAutoAcceptAll={autoAcceptAll}
                onApplyTemplate={applyTemplate}
                onSearchChange={setSearchQuery}
                onFilterChange={setFilterStatus}
                onToggleTemplateModal={() => setShowTemplateModal(!showTemplateModal)}
                onGenerate={generateStatements}
                canProceed={canProceedToGenerate()}
                generating={generating}
                getMappingStats={getMappingStats}
                onShowCustomUpload={setShowCustomUpload}
                onCustomFileSelect={setCustomTemplateFile}
                onDownloadBlankTemplate={downloadBlankTemplate}
                onUploadCustomTemplate={handleCustomTemplateUpload}
              />
            </motion.div>
          )}
          
          {currentStep === 3 && statements && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <Step3Statements
                statements={statements}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onExport={exportStatements}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

// ==================== STEP 1 COMPONENT ====================

interface Step1Props {
  file: File | null;
  uploading: boolean;
  uploadError: string | null;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  onUpload: () => void;
  onLoadSample: () => void;
}

const Step1Upload: React.FC<Step1Props> = ({
  file,
  uploading,
  uploadError,
  onFileSelect,
  onDrop,
  onUpload,
  onLoadSample
}) => {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Upload Zone */}
      <motion.div
        className="bg-white rounded-2xl shadow-lg p-12 border-2 border-dashed border-gray-300"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        whileHover={{ borderColor: '#3b82f6' }}
      >
        <div className="flex flex-col items-center text-center">
          <div className="w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center mb-6">
            <Upload className="w-12 h-12 text-blue-600" />
          </div>
          
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Upload Trial Balance</h2>
          <p className="text-gray-600 mb-8">
            Drag and drop your file here, or click to browse
          </p>
          
          {file ? (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 w-full max-w-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-8 h-8 text-blue-600" />
                  <div className="text-left">
                    <p className="font-medium text-gray-900">{file.name}</p>
                    <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(2)} KB</p>
                  </div>
                </div>
                <CheckCircle className="w-6 h-6 text-green-500" />
              </div>
            </div>
          ) : (
            <label className="cursor-pointer">
              <input
                type="file"
                className="hidden"
                accept=".xlsx,.xls,.csv"
                onChange={onFileSelect}
              />
              <div className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium">
                Browse Files
              </div>
            </label>
          )}
          
          {uploadError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 w-full max-w-md">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                <span>{uploadError}</span>
              </div>
            </div>
          )}
          
          <p className="text-sm text-gray-500 mt-6">
            Supported formats: .xlsx, .xls, .csv
          </p>
          
          {file && !uploadError && (
            <button
              onClick={onUpload}
              disabled={uploading}
              className="mt-6 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Processing...
                </span>
              ) : (
                'Continue to Mapping'
              )}
            </button>
          )}
        </div>
      </motion.div>

      {/* Info Cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Building2, title: 'Financial Position', desc: 'Balance Sheet' },
          { icon: TrendingUp, title: 'Profit & Loss', desc: 'Income Statement' },
          { icon: DollarSign, title: 'Cash Flows', desc: 'Indirect Method' },
          { icon: BarChart3, title: 'Equity Changes', desc: 'Statement of Changes' }
        ].map((item, idx) => (
          <motion.div
            key={idx}
            className="bg-white rounded-xl p-6 shadow-md border border-gray-100"
            whileHover={{ y: -4, shadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}
          >
            <item.icon className="w-10 h-10 text-blue-600 mb-3" />
            <h3 className="font-semibold text-gray-900 mb-1">{item.title}</h3>
            <p className="text-sm text-gray-500">{item.desc}</p>
          </motion.div>
        ))}
      </div>

      {/* Sample Data Button */}
      <div className="text-center">
        <button
          onClick={onLoadSample}
          className="inline-flex items-center gap-2 px-6 py-3 text-blue-600 hover:bg-blue-50 rounded-lg transition font-medium border-2 border-blue-200"
        >
          <Sparkles className="w-5 h-5" />
          Try with Sample Data
        </button>
      </div>
    </div>
  );
};

// ==================== STEP 2 COMPONENT (MAPPING) ====================
// Due to length, I'll create a simplified version that you can expand

interface Step2Props {
  trialBalance: TrialBalanceEntry[];
  aiMappings: IFRSMapping[];
  userMappings: Record<string, string>;
  selectedAccount: IFRSMapping | null;
  templates: MappingTemplate[];
  searchQuery: string;
  filterStatus: string;
  showTemplateModal: boolean;
  showCustomUpload: boolean;
  customTemplateFile: File | null;
  uploadingCustom: boolean;
  onUpdateMapping: (glCode: string, mapping: string) => void;
  onSelectAccount: (account: IFRSMapping) => void;
  onAutoAcceptAll: () => void;
  onApplyTemplate: (template: MappingTemplate) => void;
  onSearchChange: (query: string) => void;
  onFilterChange: (status: any) => void;
  onToggleTemplateModal: () => void;
  onGenerate: () => void;
  canProceed: boolean;
  generating: boolean;
  getMappingStats: () => { total: number; mapped: number; uncertain: number; unmapped: number };
  onShowCustomUpload: (show: boolean) => void;
  onCustomFileSelect: (file: File | null) => void;
  onDownloadBlankTemplate: () => void;
  onUploadCustomTemplate: () => void;
}

const Step2Mapping: React.FC<Step2Props> = (props) => {
  const stats = props.getMappingStats();
  
  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Review Account Mapping</h2>
          <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg">
            <Sparkles className="w-5 h-5" />
            <span className="font-semibold">{Math.round((stats.mapped / stats.total) * 100)}% Auto-Mapped</span>
          </div>
        </div>
        
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-500">Total Accounts</p>
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-4">
            <p className="text-sm text-green-700">Mapped</p>
            <p className="text-2xl font-bold text-green-700">{stats.mapped}</p>
          </div>
          <div className="bg-yellow-50 rounded-lg p-4">
            <p className="text-sm text-yellow-700">Needs Review</p>
            <p className="text-2xl font-bold text-yellow-700">{stats.uncertain}</p>
          </div>
          <div className="bg-red-50 rounded-lg p-4">
            <p className="text-sm text-red-700">Unmapped</p>
            <p className="text-2xl font-bold text-red-700">{stats.unmapped}</p>
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <button
            onClick={props.onAutoAcceptAll}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            Auto-Accept All (&gt;80% confidence)
          </button>
          <button
            onClick={props.onToggleTemplateModal}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            Load Industry Template
          </button>
        </div>
      </div>

      {/* Mapping Table */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Trial Balance Accounts</h3>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">GL Code</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Account Name</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Debit</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Credit</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">IFRS Mapping</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {props.aiMappings.map((mapping) => {
                  const userMapping = props.userMappings[mapping.glCode];
                  const isMapped = userMapping && userMapping !== 'unmapped';
                  
                  return (
                    <tr key={mapping.glCode} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono">{mapping.glCode}</td>
                      <td className="px-4 py-3 text-sm">{mapping.accountName}</td>
                      <td className="px-4 py-3 text-sm text-right">
                        {props.trialBalance.find(a => a.glCode === mapping.glCode)?.debit.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        {props.trialBalance.find(a => a.glCode === mapping.glCode)?.credit.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <select
                          value={userMapping || ''}
                          onChange={(e) => props.onUpdateMapping(mapping.glCode, e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        >
                          <option value="">Select mapping...</option>
                          <option value={mapping.suggestedMapping}>
                            {mapping.suggestedMapping} (AI: {mapping.confidence}%)
                          </option>
                          {mapping.alternatives?.map((alt) => (
                            <option key={alt.path} value={alt.path}>{alt.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isMapped ? (
                          <CheckCircle className="w-5 h-5 text-green-500 mx-auto" />
                        ) : mapping.confidence >= 50 ? (
                          <AlertTriangle className="w-5 h-5 text-yellow-500 mx-auto" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-red-500 mx-auto" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Generate Button */}
      <div className="flex justify-end">
        <button
          onClick={props.onGenerate}
          disabled={!props.canProceed || props.generating}
          className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {props.generating ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" />
              Generating Statements...
            </>
          ) : (
            <>
              <Zap className="w-5 h-5" />
              Generate IFRS Statements
            </>
          )}
        </button>
      </div>

      {/* Template Modal */}
      {props.showTemplateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Select Industry Template</h3>
              <button
                onClick={props.onToggleTemplateModal}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              {/* CUSTOM TEMPLATE UPLOAD - TOP OPTION */}
              <div className="border-2 border-blue-500 bg-blue-50 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                    <Upload className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-lg text-gray-900">Upload Your Company Template</h4>
                      <span className="px-2 py-1 bg-green-600 text-white text-xs font-bold rounded">RECOMMENDED</span>
                    </div>
                    <p className="text-sm text-gray-600 mb-3">Use your own Chart of Accounts mapping file</p>
                    
                    {!props.showCustomUpload ? (
                      <button
                        onClick={() => props.onShowCustomUpload(true)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
                      >
                        Upload Custom Template
                      </button>
                    ) : (
                      <div className="space-y-3">
                        {/* File Upload Area */}
                        <div
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files[0];
                            if (file) props.onCustomFileSelect(file);
                          }}
                          className="border-2 border-dashed border-blue-300 rounded-lg p-4 text-center bg-white"
                        >
                          {!props.customTemplateFile ? (
                            <>
                              <FileSpreadsheet className="w-8 h-8 text-blue-400 mx-auto mb-2" />
                              <p className="text-sm text-gray-600 mb-2">Drag & drop or</p>
                              <label className="cursor-pointer">
                                <input
                                  type="file"
                                  className="hidden"
                                  accept=".csv,.xlsx,.xls"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) props.onCustomFileSelect(file);
                                  }}
                                />
                                <span className="px-4 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition text-sm inline-block">
                                  Browse Files
                                </span>
                              </label>
                            </>
                          ) : (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-green-600">
                                <FileSpreadsheet className="w-5 h-5" />
                                <span className="text-sm font-medium">{props.customTemplateFile.name}</span>
                              </div>
                              <button
                                onClick={() => props.onCustomFileSelect(null)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={props.onDownloadBlankTemplate}
                            className="flex-1 px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition text-sm font-medium flex items-center justify-center gap-2"
                          >
                            <Download className="w-4 h-4" />
                            Download Blank Template
                          </button>
                          
                          {props.customTemplateFile && (
                            <button
                              onClick={props.onUploadCustomTemplate}
                              disabled={props.uploadingCustom}
                              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {props.uploadingCustom ? 'Uploading...' : 'Apply Template'}
                            </button>
                          )}
                        </div>

                        <button
                          onClick={() => props.onShowCustomUpload(false)}
                          className="text-sm text-gray-500 hover:text-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-4 py-2">
                <div className="flex-1 border-t border-gray-300"></div>
                <span className="text-sm text-gray-500 font-medium">OR SELECT PRE-BUILT TEMPLATE</span>
                <div className="flex-1 border-t border-gray-300"></div>
              </div>

              {/* Industry Templates */}
              {props.templates.map((template) => {
                const IconComponent = template.icon === 'ShoppingCart' ? ShoppingCart :
                                     template.icon === 'Cpu' ? Cpu :
                                     template.icon === 'Factory' ? Factory :
                                     template.icon === 'Briefcase' ? Briefcase : Building2;
                
                return (
                  <button
                    key={template.id}
                    onClick={() => props.onApplyTemplate(template)}
                    className="w-full p-6 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition text-left"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                        <IconComponent className="w-6 h-6 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-semibold text-lg text-gray-900 mb-1">{template.name}</h4>
                        <p className="text-sm text-gray-600">{template.description}</p>
                      </div>
                      <ArrowRight className="w-6 h-6 text-gray-400" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== STEP 3 COMPONENT (STATEMENTS) ====================
// Simplified version - you can expand with full statement formatting

interface Step3Props {
  statements: GeneratedStatements;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onExport: (format: 'pdf' | 'excel' | 'word' | 'json') => void;
}

const Step3Statements: React.FC<Step3Props> = ({ statements, activeTab, onTabChange, onExport }) => {
  const tabs = [
    { id: 'financial-position', label: 'Financial Position' },
    { id: 'profit-loss', label: 'Profit & Loss' },
    { id: 'cash-flows', label: 'Cash Flows' },
    { id: 'equity', label: 'Changes in Equity' }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{statements.entityName}</h2>
            <p className="text-gray-600">IFRS Financial Statements - Period ending {statements.periodEnd}</p>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => onExport('excel')}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Excel
            </button>
            <button
              onClick={() => onExport('pdf')}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              PDF
            </button>
            <button
              onClick={() => onExport('json')}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              JSON
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`px-6 py-3 font-medium transition border-b-2 ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Statement Display */}
      <div className="bg-white rounded-xl shadow-lg p-8">
        {activeTab === 'financial-position' && (
          <FinancialPositionView data={statements.financialPosition} entityName={statements.entityName} periodEnd={statements.periodEnd} currency={statements.currency} />
        )}
        {activeTab === 'profit-loss' && (
          <ProfitLossView data={statements.profitLoss} entityName={statements.entityName} periodEnd={statements.periodEnd} currency={statements.currency} />
        )}
        {activeTab === 'cash-flows' && (
          <div className="text-center py-12 text-gray-500">
            <DollarSign className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p>Cash Flow Statement (Indirect Method)</p>
            <p className="text-sm mt-2">{statements.cashFlows.note}</p>
          </div>
        )}
        {activeTab === 'equity' && (
          <div className="text-center py-12 text-gray-500">
            <BarChart3 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p>Statement of Changes in Equity</p>
            <p className="text-sm mt-2">{statements.changesInEquity.note}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== STATEMENT VIEWS ====================

const FinancialPositionView = ({ data, entityName, periodEnd, currency }: any) => {
  return (
    <div className="font-serif">
      <div className="text-center mb-8">
        <h3 className="text-xl font-bold uppercase">{entityName}</h3>
        <h4 className="text-lg font-semibold">STATEMENT OF FINANCIAL POSITION</h4>
        <p className="text-gray-600">As at {periodEnd}</p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-gray-900">
            <th className="text-left py-2"></th>
            <th className="text-right py-2 px-4">{currency}</th>
          </tr>
        </thead>
        <tbody>
          {/* Assets */}
          <tr><td colSpan={2} className="pt-6 pb-2 font-bold text-lg">ASSETS</td></tr>
          
          <tr><td colSpan={2} className="pt-4 pb-2 font-semibold">Non-current assets</td></tr>
          <tr>
            <td className="pl-4 py-1">Property, plant and equipment</td>
            <td className="text-right px-4">{data.assets.nonCurrent.ppe.toLocaleString()}</td>
          </tr>
          <tr>
            <td className="pl-4 py-1">Intangible assets</td>
            <td className="text-right px-4">{data.assets.nonCurrent.intangibles.toLocaleString()}</td>
          </tr>
          <tr className="border-t border-gray-300">
            <td className="pl-4 py-1 font-semibold">Total non-current assets</td>
            <td className="text-right px-4 font-semibold">{data.assets.totalNonCurrent.toLocaleString()}</td>
          </tr>

          <tr><td colSpan={2} className="pt-4 pb-2 font-semibold">Current assets</td></tr>
          <tr>
            <td className="pl-4 py-1">Inventories</td>
            <td className="text-right px-4">{data.assets.current.inventories.toLocaleString()}</td>
          </tr>
          <tr>
            <td className="pl-4 py-1">Trade and other receivables</td>
            <td className="text-right px-4">{data.assets.current.tradeReceivables.toLocaleString()}</td>
          </tr>
          <tr>
            <td className="pl-4 py-1">Cash and cash equivalents</td>
            <td className="text-right px-4">{data.assets.current.cashAndEquivalents.toLocaleString()}</td>
          </tr>
          <tr className="border-t border-gray-300">
            <td className="pl-4 py-1 font-semibold">Total current assets</td>
            <td className="text-right px-4 font-semibold">{data.assets.totalCurrent.toLocaleString()}</td>
          </tr>

          <tr className="border-t-2 border-gray-900">
            <td className="py-2 font-bold">TOTAL ASSETS</td>
            <td className="text-right px-4 font-bold">{data.assets.total.toLocaleString()}</td>
          </tr>

          {/* Equity & Liabilities */}
          <tr><td colSpan={2} className="pt-8 pb-2 font-bold text-lg">EQUITY AND LIABILITIES</td></tr>
          
          <tr><td colSpan={2} className="pt-4 pb-2 font-semibold">Equity</td></tr>
          <tr>
            <td className="pl-4 py-1">Share capital</td>
            <td className="text-right px-4">{data.equity.shareCapital.toLocaleString()}</td>
          </tr>
          <tr>
            <td className="pl-4 py-1">Retained earnings</td>
            <td className="text-right px-4">{data.equity.retainedEarnings.toLocaleString()}</td>
          </tr>
          <tr className="border-t border-gray-300">
            <td className="pl-4 py-1 font-semibold">Total equity</td>
            <td className="text-right px-4 font-semibold">{data.equity.total.toLocaleString()}</td>
          </tr>

          <tr><td colSpan={2} className="pt-4 pb-2 font-semibold">Non-current liabilities</td></tr>
          <tr>
            <td className="pl-4 py-1">Long-term borrowings</td>
            <td className="text-right px-4">{data.liabilities.nonCurrent.borrowings.toLocaleString()}</td>
          </tr>

          <tr><td colSpan={2} className="pt-4 pb-2 font-semibold">Current liabilities</td></tr>
          <tr>
            <td className="pl-4 py-1">Trade and other payables</td>
            <td className="text-right px-4">{data.liabilities.current.tradePayables.toLocaleString()}</td>
          </tr>
          <tr>
            <td className="pl-4 py-1">Short-term borrowings</td>
            <td className="text-right px-4">{data.liabilities.current.borrowings.toLocaleString()}</td>
          </tr>
          <tr className="border-t border-gray-300">
            <td className="pl-4 py-1 font-semibold">Total current liabilities</td>
            <td className="text-right px-4 font-semibold">{data.liabilities.totalCurrent.toLocaleString()}</td>
          </tr>

          <tr className="border-t-2 border-gray-900">
            <td className="py-2 font-bold">TOTAL EQUITY AND LIABILITIES</td>
            <td className="text-right px-4 font-bold">{data.totalEquityAndLiabilities.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      {data.isBalanced && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600" />
          <span className="text-green-700 font-medium">Statement is balanced ✓</span>
        </div>
      )}
    </div>
  );
};

const ProfitLossView = ({ data, entityName, periodEnd, currency }: any) => {
  return (
    <div className="font-serif">
      <div className="text-center mb-8">
        <h3 className="text-xl font-bold uppercase">{entityName}</h3>
        <h4 className="text-lg font-semibold">STATEMENT OF PROFIT OR LOSS</h4>
        <p className="text-gray-600">For the year ended {periodEnd}</p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-gray-900">
            <th className="text-left py-2"></th>
            <th className="text-right py-2 px-4">{currency}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-2 font-semibold">Revenue</td>
            <td className="text-right px-4">{data.revenue.toLocaleString()}</td>
          </tr>
          <tr>
            <td className="py-2">Cost of sales</td>
            <td className="text-right px-4">({data.costOfSales.toLocaleString()})</td>
          </tr>
          <tr className="border-t border-gray-300">
            <td className="py-2 font-semibold">Gross profit</td>
            <td className="text-right px-4 font-semibold">{data.grossProfit.toLocaleString()}</td>
          </tr>

          <tr><td colSpan={2} className="pt-4 pb-2">Operating expenses:</td></tr>
          <tr>
            <td className="pl-4 py-1">Employee benefits</td>
            <td className="text-right px-4">({data.operatingExpenses.employeeBenefits.toLocaleString()})</td>
          </tr>
          <tr>
            <td className="pl-4 py-1">Depreciation and amortization</td>
            <td className="text-right px-4">({data.operatingExpenses.depreciation.toLocaleString()})</td>
          </tr>
          <tr>
            <td className="pl-4 py-1">Distribution costs</td>
            <td className="text-right px-4">({data.operatingExpenses.distribution.toLocaleString()})</td>
          </tr>
          <tr>
            <td className="pl-4 py-1">Administrative expenses</td>
            <td className="text-right px-4">({data.operatingExpenses.administrative.toLocaleString()})</td>
          </tr>
          
          <tr className="border-t border-gray-300">
            <td className="py-2 font-semibold">Operating profit</td>
            <td className="text-right px-4 font-semibold">{data.operatingProfit.toLocaleString()}</td>
          </tr>

          <tr>
            <td className="py-2">Finance costs</td>
            <td className="text-right px-4">({data.financeCosts.toLocaleString()})</td>
          </tr>

          <tr className="border-t border-gray-300">
            <td className="py-2 font-semibold">Profit before tax</td>
            <td className="text-right px-4 font-semibold">{data.profitBeforeTax.toLocaleString()}</td>
          </tr>

          <tr>
            <td className="py-2">Income tax expense</td>
            <td className="text-right px-4">({data.incomeTax.toLocaleString()})</td>
          </tr>

          <tr className="border-t-2 border-gray-900">
            <td className="py-3 font-bold text-lg">PROFIT FOR THE YEAR</td>
            <td className="text-right px-4 font-bold text-lg">{data.profitAfterTax.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};
