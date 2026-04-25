// FP&A Variance Analysis - AI Commentary Component (AWS Nova Powered)
import { useState } from 'react';
import { Sparkles, Copy, RefreshCw, Download, Edit2, Check, X } from 'lucide-react';
import type { VarianceRow } from '../../types/fpa';
import { callAI } from '../../services/aiProvider';
import { formatCurrency, formatPercentage } from '../../utils/varianceUtils';

interface Props {
  varianceData: VarianceRow[];
  period: string;
  entityName: string;
  currency?: string;
}

export const AICommentary = ({ varianceData, period, entityName, currency = "INR" }: Props) => {
  const [commentary, setCommentary] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedCommentary, setEditedCommentary] = useState('');
  const [copied, setCopied] = useState(false);

  const generateCommentary = async () => {
    setIsGenerating(true);
    
    try {
      const classifyType = (r: VarianceRow): 'income' | 'expense' | 'other' => {
        if (r.accountType) return r.accountType;
        const c = String(r.category || '').toLowerCase();
        if (/revenue|income|sales/.test(c) && !/cogs|cost of sales|cost of goods/.test(c)) return 'income';
        if (/expense|cost|cogs|depreciation|interest|payroll|rent|admin|marketing/.test(c)) return 'expense';
        return 'other';
      };
      const pAndLRows = varianceData.filter((r) => !r.isHeader && classifyType(r) !== 'other');

      // Find critical variances
      const criticalVariances = varianceData
        .filter(r => r.threshold === "critical" && !r.isHeader)
        .map(r => `${r.category}: ${formatPercentage(r.variancePct)} ${r.favorable ? 'favorable' : 'unfavorable'}`);

      const costOverruns = pAndLRows
        .filter((r) => classifyType(r) === 'expense' && r.actual > r.budget)
        .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
        .slice(0, 3)
        .map((r) => `${r.category}: ${formatPercentage(r.variancePct)} over budget`);

      const favorableVariances = pAndLRows
        .filter((r) =>
          (classifyType(r) === 'income' && r.actual > r.budget) ||
          (classifyType(r) === 'expense' && r.actual < r.budget)
        )
        .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
        .slice(0, 3)
        .map((r) => `${r.category}: ${formatPercentage(r.variancePct)} ${classifyType(r) === 'income' ? 'above budget' : 'under budget'}`);

      // Get key metrics
      const revenue = varianceData.find(r => r.id === "revenue");
      const netProfit = varianceData.find(r => r.id === "net-profit");
      const adminExpenses = varianceData.find(r => r.id === "admin-expenses");
      const exportSales = varianceData.find(r => r.id === "export-sales");
      const costOfSales = varianceData.find(r => r.id === "cost-of-sales");

      const prompt = `You are a senior FP&A analyst writing variance commentary for a board pack.

COMPANY: ${entityName}
PERIOD: ${period}
CURRENCY: ${currency}

KEY VARIANCES:
${criticalVariances.join("\n")}

DETAILED METRICS:
- Revenue: Actual ${revenue ? formatCurrency(revenue.actual, currency) : 'N/A'} vs Budget ${revenue ? formatCurrency(revenue.budget, currency) : 'N/A'} (${revenue ? formatPercentage(revenue.variancePct) : 'N/A'} ${revenue?.favorable ? 'favorable' : 'unfavorable'})
- Net Profit: Actual ${netProfit ? formatCurrency(netProfit.actual, currency) : 'N/A'} vs Budget ${netProfit ? formatCurrency(netProfit.budget, currency) : 'N/A'} (${netProfit ? formatPercentage(netProfit.variancePct) : 'N/A'} ${netProfit?.favorable ? 'favorable' : 'unfavorable'})
- Admin Expenses: ${adminExpenses ? formatPercentage(adminExpenses.variancePct) : 'N/A'} over budget
- Export Sales: ${exportSales ? formatPercentage(exportSales.variancePct) : 'N/A'} below target
- Cost of Sales: ${costOfSales ? formatPercentage(costOfSales.variancePct) : 'N/A'} over budget

STRICT RULES:
- Revenue exceeding budget is ALWAYS favorable.
- NEVER call revenue increase an overspend.
- NEVER list revenue inside cost overruns.
- Always present these sections:
  a) Revenue Performance (vs budget)
  b) Cost Performance (vs budget)
  c) Profit/Margin Impact
- Overall logic:
  * revenue up + costs controlled => Outperforming
  * revenue up + costs up faster => Growth with pressure
  * revenue down + costs up => Underperforming
  * revenue down + costs down => Contracting
- COGS interpretation must use ratio:
  Budget COGS% = Budget COGS / Budget Revenue
  Actual COGS% = Actual COGS / Actual Revenue
  If Actual COGS% < Budget COGS% => margin improved
  If Actual COGS% > Budget COGS% => margin eroded
- Use ONLY numbers given above.
- NEVER use generic phrases like "implement spending freeze", "renegotiate contracts", or "improve cost controls".
- NEVER use words:
  "overspend" for revenue
  "unfavorable" for revenue exceeding budget
  "spending freeze"
  "renegotiate contracts"
- ALWAYS cite specific values and percentages.

COST OVERRUNS (expense only):
${costOverruns.length ? costOverruns.join("\n") : 'None'}

FAVORABLE VARIANCES:
${favorableVariances.length ? favorableVariances.join("\n") : 'None'}

Write commentary in this exact structure:

1. HEADLINE (one sentence, with numbers)

2. TOP 3 DRIVERS (with amounts)

3. REVENUE PERFORMANCE

4. COST PERFORMANCE

5. PROFIT/MARGIN IMPACT

6. COST OVERRUNS (expense only)

7. FAVORABLE VARIANCES

8. 3 SPECIFIC ACTIONS (each action includes a numeric target)

Formatting:
- Plain text only (no markdown)
- Section headers in ALL CAPS ending with colon`;

      const result = await callAI(prompt);
      setCommentary(result);
      setEditedCommentary(result);
    } catch (error: any) {
      alert('Failed to generate commentary: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(isEditing ? editedCommentary : commentary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = () => {
    setCommentary(editedCommentary);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditedCommentary(commentary);
    setIsEditing(false);
  };

  const handleDownload = () => {
    const blob = new Blob([commentary], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `variance-commentary-${period}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Sparkles className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">AI-Powered Variance Commentary</h3>
            <p className="text-sm text-gray-600">Professional board-level analysis by AWS Nova</p>
          </div>
        </div>

        {/* Action Buttons */}
        {commentary && !isEditing && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition flex items-center gap-2 text-sm font-medium"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={() => setIsEditing(true)}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition flex items-center gap-2 text-sm font-medium"
            >
              <Edit2 className="w-4 h-4" />
              Edit
            </button>
            <button
              onClick={handleDownload}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition flex items-center gap-2 text-sm font-medium"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
            <button
              onClick={generateCommentary}
              disabled={isGenerating}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition flex items-center gap-2 text-sm font-medium disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
              Regenerate
            </button>
          </div>
        )}
      </div>

      {/* Commentary Display/Edit */}
      {!commentary ? (
        <div className="text-center py-12">
          <div className="mb-4">
            <Sparkles className="w-16 h-16 text-purple-300 mx-auto" />
          </div>
          <p className="text-gray-600 mb-6">Generate AI-powered variance commentary for your board pack</p>
          <button
            onClick={generateCommentary}
            disabled={isGenerating}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg font-semibold transition flex items-center gap-2 mx-auto disabled:opacity-50"
          >
            <Sparkles className={`w-5 h-5 ${isGenerating ? 'animate-pulse' : ''}`} />
            {isGenerating ? 'Generating Commentary...' : 'Generate AI Commentary'}
          </button>
        </div>
      ) : isEditing ? (
        <div>
          <textarea
            value={editedCommentary}
            onChange={(e) => setEditedCommentary(e.target.value)}
            className="w-full h-96 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            placeholder="Edit commentary..."
          />
          <div className="flex items-center justify-end gap-2 mt-4">
            <button
              onClick={handleCancelEdit}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              Save Changes
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
          <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
            {commentary}
          </pre>
        </div>
      )}
    </div>
  );
};
