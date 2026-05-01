// FP&A Variance Analysis - AI Commentary Component (AWS Nova Powered)
import { useState } from 'react';
import { Sparkles, Copy, RefreshCw, Download, Edit2, Check, X, ChevronDown } from 'lucide-react';
import type { VarianceRow, CurrencyFormatLocale } from '../../types/fpa';
import { callAI } from '../../services/aiProvider';
import { formatCurrency, formatPercentage } from '../../utils/varianceUtils';

interface Props {
  varianceData: VarianceRow[];
  period: string;
  entityName: string;
  currency?: string;
  currencyFormat?: CurrencyFormatLocale;
}

type NarrativeMode = 'cfo' | 'board' | 'investor';

const SYSTEM_PROMPT = `
You are a senior CFO advisor generating 
variance analysis commentary.

ABSOLUTE RULES — NEVER BREAK THESE:

1. NET PROFIT IS NEVER "SPENT"
   Always write: "Net profit increased to X 
   from budget of Y — favorable variance of Z"
   NEVER write profit as a spending statement

2. PROFIT VARIANCE DIRECTION
   actual_profit > budget_profit = FAVORABLE
   actual_profit < budget_profit = UNFAVORABLE
   NEVER call profit increase "unfavorable"

3. STATUS CLASSIFICATION (use these exact phrases)
   revenue_growth% > cost_growth% AND profit > budget:
   → "High Growth with Margin Expansion"
   
   revenue_growth% > 0 AND cost_growth% > revenue_growth%:
   → "Growth with Margin Pressure"
   
   revenue_growth% < 0:
   → "Underperforming"

4. COSTS VS REVENUE LOGIC
   If costs grew LESS than revenue:
   → "Costs well-controlled relative to growth"
   → "Strong operating leverage"
   NEVER say "costs outpacing revenue" when 
   costs grew LESS than revenue

5. MARKETING EFFICIENCY
   If revenue_growth > marketing_growth:
   → "Marketing efficiency strong — 
      revenue scaled faster than spend"
   NEVER say "marketing underperformed"

6. COGS INTERPRETATION
   Always calculate:
   budget_cogs_pct = budget_cogs/budget_revenue
   actual_cogs_pct = actual_cogs/actual_revenue
   Write: "Gross margin moved from X% to Y%"
   Add: "Subject to pricing/mix validation"
   When COGS grew slower than revenue, prefer this style (substitute real % from DATA INPUTS):
   "A key highlight is that COGS increased by only X% relative to Y% revenue growth, indicating strong operating leverage."

7. CURRENCY IN PROSE
   Echo monetary amounts using the SAME compact style as DATA INPUTS (e.g. $58.29M or ₹5.82Cr).
   Never mix Indian lakh/crore wording with international M/K in the same narrative.

8. BANNED WORDS — NEVER USE:
   - "spent" for profit
   - "unfavorable" for profit increase
   - "outpacing" when costs < revenue growth
   - "growth with pressure" when margins expanded
   - "economies of scale" without data
   - "spending freeze"
   - "renegotiate contracts"

OUTPUT STRUCTURE — ALWAYS USE THIS:

Executive Summary:
[Company] delivered [status] for [period].

Revenue: [actual] vs budget [budget] — [+X%] FAVORABLE/UNFAVORABLE
Costs: [actual] vs budget [budget] — [+X%] OVER/UNDER BUDGET  
Net Profit: [actual] vs budget [budget] — [+X%] FAVORABLE/UNFAVORABLE
Gross Margin: moved from [budget%] to [actual%]

Key Insights:
- [specific numbered insight with £/$ amounts]
- [specific numbered insight]
- [specific numbered insight]

Key Risks:
- [specific risk with numbers]
- [specific risk with numbers]

Overall Status: [High Growth with Margin Expansion /
                 Growth with Margin Pressure /
                 Underperforming]
`;

