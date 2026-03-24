import React, { useState } from 'react';
import { Upload, X, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { parseCFODecisionFile, saveCFODecisionData } from '../../services/cfoDecisionDataService';

interface CFODecisionUploadModalProps {
  onClose: () => void;
  onUploadSuccess: () => void;
}

const SAMPLE_PATHS = [
  'FinReportAI_Sample_Data_AllModules (3).xlsx',
  'FinReportAI_Sample_Data_AllModules%20(3).xlsx',
  'FinReportAI_Sample_Data_AllModules.xlsx',
];

const CFODecisionUploadModal: React.FC<CFODecisionUploadModalProps> = ({ onClose, onUploadSuccess }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [sheetsLoaded, setSheetsLoaded] = useState<string[]>([]);

  const loadSampleFromPublic = async () => {
    setUploading(true);
    setUploadStatus('idle');
    setMessage('');
    for (const path of SAMPLE_PATHS) {
      try {
        const res = await fetch('/' + path);
        if (!res.ok) continue;
        const blob = await res.blob();
        const file = new File([blob], path.replace(/%20/g, ' '), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const parsedData = await parseCFODecisionFile(file);
        saveCFODecisionData(parsedData);
        const loaded: string[] = [];
        if (parsedData.investment.length > 0) loaded.push('Investment Decisions');
        if (parsedData.buildVsBuy.length > 0) loaded.push('Build vs Buy');
        if (parsedData.risks.length > 0) loaded.push('Risk Dashboard');
        if (parsedData.internalVsExternal.length > 0) loaded.push('Internal vs External');
        if (parsedData.hireVsAutomate.length > 0) loaded.push('Hire vs Automate');
        setSheetsLoaded(loaded.length ? loaded : ['Data loaded']);
        setUploadStatus('success');
        setMessage(loaded.length ? `✅ Sample loaded: ${loaded.join(', ')}` : '✅ File loaded.');
        setTimeout(() => { onUploadSuccess(); onClose(); }, 2000);
        return;
      } catch (_) { continue; }
    }
    setUploadStatus('error');
    setMessage('Sample file not found in public folder. Upload your Excel file using "Choose File" above.');
    setUploading(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadStatus('idle');
    setMessage('');
    setSheetsLoaded([]);

    try {
      // Parse the file
      const parsedData = await parseCFODecisionFile(file);
      
      // Save to localStorage
      saveCFODecisionData(parsedData);
      
      // Track which sheets were loaded
      const loaded: string[] = [];
      if (parsedData.investment.length > 0) loaded.push('Investment Decisions');
      if (parsedData.buildVsBuy.length > 0) loaded.push('Build vs Buy');
      if (parsedData.internalVsExternal.length > 0) loaded.push('Internal vs External');
      if (parsedData.hireVsAutomate.length > 0) loaded.push('Hire vs Automate');
      if (parsedData.costCutVsInvest.length > 0) loaded.push('Cost Cut vs Invest');
      if (parsedData.capitalAllocation.length > 0) loaded.push('Capital Allocation');
      if (parsedData.risks.length > 0) loaded.push('Risk Dashboard');
      if (parsedData.auditTrail.length > 0) loaded.push('Decision Audit Trail');
      
      setSheetsLoaded(loaded);
      setUploadStatus('success');
      setMessage(`✅ ${loaded.length} modules loaded successfully!`);
      
      // Auto-close after 2 seconds
      setTimeout(() => {
        onUploadSuccess();
        onClose();
      }, 2000);
      
    } catch (error: any) {
      setUploadStatus('error');
      setMessage(error.message || 'Upload failed. Please check your file format.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-white p-6 rounded-t-xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Upload Decision Data</h2>
              <p className="text-amber-50 text-sm mt-1">
                Upload Excel file with decision analysis data
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Upload Area */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-amber-500 transition-colors">
            <Upload className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Drop your Excel file here
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              or click to browse
            </p>
            
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
              id="cfo-file-upload"
            />
            <label
              htmlFor="cfo-file-upload"
              className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-colors cursor-pointer ${
                uploading
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-amber-600 text-white hover:bg-amber-700'
              }`}
            >
              <Upload className="w-5 h-5" />
              {uploading ? 'Processing...' : 'Choose File'}
            </label>
            <p className="mt-3 text-sm text-gray-500">
              Or{' '}
              <button
                type="button"
                onClick={loadSampleFromPublic}
                disabled={uploading}
                className="text-amber-600 hover:underline font-medium disabled:opacity-50"
              >
                load sample from public folder
              </button>
              {' '}(FinReportAI_Sample_Data_AllModules)
            </p>
          </div>

          {/* Status Message */}
          {uploadStatus !== 'idle' && (
            <div className={`p-4 rounded-lg flex items-start gap-3 ${
              uploadStatus === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
            }`}>
              {uploadStatus === 'success' ? (
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className={`font-medium ${
                  uploadStatus === 'success' ? 'text-green-900' : 'text-red-900'
                }`}>
                  {message}
                </p>
                {sheetsLoaded.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {sheetsLoaded.map((sheet) => (
                      <li key={sheet} className="text-sm text-green-700 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" />
                        {sheet}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Expected Sheet Names */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Expected Sheet Names
            </h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                <span className="text-gray-700">Investment_Decisions</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                <span className="text-gray-700">Build_vs_Buy</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                <span className="text-gray-700">Internal_vs_External</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                <span className="text-gray-700">Hire_vs_Automate</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                <span className="text-gray-700">Cost_Cut_vs_Invest</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                <span className="text-gray-700">Capital_Allocation</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                <span className="text-gray-700">Risk_Dashboard</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                <span className="text-gray-700">Decision_Audit_Trail</span>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-3">
              💡 Sheet names are case-insensitive. You can also use "Investment", "BuildVsBuy", etc.
            </p>
          </div>

          {/* Required Columns Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 mb-2">📋 Column Requirements</h4>
            <p className="text-sm text-blue-800">
              Each sheet should have specific columns. Download the template below for exact format.
            </p>
            <button className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium underline">
              📥 Download Excel Template
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 rounded-b-xl flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default CFODecisionUploadModal;
