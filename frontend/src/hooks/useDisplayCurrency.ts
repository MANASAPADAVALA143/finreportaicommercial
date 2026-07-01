import { useMemo } from 'react';
import { useMarket } from '@/contexts/MarketContext';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { formatCurrency, getCurrencySymbol } from '@/utils/currency';

/** Market-aware currency for AP / CFO dashboards (UAE → AED, India → INR). */
export function useDisplayCurrency() {
  const { isUAE, isIndia, config } = useMarket();
  const { baseCurrency: settingsCurrency } = useCompanySettings();

  const currency = useMemo(
    () => (isUAE ? 'AED' : settingsCurrency || config.currency || 'INR'),
    [isUAE, settingsCurrency, config.currency],
  );

  const symbol = useMemo(() => {
    if (isUAE) return 'د.إ';
    return getCurrencySymbol(currency);
  }, [isUAE, currency]);

  const fmt = useMemo(
    () => (amount: number) => formatCurrency(amount, currency),
    [currency],
  );

  const fmtCompact = useMemo(
    () => (amount: number) => {
      if (currency === 'INR' && amount >= 100_000) {
        return `₹${(amount / 100_000).toFixed(1)}L`;
      }
      return formatCurrency(amount, currency);
    },
    [currency],
  );

  return { currency, symbol, fmt, fmtCompact, isUAE, isIndia, config };
}
