export const scenarios = [
    {
        id: "best",
        name: "Best Case",
        type: "best",
        description: "Revenue +15%, Costs -5% — optimistic growth",
        color: "#10B981",
        assumptions: [
            { id: "rev-growth", category: "Revenue", variable: "Revenue Growth %", baseValue: 27, scenarioValue: 42, changePercent: 15, unit: "percentage", impact: "high" },
            { id: "cogs", category: "Costs", variable: "COGS %", baseValue: 56, scenarioValue: 51, changePercent: -5, unit: "percentage", impact: "high" },
            { id: "opex", category: "Costs", variable: "Opex Growth %", baseValue: 15, scenarioValue: 10, changePercent: -5, unit: "percentage", impact: "medium" },
            { id: "payroll", category: "Costs", variable: "Payroll Growth %", baseValue: 12, scenarioValue: 10, changePercent: -2, unit: "percentage", impact: "medium" }
        ],
        results: {
            revenue: 483000000,
            grossProfit: 241000000,
            grossMargin: 49.9,
            ebitda: 92000000,
            ebitdaMargin: 19.0,
            netProfit: 74000000,
            netMargin: 15.3,
            cashPosition: 82000000,
            breakEvenMonth: "Jan 26",
            runway: 18
        },
        createdAt: "2025-10-01",
        isLocked: false,
        isActive: false
    },
    {
        id: "base",
        name: "Base Case",
        type: "base",
        description: "Expected performance — budget scenario",
        color: "#3B82F6",
        assumptions: [
            { id: "rev-growth", category: "Revenue", variable: "Revenue Growth %", baseValue: 27, scenarioValue: 27, changePercent: 0, unit: "percentage", impact: "high" },
            { id: "cogs", category: "Costs", variable: "COGS %", baseValue: 56, scenarioValue: 56, changePercent: 0, unit: "percentage", impact: "high" },
            { id: "opex", category: "Costs", variable: "Opex Growth %", baseValue: 15, scenarioValue: 15, changePercent: 0, unit: "percentage", impact: "medium" },
            { id: "payroll", category: "Costs", variable: "Payroll Growth %", baseValue: 12, scenarioValue: 12, changePercent: 0, unit: "percentage", impact: "medium" }
        ],
        results: {
            revenue: 420000000,
            grossProfit: 185000000,
            grossMargin: 44.0,
            ebitda: 59000000,
            ebitdaMargin: 14.0,
            netProfit: 45000000,
            netMargin: 10.7,
            cashPosition: 51000000,
            breakEvenMonth: "Mar 26",
            runway: 14
        },
        createdAt: "2025-10-01",
        isLocked: true,
        isActive: true
    },
    {
        id: "worst",
        name: "Worst Case",
        type: "worst",
        description: "Revenue -15%, Costs +10% — stress test",
        color: "#EF4444",
        assumptions: [
            { id: "rev-growth", category: "Revenue", variable: "Revenue Growth %", baseValue: 27, scenarioValue: 8, changePercent: -15, unit: "percentage", impact: "high" },
            { id: "cogs", category: "Costs", variable: "COGS %", baseValue: 56, scenarioValue: 62, changePercent: 10, unit: "percentage", impact: "high" },
            { id: "opex", category: "Costs", variable: "Opex Growth %", baseValue: 15, scenarioValue: 25, changePercent: 10, unit: "percentage", impact: "medium" },
            { id: "payroll", category: "Costs", variable: "Payroll Growth %", baseValue: 12, scenarioValue: 18, changePercent: 6, unit: "percentage", impact: "medium" }
        ],
        results: {
            revenue: 357000000,
            grossProfit: 130000000,
            grossMargin: 36.4,
            ebitda: 18000000,
            ebitdaMargin: 5.0,
            netProfit: 8000000,
            netMargin: 2.2,
            cashPosition: 18000000,
            breakEvenMonth: "Jun 26",
            runway: 6
        },
        createdAt: "2025-10-01",
        isLocked: false,
        isActive: false
    },
    {
        id: "custom1",
        name: "Custom Scenario",
        type: "custom",
        description: "Revenue +5%, moderate cost control",
        color: "#8B5CF6",
        assumptions: [
            { id: "rev-growth", category: "Revenue", variable: "Revenue Growth %", baseValue: 27, scenarioValue: 33, changePercent: 6, unit: "percentage", impact: "high" },
            { id: "cogs", category: "Costs", variable: "COGS %", baseValue: 56, scenarioValue: 54, changePercent: -2, unit: "percentage", impact: "high" },
            { id: "opex", category: "Costs", variable: "Opex Growth %", baseValue: 15, scenarioValue: 13, changePercent: -2, unit: "percentage", impact: "medium" },
            { id: "payroll", category: "Costs", variable: "Payroll Growth %", baseValue: 12, scenarioValue: 11, changePercent: -1, unit: "percentage", impact: "medium" }
        ],
        results: {
            revenue: 441000000,
            grossProfit: 198000000,
            grossMargin: 44.9,
            ebitda: 68000000,
            ebitdaMargin: 15.4,
            netProfit: 53000000,
            netMargin: 12.0,
            cashPosition: 59000000,
            breakEvenMonth: "Feb 26",
            runway: 15
        },
        createdAt: "2025-11-01",
        isLocked: false,
        isActive: false
    }
];
export const sensitivityData = [
    {
        variable: "Revenue Growth %",
        baseValue: 27,
        minus20: -12000000,
        minus10: 16500000,
        base: 45000000,
        plus10: 73500000,
        plus20: 101000000,
        impactOnNetProfit: 113000000,
        sensitivity: "high"
    },
    {
        variable: "COGS %",
        baseValue: 56,
        minus20: 78000000,
        minus10: 62000000,
        base: 45000000,
        plus10: 28000000,
        plus20: 12000000,
        impactOnNetProfit: 66000000,
        sensitivity: "high"
    },
    {
        variable: "Price Change %",
        baseValue: 0,
        minus20: -5000000,
        minus10: 20000000,
        base: 45000000,
        plus10: 70000000,
        plus20: 95000000,
        impactOnNetProfit: 100000000,
        sensitivity: "high"
    },
    {
        variable: "Payroll Growth %",
        baseValue: 12,
        minus20: 59000000,
        minus10: 52000000,
        base: 45000000,
        plus10: 38000000,
        plus20: 31000000,
        impactOnNetProfit: 28000000,
        sensitivity: "medium"
    },
    {
        variable: "Admin Costs %",
        baseValue: 4.4,
        minus20: 53000000,
        minus10: 49000000,
        base: 45000000,
        plus10: 41000000,
        plus20: 37000000,
        impactOnNetProfit: 16000000,
        sensitivity: "low"
    },
    {
        variable: "Market Growth %",
        baseValue: 10,
        minus20: 38000000,
        minus10: 42000000,
        base: 45000000,
        plus10: 48000000,
        plus20: 51000000,
        impactOnNetProfit: 13000000,
        sensitivity: "low"
    }
];
// Monthly data for chart (12 months for each scenario)
export const monthlyScenarioData = [
    { month: "Jan 26", best: 38000000, base: 31000000, worst: 27000000, custom: 33000000 },
    { month: "Feb 26", best: 39500000, base: 32800000, worst: 28500000, custom: 34200000 },
    { month: "Mar 26", best: 41000000, base: 36500000, worst: 30000000, custom: 36800000 },
    { month: "Apr 26", best: 40200000, base: 33900000, worst: 29200000, custom: 35100000 },
    { month: "May 26", best: 41800000, base: 35200000, worst: 30800000, custom: 36400000 },
    { month: "Jun 26", best: 43200000, base: 37800000, worst: 32100000, custom: 38900000 },
    { month: "Jul 26", best: 41500000, base: 36100000, worst: 30500000, custom: 37200000 },
    { month: "Aug 26", best: 40800000, base: 34500000, worst: 29800000, custom: 35800000 },
    { month: "Sep 26", best: 42100000, base: 36000000, worst: 30200000, custom: 37100000 },
    { month: "Oct 26", best: 42800000, base: 36800000, worst: 31000000, custom: 37900000 },
    { month: "Nov 26", best: 41900000, base: 35900000, worst: 30400000, custom: 37000000 },
    { month: "Dec 26", best: 44500000, base: 38200000, worst: 32500000, custom: 39600000 }
];
