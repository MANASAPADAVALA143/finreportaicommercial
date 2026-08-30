import { useMemo } from 'react';
import { useMarket } from '@/contexts/MarketContext';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { formatCurrency, formatCompactCurrency, getCurrencySymbol } from '@/utils/currency';

/** Market-aware currency for AP / CFO dashboards (UAE → AED, India → INR). */
export function useDisplayCurrency() {
  const { isUAE, isIndia, config } = useMarket();
  const { baseCurrency: settingsCurrency } = useCompanySettings();

  // Market toggle wins — never show AED on India or INR on UAE.
  // Previously India deferred to settingsCurrency first, which meant a UAE
  // company (baseCurrency 'AED') leaked AED into every India-mode dashboard.
  const currency = useMemo(() => {
    if (isUAE) return 'AED';
    if (isIndia) return 'INR';
    const fromSettings = (settingsCurrency || '').toUpperCase();
    if (fromSettings === 'AED' || fromSettings === 'INR') return fromSettings;
    return config.currency || 'INR';
  }, [isUAE, isIndia, settingsCurrency, config.currency]);

  const symbol = useMemo(() => {
    if (isUAE) return 'AED';
    if (currency === 'INR') return '₹';
    return getCurrencySymbol(currency);
  }, [isUAE, currency]);

  const fmt = useMemo(
    () => (amount: number) => formatCurrency(amount, currency),
    [currency],
  );

  // Compact form for chart axes / dense KPI tiles: "AED 500K", "AED 1.5M", "₹34.0L".
  const fmtCompact = useMemo(
    () => (amount: number) => formatCompactCurrency(amount, currency),
    [currency],
  );

  return { currency, symbol, fmt, fmtCompact, isUAE, isIndia, config };
}
