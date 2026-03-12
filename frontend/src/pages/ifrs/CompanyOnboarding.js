import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// ==================== COMPANY ONBOARDING — IFRS SETUP ====================
// "Map Once, Use Forever" — One-time Chart of Accounts mapping
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Building2, Upload, Sparkles, CheckCircle, AlertCircle, Download, FileSpreadsheet, Factory, ShoppingCart, Briefcase, Cpu, X, ArrowRight, Info } from "lucide-react";
import Papa from "papaparse";
import { saveCompanyMappings, IFRS_LINE_ITEMS, INDUSTRY_TEMPLATES, getAISuggestions } from "../../services/mappingService";
// ==================== MAIN COMPONENT ====================
export const CompanyOnboarding = () => {
    const navigate = useNavigate();
    // Company Info
    const [companyName, setCompanyName] = useState("");
    const [companyId, setCompanyId] = useState("");
    const [currency, setCurrency] = useState("USD");
    const [yearEnd, setYearEnd] = useState("Dec");
    // Tab Selection
    const [activeTab, setActiveTab] = useState(1);
    // Upload State
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [chartOfAccounts, setChartOfAccounts] = useState([]);
    const [mappings, setMappings] = useState({});
    const [showPreview, setShowPreview] = useState(false);
    // AI State
    const [aiProcessing, setAiProcessing] = useState(false);
    // Error State
    const [error, setError] = useState(null);
    // ==================== HANDLERS ====================
    const generateCompanyId = () => {
        const id = `CO${Date.now().toString(36).toUpperCase()}`;
        setCompanyId(id);
    };
    const handleFileSelect = (e) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setError(null);
        }
    };
    const handleFileDrop = (e) => {
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
                    const data = results.data;
                    const parsed = [];
                    const parsedMappings = {};
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
        }
        catch (err) {
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
                mappingStatus: "unmapped"
            }));
            const aiResults = await getAISuggestions(entries);
            const newMappings = {};
            for (const [glCode, result] of Object.entries(aiResults)) {
                if (result.suggestedMapping && result.confidence > 50) {
                    newMappings[glCode] = result.suggestedMapping;
                }
            }
            setMappings(newMappings);
            setShowPreview(true);
            setAiProcessing(false);
        }
        catch (err) {
            setError(`AI mapping failed: ${err.message}`);
            setAiProcessing(false);
        }
    };
    const handleTemplateSelect = (templateId) => {
        const template = INDUSTRY_TEMPLATES.find(t => t.id === templateId);
        if (!template)
            return;
        setMappings(template.mappings);
        // Generate sample chart of accounts from template
        const sampleCoA = Object.entries(template.mappings).map(([glCode, ifrsLine]) => ({
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
        }
        catch (err) {
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
    return (_jsxs("div", { className: "min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50", children: [_jsx("div", { className: "bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50", children: _jsx("div", { className: "max-w-7xl mx-auto px-6 py-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("button", { onClick: () => navigate("/dashboard"), className: "p-2 hover:bg-gray-100 rounded-lg transition", children: _jsx(ArrowLeft, { className: "w-5 h-5" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Company Setup \u2014 Chart of Accounts" }), _jsx("p", { className: "text-sm text-gray-500", children: "Upload once, auto-map forever" })] })] }), _jsx(Building2, { className: "w-8 h-8 text-blue-600" })] }) }) }), _jsxs("div", { className: "max-w-6xl mx-auto px-6 py-8 space-y-6", children: [_jsx(motion.div, { initial: { opacity: 0, y: -20 }, animate: { opacity: 1, y: 0 }, className: "bg-blue-50 border border-blue-200 rounded-xl p-6", children: _jsxs("div", { className: "flex gap-4", children: [_jsx(Info, { className: "w-6 h-6 text-blue-600 flex-shrink-0 mt-1" }), _jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-blue-900 mb-2", children: "This is a one-time setup" }), _jsxs("p", { className: "text-blue-800 text-sm", children: ["Once your Chart of Accounts is mapped to IFRS line items, every monthly Trial Balance upload will be ", _jsx("strong", { children: "100% automatic" }), ". You will never need to manually map accounts again (unless you add new GL codes)."] })] })] }) }), _jsxs(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, className: "bg-white rounded-xl shadow-lg p-8", children: [_jsx("h2", { className: "text-xl font-bold text-gray-900 mb-6", children: "Company Information" }), _jsxs("div", { className: "grid md:grid-cols-2 gap-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Company Name *" }), _jsx("input", { type: "text", value: companyName, onChange: (e) => setCompanyName(e.target.value), placeholder: "e.g. Acme Manufacturing Ltd", className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Company ID *" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { type: "text", value: companyId, onChange: (e) => setCompanyId(e.target.value), placeholder: "Unique identifier", className: "flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" }), _jsx("button", { onClick: generateCompanyId, className: "px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition text-sm font-medium", children: "Generate" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Reporting Currency" }), _jsxs("select", { value: currency, onChange: (e) => setCurrency(e.target.value), className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500", children: [_jsx("option", { value: "USD", children: "USD - US Dollar" }), _jsx("option", { value: "EUR", children: "EUR - Euro" }), _jsx("option", { value: "GBP", children: "GBP - British Pound" }), _jsx("option", { value: "INR", children: "INR - Indian Rupee" }), _jsx("option", { value: "AED", children: "AED - UAE Dirham" }), _jsx("option", { value: "SGD", children: "SGD - Singapore Dollar" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Financial Year End" }), _jsx("select", { value: yearEnd, onChange: (e) => setYearEnd(e.target.value), className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500", children: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(month => (_jsx("option", { value: month, children: month }, month))) })] })] })] }), _jsxs(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.1 }, className: "bg-white rounded-xl shadow-lg overflow-hidden", children: [_jsxs("div", { className: "flex border-b border-gray-200", children: [_jsxs("button", { onClick: () => setActiveTab(1), className: `flex-1 px-6 py-4 font-medium transition ${activeTab === 1
                                            ? "bg-blue-50 text-blue-700 border-b-2 border-blue-600"
                                            : "text-gray-600 hover:bg-gray-50"}`, children: [_jsx(Upload, { className: "w-5 h-5 inline-block mr-2" }), "Upload Chart of Accounts"] }), _jsxs("button", { onClick: () => setActiveTab(2), className: `flex-1 px-6 py-4 font-medium transition ${activeTab === 2
                                            ? "bg-blue-50 text-blue-700 border-b-2 border-blue-600"
                                            : "text-gray-600 hover:bg-gray-50"}`, children: [_jsx(Building2, { className: "w-5 h-5 inline-block mr-2" }), "Use Industry Template"] }), _jsxs("button", { onClick: () => setActiveTab(3), className: `flex-1 px-6 py-4 font-medium transition ${activeTab === 3
                                            ? "bg-blue-50 text-blue-700 border-b-2 border-blue-600"
                                            : "text-gray-600 hover:bg-gray-50"}`, children: [_jsx(Sparkles, { className: "w-5 h-5 inline-block mr-2" }), "AI-Assisted Setup"] })] }), _jsxs("div", { className: "p-8", children: [activeTab === 1 && (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-2", children: "Upload Chart of Accounts (Recommended)" }), _jsx("p", { className: "text-gray-600 text-sm mb-4", children: "Upload a CSV/Excel file with your GL codes already mapped to IFRS line items" })] }), _jsxs("div", { className: "bg-gray-50 rounded-lg p-4 border border-gray-200", children: [_jsx("p", { className: "text-sm font-medium text-gray-700 mb-2", children: "Expected format:" }), _jsxs("div", { className: "bg-white rounded border border-gray-300 p-3 font-mono text-xs overflow-x-auto", children: [_jsxs("div", { className: "grid grid-cols-3 gap-4 font-semibold mb-2", children: [_jsx("div", { children: "GL Code" }), _jsx("div", { children: "Account Name" }), _jsx("div", { children: "IFRS Line Item" })] }), _jsxs("div", { className: "grid grid-cols-3 gap-4 text-gray-600", children: [_jsx("div", { children: "1001" }), _jsx("div", { children: "Cash & Bank" }), _jsx("div", { className: "text-xs", children: "financialPosition.assets.current.cash..." })] })] }), _jsxs("button", { onClick: downloadTemplate, className: "mt-3 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium", children: [_jsx(Download, { className: "w-4 h-4" }), "Download Template CSV"] })] }), _jsx("div", { onDragOver: (e) => e.preventDefault(), onDrop: handleFileDrop, className: "border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-blue-400 transition", children: file ? (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-center gap-3 text-green-600", children: [_jsx(FileSpreadsheet, { className: "w-8 h-8" }), _jsxs("div", { className: "text-left", children: [_jsx("p", { className: "font-medium", children: file.name }), _jsxs("p", { className: "text-sm text-gray-500", children: [(file.size / 1024).toFixed(2), " KB"] })] }), _jsx(CheckCircle, { className: "w-6 h-6" })] }), _jsx("button", { onClick: () => setFile(null), className: "text-sm text-red-600 hover:text-red-700", children: "Remove file" })] })) : (_jsxs(_Fragment, { children: [_jsx(Upload, { className: "w-12 h-12 text-gray-400 mx-auto mb-4" }), _jsx("p", { className: "text-gray-600 mb-4", children: "Drag and drop your file here, or" }), _jsxs("label", { className: "cursor-pointer", children: [_jsx("input", { type: "file", className: "hidden", accept: ".csv,.xlsx,.xls", onChange: handleFileSelect }), _jsx("span", { className: "px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition inline-block", children: "Browse Files" })] }), _jsx("p", { className: "text-sm text-gray-500 mt-4", children: "Supports .xlsx, .xls, .csv" })] })) }), file && (_jsx("button", { onClick: parseAndUploadCoA, disabled: uploading, className: "w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed", children: uploading ? "Processing..." : "Parse and Preview" }))] })), activeTab === 2 && (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-2", children: "Select Industry Template" }), _jsx("p", { className: "text-gray-600 text-sm mb-6", children: "Choose a pre-configured template based on your industry. You can customize after loading." })] }), _jsx("div", { className: "grid md:grid-cols-2 gap-4", children: INDUSTRY_TEMPLATES.map((template) => {
                                                    const IconComponent = template.icon === "Factory" ? Factory :
                                                        template.icon === "ShoppingCart" ? ShoppingCart :
                                                            template.icon === "Briefcase" ? Briefcase :
                                                                template.icon === "Cpu" ? Cpu :
                                                                    Building2;
                                                    return (_jsx("button", { onClick: () => handleTemplateSelect(template.id), className: "p-6 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition text-left group", children: _jsxs("div", { className: "flex items-start gap-4", children: [_jsx("div", { className: "w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition", children: _jsx(IconComponent, { className: "w-6 h-6 text-blue-600" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("h4", { className: "font-semibold text-lg text-gray-900 mb-1", children: template.name }), _jsx("p", { className: "text-sm text-gray-600 mb-2", children: template.description }), _jsxs("p", { className: "text-xs text-gray-500", children: ["~", template.accountCount, " pre-mapped accounts"] })] }), _jsx(ArrowRight, { className: "w-5 h-5 text-gray-400 group-hover:text-blue-600 transition" })] }) }, template.id));
                                                }) })] })), activeTab === 3 && (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-2", children: "AI-Assisted Mapping" }), _jsx("p", { className: "text-gray-600 text-sm mb-4", children: "Upload your Chart of Accounts WITHOUT the IFRS mapping column. AI will suggest mappings for you to review." })] }), _jsx("div", { onDragOver: (e) => e.preventDefault(), onDrop: handleFileDrop, className: "border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-blue-400 transition", children: file ? (_jsx("div", { className: "space-y-4", children: _jsxs("div", { className: "flex items-center justify-center gap-3 text-green-600", children: [_jsx(FileSpreadsheet, { className: "w-8 h-8" }), _jsxs("div", { className: "text-left", children: [_jsx("p", { className: "font-medium", children: file.name }), _jsxs("p", { className: "text-sm text-gray-500", children: [(file.size / 1024).toFixed(2), " KB"] })] }), _jsx(CheckCircle, { className: "w-6 h-6" })] }) })) : (_jsxs(_Fragment, { children: [_jsx(Sparkles, { className: "w-12 h-12 text-purple-400 mx-auto mb-4" }), _jsx("p", { className: "text-gray-600 mb-4", children: "Upload Chart of Accounts (just GL Code and Account Name)" }), _jsxs("label", { className: "cursor-pointer", children: [_jsx("input", { type: "file", className: "hidden", accept: ".csv,.xlsx,.xls", onChange: handleFileSelect }), _jsx("span", { className: "px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition inline-block", children: "Browse Files" })] })] })) }), file && (_jsx("button", { onClick: async () => {
                                                    await parseAndUploadCoA();
                                                    await handleAIMapping();
                                                }, disabled: aiProcessing, className: "w-full px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2", children: aiProcessing ? (_jsxs(_Fragment, { children: [_jsx(Sparkles, { className: "w-5 h-5 animate-pulse" }), "AI is analyzing your accounts..."] })) : (_jsxs(_Fragment, { children: [_jsx(Sparkles, { className: "w-5 h-5" }), "Upload & Get AI Suggestions"] })) }))] }))] })] }), showPreview && (_jsxs(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, className: "bg-white rounded-xl shadow-lg p-8", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Mapping Preview" }), _jsxs("p", { className: "text-sm text-gray-600", children: [Object.keys(mappings).length, " of ", chartOfAccounts.length, " accounts mapped"] })] }), _jsxs("div", { className: "flex gap-3", children: [_jsx("button", { onClick: () => setShowPreview(false), className: "px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition", children: "Cancel" }), _jsxs("button", { onClick: handleSave, disabled: Object.keys(mappings).length === 0, className: "px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2", children: [_jsx(CheckCircle, { className: "w-5 h-5" }), "Save & Complete Setup"] })] })] }), _jsx("div", { className: "max-h-96 overflow-y-auto border border-gray-200 rounded-lg", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "bg-gray-50 sticky top-0", children: _jsxs("tr", { children: [_jsx("th", { className: "px-4 py-3 text-left font-semibold text-gray-700", children: "GL Code" }), _jsx("th", { className: "px-4 py-3 text-left font-semibold text-gray-700", children: "Account Name" }), _jsx("th", { className: "px-4 py-3 text-left font-semibold text-gray-700", children: "IFRS Mapping" }), _jsx("th", { className: "px-4 py-3 text-center font-semibold text-gray-700", children: "Status" })] }) }), _jsx("tbody", { className: "divide-y divide-gray-200", children: chartOfAccounts.slice(0, 20).map((account) => {
                                                const isMapped = !!mappings[account.glCode];
                                                const ifrsItem = IFRS_LINE_ITEMS.find(item => item.value === mappings[account.glCode]);
                                                return (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: "px-4 py-3 font-mono text-xs", children: account.glCode }), _jsx("td", { className: "px-4 py-3", children: account.accountName }), _jsx("td", { className: "px-4 py-3 text-xs text-gray-600", children: isMapped ? ifrsItem?.label || mappings[account.glCode] : "-" }), _jsx("td", { className: "px-4 py-3 text-center", children: isMapped ? (_jsx(CheckCircle, { className: "w-5 h-5 text-green-500 inline-block" })) : (_jsx(AlertCircle, { className: "w-5 h-5 text-amber-500 inline-block" })) })] }, account.glCode));
                                            }) })] }) }), chartOfAccounts.length > 20 && (_jsxs("p", { className: "text-sm text-gray-500 mt-4 text-center", children: ["Showing first 20 accounts. All ", chartOfAccounts.length, " will be saved."] }))] })), error && (_jsxs(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, className: "bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3", children: [_jsx(AlertCircle, { className: "w-5 h-5 text-red-600 flex-shrink-0" }), _jsx("p", { className: "text-red-800 text-sm", children: error }), _jsx("button", { onClick: () => setError(null), className: "ml-auto text-red-600 hover:text-red-700", children: _jsx(X, { className: "w-5 h-5" }) })] }))] })] }));
};
