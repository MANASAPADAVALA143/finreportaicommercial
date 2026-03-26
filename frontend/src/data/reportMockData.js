export const reportHistory = [
    {
        id: "rpt-001",
        name: "Board Pack — October 2025",
        period: "Oct 2025",
        type: "boardPack",
        generatedAt: "2025-11-05T09:00:00",
        generatedBy: "MANASA Padavala",
        status: "final",
        pageCount: 18,
        fileSize: "2.4MB"
    },
    {
        id: "rpt-002",
        name: "Flash Report — October 2025",
        period: "Oct 2025",
        type: "flashReport",
        generatedAt: "2025-11-03T08:30:00",
        generatedBy: "MANASA Padavala",
        status: "sent",
        pageCount: 2,
        fileSize: "0.3MB"
    },
    {
        id: "rpt-003",
        name: "Board Pack — September 2025",
        period: "Sep 2025",
        type: "boardPack",
        generatedAt: "2025-10-04T09:00:00",
        generatedBy: "MANASA Padavala",
        status: "final",
        pageCount: 16,
        fileSize: "2.1MB"
    },
    {
        id: "rpt-004",
        name: "Management Accounts — September 2025",
        period: "Sep 2025",
        type: "managementAccounts",
        generatedAt: "2025-10-04T09:00:00",
        generatedBy: "MANASA Padavala",
        status: "draft",
        pageCount: 9,
        fileSize: "1.2MB"
    }
];
export const boardPackSections = [
    { id: "exec-summary", title: "Executive Summary (AI-written)", included: true, order: 1, aiGenerated: true, approved: false },
    { id: "fin-highlights", title: "Financial Highlights — KPI Cards", included: true, order: 2, aiGenerated: false, approved: true },
    { id: "pl-summary", title: "P&L Summary — Budget vs Actual", included: true, order: 3, aiGenerated: false, approved: true },
    { id: "revenue", title: "Revenue Analysis — by segment", included: true, order: 4, aiGenerated: false, approved: true },
    { id: "costs", title: "Cost Analysis — by department", included: true, order: 5, aiGenerated: false, approved: false },
    { id: "balance-sheet", title: "Balance Sheet Summary", included: true, order: 6, aiGenerated: false, approved: true },
    { id: "cashflow", title: "Cash Flow Summary", included: true, order: 7, aiGenerated: false, approved: true },
    { id: "variance", title: "Variance Commentary (AI-written)", included: true, order: 8, aiGenerated: true, approved: false },
    { id: "trends", title: "12-Month Trend Charts", included: true, order: 9, aiGenerated: false, approved: true },
    { id: "scenario", title: "Scenario Planning Summary", included: true, order: 10, aiGenerated: false, approved: false },
    { id: "forecast", title: "FY2026 Forecast Summary", included: true, order: 11, aiGenerated: false, approved: false },
    { id: "risks", title: "Key Risks & Opportunities", included: true, order: 12, aiGenerated: true, approved: false },
    { id: "actions", title: "Management Actions", included: true, order: 13, aiGenerated: true, approved: false },
    { id: "appendix", title: "Appendix — Detailed Tables", included: false, order: 14, aiGenerated: false, approved: false }
];
export const flashReportData = {
    headline: "Revenue missed budget by 5.7% however EBITDA remained resilient at ₹8.6Cr on improved cost management.",
    keyMetrics: [
        { label: "Revenue", actual: 330000000, budget: 350000000, variance: -20000000, variancePct: -5.7 },
        { label: "Gr Profit", actual: 145000000, budget: 180000000, variance: -35000000, variancePct: -19.4 },
        { label: "EBITDA", actual: 86000000, budget: 90000000, variance: -4000000, variancePct: -3.9 },
        { label: "Net Profit", actual: 51000000, budget: 81000000, variance: -30000000, variancePct: -37.0 },
        { label: "Cash", actual: 25000000, budget: 30000000, variance: -5000000, variancePct: -16.7 }
    ],
    topVariances: {
        favorable: [
            { label: "Distribution", amount: "+₹10L" },
            { label: "Travel", amount: "+₹8L" },
            { label: "IT Costs", amount: "+₹5L" }
        ],
        unfavorable: [
            { label: "Admin", amount: "▼₹25L (-20.8%)" },
            { label: "Export", amount: "▼₹100L (-11.1%)" },
            { label: "COGS", amount: "▼₹150L (-8.8%)" }
        ]
    },
    keyMessages: [
        "Export sales underperformed — currency headwinds impacting pricing",
        "Admin cost overrun requires immediate review with department heads",
        "Cash conversion cycle at 66 days — above 45-day target threshold",
        "EBITDA resilience from distribution cost savings offsetting revenue miss"
    ],
    immediateActions: [
        "CFO to review admin cost overrun with dept heads (scheduled 8 Nov)",
        "Sales director to provide export pipeline update and recovery plan",
        "Finance to chase ₹80L overdue receivables before month-end",
        "Operations to review COGS increase (+8.8%) with procurement team"
    ]
};
export const commentaryPrompts = {
    executiveSummary: `You are a CFO writing an executive summary for the board of directors. Write 2 professional paragraphs.

Period: October 2025 | Company: FinReport AI
Revenue: ₹33.0Cr vs ₹35.0Cr budget (-5.7%)
Gross Margin: 43.9% vs 51.4% budget (-7.5pp)
EBITDA: ₹8.6Cr vs ₹9.0Cr (-3.9%)
Net Profit: ₹5.1Cr vs ₹8.1Cr (-37%)

Positive: Distribution costs under budget, YoY revenue +17.9%
Negative: Admin costs 20.8% over, Export sales miss

Paragraph 1: Performance summary with numbers.
Paragraph 2: Key variances and management actions.
Max 150 words. Board-level professional language.`,
    varianceCommentary: `Write variance commentary for CFO board pack.

UNFAVORABLE VARIANCES:
- Admin costs: +20.8% (₹25L over budget)
- Export Sales: -11.1% (₹100L under budget)  
- COGS: +8.8% (₹150L over budget)

FAVORABLE VARIANCES:
- Distribution costs: -7.7% (₹10L under budget)
- Travel expenses: -13% (₹8L under budget)

Write 4-5 sentences. Include specific numbers. Mention actions required.
CFO tone for board pack. Max 120 words.`,
    cashFlowCommentary: `Write cash flow commentary for board pack.

Current cash: ₹2.5Cr vs ₹3.0Cr target (-16.7%)
Days Sales Outstanding (DSO): 46 days (target: 40 days)
Cash conversion cycle: 66 days vs 45-day target
Overdue receivables: ₹80L requiring immediate collection

Write 3 sentences covering position, drivers, and action.
CFO tone for board. Max 80 words.`,
    outlook: `Write forward-looking outlook statement for board pack.

FY2026 Revenue forecast: ₹42.0Cr (+27% YoY growth)
Current trajectory: -5.7% vs monthly budget (Oct)
Q2 seasonality: Typically stronger (Dec holiday season)
Export pipeline: Early signs of recovery post-currency stabilization

Write 2-3 sentences with optimistic but realistic CFO tone.
Max 70 words.`
};
