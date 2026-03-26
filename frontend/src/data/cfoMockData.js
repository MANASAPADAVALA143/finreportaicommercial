export const initialChatMessages = [
    {
        id: "welcome",
        role: "assistant",
        content: `Hello MANASA! 👋 I'm your CFO AI Assistant powered by Amazon Nova.

I have full access to your October 2025 financial data including:
• **P&L actuals** vs budget (Revenue ₹33Cr, Net Profit ₹5.1Cr)
• **Variance analysis** (Net profit -37% vs budget 🔴)
• **Cash position** (₹2.5Cr, DSO 46 days)
• **KPI dashboard** (Health Score: 62/100)
• **Forecasts** (FY2026: ₹42Cr target)

Ask me anything about your financials! What would you like to know?`,
        timestamp: new Date().toISOString(),
        sources: ["KPI Dashboard", "Variance Analysis"],
    }
];
export const suggestedQuestions = [
    "What is our biggest financial risk right now?",
    "Why did gross margins drop this month?",
    "What is our cash runway at current burn rate?",
    "Which department is most over budget?",
    "Generate a 3-sentence board summary for October",
    "What actions should I take to improve net profit?",
    "Compare our performance to last year",
    "What is driving the admin cost overrun?",
    "How much revenue do we need to hit budget?",
    "Should I be worried about our cash position?",
];
export const mockInsights = [
    {
        id: "ins-001",
        category: "cost",
        title: "Gross Margin Erosion — Immediate Attention",
        summary: "43.9% margin is 7.5pp below 51.4% budget",
        detail: "COGS increased 8.8% over budget. At this trajectory, FY2026 net profit could be ₹6Cr below forecast. Likely drivers: input cost inflation or pricing pressure on export sales.",
        impact: "high",
        urgency: "immediate",
        action: "Review COGS breakdown with operations. Consider 3-5% price increase.",
        metric: { label: "Gross Margin Gap", value: "-7.5pp", change: "vs budget" },
        generatedAt: new Date().toISOString(),
    },
    {
        id: "ins-002",
        category: "cash",
        title: "Cash Conversion Cycle at Risk",
        summary: "66-day CCC is 47% above 45-day target",
        detail: "DSO of 46 days means customers are paying 6 days slower than target. Combined with DIO of 58 days, working capital is being strained.",
        impact: "high",
        urgency: "immediate",
        action: "Chase ₹80L overdue receivables. Negotiate faster payment terms.",
        metric: { label: "CCC", value: "66 days", change: "+21 vs target" },
        generatedAt: new Date().toISOString(),
    },
    {
        id: "ins-003",
        category: "revenue",
        title: "Strong YoY Growth Despite Budget Miss",
        summary: "+17.9% YoY growth above industry average",
        detail: "While October missed budget by 5.7%, YoY growth of 17.9% significantly outperforms industry average of ~10%. Domestic market momentum is strong.",
        impact: "high",
        urgency: "this_month",
        action: "Leverage domestic growth to offset export weakness in Q3.",
        metric: { label: "YoY Growth", value: "+17.9%", change: "vs 10% industry" },
        generatedAt: new Date().toISOString(),
    },
    {
        id: "ins-004",
        category: "cost",
        title: "Admin Cost Overrun — 20.8% Over Budget",
        summary: "Administrative expenses exceeded budget by ₹25L",
        detail: "Admin costs came in at ₹1.45Cr vs ₹1.2Cr budget. YTD overrun is approximately ₹1.5Cr. This requires immediate itemized review to identify specific drivers.",
        impact: "medium",
        urgency: "this_week",
        action: "Request itemized admin cost breakdown from Finance by end of week.",
        metric: { label: "Admin Overrun", value: "₹25L", change: "+20.8%" },
        generatedAt: new Date().toISOString(),
    },
    {
        id: "ins-005",
        category: "opportunity",
        title: "Distribution Cost Efficiency Gains",
        summary: "Distribution costs 7.7% under budget (₹10L savings)",
        detail: "Strong cost management in distribution is a bright spot. This suggests operational efficiency improvements that could be replicated in other cost centers.",
        impact: "medium",
        urgency: "this_month",
        action: "Document distribution efficiency best practices for rollout to other depts.",
        metric: { label: "Distribution Savings", value: "₹10L", change: "-7.7%" },
        generatedAt: new Date().toISOString(),
    },
    {
        id: "ins-006",
        category: "risk",
        title: "Export Sales Underperformance",
        summary: "Export sales ₹100L below budget (-11.1%)",
        detail: "Export segment missed budget by 11.1%, likely due to currency headwinds and competitive pressure. This is partially offset by strong domestic performance.",
        impact: "medium",
        urgency: "this_week",
        action: "Sales director to provide export pipeline update and recovery plan.",
        metric: { label: "Export Shortfall", value: "₹100L", change: "-11.1%" },
        generatedAt: new Date().toISOString(),
    },
];
export const mockKPIAlerts = [
    {
        id: "alert-001",
        kpi: "Net Profit Margin",
        current: 15.5,
        threshold: 20,
        severity: "critical",
        message: "Net margin 15.5% below critical threshold of 20%",
        recommendation: "Review COGS and admin cost drivers immediately",
        triggeredAt: new Date().toISOString()
    },
    {
        id: "alert-002",
        kpi: "Cash Conversion Cycle",
        current: 66,
        threshold: 60,
        severity: "critical",
        message: "CCC at 66 days above 60-day critical threshold",
        recommendation: "Accelerate AR collections urgently. Chase ₹80L overdue receivables.",
        triggeredAt: new Date().toISOString()
    },
    {
        id: "alert-003",
        kpi: "Revenue vs Budget",
        current: -5.7,
        threshold: -5,
        severity: "warning",
        message: "Revenue -5.7% vs budget exceeds -5% warning threshold",
        recommendation: "Review November sales pipeline with sales director",
        triggeredAt: new Date().toISOString()
    },
    {
        id: "alert-004",
        kpi: "Gross Margin %",
        current: 43.9,
        threshold: 45,
        severity: "warning",
        message: "Gross margin 43.9% below 45% warning threshold",
        recommendation: "Analyze COGS variance drivers with operations team",
        triggeredAt: new Date().toISOString()
    },
    {
        id: "alert-005",
        kpi: "Admin Cost vs Budget",
        current: 20.8,
        threshold: 10,
        severity: "critical",
        message: "Admin costs +20.8% over budget (critical threshold +10%)",
        recommendation: "Request itemized admin expense breakdown immediately",
        triggeredAt: new Date().toISOString()
    },
];
export const mockHealthScore = {
    overall: 62,
    grade: "B",
    components: {
        profitability: 58,
        liquidity: 54,
        efficiency: 48,
        growth: 74,
        stability: 76
    },
    trend: "declining",
    benchmarkVsIndustry: 71,
    aiSummary: `Your financial health score of 62/100 reflects strong revenue growth momentum (+17.9% YoY) offset by margin compression and working capital inefficiency. The primary drag is efficiency (48/100) driven by a 66-day cash conversion cycle. Improving DSO by 10 days and resolving the COGS overrun would lift your score to approximately 71/100 — in line with industry benchmark.`
};
export const financialContext = `
COMPANY FINANCIAL DATA — October 2025:
Company: FinReport AI

P&L ACTUALS vs BUDGET:
Revenue: ₹33.0Cr actual vs ₹35.0Cr budget (-5.7% unfavorable)
Cost of Sales: ₹18.5Cr actual vs ₹17.0Cr budget (-8.8% unfavorable)
Gross Profit: ₹14.5Cr (43.9% margin) vs ₹18.0Cr budget (51.4%)
Employee Benefits: ₹3.2Cr vs ₹3.0Cr budget (-6.7%)
Admin Expenses: ₹1.45Cr vs ₹1.2Cr budget (-20.8% CRITICAL)
Distribution: ₹1.2Cr vs ₹1.3Cr budget (+7.7% favorable)
Depreciation: ₹1.4Cr vs ₹1.3Cr budget (-7.7%)
EBITDA: ₹8.6Cr vs ₹9.0Cr budget (-3.9%)
Net Profit: ₹5.1Cr vs ₹8.1Cr budget (-37.0% CRITICAL)

CASH & LIQUIDITY:
Cash: ₹2.5Cr (target ₹3.0Cr)
Current Ratio: 1.8x (target >2.0x)
DSO: 46 days (target <40 days)
Cash Conversion Cycle: 66 days (target 45 days)
Runway: 14 months (base case)

KPIs:
Gross Margin: 43.9% (budget 51.4%, gap -7.5pp)
Net Margin: 15.5% (budget 23.1%, gap -7.7pp)
Revenue YoY Growth: +17.9%
EBITDA Margin: 26.2% (above budget 25.7%)

FORECASTS:
FY2026 Revenue Forecast: ₹42Cr (+27.3% YoY)
Q2 FY26 Expected: Strong seasonal recovery
Worst Case Runway: 6 months (if revenue -15%)
`;
