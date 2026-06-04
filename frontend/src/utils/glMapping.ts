/**
 * IFRS category to GL account mapping for auto-suggestion.
 */

export type GLSuggest = {
  code: string;
  name: string;
  type: string;
};

export const IFRS_TO_GL: Record<string, GLSuggest> = {
  'Professional Services': { code: '6100', name: 'Professional Fees', type: 'Expense' },
  'IT Infrastructure': { code: '1500', name: 'Fixed Assets â€” IT', type: 'Asset' },
  'IT Equipment': { code: '1500', name: 'Fixed Assets â€” IT', type: 'Asset' },
  'Office Supplies': { code: '6050', name: 'Office & Admin Expenses', type: 'Expense' },
  'Utilities': { code: '6300', name: 'Utilities Expense', type: 'Expense' },
  'Marketing': { code: '6400', name: 'Marketing & Advertising', type: 'Expense' },
  'Marketing & Advertising': { code: '6400', name: 'Marketing & Advertising', type: 'Expense' },
  'Rent & Lease': { code: '6500', name: 'Rent & Lease Expense', type: 'Expense' },
  'Travel & Entertainment': { code: '6600', name: 'Travel & Entertainment', type: 'Expense' },
  'Industrial Supplies': { code: '6050', name: 'Supply & Materials', type: 'Expense' },
};

export function suggestGL(ifrsCategory: string | null | undefined): GLSuggest | null {
  if (!ifrsCategory || !String(ifrsCategory).trim()) return null;
  return IFRS_TO_GL[ifrsCategory.trim()] ?? null;
}

