import * as XLSX from 'xlsx';

// ============================================
// CFO DECISION INTELLIGENCE DATA STRUCTURES
// ============================================

export interface InvestmentDecisionData {
  projectName: string;
  investment: number;
  yearlyRevenue: number;
  yearlyCost: number;
  discountRate: number;
  projectYears: number;
}

export interface BuildVsBuyData {
  requirement: string;
  buildInitialCost: number;
  buildMonthlyCost: number;
  buildTimeMonths: number;
  buyInitialCost: number;
  buyMonthlyCost: number;
  buyTimeMonths: number;
  projectYears: number;
}

export interface InternalVsExternalData {
  functionName: string;
  currentTeam: number;
  costPerPerson: number;
  currentTime: number;
  errorRate: number;
  vendorMonthlyCost: number;
  vendorSLA: number;
  vendorErrorRate: number;
}

export interface HireVsAutomateData {
  role: string;
  annualSalary: number;
  benefits: number;
  headcount: number;
  softwareCost: number;
  implementationCost: number;
  tasksPerDay: number;
  automationRate: number;
}

export interface CostCutVsInvestData {
  scenario: string;
  currentRevenue: number;
  costCutAmount: number;
  costCutImpact: string;
  investAmount: number;
  investROI: number;
  timeHorizon: number;
}

export interface CapitalAllocationData {
  scenario: string;
  totalCapital: number;
  productDev: number;
  marketExpansion: number;
  debtRepayment: number;
  mna: number;
  cashReserve: number;
}

export interface RiskData {
  riskCategory: string;
  riskDescription: string;
  likelihood: number;
  impact: number;
  currentMitigation: string;
  riskScore: number;
}

export interface DecisionAuditData {
  date: string;
  type: string;
  title: string;
  aiOutcome: string;
  cfoOutcome: string;
  confidence: number;
  tracked: boolean;
  aiCorrect?: boolean;
}

export interface CFODecisionUploadedData {
  investment: InvestmentDecisionData[];
  buildVsBuy: BuildVsBuyData[];
  internalVsExternal: InternalVsExternalData[];
  hireVsAutomate: HireVsAutomateData[];
  costCutVsInvest: CostCutVsInvestData[];
  capitalAllocation: CapitalAllocationData[];
  risks: RiskData[];
  auditTrail: DecisionAuditData[];
  uploadDate: string;
}

// ============================================
// PARSER FUNCTIONS
// ============================================

const parseNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[₹,\s]/g, '');
    return parseFloat(cleaned) || 0;
  }
  return 0;
};

const parseString = (value: any): string => {
  return value?.toString()?.trim() || '';
};

const parseInvestmentSheet = (rows: any[]): InvestmentDecisionData[] => {
  const data: InvestmentDecisionData[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    
    data.push({
      projectName: parseString(row[0]),
      investment: parseNumber(row[1]),
      yearlyRevenue: parseNumber(row[2]),
      yearlyCost: parseNumber(row[3]),
      discountRate: parseNumber(row[4]),
      projectYears: parseNumber(row[5])
    });
  }
  
  return data;
};

const parseBuildVsBuySheet = (rows: any[]): BuildVsBuyData[] => {
  const data: BuildVsBuyData[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    
    data.push({
      requirement: parseString(row[0]),
      buildInitialCost: parseNumber(row[1]),
      buildMonthlyCost: parseNumber(row[2]),
      buildTimeMonths: parseNumber(row[3]),
      buyInitialCost: parseNumber(row[4]),
      buyMonthlyCost: parseNumber(row[5]),
      buyTimeMonths: parseNumber(row[6]),
      projectYears: parseNumber(row[7])
    });
  }
  
  return data;
};

const parseInternalVsExternalSheet = (rows: any[]): InternalVsExternalData[] => {
  const data: InternalVsExternalData[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    
    data.push({
      functionName: parseString(row[0]),
      currentTeam: parseNumber(row[1]),
      costPerPerson: parseNumber(row[2]),
      currentTime: parseNumber(row[3]),
      errorRate: parseNumber(row[4]),
      vendorMonthlyCost: parseNumber(row[5]),
      vendorSLA: parseNumber(row[6]),
      vendorErrorRate: parseNumber(row[7])
    });
  }
  
  return data;
};

const parseHireVsAutomateSheet = (rows: any[]): HireVsAutomateData[] => {
  const data: HireVsAutomateData[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    
    data.push({
      role: parseString(row[0]),
      annualSalary: parseNumber(row[1]),
      benefits: parseNumber(row[2]),
      headcount: parseNumber(row[3]),
      softwareCost: parseNumber(row[4]),
      implementationCost: parseNumber(row[5]),
      tasksPerDay: parseNumber(row[6]),
      automationRate: parseNumber(row[7])
    });
  }
  
  return data;
};

