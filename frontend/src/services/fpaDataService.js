/**
 * FPA Data Service - Single Source of Truth for Financial Data
 * Shared across ALL FP&A modules: Variance, Budget, KPI, Forecast, Scenarios, Reports
 */
/**
 * Parse Excel/CSV Trial Balance file
 * Auto-detects columns: GL Code, Account Name, Debit, Credit
 * Auto-detects account type from GL ranges or keywords
 */
export const parseTrialBalance = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const XLSX = await import('xlsx');
                const data = new Uint8Array(e.target?.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(sheet);
                if (rows.length === 0) {
                    throw new Error('File is empty or has no valid data');
                }
                // Parse rows into structured format
                const parsedRows = rows.map((row, index) => {
                    // Auto-detect account code
                    const glCode = String(row['GL Code'] || row['GLCode'] || row['Account Code'] ||
                        row['AccountCode'] || row['Code'] || (index + 1000)).trim();
                    // Auto-detect account name
                    const accountName = String(row['Account Name'] || row['AccountName'] || row['Name'] ||
                        row['Description'] || 'Unknown').trim();
                    // Auto-detect debit
                    const debit = parseFloat(row['Debit'] || row['Dr'] || row['Debit Balance'] ||
                        row['DebitBalance'] || 0) || 0;
                    // Auto-detect credit
                    const credit = parseFloat(row['Credit'] || row['Cr'] || row['Credit Balance'] ||
                        row['CreditBalance'] || 0) || 0;
                    // Auto-detect account type from GL Code or explicit column
                    let accountType = String(row['Account Type'] || row['AccountType'] || row['Type'] || '').trim();
                    if (!accountType) {
                        // Auto-detect from GL code range
                        const glNum = parseInt(glCode.replace(/\D/g, ''));
                        if (glNum >= 1000 && glNum < 2000)
                            accountType = 'Asset';
                        else if (glNum >= 2000 && glNum < 3000)
                            accountType = 'Liability';
                        else if (glNum >= 3000 && glNum < 4000)
                            accountType = 'Equity';
                        else if (glNum >= 4000 && glNum < 5000)
                            accountType = 'Revenue';
                        else if (glNum >= 5000 && glNum < 6000)
                            accountType = 'Expense';
                        else {
                            // Fallback: detect from name
                            const nameLower = accountName.toLowerCase();
                            if (nameLower.includes('revenue') || nameLower.includes('sales') || nameLower.includes('income')) {
                                accountType = 'Revenue';
                            }
                            else if (nameLower.includes('expense') || nameLower.includes('cost') || nameLower.includes('payroll')) {
                                accountType = 'Expense';
                            }
                            else if (nameLower.includes('cash') || nameLower.includes('receivable') || nameLower.includes('inventory')) {
                                accountType = 'Asset';
                            }
                            else if (nameLower.includes('payable') || nameLower.includes('loan') || nameLower.includes('debt')) {
                                accountType = 'Liability';
                            }
                            else if (nameLower.includes('equity') || nameLower.includes('capital')) {
                                accountType = 'Equity';
                            }
                        }
                    }
                    return { glCode, accountName, accountType, debit, credit };
                }).filter(entry => entry.accountName !== 'Unknown' && (entry.debit > 0 || entry.credit > 0));
                if (parsedRows.length === 0) {
                    throw new Error('No valid accounts found in file. Ensure Account Name column exists and Debit/Credit values are present.');
                }
                // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                // EXTRACT DATA - NO DOUBLE COUNTING
                // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                // Revenue
                const totalRevenue = parsedRows
                    .filter(r => r.accountType === 'Revenue')
                    .reduce((sum, r) => sum + r.credit, 0);
                const domesticRevenue = parsedRows
                    .filter(r => r.accountType === 'Revenue' &&
                    (r.accountName.toLowerCase().includes('domestic') ||
                        r.accountName.toLowerCase().includes('local')))
                    .reduce((sum, r) => sum + r.credit, 0);
                const exportRevenue = parsedRows
                    .filter(r => r.accountType === 'Revenue' &&
                    r.accountName.toLowerCase().includes('export'))
                    .reduce((sum, r) => sum + r.credit, 0);
                const serviceRevenue = parsedRows
                    .filter(r => r.accountType === 'Revenue' &&
                    r.accountName.toLowerCase().includes('service'))
                    .reduce((sum, r) => sum + r.credit, 0);
                // COGS
                const costOfGoodsSold = parsedRows
                    .filter(r => r.accountName.toLowerCase().includes('cost of goods') ||
                    r.accountName.toLowerCase().includes('cost of sales') ||
                    r.accountName.toLowerCase().includes('cogs'))
                    .reduce((sum, r) => sum + r.debit, 0);
                // Operating Expenses (itemized)
                const payroll = parsedRows
                    .filter(r => r.accountName.toLowerCase().includes('payroll') ||
                    r.accountName.toLowerCase().includes('salary') ||
                    r.accountName.toLowerCase().includes('employee benefit') ||
                    r.accountName.toLowerCase().includes('wages'))
                    .reduce((sum, r) => sum + r.debit, 0);
                const adminExpenses = parsedRows
                    .filter(r => r.accountName.toLowerCase().includes('admin'))
                    .reduce((sum, r) => sum + r.debit, 0);
                const distributionCosts = parsedRows
                    .filter(r => r.accountName.toLowerCase().includes('distribution') ||
                    r.accountName.toLowerCase().includes('freight') ||
                    r.accountName.toLowerCase().includes('shipping'))
                    .reduce((sum, r) => sum + r.debit, 0);
                const marketingCosts = parsedRows
                    .filter(r => r.accountName.toLowerCase().includes('marketing') ||
                    r.accountName.toLowerCase().includes('advertising'))
                    .reduce((sum, r) => sum + r.debit, 0);
                const rentExpense = parsedRows
                    .filter(r => r.accountName.toLowerCase().includes('rent') ||
                    r.accountName.toLowerCase().includes('lease'))
                    .reduce((sum, r) => sum + r.debit, 0);
                const depreciation = parsedRows
                    .filter(r => r.accountName.toLowerCase().includes('depreciation') ||
                    r.accountName.toLowerCase().includes('amortization'))
                    .reduce((sum, r) => sum + r.debit, 0);
                const interestExpense = parsedRows
                    .filter(r => r.accountName.toLowerCase().includes('interest'))
                    .reduce((sum, r) => sum + r.debit, 0);
                // Total expenses
                const totalExpenses = parsedRows
                    .filter(r => r.accountType === 'Expense')
                    .reduce((sum, r) => sum + r.debit, 0);
                // Other expenses (residual)
                const otherExpenses = totalExpenses - costOfGoodsSold - payroll - adminExpenses -
                    distributionCosts - marketingCosts - rentExpense -
                    depreciation - interestExpense;
                const totalOperatingExpenses = payroll + adminExpenses + distributionCosts +
                    marketingCosts + rentExpense + otherExpenses;
                // Balance Sheet
                const cashAndEquivalents = parsedRows
                    .filter(r => r.accountType === 'Asset' && r.accountName.toLowerCase().includes('cash'))
                    .reduce((sum, r) => sum + r.debit - r.credit, 0);
                const accountsReceivable = parsedRows
                    .filter(r => r.accountType === 'Asset' &&
                    (r.accountName.toLowerCase().includes('receivable') ||
                        r.accountName.toLowerCase().includes('debtor')))
                    .reduce((sum, r) => sum + r.debit - r.credit, 0);
                const inventory = parsedRows
                    .filter(r => r.accountType === 'Asset' &&
                    (r.accountName.toLowerCase().includes('inventory') ||
                        r.accountName.toLowerCase().includes('stock')))
                    .reduce((sum, r) => sum + r.debit - r.credit, 0);
                const accountsPayable = parsedRows
                    .filter(r => r.accountType === 'Liability' &&
                    (r.accountName.toLowerCase().includes('payable') ||
                        r.accountName.toLowerCase().includes('creditor')))
                    .reduce((sum, r) => sum + r.credit - r.debit, 0);
                const totalAssets = parsedRows
                    .filter(r => r.accountType === 'Asset')
                    .reduce((sum, r) => sum + r.debit - r.credit, 0);
                const totalLiabilities = parsedRows
                    .filter(r => r.accountType === 'Liability')
                    .reduce((sum, r) => sum + r.credit - r.debit, 0);
                const equity = parsedRows
                    .filter(r => r.accountType === 'Equity')
                    .reduce((sum, r) => sum + r.credit - r.debit, 0);
                const result = {
                    totalRevenue,
                    domesticRevenue,
                    exportRevenue,
                    serviceRevenue,
                    costOfGoodsSold,
                    payroll,
                    adminExpenses,
                    distributionCosts,
                    marketingCosts,
                    rentExpense,
                    depreciation,
                    interestExpense,
                    otherExpenses,
                    totalOperatingExpenses,
                    cashAndEquivalents,
                    accountsReceivable,
                    inventory,
                    accountsPayable,
                    totalAssets,
                    totalLiabilities,
                    equity,
                    capitalExpenditure: 0, // TODO: detect from TB or user input
                    headcount: 0, // TODO: user input
                    uploadedAt: new Date().toISOString(),
                    fileName: file.name,
                    rowCount: parsedRows.length
                };
                resolve(result);
            }
            catch (error) {
                reject(new Error(`Failed to parse file: ${error.message}`));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
};
/**
 * Calculate Scenario Results - PROPER P&L ORDER
 * No double counting of expenses
 */
