/**
 * Industry-specific invoice category definitions.
 * Used by AIDocumentScanner for classification and workflow routing.
 * No DB changes required — classification is a frontend layer on top of the shared AP engine.
 */
import type { IndustryKey } from '../../services/industryConfig.service';

export type InvoiceCategoryKey = string;

export type InvoiceCategory = {
  key: InvoiceCategoryKey;
  label: string;
  workflow: string;
  workflowLabel: string;
  icon: string;
  keywords: string[];
  isCapEx?: boolean;
};

export type IndustryInvoiceConfig = {
  industry: IndustryKey;
  industryLabel: string;
  apLabel: string;
  themeColor: string;
  categories: InvoiceCategory[];
};

export const MANUFACTURING_CATEGORIES: InvoiceCategory[] = [
  {
    key: 'raw_material',
    label: 'Raw Material',
    workflow: 'po_grn_match',
    workflowLabel: 'PO / GRN Matching',
    icon: 'package',
    keywords: ['steel', 'copper', 'aluminium', 'aluminum', 'plastic', 'rubber', 'chemical', 'resin', 'fabric', 'wire', 'rod', 'coil', 'sheet', 'raw material', 'raw mat', 'billet', 'ingot', 'pigment', 'dye'],
  },
  {
    key: 'machinery_capex',
    label: 'Machinery / CapEx',
    workflow: 'capex_review',
    workflowLabel: 'CapEx Classification → Asset Register',
    icon: 'settings',
    isCapEx: true,
    keywords: ['machine', 'machinery', 'equipment', 'plant', 'lathe', 'cnc', 'compressor', 'generator', 'boiler', 'crane', 'conveyor', 'robot', 'press', 'mould', 'mold', 'fixture', 'tooling', 'capex'],
  },
  {
    key: 'spare_parts',
    label: 'Spare Parts',
    workflow: 'inventory_maintenance',
    workflowLabel: 'Inventory / Maintenance Classification',
    icon: 'wrench',
    keywords: ['spare', 'spares', 'bearing', 'gear', 'seal', 'gasket', 'belt', 'filter', 'valve', 'pump', 'motor', 'sensor', 'circuit', 'maintenance part'],
  },
  {
    key: 'freight',
    label: 'Freight / Logistics',
    workflow: 'freight_allocation',
    workflowLabel: 'Freight Cost Allocation',
    icon: 'truck',
    keywords: ['freight', 'logistics', 'shipping', 'transport', 'courier', 'cargo', 'delivery charges', 'inward freight', 'outward freight', 'custom duty', 'clearing agent'],
  },
  {
    key: 'electricity_utility',
    label: 'Electricity / Utility',
    workflow: 'utility_expense',
    workflowLabel: 'Utility Expense Classification',
    icon: 'zap',
    keywords: ['electricity', 'electric', 'power', 'utility', 'water', 'gas', 'fuel', 'diesel', 'dewa', 'addc', 'sewa', 'fewa', 'mseb', 'bescom', 'wapco', 'energy'],
  },
  {
    key: 'packaging',
    label: 'Packaging Materials',
    workflow: 'packaging_recon',
    workflowLabel: 'Packaging Material Reconciliation',
    icon: 'box',
    keywords: ['packaging', 'carton', 'box', 'bag', 'pouch', 'label', 'wrapper', 'tape', 'pallet', 'shrink wrap', 'foil pack'],
  },
  {
    key: 'subcontracting',
    label: 'Subcontracting',
    workflow: 'production_cost',
    workflowLabel: 'Production / Service Cost Classification',
    icon: 'users',
    keywords: ['subcontract', 'job work', 'contract manufacturing', 'processing charge', 'conversion charge', 'outsource', 'third party manufacturing'],
  },
];

