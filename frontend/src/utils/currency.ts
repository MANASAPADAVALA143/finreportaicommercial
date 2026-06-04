/**
 * Parse amount from n8n/string - handles "46,846.00", "₹46,846", "$1,234.56"
 */
export function parseAmount(val: unknown): number {
  if (!val) return 0;
  const cleaned = String(val).replace(/[₹$,\s]/g, '').trim();
  return parseFloat(cleaned) || 0;
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'د.إ',
  SGD: 'S$',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
  SAR: '﷼',
  MYR: 'RM',
  ZAR: 'R',
  CHF: 'Fr',
  HKD: 'HK$',
  NZD: 'NZ$',
  NGN: '₦',
  KES: 'KSh',
  BRL: 'R$',
  MXN: 'MX$',
  PHP: '₱',
};

/**
 * Get currency symbol for display
 */
export function getCurrencySymbol(currency: string): string {
  const code = currency?.toUpperCase?.() ?? '';
  return CURRENCY_SYMBOLS[code] || currency || '';
}

/**
 * Format amount with symbol and locale-appropriate grouping
 */
export function formatCurrency(amount: number, currency: string = 'INR'): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] || `${currency} `;
  const n = Number(amount);
  if (Number.isNaN(n)) return `${symbol}0.00`;
  if (currency.toUpperCase() === 'INR') {
    return (
      symbol +
      n.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  return (
    symbol +
    n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