export const calculateScenarioResults = (uploadedData, multipliers) => {
    // ━━━━ STEP 1: Revenue ━━━━
    const revenue = uploadedData.totalRevenue * multipliers.revenue;
    // ━━━━ STEP 2: COGS & Gross Profit ━━━━
    const cogsRatio = uploadedData.costOfGoodsSold / uploadedData.totalRevenue;
    const cogs = revenue * cogsRatio * multipliers.cogsAdjust;
    const grossProfit = revenue - cogs;
    const grossMargin = (grossProfit / revenue) * 100;
    // ━━━━ STEP 3: Operating Expenses (NOT including COGS or D&A or Interest) ━━━━
    const payroll = uploadedData.payroll * multipliers.payrollGrowth;
    const admin = uploadedData.adminExpenses * multipliers.opexGrowth;
    const distribution = uploadedData.distributionCosts * multipliers.opexGrowth;
    const marketing = uploadedData.marketingCosts * multipliers.opexGrowth;
    const rent = uploadedData.rentExpense * multipliers.opexGrowth;
    const otherOpex = uploadedData.otherExpenses * multipliers.opexGrowth;
    const totalOperatingExpenses = payroll + admin + distribution + marketing + rent + otherOpex;
    // ━━━━ STEP 4: EBITDA ━━━━
    const ebitda = grossProfit - totalOperatingExpenses;
    const ebitdaMargin = (ebitda / revenue) * 100;
    // ━━━━ STEP 5: EBIT (after depreciation) ━━━━
    const depreciation = uploadedData.depreciation;
    const ebit = ebitda - depreciation;
    // ━━━━ STEP 6: PBT (after interest) ━━━━
    const interestExpense = uploadedData.interestExpense;
    const profitBeforeTax = ebit - interestExpense;
    // ━━━━ STEP 7: Net Profit (after tax @ 25%) ━━━━
    const taxRate = 0.25;
    const tax = profitBeforeTax > 0 ? profitBeforeTax * taxRate : 0;
    const netProfit = profitBeforeTax - tax;
    const netMargin = (netProfit / revenue) * 100;
    // ━━━━ STEP 8: Cash & Runway ━━━━
    const monthlyOperatingCost = totalOperatingExpenses / 12;
    const monthlyNetCashFlow = (netProfit + depreciation) / 12; // add back D&A
    const yearEndCash = uploadedData.cashAndEquivalents + netProfit + depreciation;
    // Runway calculation (if burning cash)
    const monthlyBurn = monthlyNetCashFlow < 0 ? Math.abs(monthlyNetCashFlow) : monthlyOperatingCost;
    const runway = monthlyBurn > 0 && monthlyNetCashFlow < 0
        ? Math.floor(uploadedData.cashAndEquivalents / monthlyBurn)
        : monthlyNetCashFlow > 0
            ? 24 // profitable = 24+ months
            : Math.floor(uploadedData.cashAndEquivalents / monthlyOperatingCost);
    // Break-even
    const breakEvenRevenue = totalOperatingExpenses + cogs;
    const breakEvenAchieved = revenue >= breakEvenRevenue;
    return {
        revenue,
        cogs,
        grossProfit,
        grossMargin,
        totalOperatingExpenses,
        payroll,
        admin,
        distribution,
        marketing,
        rent,
        otherOpex,
        ebitda,
        ebitdaMargin,
        depreciation,
        ebit,
        interestExpense,
        profitBeforeTax,
        tax,
        netProfit,
        netMargin,
        cashPosition: yearEndCash,
        runway,
        breakEvenMonth: breakEvenAchieved ? 'Already achieved' : 'Not achieved',
        monthlyNetCashFlow
    };
};
export const calculateWorkingCapital = (uploadedData, scenarioResults, previousWC) => {
    // Calculate working capital metrics
    const dso = uploadedData.accountsReceivable > 0
        ? (uploadedData.accountsReceivable / uploadedData.totalRevenue) * 365
        : 46; // default estimate
    const dpo = uploadedData.accountsPayable > 0 && uploadedData.costOfGoodsSold > 0
        ? (uploadedData.accountsPayable / uploadedData.costOfGoodsSold) * 365
        : 38; // default estimate
    const dio = uploadedData.inventory > 0 && uploadedData.costOfGoodsSold > 0
        ? (uploadedData.inventory / uploadedData.costOfGoodsSold) * 365
        : 58; // default estimate
    const ccc = dso + dio - dpo;
    // Working capital = AR + Inventory - AP
    const accountsReceivable = scenarioResults.revenue * (dso / 365);
    const accountsPayable = scenarioResults.cogs * (dpo / 365);
    const inventory = scenarioResults.cogs * (dio / 365);
    const workingCapital = accountsReceivable + inventory - accountsPayable;
    const wcChange = previousWC ? workingCapital - previousWC : 0;
    // Operating Cash Flow (indirect method)
    const operatingCashFlow = scenarioResults.netProfit + uploadedData.depreciation - wcChange;
    // Free Cash Flow
    const capex = uploadedData.capitalExpenditure || (uploadedData.totalRevenue * 0.05); // estimate 5% of revenue
    const freeCashFlow = operatingCashFlow - capex;
    // ACTUAL runway based on FCF
    const monthlyFCF = freeCashFlow / 12;
    const actualRunway = monthlyFCF < 0
        ? Math.floor(uploadedData.cashAndEquivalents / Math.abs(monthlyFCF))
        : 24; // positive FCF = 24+ months
    return {
        dso,
        dpo,
        dio,
        ccc,
        accountsReceivable,
        accountsPayable,
        inventory,
        workingCapital,
        wcChange,
        operatingCashFlow,
        freeCashFlow,
        actualRunway
    };
};
export const calculateDriverBasedRevenue = (drivers) => {
    // Net customer growth
    const newCustomers = drivers.totalCustomers * (drivers.customerGrowthPct / 100);
    const churnedCustomers = drivers.totalCustomers * (drivers.churnRatePct / 100);
    const netCustomerGrowth = newCustomers - churnedCustomers;
    const endingCustomers = drivers.totalCustomers + netCustomerGrowth;
    // Effective price
    const basePriceAdjusted = drivers.averageSellingPrice * (1 + drivers.priceChangePct / 100);
    const effectivePrice = basePriceAdjusted * (1 + drivers.productMixPremiumPct / 100);
    // Revenue calculation
    const calculatedRevenue = endingCustomers * effectivePrice * drivers.purchasesPerCustomer;
    const revenuePerCustomer = effectivePrice * drivers.purchasesPerCustomer;
    return {
        endingCustomers,
        netCustomerGrowth,
        effectivePrice,
        calculatedRevenue,
        revenuePerCustomer
    };
};
/**
 * Save to localStorage - shared across ALL FP&A modules
 */
