import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Upload, FileText, AlertTriangle, CheckCircle, TrendingUp, X, BarChart3, Shield, ArrowLeft, LayoutGrid } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';

interface ShapBreakdown {
  amountAnomaly: number;
  temporalAnomaly: number;
  behavioralAnomaly: number;
  accountAnomaly: number;
}

interface StatisticalAnalysis {
  zScore: number;
  percentile: number;
}

interface JournalEntry {
  entryId: string;
  riskScore: number;
  riskLevel: 'Low' | 'Medium' | 'High';
  anomalies: string[];
  shapBreakdown: ShapBreakdown;
  statisticalAnalysis: StatisticalAnalysis;
  explanation: string;
  recommendation: string;
}

interface AnalysisMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
}

interface ConfusionMatrix {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface CompanyOption {
  id: string;
  name: string;
  industry?: string;
  total_uploads?: number;
  last_upload?: string | null;
}

export const R2RModule: React.FC = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<JournalEntry[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [metrics, setMetrics] = useState<AnalysisMetrics | null>(null);
  const [confusionMatrix, setConfusionMatrix] = useState<ConfusionMatrix | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [showHighRiskModal, setShowHighRiskModal] = useState(false);

  // Stateful R2R: company-specific learning (MindBridge-style)
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [newCompanyName, setNewCompanyName] = useState('');
  
  // Threshold configuration
  const [sensitivityLevel, setSensitivityLevel] = useState<'conservative' | 'balanced' | 'strict'>('balanced');
  const [customThreshold, setCustomThreshold] = useState<number>(40);

  useEffect(() => {
    const saved = localStorage.getItem('fraud_detection_threshold');
    if (saved) setCustomThreshold(Number(saved));
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/companies`)
      .then((r) => r.json())
      .then((data) => setCompanies(Array.isArray(data) ? data : []))
      .catch(() => setCompanies([]));
  }, []);

  // Save threshold preference when it changes
  useEffect(() => {
    localStorage.setItem('fraud_detection_threshold', customThreshold.toString());
  }, [customThreshold]);

  // Sensitivity presets
  const SENSITIVITY_LEVELS = {
    conservative: {
      name: 'Conservative',
      subtitle: 'Catch Everything',
      threshold: 20,
      description: 'Maximum detection - may have false positives',
      icon: '🔴',
      color: 'red',
      expected: '40-50 anomalies'
    },
    balanced: {
      name: 'Balanced',
      subtitle: 'Recommended',
      threshold: 40,
      description: 'Standard fraud detection threshold',
      icon: '🟡',
      color: 'yellow',
      expected: '20-30 anomalies'
    },
    strict: {
      name: 'Strict',
      subtitle: 'High Confidence Only',
      threshold: 70,
      description: 'Only critical issues - minimal false positives',
      icon: '🟢',
      color: 'green',
      expected: '15-20 anomalies'
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleAddCompany = async () => {
    const name = newCompanyName.trim();
    if (!name) return;
    try {
      const r = await fetch(
        `${API_BASE}/api/companies?name=${encodeURIComponent(name)}&industry=General`,
        { method: 'POST' }
      );
      const c = await r.json();
      setCompanies((prev) => [...prev, { id: c.company_id, name: c.name, industry: c.industry }]);
      setSelectedCompany(c.company_id);
      setNewCompanyName('');
      toast.success(`Company "${c.name}" added`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add company');
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('Please select a file (CSV or Excel)');
      return;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('threshold', customThreshold.toString());

    const useStateful = !!selectedCompany;
    if (useStateful) {
      formData.append('company_id', selectedCompany);
    }

    const url = useStateful
      ? `${API_BASE}/api/analyze`
      : `${API_BASE}/api/journal-entries/upload`;

    try {
      console.log('📤 Uploading file:', file.name, useStateful ? `(company: ${selectedCompany})` : '(stateless)');
      console.log('🎯 Detection threshold:', customThreshold);

      const response = await axios.post(url, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      console.log('✅ Upload response:', response.data);

      if (response.data.success) {
        const data = response.data;
        setResults(data.results || []);
        setSummary(data.summary || null);
        setMetrics(data.metrics ?? null);
        if (data.metrics?.confusionMatrix) {
          setConfusionMatrix(data.metrics.confusionMatrix);
        } else {
          setConfusionMatrix(null);
        }

        const summary = data.summary;
        const novaUsed = summary?.novaUsed === true || (summary?.novaEntryCount != null && summary.novaEntryCount > 0);
        toast.success(
          useStateful
            ? `✅ Stateful: ${data.total} entries, High: ${data.high ?? summary?.highRisk ?? 0}, baseline updated for next run`
            : novaUsed
              ? `✅ Analyzed ${summary?.total} entries with Amazon Nova. High Risk: ${summary?.highRisk}`
              : `✅ Analyzed ${summary?.total} entries (rule-based). High Risk: ${summary?.highRisk}`
        );
        if (useStateful) {
          setCompanies((prev) =>
            prev.map((c) =>
              c.id === selectedCompany
                ? { ...c, total_uploads: (c.total_uploads ?? 0) + 1 }
                : c
            )
          );
        }
      }
    } catch (error: any) {
      console.error('❌ Upload error:', error);
      console.error('❌ Error details:', error.response?.data);
      toast.error(error.response?.data?.detail || error.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'High': return 'bg-red-100 text-red-800 border-red-300';
      case 'Medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'Low': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-8">
      <div className="container mx-auto max-w-7xl">
        {/* Top bar: back + Service 1 links + R2R Pattern */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="p-2 hover:bg-white/80 rounded-lg transition flex items-center gap-2 text-gray-700"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-500 mr-1">Service 1:</span>
            <Link
              to="/close-tracker"
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-gray-800 rounded-lg transition text-sm font-medium"
            >
              📋 Close Tracker
            </Link>
            <Link
              to="/tb-variance"
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-gray-800 rounded-lg transition text-sm font-medium"
            >
              📊 TB Variance
            </Link>
            <Link
              to="/bank-recon"
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-gray-800 rounded-lg transition text-sm font-medium"
            >
              🏦 Bank Recon
            </Link>
            <Link
              to="/r2r-pattern"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition shadow-sm"
            >
              <Upload className="w-4 h-4" />
              <span>Upload journal entries (R2R Pattern)</span>
            </Link>
          </div>
        </div>
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3 mb-2">
            <FileText className="w-10 h-10 text-blue-600" />
            Record to Report (R2R) - Amazon Nova AI
          </h1>
          <p className="text-lg text-gray-600">Upload journal entries for complete ML-powered fraud analysis with SHAP & metrics</p>
        </div>

        {/* Redirect notice: uploaded journal analysis lives in R2R Pattern Engine */}
        <Link
          to="/r2r-pattern"
          className="mb-6 flex items-center gap-3 p-4 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-800 hover:bg-indigo-100 transition"
        >
          <LayoutGrid className="w-6 h-6 flex-shrink-0 text-indigo-600" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-indigo-900">View your uploaded journal entry analysis</p>
            <p className="text-sm text-indigo-700 mt-0.5">Pattern analysis, risk flags, and anomaly trends are in <strong>R2R Pattern Engine</strong> →</p>
          </div>
          <span className="text-indigo-600 font-medium shrink-0">Open R2R Pattern Engine</span>
        </Link>

        {/* Threshold Configuration */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-6 h-6 text-purple-600" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">Detection Sensitivity</h2>
              <p className="text-sm text-gray-600">Adjust how strictly anomalies are flagged</p>
            </div>
          </div>

          {/* Sensitivity Presets */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {Object.entries(SENSITIVITY_LEVELS).map(([key, level]) => (
              <button
                key={key}
                onClick={() => {
                  setSensitivityLevel(key as any);
                  setCustomThreshold(level.threshold);
                }}
                className={`p-6 rounded-xl border-2 transition-all text-left hover:shadow-md ${
                  sensitivityLevel === key
                    ? level.color === 'red'
                      ? 'border-red-500 bg-red-50'
                      : level.color === 'yellow'
                      ? 'border-yellow-500 bg-yellow-50'
                      : 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start gap-3 mb-3">
                  <span className="text-3xl flex-shrink-0">{level.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-base">{level.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{level.subtitle}</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mb-3 leading-relaxed">{level.description}</p>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-700">
                    Threshold: {level.threshold}+
                  </p>
                  <p className="text-xs text-gray-500">{level.expected}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Custom Threshold Slider */}
          <div className="bg-gradient-to-br from-gray-50 to-blue-50 rounded-xl p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-bold text-gray-800">
                Custom Threshold (Advanced)
              </label>
              <span className="text-2xl font-bold text-blue-600">{customThreshold}</span>
            </div>
            <input
              type="range"
              min="10"
              max="90"
              step="5"
              value={customThreshold}
              onChange={(e) => {
                setCustomThreshold(Number(e.target.value));
                // Reset preset selection when using custom value
                const matchingPreset = Object.entries(SENSITIVITY_LEVELS).find(
                  ([_, level]) => level.threshold === Number(e.target.value)
                );
                if (!matchingPreset) {
                  setSensitivityLevel('balanced');
                }
              }}
              className="w-full h-3 bg-gradient-to-r from-green-200 via-yellow-200 to-red-200 rounded-lg appearance-none cursor-pointer"
              style={{
                WebkitAppearance: 'none',
              }}
            />
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>Very Sensitive (10)</span>
              <span>Moderate (50)</span>
              <span>Very Strict (90)</span>
            </div>
            <div className="mt-4 p-3 bg-white rounded-lg border border-blue-200">
              <p className="text-sm text-gray-700">
                <strong className="text-blue-600">Expected Impact:</strong> With threshold{' '}
                <span className="font-bold text-blue-600">{customThreshold}</span>, you'll detect{' '}
                <span className="font-semibold">
                  {customThreshold <= 25 ? '40-50 anomalies (very high sensitivity)' :
                   customThreshold <= 35 ? '30-40 anomalies (high sensitivity)' :
                   customThreshold <= 50 ? '20-30 anomalies (moderate sensitivity)' :
                   customThreshold <= 65 ? '15-20 anomalies (low sensitivity)' :
                   '10-15 anomalies (very low sensitivity - critical only)'}
                </span>
              </p>
              <p className="text-xs text-gray-500 mt-2">
                💡 Lower values = more anomalies detected (higher recall, more false positives)
                <br />
                💡 Higher values = fewer anomalies detected (higher precision, fewer false positives)
              </p>
            </div>
          </div>
        </div>

        {/* Upload Section */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 mb-8">
          <div className="flex items-center gap-4">
            <Upload className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">Upload Journal Entries (CSV or Excel)</h2>
          </div>

          {/* Stateful R2R: Select client company (MindBridge-style learning) */}
          <div className="mt-6 mb-6 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Select Client Company</label>
            <p className="text-xs text-gray-500 mb-3">Choose a company to use company-specific baselines (accuracy improves over time).</p>
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              className="block w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Stateless (no company learning) —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.total_uploads != null ? ` (${c.total_uploads} uploads)` : ''}</option>
              ))}
            </select>
            <div className="flex gap-2 mt-3">
              <input
                type="text"
                placeholder="Or add new company..."
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCompany())}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
              />
              <button
                type="button"
                onClick={handleAddCompany}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
              >
                Add
              </button>
            </div>
          </div>
          
