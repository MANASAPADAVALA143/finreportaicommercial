// ==================== MAPPING SERVICE ====================
// "Map Once, Use Forever" Architecture
// Company GL codes mapped to IFRS line items — saved permanently
// ==================== IFRS MASTER LINE ITEMS ====================
// Standard IFRS classification reference
export const IFRS_LINE_ITEMS = [
    // ========== BALANCE SHEET - ASSETS ==========
    // Current Assets
    { value: "financialPosition.assets.current.cashAndEquivalents", label: "Cash & Cash Equivalents", statement: "balanceSheet", category: "Current Assets" },
    { value: "financialPosition.assets.current.tradeReceivables", label: "Trade Receivables", statement: "balanceSheet", category: "Current Assets" },
    { value: "financialPosition.assets.current.inventories", label: "Inventories", statement: "balanceSheet", category: "Current Assets" },
    { value: "financialPosition.assets.current.prepayments", label: "Prepayments & Other Current Assets", statement: "balanceSheet", category: "Current Assets" },
    { value: "financialPosition.assets.current.otherCurrent", label: "Other Current Assets", statement: "balanceSheet", category: "Current Assets" },
    // Non-Current Assets
    { value: "financialPosition.assets.nonCurrent.propertyPlantEquipment", label: "Property, Plant & Equipment (PPE)", statement: "balanceSheet", category: "Non-Current Assets" },
    { value: "financialPosition.assets.nonCurrent.intangibleAssets", label: "Intangible Assets", statement: "balanceSheet", category: "Non-Current Assets" },
    { value: "financialPosition.assets.nonCurrent.investments", label: "Long-term Investments", statement: "balanceSheet", category: "Non-Current Assets" },
    { value: "financialPosition.assets.nonCurrent.otherNonCurrent", label: "Other Non-Current Assets", statement: "balanceSheet", category: "Non-Current Assets" },
    // ========== BALANCE SHEET - LIABILITIES ==========
    // Current Liabilities
    { value: "financialPosition.liabilities.current.tradePayables", label: "Trade & Other Payables", statement: "balanceSheet", category: "Current Liabilities" },
    { value: "financialPosition.liabilities.current.shortTermBorrowings", label: "Short-term Borrowings", statement: "balanceSheet", category: "Current Liabilities" },
    { value: "financialPosition.liabilities.current.accruedExpenses", label: "Accrued Expenses", statement: "balanceSheet", category: "Current Liabilities" },
    { value: "financialPosition.liabilities.current.otherCurrent", label: "Other Current Liabilities", statement: "balanceSheet", category: "Current Liabilities" },
    // Non-Current Liabilities
    { value: "financialPosition.liabilities.nonCurrent.borrowings", label: "Long-term Borrowings", statement: "balanceSheet", category: "Non-Current Liabilities" },
    { value: "financialPosition.liabilities.nonCurrent.deferredTax", label: "Deferred Tax Liability", statement: "balanceSheet", category: "Non-Current Liabilities" },
    { value: "financialPosition.liabilities.nonCurrent.provisions", label: "Provisions", statement: "balanceSheet", category: "Non-Current Liabilities" },
    { value: "financialPosition.liabilities.nonCurrent.otherNonCurrent", label: "Other Non-Current Liabilities", statement: "balanceSheet", category: "Non-Current Liabilities" },
    // ========== BALANCE SHEET - EQUITY ==========
    { value: "financialPosition.equity.shareCapital", label: "Share Capital", statement: "balanceSheet", category: "Equity" },
    { value: "financialPosition.equity.retainedEarnings", label: "Retained Earnings", statement: "balanceSheet", category: "Equity" },
    { value: "financialPosition.equity.otherReserves", label: "Other Reserves", statement: "balanceSheet", category: "Equity" },
    // ========== PROFIT & LOSS ==========
    { value: "profitLoss.revenue", label: "Revenue", statement: "profitLoss", category: "Revenue" },
    { value: "profitLoss.costOfSales", label: "Cost of Sales / COGS", statement: "profitLoss", category: "Cost of Sales" },
    { value: "profitLoss.operatingExpenses.employeeBenefits", label: "Employee Benefits & Salaries", statement: "profitLoss", category: "Operating Expenses" },
    { value: "profitLoss.operatingExpenses.administrative", label: "Administrative Expenses", statement: "profitLoss", category: "Operating Expenses" },
    { value: "profitLoss.operatingExpenses.distribution", label: "Distribution & Selling Expenses", statement: "profitLoss", category: "Operating Expenses" },
    { value: "profitLoss.operatingExpenses.depreciation", label: "Depreciation & Amortisation", statement: "profitLoss", category: "Operating Expenses" },
    { value: "profitLoss.operatingExpenses.other", label: "Other Operating Expenses", statement: "profitLoss", category: "Operating Expenses" },
    { value: "profitLoss.financeIncome", label: "Finance Income / Interest Income", statement: "profitLoss", category: "Finance" },
    { value: "profitLoss.financeCosts", label: "Finance Costs / Interest Expense", statement: "profitLoss", category: "Finance" },
    { value: "profitLoss.incomeTax", label: "Income Tax Expense", statement: "profitLoss", category: "Tax" },
];
// Liability-only options for dropdown when GL has credit balance (liability/equity)
export const LIABILITY_MAPPING_OPTIONS = [
    { value: "financialPosition.liabilities.current.tradePayables", label: "Trade & Other Payables" },
    { value: "financialPosition.liabilities.current.accruedExpenses", label: "Accrued Expenses" },
    { value: "financialPosition.liabilities.current.otherCurrent", label: "Other Current Liabilities" },
    { value: "financialPosition.liabilities.nonCurrent.borrowings", label: "Long-term Borrowings" },
    { value: "financialPosition.liabilities.nonCurrent.otherNonCurrent", label: "Other Non-Current Liabilities" },
];
// ==================== STORAGE KEYS ====================
const STORAGE_KEY_MAPPINGS = "finreportai_company_mappings";
const STORAGE_KEY_COMPANIES = "finreportai_companies";
// ==================== COMPANY MAPPING CRUD ====================
export function saveCompanyMappings(companyId, companyName, mappings // glCode -> ifrsLine
) {
    try {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEY_MAPPINGS) || "{}");
        all[companyId] = {
            companyName,
            mappings,
            savedAt: new Date().toISOString(),
            accountCount: Object.keys(mappings).length
        };
        localStorage.setItem(STORAGE_KEY_MAPPINGS, JSON.stringify(all));
        console.log(`✅ Saved ${Object.keys(mappings).length} mappings for ${companyName} (ID: ${companyId})`);
    }
    catch (error) {
        console.error("Failed to save company mappings:", error);
        throw new Error("Failed to save mappings to storage");
    }
}
export function loadCompanyMappings(companyId) {
    try {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEY_MAPPINGS) || "{}");
        return all[companyId]?.mappings || null;
    }
    catch (error) {
        console.error("Failed to load company mappings:", error);
        return null;
    }
}
export function hasCompanyMappings(companyId) {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY_MAPPINGS) || "{}");
    return !!all[companyId] && Object.keys(all[companyId].mappings || {}).length > 0;
}
export function getCompanyMappingInfo(companyId) {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY_MAPPINGS) || "{}");
    const data = all[companyId];
    if (!data) {
        return { exists: false };
    }
    return {
        exists: true,
        companyName: data.companyName,
        accountCount: data.accountCount,
        savedAt: data.savedAt
    };
}
// ==================== AUTO-MAP TRIAL BALANCE ====================
// Core "Map Once Use Forever" logic
export function autoMapTrialBalance(trialBalance, companyId) {
    const savedMappings = loadCompanyMappings(companyId);
    if (!savedMappings) {
        // No saved mappings — all entries are unmapped
        return {
            mapped: [],
            newCodes: [],
            unmapped: trialBalance.map(entry => ({
                ...entry,
                mappingStatus: "unmapped"
            })),
            mappedCount: 0,
            newCodeCount: 0,
            totalCount: trialBalance.length
        };
    }
    const mapped = [];
    const newCodes = [];
    const unmapped = [];
    for (const entry of trialBalance) {
        const ifrsLine = savedMappings[entry.glCode];
        if (ifrsLine) {
            // GL code found in saved mappings → auto-mapped
            mapped.push({
                ...entry,
                mappedIfrsLine: ifrsLine,
                mappingStatus: "mapped"
            });
        }
        else {
            // GL code not in saved mappings → new code (needs mapping)
            newCodes.push({
                ...entry,
                mappingStatus: "new_code"
            });
        }
    }
    return {
        mapped,
        newCodes,
        unmapped,
        mappedCount: mapped.length,
        newCodeCount: newCodes.length,
        totalCount: trialBalance.length
    };
}
// ==================== BACKEND PATH NORMALIZER ====================
// Backend IFRS mapper uses slightly different path names; map to frontend IFRS_LINE_ITEMS values
const BACKEND_TO_FRONTEND_PATH = {
    "financialPosition.assets.nonCurrent.ppe": "financialPosition.assets.nonCurrent.propertyPlantEquipment",
    "financialPosition.assets.current.other": "financialPosition.assets.current.otherCurrent",
    "financialPosition.assets.nonCurrent.other": "financialPosition.assets.nonCurrent.otherNonCurrent",
    "financialPosition.liabilities.current.other": "financialPosition.liabilities.current.otherCurrent",
    "financialPosition.liabilities.nonCurrent.other": "financialPosition.liabilities.nonCurrent.otherNonCurrent",
    "financialPosition.equity.reserves": "financialPosition.equity.otherReserves",
    "financialPosition.liabilities.current.borrowings": "financialPosition.liabilities.current.shortTermBorrowings",
    "financialPosition.liabilities.nonCurrent.borrowings": "financialPosition.liabilities.nonCurrent.borrowings",
};
function normalizeBackendPath(path) {
    return BACKEND_TO_FRONTEND_PATH[path] ?? path;
}
// ==================== AI MAPPING VIA BACKEND (NO AWS TOKEN IN BROWSER) ====================
const API_BASE_URL = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || "http://localhost:8000";
async function getAISuggestionsFromBackend(entries) {
    try {
        const body = entries.map((e) => ({
            glCode: e.glCode,
            accountName: e.accountName,
            debit: e.debit,
            credit: e.credit,
            accountType: e.accountType || "unknown",
        }));
        const url = `${API_BASE_URL.replace(/\/$/, "")}/api/ifrs/ai-mapping`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok)
            return null;
        const data = await res.json();
        const mappings = data.mappings ?? [];
        const results = {};
        for (const m of mappings) {
            const suggested = normalizeBackendPath(m.suggestedMapping || "");
            results[m.glCode] = {
                glCode: m.glCode,
                accountName: m.accountName,
                suggestedMapping: suggested,
                confidence: m.confidence ?? 0,
                alternatives: (m.alternatives ?? []).map((alt) => ({
                    ifrsLine: normalizeBackendPath(alt.path || alt.ifrsLine || ""),
                    label: alt.label || (IFRS_LINE_ITEMS.find((i) => i.value === normalizeBackendPath(alt.path || alt.ifrsLine || ""))?.label ?? ""),
                    confidence: alt.confidence ?? 0,
                })),
            };
        }
        return results;
    }
    catch {
        return null;
    }
}
// ==================== RULE-BASED MAPPING (NO BACKEND, NO AWS) ====================
// Same logic as backend ifrs_mapper — works offline, no credentials needed
const RULE_KEYWORDS = [
    { keyword: "cash", path: "financialPosition.assets.current.cashAndEquivalents", confidence: 95 },
    { keyword: "bank", path: "financialPosition.assets.current.cashAndEquivalents", confidence: 95 },
    { keyword: "accounts receivable", path: "financialPosition.assets.current.tradeReceivables", confidence: 95 },
    { keyword: "trade receivable", path: "financialPosition.assets.current.tradeReceivables", confidence: 95 },
    { keyword: "inventory", path: "financialPosition.assets.current.inventories", confidence: 95 },
    { keyword: "stock", path: "financialPosition.assets.current.inventories", confidence: 90 },
    { keyword: "property, plant", path: "financialPosition.assets.nonCurrent.propertyPlantEquipment", confidence: 95 },
    { keyword: "ppe", path: "financialPosition.assets.nonCurrent.propertyPlantEquipment", confidence: 95 },
    { keyword: "equipment", path: "financialPosition.assets.nonCurrent.propertyPlantEquipment", confidence: 85 },
    { keyword: "intangible", path: "financialPosition.assets.nonCurrent.intangibleAssets", confidence: 95 },
    { keyword: "goodwill", path: "financialPosition.assets.nonCurrent.intangibleAssets", confidence: 95 },
    { keyword: "accounts payable", path: "financialPosition.liabilities.current.tradePayables", confidence: 95 },
    { keyword: "trade payable", path: "financialPosition.liabilities.current.tradePayables", confidence: 95 },
    { keyword: "accrued expenses", path: "financialPosition.liabilities.current.accruedExpenses", confidence: 95 },
    { keyword: "short-term loan", path: "financialPosition.liabilities.current.shortTermBorrowings", confidence: 90 },
    { keyword: "long-term debt", path: "financialPosition.liabilities.nonCurrent.borrowings", confidence: 95 },
    { keyword: "long-term loan", path: "financialPosition.liabilities.nonCurrent.borrowings", confidence: 95 },
    { keyword: "share capital", path: "financialPosition.equity.shareCapital", confidence: 95 },
    { keyword: "common stock", path: "financialPosition.equity.shareCapital", confidence: 95 },
    { keyword: "retained earnings", path: "financialPosition.equity.retainedEarnings", confidence: 95 },
    { keyword: "reserves", path: "financialPosition.equity.otherReserves", confidence: 85 },
    { keyword: "sales", path: "profitLoss.revenue", confidence: 95 },
    { keyword: "revenue", path: "profitLoss.revenue", confidence: 95 },
    { keyword: "service revenue", path: "profitLoss.revenue", confidence: 95 },
    { keyword: "cost of goods sold", path: "profitLoss.costOfSales", confidence: 95 },
    { keyword: "cogs", path: "profitLoss.costOfSales", confidence: 95 },
    { keyword: "cost of sales", path: "profitLoss.costOfSales", confidence: 95 },
    { keyword: "salaries", path: "profitLoss.operatingExpenses.employeeBenefits", confidence: 90 },
    { keyword: "wages", path: "profitLoss.operatingExpenses.employeeBenefits", confidence: 90 },
    { keyword: "payroll", path: "profitLoss.operatingExpenses.employeeBenefits", confidence: 90 },
    { keyword: "depreciation", path: "profitLoss.operatingExpenses.depreciation", confidence: 95 },
    { keyword: "amortization", path: "profitLoss.operatingExpenses.depreciation", confidence: 95 },
    { keyword: "rent", path: "profitLoss.operatingExpenses.administrative", confidence: 85 },
    { keyword: "marketing", path: "profitLoss.operatingExpenses.distribution", confidence: 85 },
    { keyword: "advertising", path: "profitLoss.operatingExpenses.distribution", confidence: 85 },
    { keyword: "administrative", path: "profitLoss.operatingExpenses.administrative", confidence: 90 },
    { keyword: "interest expense", path: "profitLoss.financeCosts", confidence: 95 },
    { keyword: "interest income", path: "profitLoss.financeIncome", confidence: 95 },
    { keyword: "income tax", path: "profitLoss.incomeTax", confidence: 95 },
    { keyword: "tax expense", path: "profitLoss.incomeTax", confidence: 90 },
];
function getRuleBasedMappings(entries) {
    const results = {};
    for (const entry of entries) {
        const name = (entry.accountName || "").toLowerCase();
        const type = (entry.accountType || "").toLowerCase();
        let suggested = "";
        let confidence = 0;
        for (const { keyword, path, confidence: c } of RULE_KEYWORDS) {
            if (name.includes(keyword)) {
                suggested = path;
                confidence = c;
                break;
            }
        }
        if (!suggested && type) {
            if (["asset", "assets"].some((t) => type.includes(t)))
                suggested = "financialPosition.assets.current.otherCurrent";
            else if (["liability", "liabilities"].some((t) => type.includes(t)))
                suggested = "financialPosition.liabilities.current.otherCurrent";
            else if (["equity", "capital"].some((t) => type.includes(t)))
                suggested = "financialPosition.equity.otherReserves";
            else if (["revenue", "income"].some((t) => type.includes(t)))
                suggested = "profitLoss.revenue";
            else if (["expense", "expenses"].some((t) => type.includes(t)))
                suggested = "profitLoss.operatingExpenses.other";
            if (suggested)
                confidence = 55;
        }
        if (!suggested)
            suggested = "unmapped";
        const ifrsItem = IFRS_LINE_ITEMS.find((i) => i.value === suggested);
        results[entry.glCode] = {
            glCode: entry.glCode,
            accountName: entry.accountName,
            suggestedMapping: suggested === "unmapped" ? "" : suggested,
            confidence,
            alternatives: ifrsItem ? [] : IFRS_LINE_ITEMS.slice(0, 3).map((i) => ({ ifrsLine: i.value, label: i.label, confidence: 0 })),
        };
    }
    return results;
}
// ==================== AI MAPPING SUGGESTIONS ====================
const ACCRUED_EXPENSES_PATH = "financialPosition.liabilities.current.accruedExpenses";
/** Force liability accounts (e.g. Accrued Expenses, account 2100) to map to liabilities, never to Revenue/income. */
function fixLiabilitySuggestions(entries, results) {
    const out = { ...results };
    for (const entry of entries) {
        const glCodeStr = String(entry.glCode ?? "").trim();
        const name = (entry.accountName || "").toLowerCase();
        const isLiabilityBalance = entry.credit > entry.debit;
        const isAccruedExpenses = glCodeStr === "2100" ||
            /accrued\s*expenses?/.test(name) ||
            (name.includes("accrued") && isLiabilityBalance);
        if (!isAccruedExpenses)
            continue;
        const r = out[entry.glCode] ?? out[glCodeStr] ?? out["2100"];
        const suggested = (r?.suggestedMapping ?? "").toLowerCase();
        const isWronglyIncome = !r?.suggestedMapping ||
            suggested.startsWith("profitloss.") ||
            suggested.includes("revenue") ||
            suggested.includes("income");
        if (isWronglyIncome || r?.suggestedMapping !== ACCRUED_EXPENSES_PATH) {
            const fixed = {
                ...r,
                glCode: entry.glCode,
                accountName: entry.accountName,
                suggestedMapping: ACCRUED_EXPENSES_PATH,
                confidence: 95,
                alternatives: (r?.alternatives ?? []).filter((alt) => (alt.ifrsLine ?? "").toLowerCase() !== "profitloss.revenue" && !(alt.ifrsLine ?? "").toLowerCase().includes("income")),
            };
            out[entry.glCode] = fixed;
            if (glCodeStr && glCodeStr !== String(entry.glCode))
                out[glCodeStr] = fixed;
        }
    }
    return out;
}
export async function getAISuggestions(entries) {
    if (entries.length === 0)
        return {};
    // 1) Prefer backend (no AWS token in browser)
    const backendResults = await getAISuggestionsFromBackend(entries);
    const raw = backendResults && Object.keys(backendResults).length > 0
        ? backendResults
        : getRuleBasedMappings(entries);
    // 2) Ensure Accrued Expenses (and similar liability accounts) never map to Revenue/income
    return fixLiabilitySuggestions(entries, raw);
}
// ==================== HELPER: GET IFRS LINE ITEM INFO ====================
export function getIFRSLineItemInfo(ifrsLine) {
    return IFRS_LINE_ITEMS.find(item => item.value === ifrsLine);
}
// ==================== HELPER: GET IFRS LINE ITEMS BY STATEMENT ====================
export function getIFRSLineItemsByStatement(statement) {
    return IFRS_LINE_ITEMS.filter(item => item.statement === statement);
}
// ==================== HELPER: VALIDATE MAPPING ====================
export function validateMapping(ifrsLine) {
    return IFRS_LINE_ITEMS.some(item => item.value === ifrsLine);
}
// ==================== INDUSTRY TEMPLATES ====================
export const INDUSTRY_TEMPLATES = [
    {
        id: "manufacturing",
        name: "Manufacturing",
        industry: "Manufacturing & Production",
        description: "Pre-configured mappings for manufacturing companies with inventory, COGS, and production costs",
        icon: "Factory",
        accountCount: 180,
        mappings: {
            "1001": "financialPosition.assets.current.cashAndEquivalents",
            "1002": "financialPosition.assets.current.tradeReceivables",
            "1003": "financialPosition.assets.current.inventories",
            "2001": "financialPosition.assets.nonCurrent.propertyPlantEquipment",
            "3001": "financialPosition.liabilities.current.tradePayables",
            "4001": "financialPosition.liabilities.nonCurrent.borrowings",
            "5001": "financialPosition.equity.shareCapital",
            "6001": "profitLoss.revenue",
            "7001": "profitLoss.costOfSales",
            "7002": "profitLoss.operatingExpenses.employeeBenefits",
            "7007": "profitLoss.operatingExpenses.depreciation",
        }
    },
    {
        id: "retail",
        name: "Retail & E-commerce",
        industry: "Retail Trade",
        description: "Optimized for retail businesses with focus on inventory, sales, and customer receivables",
        icon: "ShoppingCart",
        accountCount: 150,
        mappings: {
            "1001": "financialPosition.assets.current.cashAndEquivalents",
            "1002": "financialPosition.assets.current.tradeReceivables",
            "1003": "financialPosition.assets.current.inventories",
            "6001": "profitLoss.revenue",
            "7001": "profitLoss.costOfSales",
            "7006": "profitLoss.operatingExpenses.distribution",
        }
    },
    {
        id: "services",
        name: "Professional Services",
        industry: "Services",
        description: "Designed for service-based businesses with minimal inventory and focus on employee costs",
        icon: "Briefcase",
        accountCount: 120,
        mappings: {
            "1001": "financialPosition.assets.current.cashAndEquivalents",
            "1002": "financialPosition.assets.current.tradeReceivables",
            "6001": "profitLoss.revenue",
            "7002": "profitLoss.operatingExpenses.employeeBenefits",
            "7005": "profitLoss.operatingExpenses.administrative",
        }
    },
    {
        id: "technology",
        name: "Technology & SaaS",
        industry: "Technology",
        description: "Tailored for tech companies with software development, R&D, and subscription revenue",
        icon: "Cpu",
        accountCount: 140,
        mappings: {
            "1001": "financialPosition.assets.current.cashAndEquivalents",
            "2002": "financialPosition.assets.nonCurrent.intangibleAssets",
            "6001": "profitLoss.revenue",
            "7002": "profitLoss.operatingExpenses.employeeBenefits",
        }
    },
    {
        id: "real-estate",
        name: "Real Estate",
        industry: "Real Estate",
        description: "Configured for real estate companies with property assets, rental income, and depreciation",
        icon: "Building2",
        accountCount: 160,
        mappings: {
            "1001": "financialPosition.assets.current.cashAndEquivalents",
            "2001": "financialPosition.assets.nonCurrent.propertyPlantEquipment",
            "6001": "profitLoss.revenue",
            "7007": "profitLoss.operatingExpenses.depreciation",
        }
    }
];