export const saveFPAData = (data) => {
    localStorage.setItem('finreportai_fpa_data', JSON.stringify(data));
    console.log('✅ FPA Data saved to localStorage:', data.fileName);
};
/**
 * Load from localStorage
 */
export const loadFPAData = () => {
    try {
        const stored = localStorage.getItem('finreportai_fpa_data');
        return stored ? JSON.parse(stored) : null;
    }
    catch (error) {
        console.error('❌ Failed to load FPA data from localStorage:', error);
        return null;
    }
};
/**
 * Clear stored data
 */
export const clearFPAData = () => {
    localStorage.removeItem('finreportai_fpa_data');
};
export const parseMultiSheetWorkbook = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const XLSX = await import('xlsx');
                const data = new Uint8Array(e.target?.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const results = [];
                // Sheet name mapping (case-insensitive)
                const sheetMapping = {
                    'actual_tb': { key: 'fpa_actual', dataType: 'Actual Trial Balance' },
                    'actual': { key: 'fpa_actual', dataType: 'Actual Trial Balance' },
                    'budget': { key: 'fpa_budget', dataType: 'Budget Data' },
                    'budget_tb': { key: 'fpa_budget', dataType: 'Budget Data' },
                    'monthly_revenue': { key: 'fpa_forecast', dataType: 'Monthly Revenue / Forecast' },
                    'monthly': { key: 'fpa_forecast', dataType: 'Monthly Revenue / Forecast' },
                    'forecast': { key: 'fpa_forecast', dataType: 'Monthly Revenue / Forecast' },
                    'department_expenses': { key: 'fpa_departments', dataType: 'Department Expenses' },
                    'departments': { key: 'fpa_departments', dataType: 'Department Expenses' },
                    'scenario_planning': { key: 'fpa_scenarios', dataType: 'Scenario Planning' },
                    'scenarios': { key: 'fpa_scenarios', dataType: 'Scenario Planning' }
                };
                // Process each sheet
                for (const sheetName of workbook.SheetNames) {
                    const normalizedName = sheetName.toLowerCase().trim().replace(/\s+/g, '_');
                    const mapping = sheetMapping[normalizedName];
                    if (mapping) {
                        try {
                            const sheet = workbook.Sheets[sheetName];
                            const rows = XLSX.utils.sheet_to_json(sheet);
                            if (rows.length === 0) {
                                results.push({
                                    sheetName,
                                    storageKey: mapping.key,
                                    dataType: mapping.dataType,
                                    success: false,
                                    error: 'Sheet is empty'
                                });
                                continue;
                            }
                            // Detect sheet format by columns
                            const firstRow = rows[0];
                            const columns = Object.keys(firstRow).map(k => k.toLowerCase());
                            let parsedData;
                            // SHEET TYPE 1: Trial Balance format (has Debit/Credit columns)
                            if (columns.some(col => col.includes('debit') || col === 'dr')) {
                                parsedData = await parseTrialBalanceFromRows(rows, `${sheetName} (${file.name})`);
                            }
                            // SHEET TYPE 2: Monthly Revenue format (has Month column)
                            else if (columns.some(col => col === 'month' || col.includes('month'))) {
                                parsedData = parseMonthlyRevenueFromRows(rows, `${sheetName} (${file.name})`);
                            }
                            // SHEET TYPE 3: Department Expenses format (has Department column)
                            else if (columns.some(col => col === 'department' || col.includes('dept'))) {
                                parsedData = parseDepartmentExpensesFromRows(rows, `${sheetName} (${file.name})`);
                            }
                            // SHEET TYPE 4: Scenario Planning format (has Scenario column)
                            else if (columns.some(col => col === 'scenario' || col.includes('scenario'))) {
                                parsedData = parseScenarioDataFromRows(rows, `${sheetName} (${file.name})`);
                            }
                            else {
                                throw new Error(`Unrecognized sheet format. Expected columns: [Debit/Credit] or [Month] or [Department] or [Scenario]`);
                            }
                            // Save to localStorage with correct key
                            localStorage.setItem(mapping.key, JSON.stringify(parsedData));
                            results.push({
                                sheetName,
                                storageKey: mapping.key,
                                dataType: mapping.dataType,
                                success: true
                            });
                            console.log(`✅ Loaded sheet "${sheetName}" → ${mapping.key}`);
                        }
                        catch (error) {
                            results.push({
                                sheetName,
                                storageKey: mapping.key,
                                dataType: mapping.dataType,
                                success: false,
                                error: error.message
                            });
                        }
                    }
                }
                if (results.length === 0) {
                    reject(new Error('No recognized sheets found. Expected sheet names like: Actual_TB, Budget, Monthly_Revenue, Department_Expenses, Scenario_Planning'));
                }
                else {
                    resolve(results);
                }
            }
            catch (error) {
                reject(new Error(`Failed to parse workbook: ${error.message}`));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
};
/**
 * Parse trial balance from rows (exported for central multi-sheet upload).
 */
