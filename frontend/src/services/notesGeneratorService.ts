/**
 * IFRS Notes Generator Service
 * Generates note content from financial data; uses AI when available, else template.
 */

import { callAI } from './aiProvider';

export interface CompanyInfo {
  name: string;
  period?: string;
  periodEnd?: string;
  currency?: string;
  industry?: string;
  country?: string;
}

export async function generateNoteContent(
  noteType: string,
  financialData: Record<string, unknown>,
  companyInfo: CompanyInfo
): Promise<string> {
  const period = companyInfo.period ?? companyInfo.periodEnd ?? 'current period';
  const prompt = `You are an IFRS expert preparing notes to financial statements.

Company: ${companyInfo.name}
Period: ${period}
Currency: ${companyInfo.currency ?? 'USD'}
Industry: ${companyInfo.industry ?? 'General'}
Financial Data (summary): ${JSON.stringify(financialData, null, 2).slice(0, 2000)}

Generate the following note for the annual report: ${noteType}

Requirements:
- Professional language suitable for audited financial statements
- Reference specific IFRS standards where relevant (IFRS 15, IAS 16, etc.)
- Use actual numbers from the financial data when provided
- Format as a proper accounting note (paragraphs, no markdown)
- Keep concise but complete (2-6 paragraphs)

Output only the note content text, no headers or "Note X" title.`;

  try {
    const response = await callAI(prompt, { maxTokens: 1500, temperature: 0.3 });
    return response?.trim() || getFallbackNoteContent(noteType, companyInfo, financialData);
  } catch {
    return getFallbackNoteContent(noteType, companyInfo, financialData);
  }
}

function getFallbackNoteContent(
  noteType: string,
  company: CompanyInfo,
  data: Record<string, unknown>
): string {
  const name = company.name || 'The Company';
  const period = company.period ?? company.periodEnd ?? 'the reporting period';
  const currency = company.currency ?? 'USD';

  const fallbacks: Record<string, string> = {
    'general-information': `${name} is a company incorporated and operating in its jurisdiction. The registered office and principal place of business are as disclosed in the company records. These financial statements are prepared for the ${period} and are presented in ${currency}, the functional currency of the entity.`,
    'accounting-policies': `The financial statements have been prepared in accordance with International Financial Reporting Standards (IFRS) as issued by the IASB. The financial statements are prepared on the historical cost basis except for certain financial instruments and defined benefit assets and liabilities which are measured at fair value. Revenue is recognised when control of goods or services is transferred to the customer. Property, plant and equipment is stated at cost less accumulated depreciation and impairment.`,
    'revenue-recognition': `Revenue is recognised when (or as) the entity satisfies a performance obligation by transferring a promised good or service to a customer (IFRS 15). Revenue is measured at the amount of consideration to which the entity expects to be entitled. Revenue from the sale of goods is recognised at the point in time when control is transferred. Revenue from services is recognised over time.`,
    'property-plant-equipment': `Property, plant and equipment is stated at cost less accumulated depreciation and any accumulated impairment losses. Depreciation is calculated to write off the cost less residual value of each asset over its useful life. The carrying amounts and movements for the ${period} are as shown in the statement of financial position.`,
    'leases': `The Group applies IFRS 16 Leases. At the commencement date, the Group recognises a right-of-use asset and a lease liability. The right-of-use asset is depreciated over the shorter of the lease term and the useful life of the underlying asset. The lease liability is measured at the present value of remaining lease payments, discounted at the incremental borrowing rate.`,
    'income-tax': `Income tax expense comprises current and deferred tax. Current tax is the expected tax payable on taxable profit for the period. Deferred tax is recognised in respect of temporary differences between the carrying amounts of assets and liabilities and their tax bases. The effective tax rate is reconciled to the applicable statutory rate.`,
    'inventories': `Inventories are stated at the lower of cost and net realisable value. Cost is determined using the first-in, first-out (FIFO) or weighted average method. Net realisable value is the estimated selling price less costs to complete and sell.`,
    'related-party': `Related party transactions are disclosed in accordance with IAS 24. Transactions with related parties are made on terms equivalent to those that prevail in arm's length transactions. Key management compensation is disclosed in the remuneration report.`,
    'subsequent-events': `Events after the reporting period are considered up to the date when the financial statements are authorised for issue. Adjusting events are reflected in the financial statements. Non-adjusting events are disclosed where material.`,
    'financial-instruments': `Financial assets and liabilities are recognised when the entity becomes a party to the contractual provisions. They are initially measured at fair value. Classification and subsequent measurement follow IFRS 9.`,
  };

  const key = noteType.toLowerCase().replace(/\s+/g, '-');
  for (const [k, v] of Object.entries(fallbacks)) {
    if (key.includes(k) || noteType.toLowerCase().includes(k)) return v;
  }
  return `This note provides additional information in respect of ${noteType} for ${name} for the ${period}. The amounts disclosed are consistent with the financial statements and supporting records.`;
}

const NOTE_TYPE_TO_SERVICE_KEY: Record<string, string> = {
  'note-1-general': 'general-information',
  'note-2-policies': 'accounting-policies',
  'note-3-revenue': 'revenue-recognition',
  'note-4-ppe': 'property-plant-equipment',
  'note-5-leases': 'leases',
  'note-6-instruments': 'financial-instruments',
  'note-7-inventory': 'inventories',
  'note-8-tax': 'income-tax',
  'note-9-related': 'related-party',
  'note-10-events': 'subsequent-events',
};

export function getNoteTypeForGeneration(sectionId: string): string {
  return NOTE_TYPE_TO_SERVICE_KEY[sectionId] ?? sectionId;
}
