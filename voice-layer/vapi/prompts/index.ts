// Prompt registry — import paths for all agent prompts
// Prompts live in .md files (source of truth for Vapi dashboard)
// This file exports the variable key names for type safety

export const NOVA_VARIABLE_KEYS = [
  'PROSPECT_NAME',
  'COMPANY_NAME',
  'PROSPECT_ROLE',
  'KNOWN_PAIN',
  'INVOICE_VOLUME',
  'REVENUE_RANGE',
  'SOURCE',
] as const

export const ATLAS_VARIABLE_KEYS = [
  'FIRM_NAME',
  'ATTORNEY_NAMES',
  'EMERGENCY_NUMBER',
  'CAL_AVAILABILITY',
  'BUSINESS_HOURS',
] as const

export const CIPHER_VARIABLE_KEYS = [
  'FIRM_NAME',
  'TURNAROUND_TIME',
] as const

export type NovaVariable = typeof NOVA_VARIABLE_KEYS[number]
export type AtlasVariable = typeof ATLAS_VARIABLE_KEYS[number]
export type CipherVariable = typeof CIPHER_VARIABLE_KEYS[number]

// Type-safe variable injection helper
export function buildNovaVariables(data: {
  prospectName: string
  companyName: string
  role: string
  painArea: string
  invoiceVolume: string
  revenueRange: string
  source?: 'web_form' | 'outbound'
}): Record<NovaVariable, string> {
  return {
    PROSPECT_NAME:  data.prospectName,
    COMPANY_NAME:   data.companyName,
    PROSPECT_ROLE:  data.role,
    KNOWN_PAIN:     data.painArea,
    INVOICE_VOLUME: data.invoiceVolume,
    REVENUE_RANGE:  data.revenueRange,
    SOURCE:         data.source ?? 'outbound',
  }
}