export const parseTrialBalanceFromRows = async (rows, fileName) => {
    if (rows.length === 0) {
        throw new Error('No valid data found');
    }
    // Parse rows into structured format
    const parsedRows = rows.map((row, index) => {
        const glCode = String(row['GL Code'] || row['GLCode'] || row['Account Code'] ||
            row['AccountCode'] || row['Code'] || (index + 1000)).trim();
        const accountName = String(row['Account Name'] || row['AccountName'] || row['Name'] ||
            row['Description'] || 'Unknown').trim();
        const debit = parseFloat(row['Debit'] || row['Dr'] || row['Debit Balance'] ||
            row['DebitBalance'] || 0) || 0;
        const credit = parseFloat(row['Credit'] || row['Cr'] || row['Credit Balance'] ||
            row['CreditBalance'] || 0) || 0;
        let accountType = String(row['Account Type'] || row['AccountType'] || row['Type'] || '').trim();
        if (!accountType) {
            const glNum = parseInt(glCode.replace(/\D/g, ''));
            if (glNum >= 1000 && glNum < 2000)
                accountType = 'Asset';
            else if (glNum >= 2000 && glNum < 3000)
                accountType = 'Liability';
            else if (glNum >= 3000 && glNum < 4000)
                accountType = 'Equity';
            else if (glNum >= 4000 && glNum < 5000)
                accountType = 'Revenue';
            else if (glNum >= 5000 && glNum < 6000)
                accountType = 'Expense';
            else {
                const nameLower = accountName.toLowerCase();
                if (nameLower.includes('revenue') || nameLower.includes('sales') || nameLower.includes('income')) {
                    accountType = 'Revenue';
                }
                else if (nameLower.includes('expense') || nameLower.includes('cost') || nameLower.includes('payroll')) {
                    accountType = 'Expense';
                }
                else if (nameLower.includes('cash') || nameLower.includes('receivable') || nameLower.includes('inventory')) {
                    accountType = 'Asset';
                }
                else if (nameLower.includes('payable') || nameLower.includes('loan') || nameLower.includes('debt')) {
                    accountType = 'Liability';
                }
                else if (nameLower.includes('equity') || nameLower.includes('capital')) {
                    accountType = 'Equity';
                }
            }
        }
        return { glCode, accountName, accountType, debit, credit };
    }).filter(entry => entry.accountName !== 'Unknown' && (entry.debit > 0 || entry.credit > 0));
    if (parsedRows.length === 0) {
        throw new Error('No valid accounts found. Ensure Account Name column exists and Debit/Credit values are present.');
    }
    // Extract financial data
    const totalRevenue = parsedRows
        .filter(r => r.accountType === 'Revenue')
        .reduce((sum, r) => sum + r.credit, 0);
    const domesticRevenue = parsedRows
        .filter(r => r.accountType === 'Revenue' &&
        (r.accountName.toLowerCase().includes('domestic') ||
            r.accountName.toLowerCase().includes('local')))
        .reduce((sum, r) => sum + r.credit, 0);
    const exportRevenue = parsedRows
        .filter(r => r.accountType === 'Revenue' &&
        r.accountName.toLowerCase().includes('export'))
        .reduce((sum, r) => sum + r.credit, 0);
    const serviceRevenue = parsedRows
        .filter(r => r.accountType === 'Revenue' &&
        r.accountName.toLowerCase().includes('service'))
        .reduce((sum, r) => sum + r.credit, 0);
    const costOfGoodsSold = parsedRows
        .filter(r => r.accountName.toLowerCase().includes('cost of goods') ||
        r.accountName.toLowerCase().includes('cost of sales') ||
        r.accountName.toLowerCase().includes('cogs'))
        .reduce((sum, r) => sum + r.debit, 0);
    const payroll = parsedRows
        .filter(r => r.accountName.toLowerCase().includes('payroll') ||
        r.accountName.toLowerCase().includes('salary') ||
        r.accountName.toLowerCase().includes('employee benefit') ||
        r.accountName.toLowerCase().includes('wages'))
        .reduce((sum, r) => sum + r.debit, 0);
    const adminExpenses = parsedRows
        .filter(r => r.accountName.toLowerCase().includes('admin'))
        .reduce((sum, r) => sum + r.debit, 0);
    const distributionCosts = parsedRows
        .filter(r => r.accountName.toLowerCase().includes('distribution') ||
        r.accountName.toLowerCase().includes('freight') ||
        r.accountName.toLowerCase().includes('shipping'))
        .reduce((sum, r) => sum + r.debit, 0);
    const marketingCosts = parsedRows
        .filter(r => r.accountName.toLowerCase().includes('marketing') ||
        r.accountName.toLowerCase().includes('advertising'))
        .reduce((sum, r) => sum + r.debit, 0);
    const rentExpense = parsedRows
        .filter(r => r.accountName.toLowerCase().includes('rent') ||
        r.accountName.toLowerCase().includes('lease'))
        .reduce((sum, r) => sum + r.debit, 0);
    const depreciation = parsedRows
        .filter(r => r.accountName.toLowerCase().includes('depreciation') ||
        r.accountName.toLowerCase().includes('amortization'))
        .reduce((sum, r) => sum + r.debit, 0);
    const interestExpense = parsedRows
        .filter(r => r.accountName.toLowerCase().includes('interest'))
        .reduce((sum, r) => sum + r.debit, 0);
    const totalExpenses = parsedRows
        .filter(r => r.accountType === 'Expense')
        .reduce((sum, r) => sum + r.debit, 0);
    const otherExpenses = totalExpenses - costOfGoodsSold - payroll - adminExpenses -
        distributionCosts - marketingCosts - rentExpense -
        depreciation - interestExpense;
    const totalOperatingExpenses = payroll + adminExpenses + distributionCosts +
        marketingCosts + rentExpense + otherExpenses;
    const cashAndEquivalents = parsedRows
        .filter(r => r.accountType === 'Asset' && r.accountName.toLowerCase().includes('cash'))
        .reduce((sum, r) => sum + r.debit - r.credit, 0);
    const accountsReceivable = parsedRows
        .filter(r => r.accountType === 'Asset' &&
        (r.accountName.toLowerCase().includes('receivable') ||
            r.accountName.toLowerCase().includes('debtor')))
        .reduce((sum, r) => sum + r.debit - r.credit, 0);
    const inventory = parsedRows
        .filter(r => r.accountType === 'Asset' &&
        (r.accountName.toLowerCase().includes('inventory') ||
            r.accountName.toLowerCase().includes('stock')))
        .reduce((sum, r) => sum + r.debit - r.credit, 0);
    const accountsPayable = parsedRows
        .filter(r => r.accountType === 'Liability' &&
        (r.accountName.toLowerCase().includes('payable') ||
            r.accountName.toLowerCase().includes('creditor')))
        .reduce((sum, r) => sum + r.credit - r.debit, 0);
    const totalAssets = parsedRows
        .filter(r => r.accountType === 'Asset')
        .reduce((sum, r) => sum + r.debit - r.credit, 0);
    const totalLiabilities = parsedRows
        .filter(r => r.accountType === 'Liability')
        .reduce((sum, r) => sum + r.credit - r.debit, 0);
    const equity = parsedRows
        .filter(r => r.accountType === 'Equity')
        .reduce((sum, r) => sum + r.credit - r.debit, 0);
    return {
        totalRevenue,
        domesticRevenue,
        exportRevenue,
        serviceRevenue,
        costOfGoodsSold,
        payroll,
        adminExpenses,
        distributionCosts,
        marketingCosts,
        rentExpense,
        depreciation,
        interestExpense,
        otherExpenses,
        totalOperatingExpenses,
        cashAndEquivalents,
        accountsReceivable,
        inventory,
        accountsPayable,
        totalAssets,
        totalLiabilities,
        equity,
        capitalExpenditure: 0,
        headcount: 0,
        uploadedAt: new Date().toISOString(),
        fileName,
        rowCount: parsedRows.length
    };
};
/**
 * Parse Monthly Revenue format sheet
 * Expected columns: Month, Domestic_Revenue, Export_Revenue, Service_Revenue
 */
