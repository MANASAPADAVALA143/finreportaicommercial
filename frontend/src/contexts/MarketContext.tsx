import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { type Market, type MarketConfig, getMarketConfig } from '../lib/ap-invoice/marketConfig';
import { getMyCompany } from '../lib/ap-invoice/companyService';
import { supabase } from '../lib/ap-invoice/supabase';
import { getStoredWorkspaceId } from '../services/workspaceService';

interface MarketContextType {
  market: Market;
  config: MarketConfig;
  setMarket: (market: Market) => Promise<void>;
  isUAE: boolean;
  isIndia: boolean;
  reloadMarket: () => Promise<void>;
}

const MarketContext = createContext<MarketContextType>({
  market: 'uae',
  config: getMarketConfig('uae'),
  setMarket: async () => {},
  isUAE: true,
  isIndia: false,
  reloadMarket: async () => {},
});

const STORAGE_KEY = 'finreportai_ap_market';

async function resolveCompanyIdForMarket(): Promise<string | null> {
  const wsId = getStoredWorkspaceId();
  if (wsId) {
    const { data } = await supabase
      .from('companies')
      .select('id')
      .eq('workspace_id', wsId)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  const company = await getMyCompany();
  return company?.id ?? null;
}

export function MarketProvider({ children }: { children: ReactNode }) {
  const [market, setMarketState] = useState<Market>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'uae' || saved === 'india' ? (saved as Market) : 'uae';
    } catch {
      return 'uae';
    }
  });

  const loadMarket = useCallback(async () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const savedMarket =
        saved === 'uae' || saved === 'india' ? (saved as Market) : null;

      const companyId = await resolveCompanyIdForMarket();
      if (companyId) {
        const { data: company } = await supabase
          .from('companies')
          .select('market')
          .eq('id', companyId)
          .maybeSingle();

        if (savedMarket) {
          setMarketState(savedMarket);
          if (company?.market !== savedMarket) {
            await supabase
              .from('companies')
              .update({ market: savedMarket })
              .eq('id', companyId)
              .then(() => null, () => null);
          }
          return;
        }

        if (company?.market === 'uae' || company?.market === 'india') {
          setMarketState(company.market as Market);
          localStorage.setItem(STORAGE_KEY, company.market);
          return;
        }
      }

      if (savedMarket) {
        setMarketState(savedMarket);
      }
    } catch {
      // keep current selection
    }
  }, []);

  useEffect(() => {
    void loadMarket();
  }, [loadMarket]);

  useEffect(() => {
    const onSynced = () => { void loadMarket(); };
    window.addEventListener('ap-company-synced', onSynced);
    return () => window.removeEventListener('ap-company-synced', onSynced);
  }, [loadMarket]);

  async function setMarket(newMarket: Market) {
    setMarketState(newMarket);
    try {
      localStorage.setItem(STORAGE_KEY, newMarket);
    } catch {
      /* ignore */
    }
    try {
      const companyId = await resolveCompanyIdForMarket();
      if (!companyId) return;
      const { error } = await supabase
        .from('companies')
        .update({ market: newMarket })
        .eq('id', companyId);
      if (error) console.warn('[Market] companies.market update:', error.message);
    } catch (e) {
      console.warn('[Market] setMarket failed:', e);
    }
  }

  return (
    <MarketContext.Provider
      value={{
        market,
        config: getMarketConfig(market),
        setMarket,
        isUAE: market === 'uae',
        isIndia: market === 'india',
        reloadMarket: loadMarket,
      }}
    >
      {children}
    </MarketContext.Provider>
  );
}

export const useMarket = () => useContext(MarketContext);
