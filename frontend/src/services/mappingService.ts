// ==================== MAPPING SERVICE ====================
// "Map Once, Use Forever" Architecture
// Company GL codes mapped to IFRS line items — saved permanently

import { callAI, extractJSON } from "./aiProvider";
import type { 
  CompanyMapping, 
  TrialBalanceEntry, 
  IFRSLineItem,
  AIMappingResult 
} from "../types/ifrs";

// ==================== IFRS MASTER LINE ITEMS ====================
// Standard IFRS classification reference

export const IFRS_LINE_ITEMS: IFRSLineItem[] = [
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

// ==================== STORAGE KEYS ====================

const STORAGE_KEY_MAPPINGS = "finreportai_company_mappings";
const STORAGE_KEY_COMPANIES = "finreportai_companies";

// ==================== COMPANY MAPPING CRUD ====================

export function saveCompanyMappings(
  companyId: string, 
  companyName: string,
  mappings: Record<string, string>  // glCode -> ifrsLine
): void {
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
  } catch (error) {
    console.error("Failed to save company mappings:", error);
    throw new Error("Failed to save mappings to storage");
  }
}

export function loadCompanyMappings(companyId: string): Record<string, string> | null {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY_MAPPINGS) || "{}");
    return all[companyId]?.mappings || null;
  } catch (error) {
    console.error("Failed to load company mappings:", error);
    return null;
  }
}

export function hasCompanyMappings(companyId: string): boolean {
  const all = JSON.parse(localStorage.getItem(STORAGE_KEY_MAPPINGS) || "{}");
  return !!all[companyId] && Object.keys(all[companyId].mappings || {}).length > 0;
}

export function getCompanyMappingInfo(companyId: string): {
  exists: boolean;
  companyName?: string;
  accountCount?: number;
  savedAt?: string;
} {
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

export function autoMapTrialBalance(
  trialBalance: TrialBalanceEntry[],
  companyId: string
): {
  mapped: TrialBalanceEntry[];
  newCodes: TrialBalanceEntry[];
  unmapped: TrialBalanceEntry[];
  mappedCount: number;
  newCodeCount: number;
  totalCount: number;
} {
  const savedMappings = loadCompanyMappings(companyId);
  
  if (!savedMappings) {
    // No saved mappings — all entries are unmapped
    return {
      mapped: [],
      newCodes: [],
      unmapped: trialBalance.map(entry => ({
        ...entry,
        mappingStatus: "unmapped" as const
      })),
      mappedCount: 0,
      newCodeCount: 0,
      totalCount: trialBalance.length
    };
  }

  const mapped: TrialBalanceEntry[] = [];
  const newCodes: TrialBalanceEntry[] = [];
  const unmapped: TrialBalanceEntry[] = [];

  for (const entry of trialBalance) {
    const ifrsLine = savedMappings[entry.glCode];
    
    if (ifrsLine) {
      // GL code found in saved mappings → auto-mapped
      mapped.push({
        ...entry,
        mappedIfrsLine: ifrsLine,
        mappingStatus: "mapped"
      });
    } else {
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

// ==================== AI MAPPING SUGGESTIONS ====================

export async function getAISuggestions(
  entries: TrialBalanceEntry[]
): Promise<Record<string, AIMappingResult>> {
  
  if (entries.length === 0) {
    return {};
  }

  const prompt = `You are an expert IFRS accountant. Map these General Ledger accounts to the appropriate IFRS line items.

GL ACCOUNTS TO MAP:
${entries.map(e => `${e.glCode}: "${e.accountName}" (Debit: ${e.debit}, Credit: ${e.credit})`).join("\n")}

AVAILABLE IFRS LINE ITEMS:
${IFRS_LINE_ITEMS.map(item => `${item.value} — ${item.label} (${item.statement})`).join("\n")}

INSTRUCTIONS:
1. Match each GL code to the most appropriate IFRS line item
2. Consider the account name and debit/credit balance
3. For each GL code, provide:
   - Primary mapping (most confident match)
   - Confidence score (0-100)
   - 1-2 alternative mappings if applicable

Return ONLY valid JSON in this exact format:
{
  "glCode": {
    "suggestedMapping": "ifrsLine",
    "confidence": 95,
    "alternatives": [
      {"ifrsLine": "alternative1", "label": "Alternative 1", "confidence": 75}
    ]
  }
}

RULES:
- Use exact GL codes as keys
- Use exact IFRS line item values from the list above
- Confidence must be 0-100
- Return ONLY JSON, no explanation`;

  try {
    const response = await callAI(prompt, { maxTokens: 3000, temperature: 0.2 });
    const jsonData = extractJSON(response);
    
    // Transform AI response to AIMappingResult format
    const results: Record<string, AIMappingResult> = {};
    
    for (const entry of entries) {
      const aiResult = jsonData[entry.glCode];
      
      if (aiResult) {
        const ifrsItem = IFRS_LINE_ITEMS.find(item => item.value === aiResult.suggestedMapping);
        
        results[entry.glCode] = {
          glCode: entry.glCode,
          accountName: entry.accountName,
          suggestedMapping: aiResult.suggestedMapping,
          confidence: aiResult.confidence || 0,
          alternatives: (aiResult.alternatives || []).map((alt: any) => ({
            ifrsLine: alt.ifrsLine,
            label: alt.label || IFRS_LINE_ITEMS.find(i => i.value === alt.ifrsLine)?.label || alt.ifrsLine,
            confidence: alt.confidence || 0
          }))
        };
      } else {
        // AI didn't provide mapping for this code
        results[entry.glCode] = {
          glCode: entry.glCode,
          accountName: entry.accountName,
          suggestedMapping: "",
          confidence: 0,
          alternatives: []
        };
      }
    }
    
    return results;
    
  } catch (error) {
    console.error("AI mapping suggestion failed:", error);
    throw error;
  }
}

// ==================== HELPER: GET IFRS LINE ITEM INFO ====================

export function getIFRSLineItemInfo(ifrsLine: string): IFRSLineItem | undefined {
  return IFRS_LINE_ITEMS.find(item => item.value === ifrsLine);
}

// ==================== HELPER: GET IFRS LINE ITEMS BY STATEMENT ====================

export function getIFRSLineItemsByStatement(statement: "balanceSheet" | "profitLoss" | "cashFlow" | "equity"): IFRSLineItem[] {
  return IFRS_LINE_ITEMS.filter(item => item.statement === statement);
}

// ==================== HELPER: VALIDATE MAPPING ====================

export function validateMapping(ifrsLine: string): boolean {
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