const MODE_INSTRUCTIONS: Record<NarrativeMode, string> = {
  cfo: `
NARRATIVE MODE: CFO Summary
- Keep detailed commentary with specific financial numbers.
- Highlight concrete drivers and operating actions by line item.
- Include precise budget vs actual references in each section.`,
  board: `
NARRATIVE MODE: Board Presentation
- At most 3 bullet points total for the entire Key Insights section (no extra bullets elsewhere).
- Visual-first: each bullet starts with the headline number or %, then one short clause.
- Skip granular line-item lists; focus on strategic signal and decisions.`,
  investor: `
NARRATIVE MODE: Investor Update
- Growth story first; cite runway and efficiency only from DATA (no invented TAM figures).
- Pair major upside with a specific risk and how management addresses it.
- Tone: confident, concise, appropriate for public-company-style updates.`,
};

const validateNarrative = (text: string): boolean => {
  const lower = String(text || '').toLowerCase();
  const bannedPatterns: RegExp[] = [
    /company\s+spent/,
    /costs outpacing/,
    /growth with pressure/,
    /net profit[\s\S]{0,80}unfavorable variance|unfavorable variance[\s\S]{0,80}net profit/,
  ];
  return !bannedPatterns.some((rx) => rx.test(lower));
};

export const AICommentary = ({ varianceData, period, entityName, currency = "INR", currencyFormat }: Props) => {
  const [commentary, setCommentary] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedCommentary, setEditedCommentary] = useState('');
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<NarrativeMode>('cfo');
  const [showModeMenu, setShowModeMenu] = useState(false);

  const modeLabel: Record<NarrativeMode, string> = {
    cfo: 'CFO Summary',
    board: 'Board Presentation',
    investor: 'Investor Update',
  };

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

      const revenueRows = pAndLRows.filter((r) => classifyType(r) === 'income');
      const expenseRows = pAndLRows.filter((r) => classifyType(r) === 'expense');
      const marketingRows = expenseRows.filter((r) => /marketing|advertising/i.test(String(r.category || '')));
      const cogsRows = expenseRows.filter((r) => /cogs|cost of sales|cost of goods/i.test(String(r.category || '')));

      const revenueActual = revenueRows.reduce((s, r) => s + (Number(r.actual) || 0), 0);
      const revenueBudget = revenueRows.reduce((s, r) => s + (Number(r.budget) || 0), 0);
      const costActual = expenseRows.reduce((s, r) => s + (Number(r.actual) || 0), 0);
      const costBudget = expenseRows.reduce((s, r) => s + (Number(r.budget) || 0), 0);
      const netProfitActual = revenueActual - costActual;
      const netProfitBudget = revenueBudget - costBudget;
      const revenueVariancePct = revenueBudget !== 0 ? ((revenueActual - revenueBudget) / revenueBudget) * 100 : 0;
      const costVariancePct = costBudget !== 0 ? ((costActual - costBudget) / costBudget) * 100 : 0;
      const netProfitVariancePct = netProfitBudget !== 0 ? ((netProfitActual - netProfitBudget) / Math.abs(netProfitBudget)) * 100 : 0;
      const marketingActual = marketingRows.reduce((s, r) => s + (Number(r.actual) || 0), 0);
      const marketingBudget = marketingRows.reduce((s, r) => s + (Number(r.budget) || 0), 0);
      const marketingGrowthPct = marketingBudget !== 0 ? ((marketingActual - marketingBudget) / marketingBudget) * 100 : 0;
      const budgetCogs = cogsRows.reduce((s, r) => s + (Number(r.budget) || 0), 0);
      const actualCogs = cogsRows.reduce((s, r) => s + (Number(r.actual) || 0), 0);
      const budgetCogsPct = revenueBudget !== 0 ? (budgetCogs / revenueBudget) * 100 : 0;
      const actualCogsPct = revenueActual !== 0 ? (actualCogs / revenueActual) * 100 : 0;
      const marginChangePct = budgetCogsPct - actualCogsPct;
      const statusClassification =
        revenueVariancePct > costVariancePct && netProfitActual > netProfitBudget
          ? 'High Growth with Margin Expansion'
          : revenueVariancePct > 0 && costVariancePct > revenueVariancePct
            ? 'Growth with Margin Pressure'
            : revenueVariancePct < 0 && costVariancePct > 0
              ? 'Underperforming'
              : 'Mixed performance';

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

      // Get key metrics (kept for account-level commentary)
      const adminExpenses = varianceData.find(r => r.id === "admin-expenses");
      const exportSales = varianceData.find(r => r.id === "export-sales");
      const costOfSales = varianceData.find(r => r.id === "cost-of-sales");

      const prompt = `${SYSTEM_PROMPT}
${MODE_INSTRUCTIONS[mode]}

DATA INPUTS:
Company: ${entityName}
Period: ${period}
Currency: ${currency}
Revenue actual: ${formatCurrency(revenueActual, currency, currencyFormat)}
Revenue budget: ${formatCurrency(revenueBudget, currency, currencyFormat)}
Revenue growth %: ${revenueVariancePct.toFixed(1)}%
Cost actual: ${formatCurrency(costActual, currency, currencyFormat)}
Cost budget: ${formatCurrency(costBudget, currency, currencyFormat)}
Cost growth %: ${costVariancePct.toFixed(1)}%
Net profit actual: ${formatCurrency(netProfitActual, currency, currencyFormat)}
Net profit budget: ${formatCurrency(netProfitBudget, currency, currencyFormat)}
Net profit variance %: ${netProfitVariancePct.toFixed(1)}%
Marketing growth %: ${marketingGrowthPct.toFixed(1)}%
Budget COGS %: ${budgetCogsPct.toFixed(1)}%
Actual COGS %: ${actualCogsPct.toFixed(1)}%
Margin change % (budget - actual COGS%): ${marginChangePct.toFixed(1)}%
Status classification anchor: ${statusClassification}

Critical variances:
${criticalVariances.join("\n") || 'None'}

Cost overruns (expense only):
${costOverruns.join("\n") || 'None'}

Favorable variances:
${favorableVariances.join("\n") || 'None'}

Additional metrics:
Admin Expenses variance: ${adminExpenses ? formatPercentage(adminExpenses.variancePct) : 'N/A'}
Export Sales variance: ${exportSales ? formatPercentage(exportSales.variancePct) : 'N/A'}
Cost of Sales variance: ${costOfSales ? formatPercentage(costOfSales.variancePct) : 'N/A'}

Generate the final narrative now.`;

      let result = '';
      const maxAttempts = 3; // initial + 2 retries
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const retryNudge = attempt > 1
          ? `\n\nRETRY ${attempt - 1}: Previous output violated banned-phrase validation. Rewrite strictly and remove banned language. Keep ${modeLabel[mode]} style.`
          : '';
        result = await callAI(prompt + retryNudge);
        if (validateNarrative(result)) break;
      }
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
            <div className="relative">
              <button
                onClick={() => setShowModeMenu((s) => !s)}
                className="px-3 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition flex items-center gap-2 text-sm font-medium"
              >
                <span className="truncate max-w-[200px]">AI Narrative · {modeLabel[mode]}</span>
                <ChevronDown className="w-4 h-4 shrink-0" />
              </button>
              {showModeMenu && (
                <div className="absolute right-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white shadow-lg z-20">
                  {(['cfo', 'board', 'investor'] as NarrativeMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setMode(m);
                        setShowModeMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${mode === m ? 'font-semibold text-purple-700' : 'text-gray-700'}`}
                    >
                      {modeLabel[m]}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
          <div className="inline-block relative mb-4">
            <button
              onClick={() => setShowModeMenu((s) => !s)}
              className="px-4 py-2 border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition flex items-center gap-2 text-sm font-semibold"
            >
              <span className="truncate max-w-[220px]">AI Narrative · {modeLabel[mode]}</span>
              <ChevronDown className="w-4 h-4 shrink-0" />
            </button>
            {showModeMenu && (
              <div className="absolute left-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white shadow-lg z-20">
                {(['cfo', 'board', 'investor'] as NarrativeMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMode(m);
                      setShowModeMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${mode === m ? 'font-semibold text-purple-700' : 'text-gray-700'}`}
                  >
                    {modeLabel[m]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-4">Selected mode: {modeLabel[mode]}</p>
          <button
            onClick={generateCommentary}
            disabled={isGenerating}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg font-semibold transition flex items-center gap-2 mx-auto disabled:opacity-50"
          >
            <Sparkles className={`w-5 h-5 ${isGenerating ? 'animate-pulse' : ''}`} />
            {isGenerating ? 'Generating Commentary...' : `Generate ${modeLabel[mode]}`}
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
