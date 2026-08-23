import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSuite, type Suite } from '../context/SuiteContext';

/**
 * Route → suite mapping.
 * `/ap-invoices` is shared by India (GST/INR) and UAE (VAT/AED) — do NOT force UAE.
 * Market toggle / localStorage (`finreportai_ap_market`) owns AP market.
 */
const ROUTE_TO_SUITE: Array<[string, Suite]> = [
  ['/india-full',    'india'],
  ['/ca-firm',       'india'],
  ['/erp/tally',     'india'],
  ['/dashboard',     'uae'],
  ['/uae-suite',     'uae'],
  ['/uae-full',      'uae'],
  ['/uae-accounting','uae'],
  ['/gulftax',       'uae'],
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

function marketFromStorage(): Suite | null {
  try {
    const m = localStorage.getItem('finreportai_ap_market');
    if (m === 'india' || m === 'uae') return m;
    const s = localStorage.getItem('gnanova_suite');
    if (s === 'india' || s === 'uae') return s;
  } catch {
    /* ignore */
  }
  return null;
}

export function useAutoSuiteSwitcher() {
  const location = useLocation();
  const { setSuite } = useSuite();

  useEffect(() => {
    const path = location.pathname;

    // Shared AP InvoiceFlow: keep India/UAE from the market toggle
    if (path === '/ap-invoices' || path.startsWith('/ap-invoices/')) {
      const market = marketFromStorage();
      if (market) setSuite(market);
      return;
    }

    for (const [prefix, suite] of ROUTE_TO_SUITE) {
      if (path.startsWith(prefix)) {
        setSuite(suite);
        break;
      }
    }
  }, [location.pathname, setSuite]);
}
