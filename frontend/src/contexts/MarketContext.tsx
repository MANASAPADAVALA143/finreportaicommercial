import { createContext, useContext, useState, type ReactNode } from 'react';
import { type Market, type MarketConfig, getMarketConfig } from '../lib/ap-invoice/marketConfig';

interface MarketContextType {
  market: Market;
  config: MarketConfig;
  setMarket: (market: Market) => Promise<void>;
  isUAE: boolean;
  isIndia: boolean;
}

const MarketContext = createContext<MarketContextType>({
  market: 'india',
  config: getMarketConfig('india'),
  setMarket: async () => {},
  isUAE: false,
  isIndia: true,
});

const STORAGE_KEY = 'finreportai_ap_market';

export function MarketProvider({ children }: { children: ReactNode }) {
  const [market, setMarketState] = useState<Market>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return (saved === 'uae' || saved === 'india') ? saved as Market : 'uae';
    } catch { return 'uae'; }
  });

  async function setMarket(newMarket: Market) {
    setMarketState(newMarket);
    try { localStorage.setItem(STORAGE_KEY, newMarket); } catch {}
    // Optionally sync to AP Supabase
    try {
      const { apSupabase } = await import('../lib/apSupabase');
      const { data: { user } } = await apSupabase.auth.getUser();
      if (user) {
        const { data: profile } = await apSupabase.from('profiles').select('company_id').eq('id', user.id).single();
        if (profile?.company_id) {
          await apSupabase.from('companies').update({ market: newMarket }).eq('id', profile.company_id);
        }
      }
    } catch {}
  }

  return (
    <MarketContext.Provider
      value={{
        market,
        config: getMarketConfig(market),
        setMarket,
        isUAE: market === 'uae',
        isIndia: market === 'india',
      }}
    >
      {children}
    </MarketContext.Provider>
  );
}

export const useMarket = () => useContext(MarketContext);

