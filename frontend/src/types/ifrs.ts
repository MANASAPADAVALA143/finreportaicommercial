// ==================== IFRS STATEMENT GENERATOR — TYPE DEFINITIONS ====================
// "Map Once, Use Forever" Architecture

// ==================== COMPANY MASTER MAPPING ====================
// Saved ONCE per company, used forever for all monthly uploads

export interface CompanyMapping {
  id: string;
  companyId: string;
  companyName: string;
  glCode: string;              // e.g. "1001"
  glDescription: string;       // e.g. "Cash & Bank"
  ifrsLine: string;            // e.g. "financialPosition.assets.current.cashAndEquivalents"
  ifrsLabel: string;           // e.g. "Cash & Cash Equivalents"
  ifrsStatement: string;       // "balanceSheet" | "profitLoss" | "cashFlow" | "equity"
  createdAt: string;
  updatedAt: string;
}

// ==================== TRIAL BALANCE ====================
// Uploaded monthly — auto-mapped using CompanyMapping

export interface TrialBalanceEntry {
  glCode: string;
  accountName: string;
  debit: number;
  credit: number;
  mappedIfrsLine?: string;     // auto-filled from CompanyMapping
  mappingStatus: "mapped" | "unmapped" | "new_code" | "uncertain";
  accountType?: string;        // e.g. "asset" | "liability" | "equity" | "revenue" | "expense"
  net?: number;                // debit - credit (computed)
  confidence?: number;
  suggestedMapping?: string;
}

// ==================== IFRS LINE ITEM MASTER ====================
// Standard IFRS classification reference

export interface IFRSLineItem {
  value: string;               // e.g. "financialPosition.assets.current.cashAndEquivalents"
  label: string;               // e.g. "Cash & Cash Equivalents"
  statement: "balanceSheet" | "profitLoss" | "cashFlow" | "equity";
  category?: string;           // e.g. "Current Assets", "Operating Expenses"
}

// ==================== IFRS STATEMENT OUTPUT ====================

export interface IFRSStatement {
  companyName: string;
  periodEnd: string;
  currency: string;
  balanceSheet: BalanceSheet;
  profitLoss: ProfitLoss;
  cashFlow: CashFlow;
  equity: Equity;
  generatedAt: string;
  aiProvider: string;          // "aws-nova" | "claude" | "openai"
  aiValidation?: AIValidation;
}

export interface AIValidation {
  balanceCheck: boolean;
  issues: string[];
  highlights: string[];
}

// ==================== BALANCE SHEET ====================

export interface BalanceSheet {
  assets: Assets;
  liabilities: Liabilities;
  equity: EquitySection;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

export interface Assets {
  current: CurrentAssets;
  nonCurrent: NonCurrentAssets;
  totalAssets: number;
}

export interface CurrentAssets {
  cashAndEquivalents: number;
  tradeReceivables: number;
  inventories: number;
  prepayments: number;
  otherCurrent: number;
  otherCurrentAssets?: number;  // alias used by statementGenerator
  total?: number;
  totalCurrent: number;
  [key: string]: number | undefined;
}

export interface NonCurrentAssets {
  propertyPlantEquipment: number;
  intangibleAssets: number;
  investments: number;
  deferredTax?: number;
  otherNonCurrent: number;
  otherNonCurrentAssets?: number;
  total?: number;
  totalNonCurrent: number;
  [key: string]: number | undefined;
}

export interface Liabilities {
  current: CurrentLiabilities;
  nonCurrent: NonCurrentLiabilities;
  totalLiabilities: number;
  total?: number;
}

export interface CurrentLiabilities {
  tradePayables: number;
  shortTermBorrowings: number;
  accruedExpenses: number;
  currentTaxPayable?: number;
  provisions?: number;
  otherCurrentLiabilities?: number;
  otherCurrent: number;
  total?: number;
  totalCurrent: number;
  [key: string]: number | undefined;
}

export interface NonCurrentLiabilities {
  borrowings: number;
  longTermBorrowings?: number;
  deferredTax: number;
  provisions: number;
  otherNonCurrentLiabilities?: number;
  otherNonCurrent: number;
  total?: number;
  totalNonCurrent: number;
  [key: string]: number | undefined;
}

export interface EquitySection {
  shareCapital: number;
  retainedEarnings: number;
  reserves?: number;
  otherReserves: number;
  total?: number;
  totalEquity: number;
  [key: string]: number | undefined;
}

// ==================== PROFIT & LOSS ====================

export interface ProfitLoss {
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  grossMarginPercent?: number;
  operatingExpenses: OperatingExpenses;
  operatingProfit: number;
  operatingMarginPercent?: number;
  financeIncome: number;
  financeCosts: number;
  profitBeforeTax: number;
  incomeTax: number;
  netProfit: number;
  profitAfterTax?: number;  // alias for netProfit used by statementGenerator
  netMarginPercent?: number;
  [key: string]: number | OperatingExpenses | undefined;
}

export interface OperatingExpenses {
  employeeBenefits: number;
  administrative: number;
  distribution: number;
  depreciation: number;
  other: number;
  total: number;
}

// ==================== CASH FLOW ====================

export interface CashFlow {
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: number;
  openingBalance: number;
  closingBalance: number;
}

export interface CashFlowSection {
  items?: CashFlowItem[];
  total: number;
  // Extended properties used by statementGenerator (flat structure)
  [key: string]: CashFlowItem[] | number | Record<string, number> | undefined;
}

export interface CashFlowItem {
  label: string;
  amount: number;
}

// ==================== EQUITY ====================

export interface Equity {
  shareCapital: EquityMovement;
  retainedEarnings: RetainedEarningsMovement;
  otherReserves: EquityMovement;
  totalEquity: number;
}

export interface EquityMovement {
  opening: number;
  changes: number;
  closing: number;
}

export interface RetainedEarningsMovement {
  opening: number;
  netProfit: number;
  dividends: number;
  closing: number;
}

// ==================== COMPANY SETUP ====================

export interface CompanyInfo {
  id: string;
  name: string;
  currency: "USD" | "EUR" | "GBP" | "INR" | "AED" | "SGD";
  financialYearEnd: "Jan" | "Feb" | "Mar" | "Apr" | "May" | "Jun" | "Jul" | "Aug" | "Sep" | "Oct" | "Nov" | "Dec";
  industry?: string;
  createdAt: string;
}

// ==================== MAPPING TEMPLATES ====================

export interface MappingTemplate {
  id: string;
  name: string;
  industry: string;
  description: string;
  icon: string;
  accountCount: number;
  mappings: Record<string, string>;  // glCode -> ifrsLine
}

// ==================== AI MAPPING RESULT ====================

export interface AIMappingResult {
  glCode: string;
  accountName: string;
  suggestedMapping: string;
  confidence: number;
  alternatives: Array<{
    ifrsLine: string;
    label: string;
    confidence: number;
  }>;
}

// ==================== UPLOAD FORMATS ====================

export interface ChartOfAccountsRow {
  glCode: string;
  accountName: string;
  ifrsLineItem?: string;        // Optional — if provided, skip AI mapping
}

export interface TrialBalanceRow {
  glCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

// ==================== GENERATED STATEMENTS ====================

export interface GeneratedStatements {
  entityName?: string;
  periodEnd?: string;
  currency?: string;
  financialPosition: BalanceSheet;
  profitLoss: ProfitLoss;
  cashFlows: CashFlow;
  changesInEquity: Equity;
  [key: string]: unknown;
}
