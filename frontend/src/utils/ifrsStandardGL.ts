/** Legacy IFRS category â†’ default GL (used as fallback when templates do not match). */
export const IFRS_STANDARD_GL: Record<string, { code: string; name: string }> = {
  'Professional Services': { code: '6100', name: 'Professional Fees' },
  'IT Infrastructure': { code: '1500', name: 'Fixed Assets IT' },
  'IT Equipment': { code: '1500', name: 'Fixed Assets IT' },
  'Office Supplies': { code: '6050', name: 'Office Expenses' },
  Utilities: { code: '6300', name: 'Utilities Expense' },
  Marketing: { code: '6400', name: 'Marketing & Ads' },
  'Marketing & Advertising': { code: '6400', name: 'Marketing & Ads' },
  'Rent & Lease': { code: '6500', name: 'Rent Expense' },
  'Travel & Entertainment': { code: '6600', name: 'Travel Expenses' },
  'Industrial Supplies': { code: '6050', name: 'Supply & Materials' },
};

