import React, { useState } from 'react';
import { Sparkles, RefreshCw, Copy, Download } from 'lucide-react';
import { callAI } from '../../../services/aiProvider';
import { KPIMetric } from '../../../types/kpi';

interface AIInsightsProps {
  kpis: KPIMetric[];
}

const AIInsights: React.FC<AIInsightsProps> = ({ kpis }) => {
  const [insights, setInsights] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generateInsights = async () => {
    setLoading(true);
    try {
      const criticalKPIs = kpis.filter(k => k.status === 'critical');
      const goodKPIs = kpis.filter(k => k.status === 'excellent' || k.status === 'good');

      const prompt = `You are a CFO advisor. Analyze these KPIs and provide actionable insights for the CFO morning briefing.

CRITICAL KPIs (needs immediate attention):
${criticalKPIs.map(k => `- ${k.title}: ${k.formattedValue} vs target ${k.unit === 'currency' ? '₹' + (k.target / 10000000).toFixed(2) + 'Cr' : k.target.toFixed(1) + (k.unit === 'percentage' ? '%' : k.unit === 'days' ? ' days' : 'x')} (${k.changePercent > 0 ? '+' : ''}${k.changePercent.toFixed(1)}%)`).join('\n')}

PERFORMING WELL:
${goodKPIs.slice(0, 3).map(k => `- ${k.title}: ${k.formattedValue}`).join('\n')}

KEY METRICS:
- Revenue: ₹33Cr vs ₹35Cr budget (-5.7%)
- Gross Margin: 43.9% vs 51.4% target (-7.5pp)
- Net Profit: ₹5.1Cr vs ₹8.1Cr budget (-37%)
- Cash Conversion Cycle: 66 days vs 45 day target
- DSO: 46 days (customers paying late)

Provide:
1. TOP 3 URGENT ACTIONS (what CFO must do TODAY)
2. POSITIVE HIGHLIGHTS (what is working well)
3. 30-DAY OUTLOOK (what to watch next month)
4. ONE KEY RISK (biggest financial risk right now)

Be specific, use numbers, CFO tone, max 200 words total.`;

      const aiResponse = await callAI(prompt);
      setInsights(aiResponse);
    } catch (error: any) {
      alert('❌ Failed to generate AI insights: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (insights) {
      navigator.clipboard.writeText(insights);
      alert('✅ Insights copied to clipboard!');
    }
  };

  const downloadInsights = () => {
    if (insights) {
      const blob = new Blob([insights], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `KPI_Insights_${new Date().toISOString().split('T')[0]}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const formatInsights = (text: string) => {
    // Split by sections
    const sections = text.split(/(\d\.|TOP|POSITIVE|30-DAY|ONE KEY)/);
    return sections.map((section, idx) => {
      if (section.includes('TOP 3') || section.includes('URGENT')) {
        return <div key={idx} className="mb-4"><h4 className="font-bold text-red-600 mb-2">🚨 TOP 3 URGENT ACTIONS</h4></div>;
      } else if (section.includes('POSITIVE')) {
        return <div key={idx} className="mb-4"><h4 className="font-bold text-green-600 mb-2">✅ POSITIVE HIGHLIGHTS</h4></div>;
      } else if (section.includes('30-DAY')) {
        return <div key={idx} className="mb-4"><h4 className="font-bold text-blue-600 mb-2">📅 30-DAY OUTLOOK</h4></div>;
      } else if (section.includes('KEY RISK')) {
        return <div key={idx} className="mb-4"><h4 className="font-bold text-amber-600 mb-2">⚠️ KEY RISK</h4></div>;
      }
      return <p key={idx} className="text-gray-700 whitespace-pre-line mb-2">{section}</p>;
    });
  };

  return (
    <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border-2 border-purple-200 p-6 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-600 rounded-lg">
            <Sparkles className="text-white" size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">AI CFO Insights</h3>
            <p className="text-sm text-gray-600">Powered by AWS Nova</p>
          </div>
        </div>
        
        {!loading && !insights && (
          <button
            onClick={generateInsights}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all shadow-md hover:shadow-lg transform hover:scale-105"
          >
            <Sparkles size={18} />
            Generate Insights
          </button>
        )}
        
        {insights && (
          <div className="flex items-center gap-2">
            <button
              onClick={copyToClipboard}
              className="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              title="Copy to clipboard"
            >
              <Copy size={18} className="text-gray-600" />
            </button>
            <button
              onClick={downloadInsights}
              className="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              title="Download as text"
            >
              <Download size={18} className="text-gray-600" />
            </button>
            <button
              onClick={generateInsights}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={18} className={`text-gray-600 ${loading ? 'animate-spin' : ''}`} />
              <span className="text-sm">Regenerate</span>
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mb-4"></div>
          <p className="text-gray-600">Analyzing KPIs with AI...</p>
        </div>
      )}

      {!loading && !insights && (
        <div className="bg-white rounded-lg p-6 text-center">
          <p className="text-gray-600 mb-4">
            Click "Generate Insights" to get AI-powered analysis of your KPIs with actionable recommendations.
          </p>
          <div className="grid grid-cols-2 gap-4 text-sm text-left">
            <div className="bg-purple-50 p-3 rounded-lg">
              <div className="font-semibold text-purple-900 mb-1">📊 What you'll get:</div>
              <ul className="text-gray-700 space-y-1 text-xs">
                <li>• Urgent action items</li>
                <li>• Performance highlights</li>
                <li>• Future outlook</li>
                <li>• Risk assessment</li>
              </ul>
            </div>
            <div className="bg-blue-50 p-3 rounded-lg">
              <div className="font-semibold text-blue-900 mb-1">🤖 AI analyzes:</div>
              <ul className="text-gray-700 space-y-1 text-xs">
                <li>• {kpis.filter(k => k.status === 'critical').length} critical KPIs</li>
                <li>• {kpis.filter(k => k.status === 'warning').length} warning KPIs</li>
                <li>• {kpis.filter(k => k.status === 'excellent' || k.status === 'good').length} performing well</li>
                <li>• Historical trends</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {!loading && insights && (
        <div className="bg-white rounded-lg p-6 shadow-sm">
          <div className="prose prose-sm max-w-none">
            {formatInsights(insights)}
          </div>
        </div>
      )}
    </div>
  );
};

export default AIInsights;
