import React, { useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
}

interface ParsedFinancialData {
  trialBalance: TrialBalanceRow[];
  summary: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    cash: number;
  };
  uploadDate: string;
  fileName: string;
}

export const UploadData: React.FC = () => {
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      // Parse Excel/CSV file in browser using XLSX
      const parsedData = await parseFinancialFile(file);
      
      // Save to localStorage for use across all modules
      localStorage.setItem('financialData', JSON.stringify(parsedData));
      localStorage.setItem('dataUploadDate', new Date().toISOString());
      
      // Set success result
      setResult({
        success: true,
        message: `Successfully processed ${parsedData.trialBalance.length} accounts`,
        data: parsedData.summary
      });
      
      // Redirect to CFO dashboard after 2 seconds
      setTimeout(() => {
        navigate('/cfo-dashboard');
      }, 2000);
      
    } catch (err: any) {
      setError(err.message || 'Upload failed. Please check your file format.');
    } finally {
      setUploading(false);
    }
  };

  const parseFinancialFile = (file: File): Promise<ParsedFinancialData> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows: any[] = XLSX.utils.sheet_to_json(sheet);
          
          if (rows.length === 0) {
            throw new Error('File is empty or has no valid data');
          }
          
          // Parse Trial Balance rows
          const trialBalance: TrialBalanceRow[] = rows.map((row, index) => {
            // Handle different column name variations
            const accountCode = String(row['Account Code'] || row['AccountCode'] || row['GL Code'] || row['Code'] || index + 1).trim();
            const accountName = String(row['Account Name'] || row['AccountName'] || row['Name'] || row['Description'] || 'Unknown').trim();
            const accountType = String(row['Account Type'] || row['AccountType'] || row['Type'] || 'Unknown').trim();
            const debit = parseFloat(row['Debit'] || row['Debit Balance'] || row['Dr'] || 0);
            const credit = parseFloat(row['Credit'] || row['Credit Balance'] || row['Cr'] || 0);
            
            return {
              accountCode,
              accountName,
              accountType,
              debit,
              credit
            };
          }).filter(entry => entry.accountName !== 'Unknown' && (entry.debit > 0 || entry.credit > 0));
          
          if (trialBalance.length === 0) {
            throw new Error('No valid accounts found. Please check your file format.');
          }
          
          // Calculate summary metrics
          let totalAssets = 0;
          let totalLiabilities = 0;
          let totalEquity = 0;
          let totalRevenue = 0;
          let totalExpenses = 0;
          let cash = 0;
          
          trialBalance.forEach(entry => {
            const type = entry.accountType.toLowerCase();
            const netAmount = entry.debit - entry.credit;
            
            if (type.includes('asset')) {
              totalAssets += entry.debit;
              if (entry.accountName.toLowerCase().includes('cash')) {
                cash += entry.debit;
              }
            } else if (type.includes('liability')) {
              totalLiabilities += entry.credit;
            } else if (type.includes('equity')) {
              totalEquity += entry.credit;
            } else if (type.includes('revenue') || type.includes('income')) {
              totalRevenue += entry.credit;
            } else if (type.includes('expense') || type.includes('cost')) {
              totalExpenses += entry.debit;
            }
          });
          
          const netProfit = totalRevenue - totalExpenses;
          
          resolve({
            trialBalance,
            summary: {
              totalAssets,
              totalLiabilities,
              totalEquity,
              totalRevenue,
              totalExpenses,
              netProfit,
              cash
            },
            uploadDate: new Date().toISOString(),
            fileName: file.name
          });
          
        } catch (error: any) {
          reject(new Error(`Failed to parse file: ${error.message}`));
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">
            Upload Financial Data
          </h1>
          <p className="text-slate-300 text-lg">
            Upload your Trial Balance (Excel or CSV) to power your CFO Dashboard
          </p>
        </div>

        {/* Upload Card */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 bg-purple-500/20 rounded-full flex items-center justify-center mb-6">
              <FileSpreadsheet className="w-12 h-12 text-purple-400" />
            </div>

            <h2 className="text-2xl font-semibold text-white mb-4">
              Upload Trial Balance
            </h2>

            <p className="text-slate-300 text-center mb-8 max-w-2xl">
              Your file should contain: Account Code, Account Name, Account Type, Debit, Credit
            </p>

            {/* Upload Area */}
            <label
              htmlFor="file-upload"
              className="w-full max-w-md border-2 border-dashed border-purple-400 rounded-xl p-12 cursor-pointer hover:border-purple-300 transition-all hover:bg-white/5"
            >
              <div className="flex flex-col items-center">
                <Upload className="w-16 h-16 text-purple-400 mb-4" />
                <p className="text-white font-semibold mb-2">
                  Click to upload or drag and drop
                </p>
                <p className="text-slate-400 text-sm">
                  Excel (.xlsx, .xls) or CSV files
                </p>
              </div>
              <input
                id="file-upload"
                type="file"
                className="hidden"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileUpload}
                disabled={uploading}
              />
            </label>

            {/* Loading State */}
            {uploading && (
              <div className="mt-8 flex items-center space-x-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-400"></div>
                <p className="text-white">Processing your file...</p>
              </div>
            )}

            {/* Success State */}
            {result && (
              <div className="mt-8 w-full max-w-md bg-green-500/20 border border-green-500/50 rounded-xl p-6">
                <div className="flex items-start space-x-3">
                  <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-white font-semibold mb-2">
                      Upload Successful!
                    </h3>
                    <p className="text-green-200 text-sm mb-4">
                      {result.message}
                    </p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between text-green-100">
                        <span>Cash:</span>
                        <span className="font-semibold">
                          ₹{(result.data?.cash / 10000000).toFixed(2)}Cr
                        </span>
                      </div>
                      <div className="flex justify-between text-green-100">
                        <span>Revenue:</span>
                        <span className="font-semibold">
                          ₹{(result.data?.totalRevenue / 10000000).toFixed(2)}Cr
                        </span>
                      </div>
                      <div className="flex justify-between text-green-100">
                        <span>Expenses:</span>
                        <span className="font-semibold">
                          ₹{(result.data?.totalExpenses / 10000000).toFixed(2)}Cr
                        </span>
                      </div>
                      <div className="flex justify-between text-green-100">
                        <span>Net Profit:</span>
                        <span className="font-semibold">
                          ₹{(result.data?.netProfit / 10000000).toFixed(2)}Cr
                        </span>
                      </div>
                      <div className="flex justify-between text-green-100">
                        <span>Total Assets:</span>
                        <span className="font-semibold">
                          ₹{(result.data?.totalAssets / 10000000).toFixed(2)}Cr
                        </span>
                      </div>
                    </div>
                    <p className="text-green-200 text-sm mt-4">
                      Redirecting to dashboard...
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="mt-8 w-full max-w-md bg-red-500/20 border border-red-500/50 rounded-xl p-6">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-white font-semibold mb-2">Upload Failed</h3>
                    <p className="text-red-200 text-sm">{error}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-8 bg-white/5 backdrop-blur-lg rounded-xl p-6 border border-white/10">
          <h3 className="text-white font-semibold mb-4 flex items-center">
            <FileSpreadsheet className="w-5 h-5 mr-2" />
            File Format Requirements
          </h3>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="text-purple-300 font-medium mb-2">Required Columns:</h4>
              <ul className="text-slate-300 space-y-1">
                <li>• Account Code</li>
                <li>• Account Name</li>
                <li>• Account Type (Asset, Liability, Equity, Revenue, Expense)</li>
                <li>• Debit</li>
                <li>• Credit</li>
              </ul>
            </div>
            <div>
              <h4 className="text-purple-300 font-medium mb-2">Example:</h4>
              <div className="bg-black/30 rounded p-3 text-xs text-slate-300 font-mono">
                1000, Cash, Asset, 812450, 0<br />
                4000, Revenue, Revenue, 0, 362000<br />
                5100, Operations, Expense, 118000, 0
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