const parseMonthlyRevenueFromRows = (rows, fileName) => {
    const months = [];
    const domesticRevenue = [];
    const exportRevenue = [];
    const serviceRevenue = [];
    rows.forEach(row => {
        const month = String(row['Month'] || row['month'] || row['MONTH'] || '').trim();
        if (month) {
            months.push(month);
            domesticRevenue.push(parseFloat(row['Domestic_Revenue'] || row['Domestic Revenue'] || row['Domestic'] || 0) || 0);
            exportRevenue.push(parseFloat(row['Export_Revenue'] || row['Export Revenue'] || row['Export'] || 0) || 0);
            serviceRevenue.push(parseFloat(row['Service_Revenue'] || row['Service Revenue'] || row['Service'] || 0) || 0);
        }
    });
    if (months.length === 0) {
        throw new Error('No monthly data found. Ensure Month column exists with revenue data.');
    }
    return {
        months,
        domesticRevenue,
        exportRevenue,
        serviceRevenue,
        uploadedAt: new Date().toISOString(),
        fileName
    };
};
/**
 * Parse Department Expenses format sheet
 * Expected columns: Department, Payroll, Admin, Distribution, Marketing, Rent, Other
 */
const parseDepartmentExpensesFromRows = (rows, fileName) => {
    const departments = [];
    const payroll = [];
    const admin = [];
    const distribution = [];
    const marketing = [];
    const rent = [];
    const other = [];
    rows.forEach(row => {
        const dept = String(row['Department'] || row['department'] || row['Dept'] || row['dept'] || '').trim();
        if (dept) {
            departments.push(dept);
            payroll.push(parseFloat(row['Payroll'] || row['payroll'] || row['Salaries'] || 0) || 0);
            admin.push(parseFloat(row['Admin'] || row['admin'] || row['Administrative'] || 0) || 0);
            distribution.push(parseFloat(row['Distribution'] || row['distribution'] || row['Freight'] || 0) || 0);
            marketing.push(parseFloat(row['Marketing'] || row['marketing'] || row['Advertising'] || 0) || 0);
            rent.push(parseFloat(row['Rent'] || row['rent'] || row['Lease'] || 0) || 0);
            other.push(parseFloat(row['Other'] || row['other'] || row['Misc'] || row['misc'] || 0) || 0);
        }
    });
    if (departments.length === 0) {
        throw new Error('No department data found. Ensure Department column exists with expense data.');
    }
    return {
        departments,
        payroll,
        admin,
        distribution,
        marketing,
        rent,
        other,
        uploadedAt: new Date().toISOString(),
        fileName
    };
};
/**
 * Parse Scenario Planning format sheet
 * Expected columns: Scenario, Revenue_Growth_%, COGS_%, Expense_Growth_%, Assumptions
 */
