const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const BASE_REVENUE_CR = 40;
const OPENING_CASH_CR = 8;
export function calculateScenario(assumptions, scenarioType, baseAnnualRevenue = BASE_REVENUE_CR, openingCashCr = OPENING_CASH_CR) {
    const monthlyRevenue = calculateMonthlyRevenue(assumptions, baseAnnualRevenue);
    const monthlyPL = [];
    let cumulativeCash = openingCashCr;
    const seasonal = [0.85, 0.88, 0.9, 0.95, 1.0, 1.02, 1.05, 1.08, 1.1, 1.12, 1.08, 1.05];
    MONTHS.forEach((month, index) => {
        const revenue = monthlyRevenue[index];
        const cogs = revenue * (assumptions.cogsPercent / 100);
        const grossProfit = revenue - cogs;
        const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
        const baseHeadcost = (assumptions.rdInvestment * 1.5 * (1 + assumptions.headcountGrowth / 100)) / 12;
        const marketingExpense = (assumptions.marketingSpend / 12) * (1 + index * 0.01);
        const rdExpense = assumptions.rdInvestment / 12;
        const overhead = (baseAnnualRevenue * 0.08 * (1 + assumptions.overheadGrowth / 100)) / 12;
        const totalOpex = baseHeadcost + marketingExpense + rdExpense + overhead;
        const ebitda = grossProfit - totalOpex;
        const ebitdaMarginPct = revenue > 0 ? (ebitda / revenue) * 100 : 0;
        const depreciation = (assumptions.capex / 12 / 5);
        const ebit = ebitda - depreciation;
        const financeCost = cumulativeCash < 0 ? Math.abs(cumulativeCash) * 0.01 : 0;
        const pbt = ebit - financeCost;
        const tax = pbt > 0 ? pbt * 0.25 : 0;
        const netProfit = pbt - tax;
        const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0;
        const dsoImpact = (revenue * assumptions.dso) / 365;
        const dpoImpact = (cogs * assumptions.dpo) / 365;
        const capexMonthly = assumptions.capex / 12;
        const cashFlow = netProfit + depreciation - capexMonthly + dpoImpact - dsoImpact;
        cumulativeCash += cashFlow;
        monthlyPL.push({
            month,
            revenue: +revenue.toFixed(2),
            cogs: +cogs.toFixed(2),
            grossProfit: +grossProfit.toFixed(2),
            grossMarginPct: +grossMarginPct.toFixed(1),
            marketingExpense: +marketingExpense.toFixed(2),
            headcountCost: +baseHeadcost.toFixed(2),
            rdExpense: +rdExpense.toFixed(2),
            overhead: +overhead.toFixed(2),
            totalOpex: +totalOpex.toFixed(2),
            ebitda: +ebitda.toFixed(2),
            ebitdaMarginPct: +ebitdaMarginPct.toFixed(1),
            depreciation: +depreciation.toFixed(2),
            ebit: +ebit.toFixed(2),
            financeCost: +financeCost.toFixed(2),
            pbt: +pbt.toFixed(2),
            tax: +tax.toFixed(2),
            netProfit: +netProfit.toFixed(2),
            netMarginPct: +netMarginPct.toFixed(1),
            cashFlow: +cashFlow.toFixed(2),
            cumulativeCash: +cumulativeCash.toFixed(2),
        });
    });
    const annualRevenue = monthlyPL.reduce((s, m) => s + m.revenue, 0);
    const annualEbitda = monthlyPL.reduce((s, m) => s + m.ebitda, 0);
    const annualNetProfit = monthlyPL.reduce((s, m) => s + m.netProfit, 0);
    const annualGrossProfit = monthlyPL.reduce((s, m) => s + m.grossProfit, 0);
    return {
        scenarioType,
        assumptions,
        annualKPIs: {
            revenue: +annualRevenue.toFixed(2),
            grossMarginPct: annualRevenue > 0 ? +((annualGrossProfit / annualRevenue) * 100).toFixed(1) : 0,
            ebitda: +annualEbitda.toFixed(2),
            ebitdaMarginPct: annualRevenue > 0 ? +((annualEbitda / annualRevenue) * 100).toFixed(1) : 0,
            netProfit: +annualNetProfit.toFixed(2),
            endCash: +monthlyPL[11].cumulativeCash.toFixed(2),
        },
        monthlyPL,
    };
}
function calculateMonthlyRevenue(assumptions, baseAnnualRevenue) {
    const monthlyBase = baseAnnualRevenue / 12;
    const growthFactor = 1 + assumptions.revenueGrowthRate / 100;
    const churnFactor = 1 - assumptions.churnRate / 100 / 12;
    const seasonal = [0.85, 0.88, 0.9, 0.95, 1.0, 1.02, 1.05, 1.08, 1.1, 1.12, 1.08, 1.05];
    return MONTHS.map((_, i) => {
        const monthlyGrowth = Math.pow(growthFactor, i / 12);
        const churnEffect = Math.pow(churnFactor, i);
        return monthlyBase * monthlyGrowth * churnEffect * seasonal[i];
    });
}
function normalRandom() {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function computePercentiles(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = arr.reduce((s, v) => s + v, 0) / n;
    const idx = (p) => Math.min(Math.floor((p / 100) * n), n - 1);
    return {
        p10: sorted[idx(10)],
        p25: sorted[idx(25)],
        p50: sorted[idx(50)],
        p75: sorted[idx(75)],
        p90: sorted[idx(90)],
        mean,
    };
}
export function runMonteCarlo(baseAssumptions, iterations = 1000) {
    const results = [];
    const rand = (base, sigma) => base + normalRandom() * sigma;
    for (let i = 0; i < iterations; i++) {
        const randomised = {
            revenueGrowthRate: rand(baseAssumptions.revenueGrowthRate, 5),
            newClientGrowth: rand(baseAssumptions.newClientGrowth, 8),
            avgRevenuePerClient: rand(baseAssumptions.avgRevenuePerClient, 1),
            churnRate: Math.max(0, rand(baseAssumptions.churnRate, 1.5)),
            priceIncrease: rand(baseAssumptions.priceIncrease, 2),
            cogsPercent: Math.max(10, Math.min(70, rand(baseAssumptions.cogsPercent, 3))),
            headcountGrowth: rand(baseAssumptions.headcountGrowth, 5),
            marketingSpend: Math.max(0, rand(baseAssumptions.marketingSpend, 2)),
            rdInvestment: Math.max(0, rand(baseAssumptions.rdInvestment, 2)),
            overheadGrowth: Math.max(0, rand(baseAssumptions.overheadGrowth, 3)),
            dso: Math.max(15, Math.min(90, rand(baseAssumptions.dso, 5))),
            inventoryDays: baseAssumptions.inventoryDays,
            dpo: Math.max(15, Math.min(90, rand(baseAssumptions.dpo, 5))),
            capex: Math.max(0, rand(baseAssumptions.capex, 5)),
        };
        const r = calculateScenario(randomised, 'base', baseAnnualRevenue, openingCashCr);
        results.push({
            revenue: r.annualKPIs.revenue,
            ebitda: r.annualKPIs.ebitda,
            netProfit: r.annualKPIs.netProfit,
            endCash: r.annualKPIs.endCash,
            ebitdaMarginPct: r.annualKPIs.ebitdaMarginPct,
        });
    }
    const revenueArr = results.map((r) => r.revenue);
    const ebitdaArr = results.map((r) => r.ebitda);
    const netProfitArr = results.map((r) => r.netProfit);
    const endCashArr = results.map((r) => r.endCash);
    const marginArr = results.map((r) => r.ebitdaMarginPct);
    const ebitdaPositive = results.filter((r) => r.ebitda > 0).length / iterations;
    const revenueAbove40 = results.filter((r) => r.revenue > 40).length / iterations;
    const revenueAbove50 = results.filter((r) => r.revenue > 50).length / iterations;
    const cashAbove15 = results.filter((r) => r.endCash > 15).length / iterations;
    return {
        iterations,
        results,
        percentiles: {
            revenue: computePercentiles(revenueArr),
            ebitda: computePercentiles(ebitdaArr),
            netProfit: computePercentiles(netProfitArr),
            endCash: computePercentiles(endCashArr),
            ebitdaMarginPct: computePercentiles(marginArr),
        },
        probabilities: {
            ebitdaPositive,
            revenueAbove40,
            revenueAbove50,
            cashAbove15,
        },
    };
}
