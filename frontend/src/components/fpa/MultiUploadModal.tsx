// Multi-Upload Modal for FP&A Suite
// Supports 3 upload modes:
// 1. Multi-sheet Excel workbook (auto-detect)
// 2. Single-sheet file with manual classification
// 3. Multiple separate files (4-slot upload)
import React, { useState, useRef } from 'react';
import { X, Upload, CheckCircle, AlertCircle, FileText, FileSpreadsheet, Layers } from 'lucide-react';
import { parseTrialBalance, parseMultiSheetWorkbook, hasMultipleSheets, MultiSheetResult } from '../../services/fpaDataService';
import toast from 'react-hot-toast';

interface UploadSlot {
  key: 'actual' | 'budget' | 'prior_year' | 'forecast' | 'departments' | 'scenarios';
  label: string;
  description: string;
  storageKey: string;
  required: boolean;
  uploaded: boolean;
  fileName?: string;
}

interface MultiUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type UploadMode = 'auto' | 'manual';

export const MultiUploadModal: React.FC<MultiUploadModalProps> = ({ isOpen, onClose }) => {
  const [uploadMode, setUploadMode] = useState<UploadMode>('auto');
  const [uploadSlots, setUploadSlots] = useState<UploadSlot[]>([
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

  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const smartUploadRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [showClassifyDialog, setShowClassifyDialog] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [selectedDataType, setSelectedDataType] = useState<string>('actual');

  // === MODE 1: Smart Upload (Auto-detect multi-sheet or ask for single-sheet) ===
  const handleSmartUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

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
            toast.success(
              `✅ ${successCount} sheet${successCount > 1 ? 's' : ''} loaded successfully!\n${sheetNames.join(', ')}`,
              { id: loadingToast, duration: 4000 }
            );
          }

          if (failedCount > 0) {
            const failedSheets = results.filter(r => !r.success).map(r => `${r.sheetName}: ${r.error}`).join('\n');
            toast.error(`⚠️ ${failedCount} sheet(s) failed:\n${failedSheets}`, { duration: 5000 });
          }

        } else {
          // MODE 1B: Single sheet - ask user to classify
          toast.dismiss(loadingToast);
          setPendingFile(file);
          setShowClassifyDialog(true);
        }

      } catch (error: any) {
        toast.error(`❌ ${error.message}`, { id: loadingToast });
      } finally {
        setUploading(null);
        if (smartUploadRef.current) {
          smartUploadRef.current.value = '';
        }
      }
    } else {
      // CSV file - ask user to classify
      setPendingFile(file);
      setShowClassifyDialog(true);
    }
  };

  // Handle classification and save
  const handleClassifyAndSave = async () => {
    if (!pendingFile) return;

    const slot = uploadSlots.find(s => s.key === selectedDataType);
    if (!slot) return;

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

      setUploadSlots(prev => prev.map(s => 
        s.key === slot.key 
          ? { ...s, uploaded: true, fileName: pendingFile.name }
          : s
      ));

      toast.success(
        `✅ ${slot.label} loaded — ${getModulesUsingData(slot.key)} ready`,
        { id: loadingToast, duration: 3000 }
      );

    } catch (error: any) {
      toast.error(`❌ ${error.message}`, { id: loadingToast });
    } finally {
      setUploading(null);
      setPendingFile(null);
      if (smartUploadRef.current) {
        smartUploadRef.current.value = '';
      }
    }
  };

  // === MODE 2: Manual Upload (Existing 4-slot system) ===
  const handleManualFileSelect = async (slotKey: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(slotKey);
    const slot = uploadSlots.find(s => s.key === slotKey);
    if (!slot) return;

    const loadingToast = toast.loading(`📊 Uploading ${slot.label}...`);

    try {
      const parsedData = await parseTrialBalance(file);
      
      localStorage.setItem(slot.storageKey, JSON.stringify({
        ...parsedData,
        uploadedAt: new Date().toISOString(),
        fileName: file.name,
        dataType: slot.key
      }));

      setUploadSlots(prev => prev.map(s => 
        s.key === slotKey 
          ? { ...s, uploaded: true, fileName: file.name }
          : s
      ));

      toast.success(
        `✅ ${slot.label} uploaded successfully!\n${parsedData.rowCount} accounts parsed.`,
        { id: loadingToast, duration: 3000 }
      );
    } catch (error: any) {
      toast.error(`❌ ${error.message}`, { id: loadingToast });
    } finally {
      setUploading(null);
      if (fileInputRefs.current[slotKey]) {
        fileInputRefs.current[slotKey]!.value = '';
      }
    }
  };

  const handleClearData = (slot: UploadSlot) => {
    localStorage.removeItem(slot.storageKey);
    setUploadSlots(prev => prev.map(s => 
      s.key === slot.key 
        ? { ...s, uploaded: false, fileName: undefined }
        : s
    ));
    toast.success(`Cleared ${slot.label}`);
  };

  const getModulesUsingData = (key: string): string => {
    const modules: Record<string, string> = {
      actual: 'Variance Analysis, Scenario Planning, KPI Dashboard',
      budget: 'Variance Analysis, Budget Management, KPI Dashboard',
      prior_year: 'Budget Management (YoY)',
      forecast: 'Forecasting Engine, Management Reports',
      departments: 'Budget Management, Management Reports',
      scenarios: 'Scenario Planning'
    };
    return modules[key] || 'Multiple modules';
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
          {/* Header */}
          <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 rounded-t-xl z-10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold mb-1">FP&A Data Upload</h2>
                <p className="text-blue-100 text-sm">Choose your upload method below</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-lg transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Upload Mode Toggle */}
          <div className="p-6 border-b border-gray-200 bg-gray-50">
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => setUploadMode('auto')}
                className={`flex-1 p-4 rounded-lg border-2 transition-all ${
                  uploadMode === 'auto'
                    ? 'border-blue-500 bg-blue-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <FileSpreadsheet className={`w-6 h-6 ${uploadMode === 'auto' ? 'text-blue-600' : 'text-gray-400'}`} />
                  <h3 className={`font-semibold ${uploadMode === 'auto' ? 'text-blue-900' : 'text-gray-700'}`}>
                    Smart Upload (Recommended)
                  </h3>
                </div>
                <p className="text-sm text-gray-600">
                  Upload one Excel file with multiple sheets — we'll auto-detect and load everything
                </p>
              </button>

              <button
                onClick={() => setUploadMode('manual')}
                className={`flex-1 p-4 rounded-lg border-2 transition-all ${
                  uploadMode === 'manual'
                    ? 'border-purple-500 bg-purple-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <Layers className={`w-6 h-6 ${uploadMode === 'manual' ? 'text-purple-600' : 'text-gray-400'}`} />
                  <h3 className={`font-semibold ${uploadMode === 'manual' ? 'text-purple-900' : 'text-gray-700'}`}>
                    Manual Upload
                  </h3>
                </div>
                <p className="text-sm text-gray-600">
                  Upload separate files one-by-one for each data type
                </p>
              </button>
            </div>
          </div>

          {/* Upload Content */}
          <div className="p-6">
            {uploadMode === 'auto' ? (
              // SMART UPLOAD MODE
              <div className="space-y-4">
                <div className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-dashed border-blue-300 rounded-xl p-8 text-center">
                  <FileSpreadsheet className="w-16 h-16 text-blue-600 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Drop your Excel file here</h3>
                  <p className="text-gray-600 mb-4">
                    Or click to browse — we'll automatically detect sheet names like:<br />
                    <span className="font-mono text-sm text-blue-700">Actual_TB, Budget, Monthly_Revenue, Departments, Scenarios</span>
                  </p>
                  
                  <input
                    ref={smartUploadRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleSmartUpload}
                    className="hidden"
                  />
                  
                  <button
                    onClick={() => smartUploadRef.current?.click()}
                    disabled={uploading === 'smart'}
                    className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed inline-flex items-center gap-2"
                  >
                    <Upload className="w-5 h-5" />
                    {uploading === 'smart' ? 'Processing...' : 'Choose File'}
                  </button>

                  <div className="mt-6 text-left bg-white rounded-lg p-4 border border-blue-200">
                    <p className="font-semibold text-gray-900 mb-2">💡 How it works:</p>
                    <ul className="text-sm text-gray-700 space-y-1">
                      <li>✅ <strong>Multi-sheet Excel:</strong> We auto-detect and load all recognized sheets</li>
                      <li>✅ <strong>Single-sheet file:</strong> We'll ask you what data type it is</li>
                      <li>✅ <strong>CSV files:</strong> Upload and classify manually</li>
                    </ul>
                  </div>
                </div>

                {/* Status Display */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Current Data Status:</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {uploadSlots.map(slot => (
                      <div
                        key={slot.key}
                        className={`flex items-center gap-2 p-3 rounded-lg border ${
                          slot.uploaded
                            ? 'bg-green-50 border-green-300'
                            : 'bg-white border-gray-200'
                        }`}
                      >
                        {slot.uploaded ? (
                          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{slot.label}</p>
                          {slot.uploaded && slot.fileName && (
                            <p className="text-xs text-gray-500 truncate">{slot.fileName}</p>
                          )}
                        </div>
                        {slot.uploaded && (
                          <button
                            onClick={() => handleClearData(slot)}
                            className="text-xs text-red-600 hover:text-red-700 font-medium"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              // MANUAL UPLOAD MODE (Existing 4-slot system)
              <div className="space-y-4">
                {uploadSlots.map((slot) => (
                  <div
                    key={slot.key}
                    className={`border-2 rounded-lg p-4 transition-all ${
                      slot.uploaded
                        ? 'border-green-300 bg-green-50'
                        : slot.required
                        ? 'border-orange-300 bg-orange-50'
                        : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-gray-900">{slot.label}</h3>
                          {slot.required && (
                            <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">
                              Required
                            </span>
                          )}
                          {!slot.required && (
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
                              Optional
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mb-3">{slot.description}</p>

                        {slot.uploaded && slot.fileName && (
                          <div className="flex items-center gap-2 text-sm text-green-700 bg-white px-3 py-2 rounded border border-green-200 mb-2">
                            <CheckCircle className="w-4 h-4" />
                            <FileText className="w-4 h-4" />
                            <span className="flex-1 font-medium">{slot.fileName}</span>
                          </div>
                        )}

                        <div className="text-xs text-gray-500 mt-2">
                          <strong>Used by:</strong> {getModulesUsingData(slot.key)}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 ml-4">
                        <input
                          ref={el => fileInputRefs.current[slot.key] = el}
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          onChange={(e) => handleManualFileSelect(slot.key, e)}
                          className="hidden"
                        />
                        
                        <button
                          onClick={() => fileInputRefs.current[slot.key]?.click()}
                          disabled={uploading === slot.key}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                            uploading === slot.key
                              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                              : slot.uploaded
                              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                              : 'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                        >
                          <Upload className="w-4 h-4" />
                          {uploading === slot.key ? 'Uploading...' : slot.uploaded ? 'Re-upload' : 'Upload'}
                        </button>

                        {slot.uploaded && (
                          <button
                            onClick={() => handleClearData(slot)}
                            className="px-4 py-2 bg-red-100 text-red-700 rounded-lg font-medium hover:bg-red-200 transition-colors text-sm"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-gray-50 px-6 py-4 border-t border-gray-200 rounded-b-xl flex items-center justify-between">
            <div className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">
                {uploadSlots.filter(s => s.uploaded).length}
              </span> of {uploadSlots.length} datasets uploaded
            </div>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {/* Classification Dialog */}
      {showClassifyDialog && pendingFile && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-xl max-w-md w-full shadow-2xl">
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6 rounded-t-xl">
              <h3 className="text-xl font-bold">Classify Your Data</h3>
              <p className="text-purple-100 text-sm mt-1">Tell us what type of data this file contains</p>
            </div>

            <div className="p-6">
              <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                <FileText className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{pendingFile.name}</p>
                  <p className="text-xs text-gray-600">Single sheet detected</p>
                </div>
              </div>

              <label className="block text-sm font-semibold text-gray-900 mb-2">
                This data is:
              </label>
              <select
                value={selectedDataType}
                onChange={(e) => setSelectedDataType(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition"
              >
                {uploadSlots.map(slot => (
                  <option key={slot.key} value={slot.key}>
                    {slot.label}
                  </option>
                ))}
              </select>

              <div className="mt-4 text-xs text-gray-600 bg-gray-50 p-3 rounded-lg">
                <strong className="text-gray-900">Will be used by:</strong><br />
                {getModulesUsingData(selectedDataType)}
              </div>
            </div>

            <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 rounded-b-xl flex gap-3">
              <button
                onClick={() => {
                  setShowClassifyDialog(false);
                  setPendingFile(null);
                  if (smartUploadRef.current) {
                    smartUploadRef.current.value = '';
                  }
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClassifyAndSave}
                disabled={uploading === 'classify'}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:bg-gray-400"
              >
                {uploading === 'classify' ? 'Processing...' : 'Upload & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