const parseScenarioDataFromRows = (rows, fileName) => {
    const scenarios = rows.map(row => {
        const name = String(row['Scenario'] || row['scenario'] || row['Name'] || 'Unnamed').trim();
        const revenueGrowth = parseFloat(row['Revenue_Growth_%'] || row['Revenue Growth %'] || row['Revenue_Growth'] ||
            row['RevenueGrowth'] || row['revenue_growth'] || 0) || 0;
        const cogsPercent = parseFloat(row['COGS_%'] || row['COGS %'] || row['COGS_Percent'] ||
            row['COGS'] || row['cogs'] || 0) || 0;
        const expenseGrowth = parseFloat(row['Expense_Growth_%'] || row['Expense Growth %'] || row['Expense_Growth'] ||
            row['ExpenseGrowth'] || row['expense_growth'] || 0) || 0;
        const assumptions = String(row['Assumptions'] || row['assumptions'] || row['Notes'] || row['notes'] || '').trim();
        return {
            name,
            revenueGrowth,
            cogsPercent,
            expenseGrowth,
            assumptions
        };
    }).filter(s => s.name !== 'Unnamed');
    if (scenarios.length === 0) {
        throw new Error('No scenario data found. Ensure Scenario column exists with planning data.');
    }
    return {
        scenarios,
        uploadedAt: new Date().toISOString(),
        fileName
    };
};
/**
 * Check if file has multiple sheets
 */
export const hasMultipleSheets = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const XLSX = await import('xlsx');
                const data = new Uint8Array(e.target?.result);
                const workbook = XLSX.read(data, { type: 'array' });
                resolve({
                    isMultiSheet: workbook.SheetNames.length > 1,
                    sheetNames: workbook.SheetNames
                });
            }
            catch (error) {
                reject(new Error(`Failed to read file: ${error.message}`));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
};
