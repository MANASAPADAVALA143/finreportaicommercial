import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, type Invoice } from '@/lib/ap-invoice/supabase';
import { getMyCompany } from '@/lib/ap-invoice/companyService';

/** Maximum rows the list-invoices API returns; reaching it means older invoices are not loaded. */
export const DASHBOARD_INVOICE_LIMIT = 2000;

type State = {
  invoices: Invoice[];
  companyId: string | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  loadedAt: Date | null;
  /** True when the row limit was reached, so totals may exclude the oldest invoices. */
  truncated: boolean;
};

/** Loads the active company's AP invoices once; every dashboard tab derives from this list. */
export function useApDashboardData(activeCompanyId: string | null) {
  const [state, setState] = useState<State>({
    invoices: [],
    companyId: null,
    loading: true,
    refreshing: false,
    error: null,
    loadedAt: null,
    truncated: false,
  });
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setState((s) => ({ ...s, loading: s.loadedAt == null, refreshing: s.loadedAt != null, error: null }));
    try {
      const companyId = activeCompanyId || (await getMyCompany())?.id || null;
      let invoices: Invoice[] = [];
      if (companyId) {
        try {
          const { listInvoicesViaApi } = await import('@/lib/ap-invoice/listInvoicesService');
          invoices = await listInvoicesViaApi(companyId, DASHBOARD_INVOICE_LIMIT);
        } catch (apiErr) {
          console.warn('[AP Dashboard] list-invoices API failed, falling back to Supabase:', apiErr);
          const res = await supabase
            .from('invoices')
            .select('*')
            .eq('company_id', companyId)
            .order('created_at', { ascending: false })
            .limit(DASHBOARD_INVOICE_LIMIT);
          if (res.error) throw res.error;
          invoices = (res.data || []) as Invoice[];
        }
      }
      if (id !== requestId.current) return;
      setState({
        invoices,
        companyId,
        loading: false,
        refreshing: false,
        error: null,
        loadedAt: new Date(),
        truncated: invoices.length >= DASHBOARD_INVOICE_LIMIT,
      });
    } catch (err) {
      console.error('[AP Dashboard] failed to load invoices:', err);
      if (id !== requestId.current) return;
      setState((s) => ({
        ...s,
        loading: false,
        refreshing: false,
        error: 'We could not load invoices for this organization. Check your connection and try again.',
      }));
    }
  }, [activeCompanyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}
