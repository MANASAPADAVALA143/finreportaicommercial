import { createContext, useContext, useEffect, useState } from 'react';
import { isMarketUserChosen } from '../config/productRole';

export type Suite = 'india' | 'uae' | 'fpa';

interface SuiteContextType {
  activeSuite: Suite;
  setSuite: (suite: Suite) => void;
}

const SuiteContext = createContext<SuiteContextType>({
  activeSuite: 'uae',
  setSuite: () => {},
});

export function SuiteProvider({ children }: { children: React.ReactNode }) {
  const [activeSuite, setActiveSuite] = useState<Suite>(() => {
    return (localStorage.getItem('gnanova_suite') as Suite) || 'uae';
  });

  /**
   * Route auto-switcher and suite picker update the sidebar suite only.
   * Do NOT overwrite finreportai_ap_market here — that key is owned by the
   * India/UAE market toggle. Writing it from /dashboard → uae was why admin
   * login always snapped AP back to AED after picking India.
   */
  const setSuite = (suite: Suite) => {
    setActiveSuite(suite);
    localStorage.setItem('gnanova_suite', suite);
    // Only sync AP market when the user has not explicitly chosen India/UAE,
    // and only for india/uae suites (not fpa).
    if ((suite === 'uae' || suite === 'india') && !isMarketUserChosen()) {
      localStorage.setItem('finreportai_ap_market', suite);
      window.dispatchEvent(new CustomEvent('finreportai-market-change', { detail: suite }));
    }
  };

  useEffect(() => {
    const onMarket = (e: Event) => {
      const m = (e as CustomEvent<string>).detail;
      if (m === 'uae' || m === 'india') setActiveSuite(m);
    };
    window.addEventListener('finreportai-market-change', onMarket);
    return () => window.removeEventListener('finreportai-market-change', onMarket);
  }, []);

  return (
    <SuiteContext.Provider value={{ activeSuite, setSuite }}>
      {children}
    </SuiteContext.Provider>
  );
}

export const useSuite = () => useContext(SuiteContext);