const parseCostCutVsInvestSheet = (rows: any[]): CostCutVsInvestData[] => {
  const data: CostCutVsInvestData[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    
    data.push({
      scenario: parseString(row[0]),
      currentRevenue: parseNumber(row[1]),
      costCutAmount: parseNumber(row[2]),
      costCutImpact: parseString(row[3]),
      investAmount: parseNumber(row[4]),
      investROI: parseNumber(row[5]),
      timeHorizon: parseNumber(row[6])
    });
  }
  
  return data;
};

const parseCapitalAllocationSheet = (rows: any[]): CapitalAllocationData[] => {
  const data: CapitalAllocationData[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    
    data.push({
      scenario: parseString(row[0]),
      totalCapital: parseNumber(row[1]),
      productDev: parseNumber(row[2]),
      marketExpansion: parseNumber(row[3]),
      debtRepayment: parseNumber(row[4]),
      mna: parseNumber(row[5]),
      cashReserve: parseNumber(row[6])
    });
  }
  
  return data;
};

const parseRiskSheet = (rows: any[]): RiskData[] => {
  const data: RiskData[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    
    data.push({
      riskCategory: parseString(row[0]),
      riskDescription: parseString(row[1]),
      likelihood: parseNumber(row[2]),
      impact: parseNumber(row[3]),
      currentMitigation: parseString(row[4]),
      riskScore: parseNumber(row[5])
    });
  }
  
  return data;
};

const parseDecisionAuditSheet = (rows: any[]): DecisionAuditData[] => {
  const data: DecisionAuditData[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    
    data.push({
      date: parseString(row[0]),
      type: parseString(row[1]),
      title: parseString(row[2]),
      aiOutcome: parseString(row[3]),
      cfoOutcome: parseString(row[4]),
      confidence: parseNumber(row[5]),
      tracked: row[6]?.toString()?.toLowerCase() === 'true' || row[6] === true,
      aiCorrect: row[7] !== undefined ? (row[7]?.toString()?.toLowerCase() === 'true' || row[7] === true) : undefined
    });
  }
  
  return data;
};

// ============================================
// MAIN PARSER
// ============================================

/** Parse from workbook (e.g. when processing multi-sheet upload). */
export const parseCFODecisionFromWorkbook = (workbook: XLSX.WorkBook): CFODecisionUploadedData => {
  const result: CFODecisionUploadedData = {
    investment: [],
    buildVsBuy: [],
    internalVsExternal: [],
    hireVsAutomate: [],
    costCutVsInvest: [],
    capitalAllocation: [],
    risks: [],
    auditTrail: [],
    uploadDate: new Date().toISOString()
  };
  
  // Sheet name mappings (case-insensitive)
  const sheetMappings: { [key: string]: keyof CFODecisionUploadedData } = {
    'cfo_decision_inputs': 'investment',
    'cfo_decision': 'investment',
    'decision_inputs': 'investment',
    'investment_decisions': 'investment',
    'investment': 'investment',
    'build_vs_buy': 'buildVsBuy',
    'buildvsbuy': 'buildVsBuy',
    'internal_vs_external': 'internalVsExternal',
    'internalvsexternal': 'internalVsExternal',
    'outsource': 'internalVsExternal',
    'hire_vs_automate': 'hireVsAutomate',
    'hirevsautomate': 'hireVsAutomate',
    'cost_cut_vs_invest': 'costCutVsInvest',
    'costcutvsivest': 'costCutVsInvest',
    'capital_allocation': 'capitalAllocation',
    'capitalallocation': 'capitalAllocation',
    'risk_dashboard': 'risks',
    'risks': 'risks',
    'decision_audit_trail': 'auditTrail',
    'audit_trail': 'auditTrail',
    'audit': 'auditTrail'
  };
  
  let sheetsProcessed = 0;
  
  workbook.SheetNames.forEach((sheetName) => {
    const normalizedName = sheetName.toLowerCase().replace(/[\s-]/g, '_');
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    if (rows.length <= 1) return; // Skip empty sheets
    
    const mappedKey = sheetMappings[normalizedName];
    
    if (mappedKey === 'investment') {
      result.investment = parseInvestmentSheet(rows);
      sheetsProcessed++;
    } else if (mappedKey === 'buildVsBuy') {
      result.buildVsBuy = parseBuildVsBuySheet(rows);
      sheetsProcessed++;
    } else if (mappedKey === 'internalVsExternal') {
      result.internalVsExternal = parseInternalVsExternalSheet(rows);
      sheetsProcessed++;
    } else if (mappedKey === 'hireVsAutomate') {
      result.hireVsAutomate = parseHireVsAutomateSheet(rows);
      sheetsProcessed++;
    } else if (mappedKey === 'costCutVsInvest') {
      result.costCutVsInvest = parseCostCutVsInvestSheet(rows);
      sheetsProcessed++;
    } else if (mappedKey === 'capitalAllocation') {
      result.capitalAllocation = parseCapitalAllocationSheet(rows);
      sheetsProcessed++;
    } else if (mappedKey === 'risks') {
      result.risks = parseRiskSheet(rows);
      sheetsProcessed++;
    } else if (mappedKey === 'auditTrail') {
      result.auditTrail = parseDecisionAuditSheet(rows);
      sheetsProcessed++;
    }
  });
  
  if (sheetsProcessed === 0) {
    throw new Error('No valid sheets found. Please check sheet names.');
  }

  return result;
};

