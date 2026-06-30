/**
 * Parse amount from n8n/string - handles "46,846.00", "â‚¹46,846", "$1,234.56"
 */
export function parseAmount(val: unknown): number {
  if (!val) return 0;
  const cleaned = String(val).replace(/[â‚¹$,\s]/g, '').trim();
  return parseFloat(cleaned) || 0;
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: 'â‚¹',
  USD: '$',
  EUR: 'â‚¬',
  GBP: 'Â£',
  AED: 'AED ',
  SGD: 'S$',
  JPY: 'Â¥',
  AUD: 'A$',
  CAD: 'C$',
  SAR: 'ï·¼',
  MYR: 'RM',
  ZAR: 'R',
  CHF: 'Fr',
  HKD: 'HK$',
  NZD: 'NZ$',
  NGN: 'â‚¦',
  KES: 'KSh',
  BRL: 'R$',
  MXN: 'MX$',
  PHP: 'â‚±',
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

