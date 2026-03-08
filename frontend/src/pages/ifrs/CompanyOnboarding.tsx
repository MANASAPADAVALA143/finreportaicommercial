// ==================== COMPANY ONBOARDING — IFRS SETUP ====================
// "Map Once, Use Forever" — One-time Chart of Accounts mapping

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Building2,
  Upload,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Download,
  FileSpreadsheet,
  Factory,
  ShoppingCart,
  Briefcase,
  Cpu,
  X,
  ArrowRight,
  Info
} from "lucide-react";
import Papa from "papaparse";
import {
  saveCompanyMappings,
  IFRS_LINE_ITEMS,
  INDUSTRY_TEMPLATES,
  getAISuggestions
} from "../../services/mappingService";
import type { ChartOfAccountsRow, CompanyInfo } from "../../types/ifrs";

// ==================== MAIN COMPONENT ====================

export const CompanyOnboarding = () => {
  const navigate = useNavigate();
  
  // Company Info
  const [companyName, setCompanyName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [currency, setCurrency] = useState<"USD" | "EUR" | "GBP" | "INR" | "AED" | "SGD">("USD");
  const [yearEnd, setYearEnd] = useState<string>("Dec");
  
  // Tab Selection
  const [activeTab, setActiveTab] = useState<1 | 2 | 3>(1);
  
  // Upload State
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountsRow[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState(false);
  
  // AI State
  const [aiProcessing, setAiProcessing] = useState(false);
  
  // Error State
  const [error, setError] = useState<string | null>(null);

  // ==================== HANDLERS ====================

  const generateCompanyId = () => {
    const id = `CO${Date.now().toString(36).toUpperCase()}`;
    setCompanyId(id);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      setError(null);
    }
  };

  const parseAndUploadCoA = async () => {
    if (!file || !companyName || !companyId) {
      setError("Please fill in company details and select a file");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const text = await file.text();
      
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const data = results.data as any[];
          const parsed: ChartOfAccountsRow[] = [];
          const parsedMappings: Record<string, string> = {};

          for (const row of data) {
            const glCode = row["GL Code"] || row["glCode"] || row["Code"];
            const accountName = row["Account Name"] || row["accountName"] || row["Name"];
            const ifrsLine = row["IFRS Line Item"] || row["ifrsLineItem"] || row["IFRS Mapping"];

            if (glCode && accountName) {
              parsed.push({ glCode, accountName, ifrsLineItem: ifrsLine });
              
              // If IFRS line provided, use it
              if (ifrsLine) {
                parsedMappings[glCode] = ifrsLine;
              }
            }
          }

          if (parsed.length === 0) {
            setError("No valid accounts found in file. Please check the format.");
            setUploading(false);
            return;
          }

          setChartOfAccounts(parsed);
          setMappings(parsedMappings);
          setShowPreview(true);
          setUploading(false);
        },
        error: (error) => {
          setError(`Failed to parse file: ${error.message}`);
          setUploading(false);
        }
      });
    } catch (err: any) {
      setError(err.message);
      setUploading(false);
    }
  };

  const handleAIMapping = async () => {
    if (chartOfAccounts.length === 0) {
      return;
    }

    setAiProcessing(true);
    setError(null);

    try {
      // Convert to trial balance format for AI
      const entries = chartOfAccounts.map(acc => ({
        glCode: acc.glCode,
        accountName: acc.accountName,
        debit: 0,
        credit: 0,
        mappingStatus: "unmapped" as const
      }));

      const aiResults = await getAISuggestions(entries);
      
      const newMappings: Record<string, string> = {};
      for (const [glCode, result] of Object.entries(aiResults)) {
        if (result.suggestedMapping && result.confidence > 50) {
          newMappings[glCode] = result.suggestedMapping;
        }
      }

      setMappings(newMappings);
      setShowPreview(true);
      setAiProcessing(false);
    } catch (err: any) {
      setError(`AI mapping failed: ${err.message}`);
      setAiProcessing(false);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = INDUSTRY_TEMPLATES.find(t => t.id === templateId);
    if (!template) return;

    setMappings(template.mappings);
    
    // Generate sample chart of accounts from template
    const sampleCoA: ChartOfAccountsRow[] = Object.entries(template.mappings).map(([glCode, ifrsLine]) => ({
      glCode,
      accountName: IFRS_LINE_ITEMS.find(item => item.value === ifrsLine)?.label || "Account",
      ifrsLineItem: ifrsLine
    }));
    
    setChartOfAccounts(sampleCoA);
    setShowPreview(true);
  };

  const handleSave = () => {
    if (!companyName || !companyId) {
      setError("Please provide company name and ID");
      return;
    }

    if (Object.keys(mappings).length === 0) {
      setError("No mappings to save. Please complete at least one mapping method.");
      return;
    }

    try {
      saveCompanyMappings(companyId, companyName, mappings);
      
      // Show success and redirect
      alert(`✅ Success! ${Object.keys(mappings).length} accounts mapped for ${companyName}.\n\nYou will never need to do this again. Every monthly Trial Balance upload will be 100% automatic.`);
      
      navigate("/ifrs-generator");
    } catch (err: any) {
      setError(`Failed to save: ${err.message}`);
    }
  };

  const downloadTemplate = () => {
    const csvContent = `GL Code,Account Name,IFRS Line Item
1001,Cash & Bank,financialPosition.assets.current.cashAndEquivalents
1002,Accounts Receivable,financialPosition.assets.current.tradeReceivables
1003,Inventory,financialPosition.assets.current.inventories
2001,Property Plant & Equipment,financialPosition.assets.nonCurrent.propertyPlantEquipment
3001,Trade Payables,financialPosition.liabilities.current.tradePayables
5001,Share Capital,financialPosition.equity.shareCapital
6001,Revenue,profitLoss.revenue
7001,Cost of Goods Sold,profitLoss.costOfSales`;

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chart-of-accounts-template.csv";
    a.click();
    URL.revokeObjectURL(url);
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
                onClick={() => navigate("/dashboard")}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Company Setup — Chart of Accounts</h1>
                <p className="text-sm text-gray-500">Upload once, auto-map forever</p>
              </div>
            </div>
            
            <Building2 className="w-8 h-8 text-blue-600" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Info Banner */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-blue-50 border border-blue-200 rounded-xl p-6"
        >
          <div className="flex gap-4">
            <Info className="w-6 h-6 text-blue-600 flex-shrink-0 mt-1" />
            <div>
              <h3 className="font-semibold text-blue-900 mb-2">This is a one-time setup</h3>
              <p className="text-blue-800 text-sm">
                Once your Chart of Accounts is mapped to IFRS line items, every monthly Trial Balance upload 
                will be <strong>100% automatic</strong>. You will never need to manually map accounts again 
                (unless you add new GL codes).
              </p>
            </div>
          </div>
        </motion.div>

        {/* Company Info Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl shadow-lg p-8"
        >
          <h2 className="text-xl font-bold text-gray-900 mb-6">Company Information</h2>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Company Name *
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Acme Manufacturing Ltd"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Company ID *
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  placeholder="Unique identifier"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  onClick={generateCompanyId}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition text-sm font-medium"
                >
                  Generate
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reporting Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as any)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="USD">USD - US Dollar</option>
                <option value="EUR">EUR - Euro</option>
                <option value="GBP">GBP - British Pound</option>
                <option value="INR">INR - Indian Rupee</option>
                <option value="AED">AED - UAE Dirham</option>
                <option value="SGD">SGD - Singapore Dollar</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Financial Year End
              </label>
              <select
                value={yearEnd}
                onChange={(e) => setYearEnd(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(month => (
                  <option key={month} value={month}>{month}</option>
                ))}
              </select>
            </div>
          </div>
        </motion.div>

        {/* Onboarding Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl shadow-lg overflow-hidden"
        >
          {/* Tab Headers */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab(1)}
              className={`flex-1 px-6 py-4 font-medium transition ${
                activeTab === 1
                  ? "bg-blue-50 text-blue-700 border-b-2 border-blue-600"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Upload className="w-5 h-5 inline-block mr-2" />
              Upload Chart of Accounts
            </button>
            <button
              onClick={() => setActiveTab(2)}
              className={`flex-1 px-6 py-4 font-medium transition ${
                activeTab === 2
                  ? "bg-blue-50 text-blue-700 border-b-2 border-blue-600"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Building2 className="w-5 h-5 inline-block mr-2" />
              Use Industry Template
            </button>
            <button
              onClick={() => setActiveTab(3)}
              className={`flex-1 px-6 py-4 font-medium transition ${
                activeTab === 3
                  ? "bg-blue-50 text-blue-700 border-b-2 border-blue-600"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Sparkles className="w-5 h-5 inline-block mr-2" />
              AI-Assisted Setup
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-8">
            {/* TAB 1: Upload Pre-Mapped CoA */}
            {activeTab === 1 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload Chart of Accounts (Recommended)</h3>
                  <p className="text-gray-600 text-sm mb-4">
                    Upload a CSV/Excel file with your GL codes already mapped to IFRS line items
                  </p>
                </div>

                {/* Expected Format */}
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <p className="text-sm font-medium text-gray-700 mb-2">Expected format:</p>
                  <div className="bg-white rounded border border-gray-300 p-3 font-mono text-xs overflow-x-auto">
                    <div className="grid grid-cols-3 gap-4 font-semibold mb-2">
                      <div>GL Code</div>
                      <div>Account Name</div>
                      <div>IFRS Line Item</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-gray-600">
                      <div>1001</div>
                      <div>Cash & Bank</div>
                      <div className="text-xs">financialPosition.assets.current.cash...</div>
                    </div>
                  </div>
                  
                  <button
                    onClick={downloadTemplate}
                    className="mt-3 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    <Download className="w-4 h-4" />
                    Download Template CSV
                  </button>
                </div>

                {/* Upload Zone */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleFileDrop}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-blue-400 transition"
                >
                  {file ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-3 text-green-600">
                        <FileSpreadsheet className="w-8 h-8" />
                        <div className="text-left">
                          <p className="font-medium">{file.name}</p>
                          <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(2)} KB</p>
                        </div>
                        <CheckCircle className="w-6 h-6" />
                      </div>
                      <button
                        onClick={() => setFile(null)}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        Remove file
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600 mb-4">Drag and drop your file here, or</p>
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          className="hidden"
                          accept=".csv,.xlsx,.xls"
                          onChange={handleFileSelect}
                        />
                        <span className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition inline-block">
                          Browse Files
                        </span>
                      </label>
                      <p className="text-sm text-gray-500 mt-4">Supports .xlsx, .xls, .csv</p>
                    </>
                  )}
                </div>

                {file && (
                  <button
                    onClick={parseAndUploadCoA}
                    disabled={uploading}
                    className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploading ? "Processing..." : "Parse and Preview"}
                  </button>
                )}
              </div>
            )}

            {/* TAB 2: Industry Template */}
            {activeTab === 2 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Select Industry Template</h3>
                  <p className="text-gray-600 text-sm mb-6">
                    Choose a pre-configured template based on your industry. You can customize after loading.
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  {INDUSTRY_TEMPLATES.map((template) => {
                    const IconComponent = 
                      template.icon === "Factory" ? Factory :
                      template.icon === "ShoppingCart" ? ShoppingCart :
                      template.icon === "Briefcase" ? Briefcase :
                      template.icon === "Cpu" ? Cpu :
                      Building2;

                    return (
                      <button
                        key={template.id}
                        onClick={() => handleTemplateSelect(template.id)}
                        className="p-6 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition text-left group"
                      >
                        <div className="flex items-start gap-4">
                          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition">
                            <IconComponent className="w-6 h-6 text-blue-600" />
                          </div>
                          <div className="flex-1">
                            <h4 className="font-semibold text-lg text-gray-900 mb-1">{template.name}</h4>
                            <p className="text-sm text-gray-600 mb-2">{template.description}</p>
                            <p className="text-xs text-gray-500">~{template.accountCount} pre-mapped accounts</p>
                          </div>
                          <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 3: AI-Assisted */}
            {activeTab === 3 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">AI-Assisted Mapping</h3>
                  <p className="text-gray-600 text-sm mb-4">
                    Upload your Chart of Accounts WITHOUT the IFRS mapping column. AI will suggest mappings for you to review.
                  </p>
                </div>

                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleFileDrop}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-blue-400 transition"
                >
                  {file ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-3 text-green-600">
                        <FileSpreadsheet className="w-8 h-8" />
                        <div className="text-left">
                          <p className="font-medium">{file.name}</p>
                          <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(2)} KB</p>
                        </div>
                        <CheckCircle className="w-6 h-6" />
                      </div>
                    </div>
                  ) : (
                    <>
                      <Sparkles className="w-12 h-12 text-purple-400 mx-auto mb-4" />
                      <p className="text-gray-600 mb-4">Upload Chart of Accounts (just GL Code and Account Name)</p>
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          className="hidden"
                          accept=".csv,.xlsx,.xls"
                          onChange={handleFileSelect}
                        />
                        <span className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition inline-block">
                          Browse Files
                        </span>
                      </label>
                    </>
                  )}
                </div>

                {file && (
                  <button
                    onClick={async () => {
                      await parseAndUploadCoA();
                      await handleAIMapping();
                    }}
                    disabled={aiProcessing}
                    className="w-full px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {aiProcessing ? (
                      <>
                        <Sparkles className="w-5 h-5 animate-pulse" />
                        AI is analyzing your accounts...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        Upload & Get AI Suggestions
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </motion.div>

        {/* Preview & Save */}
        {showPreview && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl shadow-lg p-8"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Mapping Preview</h2>
                <p className="text-sm text-gray-600">
                  {Object.keys(mappings).length} of {chartOfAccounts.length} accounts mapped
                </p>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPreview(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={Object.keys(mappings).length === 0}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <CheckCircle className="w-5 h-5" />
                  Save & Complete Setup
                </button>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">GL Code</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Account Name</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">IFRS Mapping</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-700">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {chartOfAccounts.slice(0, 20).map((account) => {
                    const isMapped = !!mappings[account.glCode];
                    const ifrsItem = IFRS_LINE_ITEMS.find(item => item.value === mappings[account.glCode]);
                    
                    return (
                      <tr key={account.glCode} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs">{account.glCode}</td>
                        <td className="px-4 py-3">{account.accountName}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {isMapped ? ifrsItem?.label || mappings[account.glCode] : "-"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isMapped ? (
                            <CheckCircle className="w-5 h-5 text-green-500 inline-block" />
                          ) : (
                            <AlertCircle className="w-5 h-5 text-amber-500 inline-block" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {chartOfAccounts.length > 20 && (
              <p className="text-sm text-gray-500 mt-4 text-center">
                Showing first 20 accounts. All {chartOfAccounts.length} will be saved.
              </p>
            )}
          </motion.div>
        )}

        {/* Error Display */}
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3"
          >
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-red-800 text-sm">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-600 hover:text-red-700"
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
};
