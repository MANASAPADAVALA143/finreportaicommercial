import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { type Market, type MarketConfig, getMarketConfig } from '../lib/ap-invoice/marketConfig';
import { getMyCompany } from '../lib/ap-invoice/companyService';
import { supabase } from '../lib/ap-invoice/supabase';
import { getStoredWorkspaceId } from '../services/workspaceService';
import { markMarketAsUserChosen, pinIndiaSuiteMarket, pinUaeSuiteMarket } from '../config/productRole';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAuth } from '../context/AuthContext';
import { createWorkspace } from '../services/workspaceService';

interface MarketContextType {
  market: Market;
  config: MarketConfig;
  setMarket: (market: Market) => Promise<void>;
  isUAE: boolean;
  isIndia: boolean;
  reloadMarket: () => Promise<void>;
  /** True while setMarket is creating a brand-new workspace for a market that didn't exist yet. */
  creatingWorkspace: boolean;
}

const MarketContext = createContext<MarketContextType>({
  market: 'uae',
  config: getMarketConfig('uae'),
  setMarket: async () => {},
  isUAE: true,
  isIndia: false,
  reloadMarket: async () => {},
  creatingWorkspace: false,
});

/** Country codes each market's workspace.country is expected to use. */
const MARKET_COUNTRIES: Record<Market, string[]> = {
  uae: ['UAE', 'AE'],
  india: ['INDIA', 'IN'],
};

function workspaceMarket(country: string | undefined | null): Market | null {
  const c = (country ?? '').toUpperCase();
  if (MARKET_COUNTRIES.uae.includes(c)) return 'uae';
  if (MARKET_COUNTRIES.india.includes(c)) return 'india';
  return null;
}

const STORAGE_KEY = 'finreportai_ap_market';
const SUITE_STORAGE_KEY = 'gnanova_suite';

function persistMarketSelection(market: Market) {
  try {
    localStorage.setItem(STORAGE_KEY, market);
    localStorage.setItem(SUITE_STORAGE_KEY, market);
    window.dispatchEvent(new CustomEvent('finreportai-market-change', { detail: market }));
  } catch {
    /* ignore */
  }
}

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
  const { workspaces, activeWorkspace, switchWorkspace, refreshWorkspaces } = useWorkspace();
  const { accessToken } = useAuth();
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
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
          persistMarketSelection(savedMarket);
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
          const m = company.market as Market;
          setMarketState(m);
          persistMarketSelection(m);
          return;
        }
      }

      if (savedMarket) {
        setMarketState(savedMarket);
        persistMarketSelection(savedMarket);
      }
    } catch {
      // keep current selection
    }
  }, []);

  useEffect(() => {
    void loadMarket();
  }, [loadMarket]);

  // Keep the market label truthful to whichever workspace is actually active —
  // otherwise a stale localStorage value from a prior session could show
  // e.g. "UAE" chrome while the active workspace (and its data) is India.
  useEffect(() => {
    const m = workspaceMarket(activeWorkspace?.country);
    if (m && m !== market) {
      setMarketState(m);
      persistMarketSelection(m);
    }
  }, [activeWorkspace?.country]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onMarket = (e: Event) => {
      const m = (e as CustomEvent<string>).detail;
      if (m === 'uae' || m === 'india') setMarketState(m);
    };
    window.addEventListener('finreportai-market-change', onMarket);
    return () => window.removeEventListener('finreportai-market-change', onMarket);
  }, []);

  useEffect(() => {
    const onSynced = () => { void loadMarket(); };
    window.addEventListener('ap-company-synced', onSynced);
    return () => window.removeEventListener('ap-company-synced', onSynced);
  }, [loadMarket]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'uae' || saved === 'india') {
      persistMarketSelection(saved);
    }
  }, []);

  async function setMarket(newMarket: Market) {
    // force=true so toggling India↔UAE always wins over a prior choice
    if (newMarket === 'india') pinIndiaSuiteMarket(true);
    else pinUaeSuiteMarket(true);
    markMarketAsUserChosen();

    // The market toggle used to only relabel the screen (AED↔INR, VAT↔GST)
    // without changing which workspace's data was loaded — so switching to
    // "UAE" on an India-only account kept showing the same India invoices
    // under UAE labels. Route the toggle through the actual workspace that
    // owns each market instead, creating one on first use if it doesn't exist.
    const targetWorkspace = workspaces.find((w) => workspaceMarket(w.country) === newMarket);

    if (targetWorkspace) {
      if (activeWorkspace?.id !== targetWorkspace.id) {
        switchWorkspace(targetWorkspace); // reloads the page onto the correct workspace
        return;
      }
    } else if (accessToken) {
      setCreatingWorkspace(true);
      try {
        const base = activeWorkspace?.legal_entity_name || activeWorkspace?.name || 'My Company';
        const created = await createWorkspace(accessToken, {
          name: `${base} (${newMarket === 'uae' ? 'UAE' : 'India'})`,
          legal_entity_name: base,
          country: newMarket === 'uae' ? 'UAE' : 'India',
          currency: newMarket === 'uae' ? 'AED' : 'INR',
        });
        await refreshWorkspaces();
        switchWorkspace(created); // reloads the page onto the new workspace
        return;
      } catch (e) {
        console.error('[Market] failed to create workspace for', newMarket, e);
      } finally {
        setCreatingWorkspace(false);
      }
    }

    setMarketState(newMarket);
    persistMarketSelection(newMarket);
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
        creatingWorkspace,
      }}
    >
      {children}
    </MarketContext.Provider>
  );
}

export const useMarket = () => useContext(MarketContext);