          <div className="mt-6 flex items-center gap-4">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="flex-1 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-500 transition"
            />
            <button
              onClick={handleUpload}
              disabled={loading || !file}
              className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all transform hover:scale-105"
            >
              {loading ? 'Analyzing...' : 'Analyze with Nova AI'}
            </button>
          </div>
          
          {file && (
            <p className="mt-3 text-sm text-gray-600">
              Selected: <span className="font-semibold">{file.name}</span> ({(file.size / 1024).toFixed(2)} KB)
            </p>
          )}
        </div>

        {/* Results Section */}
        {results.length > 0 && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6">
                <p className="text-sm text-gray-600 mb-2">Total Entries</p>
                <p className="text-4xl font-bold text-gray-900">{summary?.total || 0}</p>
              </div>
              <div 
                onClick={() => setShowHighRiskModal(true)}
                className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl shadow-lg border border-red-200 p-6 cursor-pointer hover:scale-105 transition-transform hover:shadow-xl"
              >
                <p className="text-sm text-red-700 mb-2">High Risk</p>
                <p className="text-4xl font-bold text-red-600">{summary?.highRisk || 0}</p>
                <p className="text-xs text-red-600 mt-2 flex items-center justify-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Click to view details
                </p>
              </div>
              <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-xl shadow-lg border border-yellow-200 p-6">
                <p className="text-sm text-yellow-700 mb-2">Medium Risk</p>
                <p className="text-4xl font-bold text-yellow-600">{summary?.mediumRisk || 0}</p>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl shadow-lg border border-green-200 p-6">
                <p className="text-sm text-green-700 mb-2">Low Risk</p>
                <p className="text-4xl font-bold text-green-600">{summary?.lowRisk || 0}</p>
              </div>
            </div>

            {/* Amazon Nova AI Analysis Summary */}
            {metrics && (
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl shadow-xl border border-blue-200 p-8 mb-8">
                <div className="flex items-center gap-3 mb-4">
                  <BarChart3 className="w-6 h-6 text-blue-600" />
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">AI Analysis Complete</h3>
                    <p className="text-sm text-gray-600">
                      {summary?.novaUsed ? (
                        <>Amazon Nova Lite risk assessment · {summary.novaEntryCount ?? summary.total} entries with Nova</>
                      ) : (
                        <>Rule-based analysis (Nova unavailable — check backend AWS keys)</>
                      )}
                    </p>
                  </div>
                </div>
                
                <div className="bg-white rounded-xl p-6 text-center">
                  <p className="text-5xl font-bold text-blue-600 mb-2">{summary?.highRisk + summary?.mediumRisk || 0}</p>
                  <p className="text-lg font-semibold text-gray-700">Anomalies Flagged for Review</p>
                  <p className="text-sm text-gray-500 mt-2">
                    {summary?.highRisk || 0} High Risk • {summary?.mediumRisk || 0} Medium Risk
                  </p>
                </div>
              </div>
            )}

            {/* Ground Truth Validation Metrics */}
            {metrics && metrics.groundTruthAnomalies !== undefined && (
              <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl shadow-xl border border-purple-200 p-8 mb-8">
                <div className="flex items-center gap-3 mb-6">
                  <CheckCircle className="w-6 h-6 text-purple-600" />
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">Ground Truth Validation</h3>
                    <p className="text-sm text-gray-600">Comparison with labeled anomalies</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="bg-white rounded-xl p-6 shadow-sm">
                    <p className="text-sm font-medium text-purple-700 mb-2">True Anomalies</p>
                    <p className="text-4xl font-bold text-purple-600">{metrics.groundTruthAnomalies}</p>
                    <p className="text-xs text-gray-500 mt-2">Labeled in dataset</p>
                  </div>
                  
                  <div className="bg-white rounded-xl p-6 shadow-sm">
                    <p className="text-sm font-medium text-green-700 mb-2">Detected</p>
                    <p className="text-4xl font-bold text-green-600">{metrics.detectedAnomalies}</p>
                    <p className="text-xs text-gray-500 mt-2">
                      {metrics.groundTruthAnomalies > 0 
                        ? `${((metrics.detectedAnomalies / metrics.groundTruthAnomalies) * 100).toFixed(0)}% recall rate`
                        : 'N/A'}
                    </p>
                  </div>
                  
                  <div className="bg-white rounded-xl p-6 shadow-sm">
                    <p className="text-sm font-medium text-red-700 mb-2">Missed</p>
                    <p className="text-4xl font-bold text-red-600">{metrics.missedAnomalies}</p>
                    <p className="text-xs text-gray-500 mt-2">False negatives</p>
                  </div>
                  
                  <div className="bg-white rounded-xl p-6 shadow-sm">
                    <p className="text-sm font-medium text-yellow-700 mb-2">False Alarms</p>
                    <p className="text-4xl font-bold text-yellow-600">{metrics.falseAlarms}</p>
                    <p className="text-xs text-gray-500 mt-2">False positives</p>
                  </div>
                </div>

                {/* Detection Performance Bar */}
                <div className="mt-6 bg-white rounded-xl p-6 shadow-sm">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Detection Performance</h4>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex justify-between text-xs text-gray-600 mb-2">
                        <span>Detected: {metrics.detectedAnomalies}</span>
                        <span>Missed: {metrics.missedAnomalies}</span>
                      </div>
                      <div className="w-full bg-red-200 rounded-full h-4 overflow-hidden flex">
                        <div 
                          className="bg-green-500 h-4 transition-all flex items-center justify-center text-xs text-white font-semibold" 
                          style={{ width: `${metrics.groundTruthAnomalies > 0 ? (metrics.detectedAnomalies / metrics.groundTruthAnomalies) * 100 : 0}%` }}
                        >
                          {metrics.groundTruthAnomalies > 0 && ((metrics.detectedAnomalies / metrics.groundTruthAnomalies) * 100) > 10 
                            ? `${((metrics.detectedAnomalies / metrics.groundTruthAnomalies) * 100).toFixed(0)}%` 
                            : ''}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-purple-600">
                        {metrics.groundTruthAnomalies > 0 
                          ? `${((metrics.detectedAnomalies / metrics.groundTruthAnomalies) * 100).toFixed(1)}%`
                          : 'N/A'}
                      </p>
                      <p className="text-xs text-gray-500">Recall</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Results Table */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-xl font-bold text-gray-900">Analysis Results</h3>
                <p className="text-sm text-gray-600 mt-1">Click on any entry for detailed SHAP analysis</p>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase">Entry ID</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase">Risk Score</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase">Risk Level</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase">Z-Score</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase">Recommendation</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {results.map((entry, index) => (
                      <tr key={index} className="hover:bg-gray-50 transition cursor-pointer" onClick={() => setSelectedEntry(entry)}>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{entry.entryId}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="text-lg font-bold">{entry.riskScore}</div>
                            <div className="w-20 bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${
                                  entry.riskScore > 70 ? 'bg-red-500' :
                                  entry.riskScore > 40 ? 'bg-yellow-500' : 'bg-green-500'
                                }`}
                                style={{ width: `${entry.riskScore}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getRiskColor(entry.riskLevel)}`}>
                            {entry.riskLevel}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold">{entry.statisticalAnalysis.zScore.toFixed(2)}</td>
                        <td className="px-6 py-4 text-xs font-medium text-gray-700">{entry.recommendation}</td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => setSelectedEntry(entry)}
                            className="text-blue-600 hover:text-blue-800 font-semibold text-sm"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Detail Modal */}
        {selectedEntry && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex justify-between items-center">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">Entry {selectedEntry.entryId} - Detailed Analysis</h3>
                  <p className="text-sm text-gray-600 mt-1">Complete SHAP & Statistical Analysis</p>
                </div>
                <button
                  onClick={() => setSelectedEntry(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Risk Overview */}
                <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-6">
                  <div className="grid grid-cols-3 gap-6">
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Risk Score</p>
                      <p className="text-4xl font-bold text-gray-900">{selectedEntry.riskScore}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Risk Level</p>
                      <span className={`inline-block px-4 py-2 rounded-full text-lg font-bold border ${getRiskColor(selectedEntry.riskLevel)}`}>
                        {selectedEntry.riskLevel}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Recommendation</p>
                      <p className="text-lg font-semibold text-gray-900">{selectedEntry.recommendation}</p>
                    </div>
                  </div>
                </div>

                {/* SHAP Breakdown */}
                <div className="bg-gray-50 rounded-xl p-6">
                  <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-purple-600" />
                    SHAP Feature Contribution Analysis
                  </h4>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="font-medium">Amount Anomaly</span>
                        <span className="font-bold text-blue-600">{selectedEntry.shapBreakdown.amountAnomaly}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-4">
                        <div
                          className="bg-gradient-to-r from-blue-400 to-blue-600 h-4 rounded-full transition-all"
                          style={{ width: `${selectedEntry.shapBreakdown.amountAnomaly}%` }}
                        />
                      </div>
                    </div>
                    
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="font-medium">Temporal Anomaly</span>
                        <span className="font-bold text-yellow-600">{selectedEntry.shapBreakdown.temporalAnomaly}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-4">
                        <div
                          className="bg-gradient-to-r from-yellow-400 to-yellow-600 h-4 rounded-full transition-all"
                          style={{ width: `${selectedEntry.shapBreakdown.temporalAnomaly}%` }}
                        />
                      </div>
                    </div>
                    
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="font-medium">Behavioral Anomaly</span>
                        <span className="font-bold text-orange-600">{selectedEntry.shapBreakdown.behavioralAnomaly}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-4">
                        <div
                          className="bg-gradient-to-r from-orange-400 to-orange-600 h-4 rounded-full transition-all"
                          style={{ width: `${selectedEntry.shapBreakdown.behavioralAnomaly}%` }}
                        />
                      </div>
                    </div>
                    
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="font-medium">Account Anomaly</span>
                        <span className="font-bold text-purple-600">{selectedEntry.shapBreakdown.accountAnomaly}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-4">
                        <div
                          className="bg-gradient-to-r from-purple-400 to-purple-600 h-4 rounded-full transition-all"
                          style={{ width: `${selectedEntry.shapBreakdown.accountAnomaly}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Statistical Analysis */}
                <div className="bg-gray-50 rounded-xl p-6">
                  <h4 className="text-lg font-bold text-gray-900 mb-4">Statistical Analysis</h4>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="bg-white rounded-lg p-4">
                      <span className="text-sm text-gray-600">Z-Score</span>
                      <p className="text-3xl font-bold text-gray-900 mt-1">
                        {selectedEntry.statisticalAnalysis.zScore.toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        {selectedEntry.statisticalAnalysis.zScore > 3 ? '🔴 Extreme outlier' :
                         selectedEntry.statisticalAnalysis.zScore > 2 ? '🟡 Significant outlier' :
                         '🟢 Within normal range'}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-4">
                      <span className="text-sm text-gray-600">Percentile</span>
                      <p className="text-3xl font-bold text-gray-900 mt-1">
                        {selectedEntry.statisticalAnalysis.percentile}th
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        Top {100 - selectedEntry.statisticalAnalysis.percentile}% of transactions
                      </p>
                    </div>
                  </div>
                </div>

                {/* Detected Issues Summary */}
                <div className="bg-red-50 rounded-xl p-6 border border-red-200">
                  <h4 className="text-lg font-bold text-red-900 mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    Issues Detected ({selectedEntry.anomalies.length})
                  </h4>
                  <div className="space-y-2">
                    {selectedEntry.anomalies.map((anomaly, idx) => {
                      // Extract just the first line (the issue title) for summary
                      const issueTitle = anomaly.split(':')[0] + (anomaly.includes(':') ? ':' : '');
                      const issueSeverity = anomaly.includes('🚨') ? 'CRITICAL' : 
                                           anomaly.includes('🔴') ? 'HIGH' :
                                           anomaly.includes('⚠️') ? 'MEDIUM' : 'INFO';
                      
                      return (
                        <div key={idx} className={`flex items-center gap-2 text-sm p-2 rounded ${
                          issueSeverity === 'CRITICAL' ? 'bg-red-200 text-red-900' :
                          issueSeverity === 'HIGH' ? 'bg-orange-100 text-orange-900' :
                          'bg-yellow-100 text-yellow-900'
                        }`}>
                          <span className="font-semibold">{issueTitle}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-red-600 mt-3">
                    📋 See "AI Audit Analysis" below for detailed explanations and recommended actions
                  </p>
                </div>

                {/* AI Explanation */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 border-2 border-blue-300">
                  <h4 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-blue-600" />
                    AI Audit Analysis
                  </h4>
                  <div className="space-y-4 text-sm text-gray-800 leading-relaxed">
                    {selectedEntry.anomalies.map((anomaly, idx) => (
                      <div key={idx} className="bg-white rounded-lg p-4 border-l-4 border-blue-500 shadow-sm">
                        <p className="whitespace-pre-wrap">{anomaly}</p>
                      </div>
                    ))}
                  </div>
                  
                  {selectedEntry.riskLevel === 'High' && (
                    <div className="mt-4 bg-red-100 border-l-4 border-red-600 rounded-lg p-4">
                      <p className="text-sm font-semibold text-red-900 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        CRITICAL: This entry requires immediate escalation to senior management
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* High Risk Entries Modal */}
        {showHighRiskModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-2xl max-w-7xl w-full max-h-[90vh] overflow-hidden">
              {/* Modal Header */}
              <div className="bg-gradient-to-r from-red-600 to-red-700 px-8 py-6 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-8 h-8 text-white" />
                  <div>
                    <h3 className="text-2xl font-bold text-white">High Risk Journal Entries</h3>
                    <p className="text-red-100 text-sm">
                      {results.filter(r => r.riskLevel === 'High').length} entries require immediate attention
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowHighRiskModal(false)}
                  className="text-white hover:bg-red-800 rounded-lg p-2 transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-8 overflow-y-auto max-h-[calc(90vh-120px)]">
                <div className="space-y-4">
                  {results
                    .filter(entry => entry.riskLevel === 'High')
                    .map((entry, index) => (
                      <div
                        key={index}
                        className="bg-gradient-to-r from-red-50 to-orange-50 rounded-xl p-6 border-2 border-red-200 hover:border-red-400 transition cursor-pointer"
                        onClick={() => {
                          setSelectedEntry(entry);
                          setShowHighRiskModal(false);
                        }}
                      >
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-4">
                            <div className="bg-red-600 text-white rounded-lg px-4 py-2 font-bold">
                              #{index + 1}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-600">Entry ID</p>
                              <p className="text-lg font-bold text-gray-900">{entry.entryId}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-red-600">Risk Score</p>
                            <p className="text-3xl font-bold text-red-600">{entry.riskScore}</p>
                          </div>
                        </div>

                        {/* Anomalies */}
                        <div className="mb-4">
                          <p className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-600" />
                            Detected Anomalies:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {entry.anomalies.slice(0, 3).map((anomaly, idx) => (
                              <span
                                key={idx}
                                className="bg-red-100 text-red-800 text-xs px-3 py-1 rounded-full border border-red-300"
                              >
                                {anomaly}
                              </span>
                            ))}
                            {entry.anomalies.length > 3 && (
                              <span className="bg-gray-100 text-gray-600 text-xs px-3 py-1 rounded-full">
                                +{entry.anomalies.length - 3} more
                              </span>
                            )}
                          </div>
                        </div>

                        {/* SHAP Breakdown */}
                        <div className="grid grid-cols-4 gap-3 mb-4">
                          <div className="bg-white rounded-lg p-3 border border-red-200">
                            <p className="text-xs text-gray-600">Amount</p>
                            <p className="text-lg font-bold text-red-600">{entry.shapBreakdown.amountAnomaly}</p>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-orange-200">
                            <p className="text-xs text-gray-600">Temporal</p>
                            <p className="text-lg font-bold text-orange-600">{entry.shapBreakdown.temporalAnomaly}</p>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-yellow-200">
                            <p className="text-xs text-gray-600">Behavioral</p>
                            <p className="text-lg font-bold text-yellow-600">{entry.shapBreakdown.behavioralAnomaly}</p>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-purple-200">
                            <p className="text-xs text-gray-600">Account</p>
                            <p className="text-lg font-bold text-purple-600">{entry.shapBreakdown.accountAnomaly}</p>
                          </div>
                        </div>

                        {/* Explanation Preview */}
                        <div className="bg-white rounded-lg p-4 border border-gray-200">
                          <p className="text-sm text-gray-700 line-clamp-2">{entry.explanation}</p>
                          <p className="text-xs text-blue-600 mt-2 font-semibold">Click to view full details →</p>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
