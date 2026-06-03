import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSuite, type Suite } from '../context/SuiteContext';

const ROUTE_TO_SUITE: Array<[string, Suite]> = [
  ['/india-full',    'india'],
  ['/ca-firm',       'india'],
  ['/erp/tally',     'india'],
  ['/uae-full',      'uae'],
  ['/uae-accounting','uae'],
  ['/ap-invoices',   'uae'],
  ['/ifrs',          'uae'],
  ['/audit',         'uae'],
  ['/r2r',           'fpa'],
  ['/r2r-pattern',   'fpa'],
  ['/fpa',           'fpa'],
  ['/cfo',           'fpa'],
  ['/reports',       'fpa'],
  ['/tb-variance',   'fpa'],
  ['/bank-recon',    'fpa'],
  ['/close',         'fpa'],
];

export function useAutoSuiteSwitcher() {
  const location = useLocation();
  const { setSuite } = useSuite();

  useEffect(() => {
    for (const [prefix, suite] of ROUTE_TO_SUITE) {
      if (location.pathname.startsWith(prefix)) {
        setSuite(suite);
        break;
      }
    }
  }, [location.pathname, setSuite]);
}
