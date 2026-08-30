/**
 * Parse amount from n8n/string - handles "46,846.00", "â‚¹46,846", "$1,234.56"
 */
export function parseAmount(val: unknown): number {
  if (!val) return 0;
  const cleaned = String(val).replace(/[₹$د.إAED,\s]/gi, '').trim();
  return parseFloat(cleaned) || 0;
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'AED ',
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
 * Compact form for chart axes / KPI tiles: "AED 0", "AED 500K", "AED 1.5M".
 * INR keeps the Lakh convention (₹34.0L) since that's the standard there.
 */
export function formatCompactCurrency(amount: number, currency: string = 'INR'): string {
  const code = currency.toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code] || `${currency} `;
  const n = Number(amount) || 0;
  if (code === 'INR') {
    if (Math.abs(n) >= 100_000) return `${symbol}${(n / 100_000).toFixed(1)}L`;
    return `${symbol}${Math.round(n).toLocaleString('en-IN')}`;
  }
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${symbol}${(n / 1_000).toFixed(0)}K`;
  return `${symbol}${Math.round(n).toLocaleString('en-US')}`;
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

