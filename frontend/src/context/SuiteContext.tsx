import { createContext, useContext, useState } from 'react';

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
  };

  return (
    <SuiteContext.Provider value={{ activeSuite, setSuite }}>
      {children}
    </SuiteContext.Provider>
  );
}

export const useSuite = () => useContext(SuiteContext);
