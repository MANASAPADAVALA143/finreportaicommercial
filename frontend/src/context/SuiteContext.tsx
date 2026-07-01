import { createContext, useContext, useEffect, useState } from 'react';

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

  const setSuite = (suite: Suite) => {
    setActiveSuite(suite);
    localStorage.setItem('gnanova_suite', suite);
    if (suite === 'uae' || suite === 'india') {
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
