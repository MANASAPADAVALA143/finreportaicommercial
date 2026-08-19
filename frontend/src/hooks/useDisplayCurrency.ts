import { useMemo } from 'react';
import { useMarket } from '@/contexts/MarketContext';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { formatCurrency, getCurrencySymbol } from '@/utils/currency';

/** Market-aware currency for AP / CFO dashboards (UAE → AED, India → INR). */
export function useDisplayCurrency() {
  const { isUAE, isIndia, config } = useMarket();
  const { baseCurrency: settingsCurrency } = useCompanySettings();

  // The market toggle decides the suite's currency for both regions —
  // it must not be overridden by the active company's stored baseCurrency.
  // Previously India deferred to settingsCurrency first, which meant a UAE
  // company (baseCurrency 'AED', the only kind currently creatable) leaked
  // AED into every India-mode dashboard, since there's no India company
  // option in the setup wizard yet.
  const currency = useMemo(
    () => (isUAE ? 'AED' : config.currency || settingsCurrency || 'INR'),
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