export const CONSTRUCTION_CATEGORIES: InvoiceCategory[] = [
  {
    key: 'contractor_ra_bill',
    label: 'Contractor RA Bill',
    workflow: 'ra_bill_verify',
    workflowLabel: 'Running Account Bill Verification',
    icon: 'file-check',
    keywords: ['ra bill', 'running account', 'running bill', 'interim certificate', 'progress certificate', 'work done certificate', 'contractor bill', 'running account bill'],
  },
  {
    key: 'cement',
    label: 'Cement / Concrete',
    workflow: 'material_receipt',
    workflowLabel: 'Material Receipt Matching',
    icon: 'layers',
    keywords: ['cement', 'concrete', 'opc', 'ppc', 'rcc', 'ready mix', 'readymix', 'rmc', 'mortar', 'grout'],
  },
  {
    key: 'steel',
    label: 'Steel / Rebar',
    workflow: 'quantity_rate_variance',
    workflowLabel: 'Quantity & Rate Variance Analysis',
    icon: 'anchor',
    keywords: ['steel', 'rebar', 'tmt bar', 'tmt', 'reinforcement', 'structural steel', 'ms pipe', 'channel', 'angle iron', 'h beam', 'i beam'],
  },
  {
    key: 'equipment_rental',
    label: 'Equipment Rental',
    workflow: 'project_allocation',
    workflowLabel: 'Project & Equipment Allocation',
    icon: 'truck',
    keywords: ['equipment hire', 'equipment rental', 'plant hire', 'crane hire', 'excavator', 'jcb', 'dozer', 'grader', 'machinery hire', 'scaffolding hire', 'tower crane'],
  },
  {
    key: 'subcontractor',
    label: 'Subcontractor',
    workflow: 'contract_milestone',
    workflowLabel: 'Contract & Milestone Verification',
    icon: 'users',
    keywords: ['subcontractor', 'sub-contractor', 'sub contractor', 'specialist contractor', 'mep contractor', 'civil contractor', 'masonry', 'plastering', 'tiling', 'flooring', 'painting contractor'],
  },
  {
    key: 'labour',
    label: 'Labour / Manpower',
    workflow: 'labour_cost',
    workflowLabel: 'Labour Cost Allocation',
    icon: 'hard-hat',
    keywords: ['labour', 'labor', 'manpower', 'workforce', 'worker', 'site worker', 'daily wage', 'skilled worker', 'unskilled', 'gang labour', 'contract labour'],
  },
  {
    key: 'consultant',
    label: 'Architect / Consultant',
    workflow: 'milestone_validation',
    workflowLabel: 'Milestone & Service Validation',
    icon: 'pen-tool',
    keywords: ['architect', 'consultant', 'engineering consultant', 'design fee', 'professional fee', 'project management', 'structural engineer', 'mep consultant', 'quantity surveyor', 'qs', 'supervision'],
  },
  {
    key: 'transport',
    label: 'Transport / Freight',
    workflow: 'freight_project',
    workflowLabel: 'Project-wise Freight Allocation',
    icon: 'truck',
    keywords: ['transport', 'trucking', 'haulage', 'delivery', 'vehicle hire', 'tipper', 'transit', 'site transport', 'material transport'],
  },
];

export const GENERAL_CATEGORIES: InvoiceCategory[] = [
  { key: 'general', label: 'General / Standard', workflow: 'standard_ap', workflowLabel: 'Standard AP Processing', icon: 'file-text', keywords: [] },
];

export const INDUSTRY_INVOICE_CONFIGS: Record<string, IndustryInvoiceConfig> = {
  manufacturing: {
    industry: 'manufacturing',
    industryLabel: 'Manufacturing',
    apLabel: 'Supplier Invoice',
    themeColor: '#1E40AF',
    categories: MANUFACTURING_CATEGORIES,
  },
  construction: {
    industry: 'construction',
    industryLabel: 'Construction',
    apLabel: 'Contractor / Supplier Invoice',
    themeColor: '#B45309',
    categories: CONSTRUCTION_CATEGORIES,
  },
  general: {
    industry: 'general',
    industryLabel: 'General Finance',
    apLabel: 'Invoice',
    themeColor: '#0A4B8F',
    categories: GENERAL_CATEGORIES,
  },
};

/**
 * Keyword-based client-side classifier.
 * Returns the best-matching category key for a given industry.
 * User can always override.
 */
export function classifyInvoice(
  industryKey: string,
  vendorName: string,
  lineItemDescriptions: string[],
  invoiceNumber?: string,
): InvoiceCategoryKey | null {
  const cfg = INDUSTRY_INVOICE_CONFIGS[industryKey];
  if (!cfg || cfg.categories.length === 0) return null;

  const haystack = [vendorName, invoiceNumber, ...lineItemDescriptions]
    .join(' ')
    .toLowerCase();

  let bestMatch: InvoiceCategory | null = null;
  let bestScore = 0;

  for (const cat of cfg.categories) {
    if (cat.keywords.length === 0) continue;
    let score = 0;
    for (const kw of cat.keywords) {
      if (haystack.includes(kw.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = cat;
    }
  }

  return bestMatch?.key ?? cfg.categories[0]?.key ?? null;
}

export function getCategoryForIndustry(industryKey: string, categoryKey: string): InvoiceCategory | undefined {
  const cfg = INDUSTRY_INVOICE_CONFIGS[industryKey];
  return cfg?.categories.find(c => c.key === categoryKey);
}

export function getCategoriesForIndustry(industryKey: string): InvoiceCategory[] {
  return INDUSTRY_INVOICE_CONFIGS[industryKey]?.categories ?? GENERAL_CATEGORIES;
}
