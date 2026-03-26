import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  Download,
  Mail,
  Sparkles,
  Check,
  Edit2,
  Copy,
  Eye,
  ChevronUp,
  ChevronDown,
  AlertTriangle
} from 'lucide-react';
import { ReportType, BoardPackSection, AICommentary } from '../../types/reports';
import {
  reportHistory,
  boardPackSections as initialSections,
  flashReportData,
  commentaryPrompts
} from '../../data/reportMockData';
import { callAI } from '../../services/aiProvider';
import { loadFPAActual, loadFPABudget, loadFPAForecast, checkDataAvailability, getMissingDataMessage, generateBoardPackSections } from '../../utils/fpaDataLoader';

const ManagementReporting: React.FC = () => {
  const navigate = useNavigate();
  
  // Check data availability
  const dataCheck = checkDataAvailability(['fpa_actual', 'fpa_budget']);
  const [actualData, setActualData] = useState<any>(null);
  const [budgetData, setBudgetData] = useState<any>(null);
  const [forecastData, setForecastData] = useState<any>(null);
  const [realSections, setRealSections] = useState<BoardPackSection[]>([]);

  useEffect(() => {
    const actual = loadFPAActual();
    const budget = loadFPABudget();
    const forecast = loadFPAForecast();
    setActualData(actual);
    setBudgetData(budget);
    setForecastData(forecast);
    
    // Generate real board pack sections from uploaded data
    if (actual && budget) {
      const generated = generateBoardPackSections(actual, budget);
      setRealSections(generated as BoardPackSection[]);
      setSections(generated as BoardPackSection[]);
    } else {
      // Use mock data if no real data
      setSections(initialSections);
    }
  }, []);
  
  const [selectedReportType, setSelectedReportType] = useState<ReportType>('boardPack');
  const [period, setPeriod] = useState('October 2025');
  const [sections, setSections] = useState<BoardPackSection[]>([]);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [aiCommentary, setAiCommentary] = useState<Record<string, AICommentary>>({});
  const [generatingCommentary, setGeneratingCommentary] = useState<string | null>(null);

  const formatCurrency = (value: number): string => {
    const crore = value / 10000000;
    const lakh = value / 100000;
    if (Math.abs(crore) >= 1) return `₹${crore.toFixed(1)}Cr`;
    return `₹${lakh.toFixed(1)}L`;
  };

  const moveSection = (index: number, direction: 'up' | 'down') => {
    const newSections = [...sections];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSections.length) return;
    
    [newSections[index], newSections[targetIndex]] = [newSections[targetIndex], newSections[index]];
    newSections.forEach((section, idx) => section.order = idx + 1);
    setSections(newSections);
  };

  const toggleSection = (id: string) => {
    setSections(sections.map(s => 
      s.id === id ? { ...s, included: !s.included } : s
    ));
  };

  const toggleApproval = (id: string) => {
    setSections(sections.map(s => 
      s.id === id ? { ...s, approved: !s.approved } : s
    ));
  };

  const generateAICommentary = async (sectionKey: string) => {
    setGeneratingCommentary(sectionKey);
    try {
      const prompt = (commentaryPrompts as any)[sectionKey];
      const response = await callAI(prompt);
      
      setAiCommentary(prev => ({
        ...prev,
        [sectionKey]: {
          section: sectionKey,
          content: response,
          wordCount: response.split(/\s+/).length,
          maxWords: sectionKey === 'executiveSummary' ? 150 : sectionKey === 'varianceCommentary' ? 120 : sectionKey === 'cashFlowCommentary' ? 80 : 70,
          approved: false
        }
      }));
    } catch (error: any) {
      alert('❌ Failed to generate commentary: ' + error.message);
    } finally {
      setGeneratingCommentary(null);
    }
  };

  const copyCommentary = (content: string) => {
    navigator.clipboard.writeText(content);
    alert('✅ Copied to clipboard!');
  };

  const approveCommentary = (sectionKey: string) => {
    setAiCommentary(prev => ({
      ...prev,
      [sectionKey]: { ...prev[sectionKey], approved: !prev[sectionKey]?.approved }
    }));
  };

  const handleExport = (format: 'pdf' | 'word') => {
    alert(`📄 Exporting ${selectedReportType} to ${format.toUpperCase()}... (Feature ready for backend integration)`);
  };

  const handleEmailBoard = () => {
    setShowEmailModal(true);
  };

  const sendEmail = () => {
    alert('✅ Board pack email sent successfully!');
    setShowEmailModal(false);
  };

  const includedSections = sections.filter(s => s.included).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 p-6">
      {/* Data Missing Warning Banner */}
      {!dataCheck.available && (
        <div className="bg-yellow-50 border-b-2 border-yellow-400 px-6 py-4 rounded-lg mb-6">
          <div className="max-w-[1800px] mx-auto flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-yellow-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-yellow-900">
                ⚠️ {getMissingDataMessage(dataCheck.missing)}
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                Management Reports require Actual, Budget, and Forecast data to generate comprehensive board packs.
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
      
      {/* Header */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/fpa')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft size={24} className="text-gray-700" />
              </button>
              <div>
                <div className="flex items-center gap-3">
                  <FileText size={32} className="text-blue-600" />
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">📋 Management Reporting</h1>
                    <p className="text-gray-600 mt-1">Board Packs · Flash Reports · Management Accounts</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option>October 2025</option>
                <option>September 2025</option>
                <option>August 2025</option>
              </select>
              <button
                onClick={() => handleExport('pdf')}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <Download size={18} />
                Export PDF
              </button>
              <button
                onClick={() => handleExport('word')}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Download size={18} />
                Export Word
              </button>
              <button
                onClick={handleEmailBoard}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Mail size={18} />
                Email Board
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Report Type Selector */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { type: 'boardPack' as ReportType, icon: '📊', title: 'BOARD PACK', desc: 'Full monthly board report', pages: '~15-20 pages', formats: 'PDF export' },
            { type: 'flashReport' as ReportType, icon: '⚡', title: 'FLASH REPORT', desc: 'Day-3 close key metrics only', pages: '~2 pages', formats: 'PDF/Email' },
            { type: 'managementAccounts' as ReportType, icon: '📄', title: 'MANAGEMENT ACCOUNTS', desc: 'Detailed monthly finance pack', pages: '~8-10 pages', formats: 'PDF/Excel' }
          ].map(report => (
            <div
              key={report.type}
              onClick={() => setSelectedReportType(report.type)}
              className={`bg-white rounded-xl shadow-sm border-2 p-6 cursor-pointer transition-all ${
                selectedReportType === report.type
                  ? 'border-blue-500 ring-4 ring-blue-100'
                  : 'border-gray-200 hover:border-blue-300'
              }`}
            >
              <div className="text-center">
                <div className="text-5xl mb-3">{report.icon}</div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{report.title}</h3>
                <p className="text-sm text-gray-600 mb-3">{report.desc}</p>
                <div className="space-y-1 text-xs text-gray-500">
                  <div>{report.pages}</div>
                  <div>{report.formats}</div>
                </div>
                <button
                  className={`mt-4 w-full px-4 py-2 rounded-lg font-semibold transition-colors ${
                    selectedReportType === report.type
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {selectedReportType === report.type ? 'Selected' : 'Generate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Board Pack Builder */}
      {selectedReportType === 'boardPack' && (
        <div className="max-w-[1800px] mx-auto mb-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Section Selector */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Board Pack Sections</h2>
                <span className="text-sm text-gray-600">{includedSections} sections included</span>
              </div>
              
              <div className="space-y-2">
                {sections.map((section, index) => (
                  <div
                    key={section.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-colors ${
                      section.included ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => moveSection(index, 'up')}
                        disabled={index === 0}
                        className="p-1 hover:bg-white rounded disabled:opacity-30"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        onClick={() => moveSection(index, 'down')}
                        disabled={index === sections.length - 1}
                        className="p-1 hover:bg-white rounded disabled:opacity-30"
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-700">{section.order}.</span>
                        <span className="text-sm font-medium text-gray-900">{section.title}</span>
                        {section.aiGenerated && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">AI</span>
                        )}
                        {section.approved && (
                          <Check size={14} className="text-green-600" />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={section.included}
                          onChange={() => toggleSection(section.id)}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <span className="ml-2 text-xs text-gray-600">Include</span>
                      </label>
                      {section.aiGenerated && section.included && (
                        <button
                          onClick={() => toggleApproval(section.id)}
                          className={`p-1.5 rounded ${
                            section.approved ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                          }`}
                          title={section.approved ? 'Approved' : 'Not approved'}
                        >
                          <Check size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Preview */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Live Preview</h2>
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200 max-h-[600px] overflow-y-auto">
                <div className="text-center mb-6 pb-4 border-b border-gray-300">
                  <h3 className="text-2xl font-bold text-gray-900">FINREPORT AI</h3>
                  <p className="text-lg text-gray-700 mt-2">BOARD PACK — {period.toUpperCase()}</p>
                  <p className="text-sm text-gray-500 mt-1">Generated: {new Date().toLocaleDateString()}</p>
                </div>

                {sections.filter(s => s.included).sort((a, b) => a.order - b.order).map((section, idx) => (
                  <div key={section.id} className="mb-6">
                    <h4 className="text-sm font-bold text-gray-900 mb-2 uppercase">
                      {section.order}. {section.title}
                    </h4>
                    <div className="h-px bg-gray-300 mb-3"></div>
                    
                    {section.id === 'exec-summary' && (
                      <div className="text-xs text-gray-700 leading-relaxed">
                        {aiCommentary.executiveSummary?.content || 
                          "October 2025 delivered revenue of ₹33.0Cr against a budget of ₹35.0Cr (-5.7%). While revenue missed target, cost management improved with distribution expenses 7.7% under budget..."}
                      </div>
                    )}
                    
                    {section.id === 'fin-highlights' && (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><span className="font-semibold">Revenue:</span> ₹33.0Cr <span className="text-red-600">▼5.7%</span></div>
                        <div><span className="font-semibold">Gr Profit:</span> ₹14.5Cr <span className="text-red-600">▼19.4%</span></div>
                        <div><span className="font-semibold">EBITDA:</span> ₹8.6Cr <span className="text-red-600">▼3.9%</span></div>
                        <div><span className="font-semibold">Net Profit:</span> ₹5.1Cr <span className="text-red-600">▼37%</span></div>
                      </div>
                    )}
                    
                    {section.id === 'variance' && (
                      <div className="text-xs text-gray-700 leading-relaxed">
                        {aiCommentary.varianceCommentary?.content || 
                          "Key unfavorable variances include Admin costs +20.8% (₹25L over), Export sales -11.1% (₹100L under), and COGS +8.8%..."}
                      </div>
                    )}
                    
                    {!['exec-summary', 'fin-highlights', 'variance'].includes(section.id) && (
                      <div className="text-xs text-gray-500 italic">
                        [Section content from {section.title.split('—')[0].trim()} module]
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Flash Report */}
      {selectedReportType === 'flashReport' && (
        <div className="max-w-[1800px] mx-auto mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <div className="border-t-4 border-b-4 border-gray-800 py-4 mb-6">
              <h2 className="text-2xl font-bold text-center text-gray-900">FINREPORT AI — FLASH REPORT</h2>
              <p className="text-center text-gray-600 mt-1">{period} | Generated: {new Date().toLocaleDateString()}</p>
            </div>

            <div className="space-y-6">
              {/* Headline */}
              <div>
                <h3 className="text-sm font-bold text-gray-700 mb-2 uppercase">Headline</h3>
                <p className="text-lg text-gray-900 font-medium">{flashReportData.headline}</p>
              </div>

              {/* Key Metrics */}
              <div>
                <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase">Key Metrics</h3>
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="py-2 px-4 text-left">Metric</th>
                      <th className="py-2 px-4 text-right">Actual</th>
                      <th className="py-2 px-4 text-right">Budget</th>
                      <th className="py-2 px-4 text-right">Var</th>
                      <th className="py-2 px-4 text-right">Var %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flashReportData.keyMetrics.map((metric, idx) => (
                      <tr key={idx} className="border-b border-gray-200">
                        <td className="py-2 px-4 font-medium">{metric.label}</td>
                        <td className="py-2 px-4 text-right">{formatCurrency(metric.actual)}</td>
                        <td className="py-2 px-4 text-right">{formatCurrency(metric.budget)}</td>
                        <td className={`py-2 px-4 text-right font-semibold ${metric.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {metric.variance >= 0 ? '▲' : '▼'}{formatCurrency(Math.abs(metric.variance))}
                        </td>
                        <td className={`py-2 px-4 text-right font-semibold ${metric.variancePct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {metric.variancePct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Top Variances */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-bold text-green-700 mb-2 uppercase">✅ Favorable</h3>
                  <ul className="space-y-1 text-sm">
                    {flashReportData.topVariances.favorable.map((item, idx) => (
                      <li key={idx}>• {item.label}: {item.amount}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-red-700 mb-2 uppercase">🔴 Unfavorable</h3>
                  <ul className="space-y-1 text-sm">
                    {flashReportData.topVariances.unfavorable.map((item, idx) => (
                      <li key={idx}>• {item.label}: {item.amount}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Key Messages */}
              <div>
                <h3 className="text-sm font-bold text-gray-700 mb-2 uppercase">Key Messages</h3>
                <ul className="space-y-2 text-sm text-gray-700">
                  {flashReportData.keyMessages.map((msg, idx) => (
                    <li key={idx}>• {msg}</li>
                  ))}
                </ul>
              </div>

              {/* Immediate Actions */}
              <div>
                <h3 className="text-sm font-bold text-gray-700 mb-2 uppercase">Immediate Actions</h3>
                <ol className="space-y-2 text-sm text-gray-700">
                  {flashReportData.immediateActions.map((action, idx) => (
                    <li key={idx}>{idx + 1}. {action}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Commentary Writer */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border-2 border-purple-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="text-purple-600" size={24} />
            <h2 className="text-xl font-bold text-gray-900">🤖 AI Commentary Writer — Powered by Nova</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: 'executiveSummary', label: 'Executive Summary' },
              { key: 'varianceCommentary', label: 'Variance Commentary' },
              { key: 'cashFlowCommentary', label: 'Cash Flow Commentary' },
              { key: 'outlook', label: 'Forward Outlook' }
            ].map(section => (
              <div key={section.key} className="bg-white rounded-lg p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">{section.label}</h3>
                  <button
                    onClick={() => generateAICommentary(section.key)}
                    disabled={generatingCommentary === section.key}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                  >
                    <Sparkles size={14} />
                    {generatingCommentary === section.key ? 'Generating...' : 'Generate'}
                  </button>
                </div>

                {aiCommentary[section.key] ? (
                  <>
                    <div className="text-sm text-gray-700 mb-3 p-3 bg-gray-50 rounded border border-gray-200 max-h-32 overflow-y-auto">
                      {aiCommentary[section.key].content}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        Words: {aiCommentary[section.key].wordCount}/{aiCommentary[section.key].maxWords}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copyCommentary(aiCommentary[section.key].content)}
                          className="p-1.5 hover:bg-gray-100 rounded"
                          title="Copy"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={() => approveCommentary(section.key)}
                          className={`p-1.5 rounded ${
                            aiCommentary[section.key].approved ? 'bg-green-100 text-green-700' : 'hover:bg-gray-100'
                          }`}
                          title={aiCommentary[section.key].approved ? 'Approved' : 'Approve'}
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-gray-500 italic">Click Generate to create AI commentary</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Report History */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Report History</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="py-3 px-4 text-left font-semibold text-gray-700">Report Name</th>
                  <th className="py-3 px-4 text-left font-semibold text-gray-700">Period</th>
                  <th className="py-3 px-4 text-left font-semibold text-gray-700">Type</th>
                  <th className="py-3 px-4 text-left font-semibold text-gray-700">Generated</th>
                  <th className="py-3 px-4 text-left font-semibold text-gray-700">Status</th>
                  <th className="py-3 px-4 text-right font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reportHistory.map((report, idx) => (
                  <tr key={report.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-900">{report.name}</td>
                    <td className="py-3 px-4 text-gray-600">{report.period}</td>
                    <td className="py-3 px-4">
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                        {report.type === 'boardPack' ? 'Board Pack' : report.type === 'flashReport' ? 'Flash Report' : 'Mgmt Accounts'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {new Date(report.generatedAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        report.status === 'final' ? 'bg-green-100 text-green-700' :
                        report.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {report.status === 'final' ? 'Final ✅' : report.status === 'sent' ? 'Sent ✅' : 'Draft 🟡'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button className="p-1.5 hover:bg-gray-100 rounded" title="View">
                          <Eye size={16} />
                        </button>
                        <button className="p-1.5 hover:bg-gray-100 rounded" title="Download">
                          <Download size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg">
            <div className="flex items-center gap-2 mb-4">
              <Mail size={24} className="text-blue-600" />
              <h3 className="text-xl font-bold text-gray-900">📧 Email Board Pack</h3>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To:</label>
                <input
                  type="email"
                  defaultValue="board@company.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CC:</label>
                <input
                  type="email"
                  defaultValue="cfo@company.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject:</label>
                <input
                  type="text"
                  defaultValue={`Board Pack — ${period} | FinReport AI`}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message:</label>
                <textarea
                  rows={4}
                  defaultValue="Dear Board Members,\n\nPlease find attached the monthly board pack for your review.\n\nBest regards,\nCFO"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <FileText size={16} />
                <span>Board_Pack_{period.replace(' ', '_')}.pdf ✅</span>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={sendEmail}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Send Email
              </button>
              <button
                onClick={() => setShowEmailModal(false)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagementReporting;
