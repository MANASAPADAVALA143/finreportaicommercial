import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Multi-Upload Modal for FP&A Suite
// Supports 3 upload modes:
// 1. Multi-sheet Excel workbook (auto-detect)
// 2. Single-sheet file with manual classification
// 3. Multiple separate files (4-slot upload)
import { useState, useRef } from 'react';
import { X, Upload, CheckCircle, FileText, FileSpreadsheet, Layers } from 'lucide-react';
import { parseTrialBalance, parseMultiSheetWorkbook, hasMultipleSheets } from '../../services/fpaDataService';
import toast from 'react-hot-toast';
export const MultiUploadModal = ({ isOpen, onClose }) => {
    const [uploadMode, setUploadMode] = useState('auto');
    const [uploadSlots, setUploadSlots] = useState([
        {
            key: 'actual',
            label: 'Actual Trial Balance',
            description: 'Current period actual data (Required for most modules)',
            storageKey: 'fpa_actual',
            required: true,
            uploaded: !!localStorage.getItem('fpa_actual')
        },
        {
            key: 'budget',
            label: 'Budget Trial Balance',
            description: 'Annual budget data (Required for Variance Analysis)',
            storageKey: 'fpa_budget',
            required: true,
            uploaded: !!localStorage.getItem('fpa_budget')
        },
        {
            key: 'prior_year',
            label: 'Prior Year Trial Balance',
            description: 'Last year data for YoY comparison (Optional)',
            storageKey: 'fpa_prior_year',
            required: false,
            uploaded: !!localStorage.getItem('fpa_prior_year')
        },
        {
            key: 'forecast',
            label: 'Monthly Revenue / Forecast',
            description: 'Forward-looking forecast (Optional)',
            storageKey: 'fpa_forecast',
            required: false,
            uploaded: !!localStorage.getItem('fpa_forecast')
        },
        {
            key: 'departments',
            label: 'Department Expenses',
            description: 'Department-level expense breakdown (Optional)',
            storageKey: 'fpa_departments',
            required: false,
            uploaded: !!localStorage.getItem('fpa_departments')
        },
        {
            key: 'scenarios',
            label: 'Scenario Planning Data',
            description: 'Pre-defined scenarios (Optional)',
            storageKey: 'fpa_scenarios',
            required: false,
            uploaded: !!localStorage.getItem('fpa_scenarios')
        }
    ]);
    const fileInputRefs = useRef({});
    const smartUploadRef = useRef(null);
    const [uploading, setUploading] = useState(null);
    const [showClassifyDialog, setShowClassifyDialog] = useState(false);
    const [pendingFile, setPendingFile] = useState(null);
    const [selectedDataType, setSelectedDataType] = useState('actual');
    // === MODE 1: Smart Upload (Auto-detect multi-sheet or ask for single-sheet) ===
    const handleSmartUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file)
            return;
        // Check if it's Excel with multiple sheets
        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            setUploading('smart');
            const loadingToast = toast.loading('🔍 Analyzing file structure...');
            try {
                const { isMultiSheet, sheetNames } = await hasMultipleSheets(file);
                if (isMultiSheet) {
                    // MODE 1A: Multi-sheet Excel
                    toast.loading('📊 Processing multiple sheets...', { id: loadingToast });
                    const results = await parseMultiSheetWorkbook(file);
                    const successCount = results.filter(r => r.success).length;
                    const failedCount = results.filter(r => !r.success).length;
                    // Update UI for successfully loaded sheets
                    setUploadSlots(prev => prev.map(slot => {
                        const result = results.find(r => r.storageKey === slot.storageKey && r.success);
                        return result ? { ...slot, uploaded: true, fileName: `${result.sheetName} (${file.name})` } : slot;
                    }));
                    if (successCount > 0) {
                        toast.success(`✅ ${successCount} sheet${successCount > 1 ? 's' : ''} loaded successfully!\n${sheetNames.join(', ')}`, { id: loadingToast, duration: 4000 });
                    }
                    if (failedCount > 0) {
                        const failedSheets = results.filter(r => !r.success).map(r => `${r.sheetName}: ${r.error}`).join('\n');
                        toast.error(`⚠️ ${failedCount} sheet(s) failed:\n${failedSheets}`, { duration: 5000 });
                    }
                }
                else {
                    // MODE 1B: Single sheet - ask user to classify
                    toast.dismiss(loadingToast);
                    setPendingFile(file);
                    setShowClassifyDialog(true);
                }
            }
            catch (error) {
                toast.error(`❌ ${error.message}`, { id: loadingToast });
            }
            finally {
                setUploading(null);
                if (smartUploadRef.current) {
                    smartUploadRef.current.value = '';
                }
            }
        }
        else {
            // CSV file - ask user to classify
            setPendingFile(file);
            setShowClassifyDialog(true);
        }
    };
    // Handle classification and save
    const handleClassifyAndSave = async () => {
        if (!pendingFile)
            return;
        const slot = uploadSlots.find(s => s.key === selectedDataType);
        if (!slot)
            return;
        setShowClassifyDialog(false);
        setUploading('classify');
        const loadingToast = toast.loading(`📊 Processing ${slot.label}...`);
        try {
            const parsedData = await parseTrialBalance(pendingFile);
            localStorage.setItem(slot.storageKey, JSON.stringify({
                ...parsedData,
                uploadedAt: new Date().toISOString(),
                fileName: pendingFile.name,
                dataType: slot.key
            }));
            setUploadSlots(prev => prev.map(s => s.key === slot.key
                ? { ...s, uploaded: true, fileName: pendingFile.name }
                : s));
            toast.success(`✅ ${slot.label} loaded — ${getModulesUsingData(slot.key)} ready`, { id: loadingToast, duration: 3000 });
        }
        catch (error) {
            toast.error(`❌ ${error.message}`, { id: loadingToast });
        }
        finally {
            setUploading(null);
            setPendingFile(null);
            if (smartUploadRef.current) {
                smartUploadRef.current.value = '';
            }
        }
    };
    // === MODE 2: Manual Upload (Existing 4-slot system) ===
    const handleManualFileSelect = async (slotKey, event) => {
        const file = event.target.files?.[0];
        if (!file)
            return;
        setUploading(slotKey);
        const slot = uploadSlots.find(s => s.key === slotKey);
        if (!slot)
            return;
        const loadingToast = toast.loading(`📊 Uploading ${slot.label}...`);
        try {
            const parsedData = await parseTrialBalance(file);
            localStorage.setItem(slot.storageKey, JSON.stringify({
                ...parsedData,
                uploadedAt: new Date().toISOString(),
                fileName: file.name,
                dataType: slot.key
            }));
            setUploadSlots(prev => prev.map(s => s.key === slotKey
                ? { ...s, uploaded: true, fileName: file.name }
                : s));
            toast.success(`✅ ${slot.label} uploaded successfully!\n${parsedData.rowCount} accounts parsed.`, { id: loadingToast, duration: 3000 });
        }
        catch (error) {
            toast.error(`❌ ${error.message}`, { id: loadingToast });
        }
        finally {
            setUploading(null);
            if (fileInputRefs.current[slotKey]) {
                fileInputRefs.current[slotKey].value = '';
            }
        }
    };
    const handleClearData = (slot) => {
        localStorage.removeItem(slot.storageKey);
        setUploadSlots(prev => prev.map(s => s.key === slot.key
            ? { ...s, uploaded: false, fileName: undefined }
            : s));
        toast.success(`Cleared ${slot.label}`);
    };
    const getModulesUsingData = (key) => {
        const modules = {
            actual: 'Variance Analysis, Scenario Planning, KPI Dashboard',
            budget: 'Variance Analysis, Budget Management, KPI Dashboard',
            prior_year: 'Budget Management (YoY)',
            forecast: 'Forecasting Engine, Management Reports',
            departments: 'Budget Management, Management Reports',
            scenarios: 'Scenario Planning'
        };
        return modules[key] || 'Multiple modules';
    };
    if (!isOpen)
        return null;
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50", children: _jsxs("div", { className: "bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl", children: [_jsx("div", { className: "sticky top-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 rounded-t-xl z-10", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold mb-1", children: "FP&A Data Upload" }), _jsx("p", { className: "text-blue-100 text-sm", children: "Choose your upload method below" })] }), _jsx("button", { onClick: onClose, className: "p-2 hover:bg-white/20 rounded-lg transition", children: _jsx(X, { className: "w-6 h-6" }) })] }) }), _jsx("div", { className: "p-6 border-b border-gray-200 bg-gray-50", children: _jsxs("div", { className: "flex gap-3 mb-4", children: [_jsxs("button", { onClick: () => setUploadMode('auto'), className: `flex-1 p-4 rounded-lg border-2 transition-all ${uploadMode === 'auto'
                                            ? 'border-blue-500 bg-blue-50 shadow-md'
                                            : 'border-gray-200 bg-white hover:border-gray-300'}`, children: [_jsxs("div", { className: "flex items-center gap-3 mb-2", children: [_jsx(FileSpreadsheet, { className: `w-6 h-6 ${uploadMode === 'auto' ? 'text-blue-600' : 'text-gray-400'}` }), _jsx("h3", { className: `font-semibold ${uploadMode === 'auto' ? 'text-blue-900' : 'text-gray-700'}`, children: "Smart Upload (Recommended)" })] }), _jsx("p", { className: "text-sm text-gray-600", children: "Upload one Excel file with multiple sheets \u2014 we'll auto-detect and load everything" })] }), _jsxs("button", { onClick: () => setUploadMode('manual'), className: `flex-1 p-4 rounded-lg border-2 transition-all ${uploadMode === 'manual'
                                            ? 'border-purple-500 bg-purple-50 shadow-md'
                                            : 'border-gray-200 bg-white hover:border-gray-300'}`, children: [_jsxs("div", { className: "flex items-center gap-3 mb-2", children: [_jsx(Layers, { className: `w-6 h-6 ${uploadMode === 'manual' ? 'text-purple-600' : 'text-gray-400'}` }), _jsx("h3", { className: `font-semibold ${uploadMode === 'manual' ? 'text-purple-900' : 'text-gray-700'}`, children: "Manual Upload" })] }), _jsx("p", { className: "text-sm text-gray-600", children: "Upload separate files one-by-one for each data type" })] })] }) }), _jsx("div", { className: "p-6", children: uploadMode === 'auto' ? (
                            // SMART UPLOAD MODE
                            _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-dashed border-blue-300 rounded-xl p-8 text-center", children: [_jsx(FileSpreadsheet, { className: "w-16 h-16 text-blue-600 mx-auto mb-4" }), _jsx("h3", { className: "text-xl font-bold text-gray-900 mb-2", children: "Drop your Excel file here" }), _jsxs("p", { className: "text-gray-600 mb-4", children: ["Or click to browse \u2014 we'll automatically detect sheet names like:", _jsx("br", {}), _jsx("span", { className: "font-mono text-sm text-blue-700", children: "Actual_TB, Budget, Monthly_Revenue, Departments, Scenarios" })] }), _jsx("input", { ref: smartUploadRef, type: "file", accept: ".xlsx,.xls,.csv", onChange: handleSmartUpload, className: "hidden" }), _jsxs("button", { onClick: () => smartUploadRef.current?.click(), disabled: uploading === 'smart', className: "px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed inline-flex items-center gap-2", children: [_jsx(Upload, { className: "w-5 h-5" }), uploading === 'smart' ? 'Processing...' : 'Choose File'] }), _jsxs("div", { className: "mt-6 text-left bg-white rounded-lg p-4 border border-blue-200", children: [_jsx("p", { className: "font-semibold text-gray-900 mb-2", children: "\uD83D\uDCA1 How it works:" }), _jsxs("ul", { className: "text-sm text-gray-700 space-y-1", children: [_jsxs("li", { children: ["\u2705 ", _jsx("strong", { children: "Multi-sheet Excel:" }), " We auto-detect and load all recognized sheets"] }), _jsxs("li", { children: ["\u2705 ", _jsx("strong", { children: "Single-sheet file:" }), " We'll ask you what data type it is"] }), _jsxs("li", { children: ["\u2705 ", _jsx("strong", { children: "CSV files:" }), " Upload and classify manually"] })] })] })] }), _jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("h4", { className: "font-semibold text-gray-900 mb-3", children: "Current Data Status:" }), _jsx("div", { className: "grid grid-cols-2 gap-3", children: uploadSlots.map(slot => (_jsxs("div", { className: `flex items-center gap-2 p-3 rounded-lg border ${slot.uploaded
                                                        ? 'bg-green-50 border-green-300'
                                                        : 'bg-white border-gray-200'}`, children: [slot.uploaded ? (_jsx(CheckCircle, { className: "w-5 h-5 text-green-600 flex-shrink-0" })) : (_jsx("div", { className: "w-5 h-5 rounded-full border-2 border-gray-300 flex-shrink-0" })), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("p", { className: "text-sm font-medium text-gray-900 truncate", children: slot.label }), slot.uploaded && slot.fileName && (_jsx("p", { className: "text-xs text-gray-500 truncate", children: slot.fileName }))] }), slot.uploaded && (_jsx("button", { onClick: () => handleClearData(slot), className: "text-xs text-red-600 hover:text-red-700 font-medium", children: "Clear" }))] }, slot.key))) })] })] })) : (
                            // MANUAL UPLOAD MODE (Existing 4-slot system)
                            _jsx("div", { className: "space-y-4", children: uploadSlots.map((slot) => (_jsx("div", { className: `border-2 rounded-lg p-4 transition-all ${slot.uploaded
                                        ? 'border-green-300 bg-green-50'
                                        : slot.required
                                            ? 'border-orange-300 bg-orange-50'
                                            : 'border-gray-200 bg-white'}`, children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-2 mb-1", children: [_jsx("h3", { className: "font-semibold text-gray-900", children: slot.label }), slot.required && (_jsx("span", { className: "px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded-full", children: "Required" })), !slot.required && (_jsx("span", { className: "px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full", children: "Optional" }))] }), _jsx("p", { className: "text-sm text-gray-600 mb-3", children: slot.description }), slot.uploaded && slot.fileName && (_jsxs("div", { className: "flex items-center gap-2 text-sm text-green-700 bg-white px-3 py-2 rounded border border-green-200 mb-2", children: [_jsx(CheckCircle, { className: "w-4 h-4" }), _jsx(FileText, { className: "w-4 h-4" }), _jsx("span", { className: "flex-1 font-medium", children: slot.fileName })] })), _jsxs("div", { className: "text-xs text-gray-500 mt-2", children: [_jsx("strong", { children: "Used by:" }), " ", getModulesUsingData(slot.key)] })] }), _jsxs("div", { className: "flex flex-col gap-2 ml-4", children: [_jsx("input", { ref: el => fileInputRefs.current[slot.key] = el, type: "file", accept: ".xlsx,.xls,.csv", onChange: (e) => handleManualFileSelect(slot.key, e), className: "hidden" }), _jsxs("button", { onClick: () => fileInputRefs.current[slot.key]?.click(), disabled: uploading === slot.key, className: `flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${uploading === slot.key
                                                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                            : slot.uploaded
                                                                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                                                : 'bg-blue-600 text-white hover:bg-blue-700'}`, children: [_jsx(Upload, { className: "w-4 h-4" }), uploading === slot.key ? 'Uploading...' : slot.uploaded ? 'Re-upload' : 'Upload'] }), slot.uploaded && (_jsx("button", { onClick: () => handleClearData(slot), className: "px-4 py-2 bg-red-100 text-red-700 rounded-lg font-medium hover:bg-red-200 transition-colors text-sm", children: "Clear" }))] })] }) }, slot.key))) })) }), _jsxs("div", { className: "sticky bottom-0 bg-gray-50 px-6 py-4 border-t border-gray-200 rounded-b-xl flex items-center justify-between", children: [_jsxs("div", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "font-semibold text-gray-900", children: uploadSlots.filter(s => s.uploaded).length }), " of ", uploadSlots.length, " datasets uploaded"] }), _jsx("button", { onClick: onClose, className: "px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors", children: "Done" })] })] }) }), showClassifyDialog && pendingFile && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-[60]", children: _jsxs("div", { className: "bg-white rounded-xl max-w-md w-full shadow-2xl", children: [_jsxs("div", { className: "bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6 rounded-t-xl", children: [_jsx("h3", { className: "text-xl font-bold", children: "Classify Your Data" }), _jsx("p", { className: "text-purple-100 text-sm mt-1", children: "Tell us what type of data this file contains" })] }), _jsxs("div", { className: "p-6", children: [_jsxs("div", { className: "mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2", children: [_jsx(FileText, { className: "w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("p", { className: "text-sm font-medium text-gray-900 truncate", children: pendingFile.name }), _jsx("p", { className: "text-xs text-gray-600", children: "Single sheet detected" })] })] }), _jsx("label", { className: "block text-sm font-semibold text-gray-900 mb-2", children: "This data is:" }), _jsx("select", { value: selectedDataType, onChange: (e) => setSelectedDataType(e.target.value), className: "w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition", children: uploadSlots.map(slot => (_jsx("option", { value: slot.key, children: slot.label }, slot.key))) }), _jsxs("div", { className: "mt-4 text-xs text-gray-600 bg-gray-50 p-3 rounded-lg", children: [_jsx("strong", { className: "text-gray-900", children: "Will be used by:" }), _jsx("br", {}), getModulesUsingData(selectedDataType)] })] }), _jsxs("div", { className: "bg-gray-50 px-6 py-4 border-t border-gray-200 rounded-b-xl flex gap-3", children: [_jsx("button", { onClick: () => {
                                        setShowClassifyDialog(false);
                                        setPendingFile(null);
                                        if (smartUploadRef.current) {
                                            smartUploadRef.current.value = '';
                                        }
                                    }, className: "flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors", children: "Cancel" }), _jsx("button", { onClick: handleClassifyAndSave, disabled: uploading === 'classify', className: "flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:bg-gray-400", children: uploading === 'classify' ? 'Processing...' : 'Upload & Save' })] })] }) }))] }));
};
