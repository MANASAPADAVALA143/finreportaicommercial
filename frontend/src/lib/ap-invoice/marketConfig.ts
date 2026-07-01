export type Market = 'india' | 'uae';

export interface MarketConfig {
  market: Market;
  currency: string;
  currencySymbol: string;
  taxLabel: string;
  taxIdLabel: string;
  taxIdPlaceholder: string;
  taxIdValidation: RegExp;
  taxRates: number[];
  filingLabel: string;
  stateLabel: string;
  accountingStandard: string;
}

export const INDIA_CONFIG: MarketConfig = {
  market: 'india',
  currency: 'INR',
  currencySymbol: '₹',
  taxLabel: 'GST',
  taxIdLabel: 'GSTIN',
  taxIdPlaceholder: '36AABCT1234M1Z5',
  taxIdValidation: /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/,
  taxRates: [0, 5, 12, 18, 28],
  filingLabel: 'GSTR-2B',
  stateLabel: 'State',
  accountingStandard: 'Ind AS',
};

export const UAE_CONFIG: MarketConfig = {
  market: 'uae',
  currency: 'AED',
  currencySymbol: 'د.إ',
  taxLabel: 'VAT',
  taxIdLabel: 'TRN',
  taxIdPlaceholder: '100234567890123',
  taxIdValidation: /^1\d{14}$/,
  taxRates: [0, 5],
  filingLabel: 'FTA VAT Return',
  stateLabel: 'Emirate',
  accountingStandard: 'IFRS',
};

export function getMarketConfig(market: Market): MarketConfig {
  return market === 'uae' ? UAE_CONFIG : INDIA_CONFIG;
}

export function validateTaxId(taxId: string, market: Market): boolean {
  const config = getMarketConfig(market);
  return config.taxIdValidation.test(taxId);
}

export const EMIRATES = [
  'Abu Dhabi',
  'Dubai',
  'Sharjah',
  'Ajman',
  'Ras Al Khaimah',
  'Fujairah',
  'Umm Al Quwain',
] as const;

export const VAT_TREATMENT_OPTIONS = [
  { value: 'standard', label: 'Standard Rated (5%)' },
  { value: 'zero', label: 'Zero Rated (0%)' },
  { value: 'exempt', label: 'Exempt' },
  { value: 'out_of_scope', label: 'Out of Scope' },
] as const;

export const UAE_FTA_QUARTERS = [
  { value: 'Q1-2025', label: 'Q1 2025 (Jan–Mar)' },
  { value: 'Q2-2025', label: 'Q2 2025 (Apr–Jun)' },
  { value: 'Q3-2025', label: 'Q3 2025 (Jul–Sep)' },
  { value: 'Q4-2025', label: 'Q4 2025 (Oct–Dec)' },
  { value: 'Q1-2026', label: 'Q1 2026 (Jan–Mar)' },
  { value: 'Q2-2026', label: 'Q2 2026 (Apr–Jun)' },
] as const;