/** Parse from File (e.g. CFO Decision upload modal). */
export const parseCFODecisionFile = async (file: File): Promise<CFODecisionUploadedData> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  return parseCFODecisionFromWorkbook(workbook);
};

// ============================================
// STORAGE FUNCTIONS
// ============================================

export const saveCFODecisionData = (data: CFODecisionUploadedData): void => {
  localStorage.setItem('cfo_decision_investment', JSON.stringify(data.investment));
  localStorage.setItem('cfo_decision_build_vs_buy', JSON.stringify(data.buildVsBuy));
  localStorage.setItem('cfo_decision_internal_vs_external', JSON.stringify(data.internalVsExternal));
  localStorage.setItem('cfo_decision_hire_vs_automate', JSON.stringify(data.hireVsAutomate));
  localStorage.setItem('cfo_decision_cost_cut_vs_invest', JSON.stringify(data.costCutVsInvest));
  localStorage.setItem('cfo_decision_capital_allocation', JSON.stringify(data.capitalAllocation));
  localStorage.setItem('cfo_decision_risks', JSON.stringify(data.risks));
  localStorage.setItem('cfo_decision_audit_trail', JSON.stringify(data.auditTrail));
  localStorage.setItem('cfo_decision_upload_date', data.uploadDate);
};

export const loadCFODecisionData = (): CFODecisionUploadedData | null => {
  try {
    const fromPipeline = localStorage.getItem('finreport_cfo_decisions');
    if (fromPipeline) {
      const data = JSON.parse(fromPipeline);
      if (data && typeof data === 'object' && (data.uploadDate != null || Array.isArray(data.investment))) return data as CFODecisionUploadedData;
    }
    const uploadDate = localStorage.getItem('cfo_decision_upload_date');
    if (!uploadDate) return null;
    return {
      investment: JSON.parse(localStorage.getItem('cfo_decision_investment') || '[]'),
      buildVsBuy: JSON.parse(localStorage.getItem('cfo_decision_build_vs_buy') || '[]'),
      internalVsExternal: JSON.parse(localStorage.getItem('cfo_decision_internal_vs_external') || '[]'),
      hireVsAutomate: JSON.parse(localStorage.getItem('cfo_decision_hire_vs_automate') || '[]'),
      costCutVsInvest: JSON.parse(localStorage.getItem('cfo_decision_cost_cut_vs_invest') || '[]'),
      capitalAllocation: JSON.parse(localStorage.getItem('cfo_decision_capital_allocation') || '[]'),
      risks: JSON.parse(localStorage.getItem('cfo_decision_risks') || '[]'),
      auditTrail: JSON.parse(localStorage.getItem('cfo_decision_audit_trail') || '[]'),
      uploadDate
    };
  } catch (error) {
    console.error('Error loading CFO decision data:', error);
    return null;
  }
};

export const clearCFODecisionData = (): void => {
  localStorage.removeItem('cfo_decision_investment');
  localStorage.removeItem('cfo_decision_build_vs_buy');
  localStorage.removeItem('cfo_decision_internal_vs_external');
  localStorage.removeItem('cfo_decision_hire_vs_automate');
  localStorage.removeItem('cfo_decision_cost_cut_vs_invest');
  localStorage.removeItem('cfo_decision_capital_allocation');
  localStorage.removeItem('cfo_decision_risks');
  localStorage.removeItem('cfo_decision_audit_trail');
  localStorage.removeItem('cfo_decision_upload_date');
};
