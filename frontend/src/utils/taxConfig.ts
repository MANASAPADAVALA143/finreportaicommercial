export interface TaxType {
  code: string;
  label: string;
  countries: string[];
  components?: { name: string; rate: number }[];
}

export const TAX_TYPES: TaxType[] = [
  { code: 'NONE', label: 'No Tax / Tax Exempt', countries: ['ALL'] },
  {
    code: 'GST_IGST',
    label: 'GST — IGST (Interstate)',
    countries: ['IN'],
    components: [{ name: 'IGST', rate: 18 }],
  },
  {
    code: 'GST_CGST_SGST',
    label: 'GST — CGST + SGST (Intrastate)',
    countries: ['IN'],
    components: [
      { name: 'CGST', rate: 9 },
      { name: 'SGST', rate: 9 },
    ],
  },
  {
    code: 'GST_5',
    label: 'GST 5% (Essential goods)',
    countries: ['IN'],
    components: [{ name: 'GST', rate: 5 }],
  },
  {
    code: 'VAT_20',
    label: 'VAT 20% (UK / Europe standard)',
    countries: ['GB', 'EU'],
    components: [{ name: 'VAT', rate: 20 }],
  },
  {
    code: 'VAT_5',
    label: 'VAT 5% (UAE)',
    countries: ['AE'],
    components: [{ name: 'VAT', rate: 5 }],
  },
  {
    code: 'VAT_9',
    label: 'GST 9% (Singapore)',
    countries: ['SG'],
    components: [{ name: 'GST', rate: 9 }],
  },
  {
    code: 'SALES_TAX',
    label: 'Sales Tax (USA — rate varies by state)',
    countries: ['US'],
    components: [{ name: 'Sales Tax', rate: 0 }],
  },
  {
    code: 'WITHHOLDING',
    label: 'Withholding Tax / TDS',
    countries: ['IN', 'MY', 'PH'],
    components: [{ name: 'TDS/WHT', rate: 10 }],
  },
  { code: 'CUSTOM', label: 'Custom Tax Rate', countries: ['ALL'] },
];

export function getTaxLabel(code: string): string {
  return TAX_TYPES.find((t) => t.code === code)?.label || code;
}

export type TaxBreakdownLine = { name: string; rate: number; amount: number };

export function calculateTax(
  subtotal: number,
  taxCode: string,
  customRate?: number
): { taxAmount: number; total: number; breakdown: TaxBreakdownLine[] } {
  const taxType = TAX_TYPES.find((t) => t.code === taxCode);
  if (!taxType || taxCode === 'NONE') {
    return { taxAmount: 0, total: subtotal, breakdown: [] };
  }

  if (taxCode === 'GST_CGST_SGST') {
    const totalPct =
      customRate != null && customRate > 0 ? customRate : (taxType.components?.reduce((s, c) => s + c.rate, 0) ?? 18);
    const half = totalPct / 2;
    const breakdown: TaxBreakdownLine[] = [
      { name: 'CGST', rate: half, amount: subtotal * (half / 100) },
      { name: 'SGST', rate: half, amount: subtotal * (half / 100) },
    ];
    const taxAmount = breakdown.reduce((s, c) => s + c.amount, 0);
    return { taxAmount, total: subtotal + taxAmount, breakdown };
  }

  const components = taxType.components || [];
  const useCustom = ['SALES_TAX', 'CUSTOM', 'WITHHOLDING'].includes(taxCode);
  const breakdown: TaxBreakdownLine[] = components.map((c) => {
    const rate = useCustom && customRate != null && customRate >= 0 ? customRate : c.rate;
    return { name: c.name, rate, amount: subtotal * (rate / 100) };
  });
  const taxAmount = breakdown.reduce((s, c) => s + c.amount, 0);
  return { taxAmount, total: subtotal + taxAmount, breakdown };
}
