import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/ap-invoice/supabase';
import { getMyCompany } from '@/lib/ap-invoice/companyService';
import { backendOrigin } from '@/utils/backendOrigin';

export type CompanySettingsRow = {
  id: string;
  user_id: string | null;
  company_name: string | null;
  country: string | null;
  base_currency: string | null;
  accounting_standard: string | null;
  date_format: string | null;
  timezone: string | null;
  fy_start: string | null;
  company_type?: string | null;
  gst_registered?: string | null;
  tds_applicable?: string | null;
  export_zoho_enabled?: boolean | null;
  export_tally_enabled?: boolean | null;
  export_formats?: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULTS: Partial<CompanySettingsRow> = {
  country: 'IN',
  base_currency: 'INR',
  accounting_standard: 'IND_AS',
  date_format: 'DD-MM-YYYY',
  timezone: 'Asia/Kolkata',
  fy_start: '04-01',
};

export function useCompanySettings() {
  const [settings, setSettings] = useState<Partial<CompanySettingsRow>>({
    base_currency: 'INR',
    country: 'IN',
    accounting_standard: 'IND_AS',
    date_format: 'DD-MM-YYYY',
    timezone: 'Asia/Kolkata',
  });
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const cid = (await getMyCompany())?.id;
      const base = backendOrigin();
      if (base) {
        try {
          const qs = cid ? `?company_id=${encodeURIComponent(cid)}` : '';
          const res = await fetch(`${base}/api/ap/company-settings${qs}`);
          if (res.ok) {
            const data = (await res.json()) as Partial<CompanySettingsRow>;
            if (data && Object.keys(data).length > 0) {
              setSettings((prev) => ({ ...prev, ...data }));
              return;
            }
          }
        } catch {
          /* fall through to Supabase */
        }
      }

      let q = supabase.from('company_settings').select('*').order('updated_at', { ascending: false }).limit(1);
      if (cid) q = q.eq('company_id', cid);
      const { data, error } = await q.maybeSingle();
      if (error) {
        const msg = error.message ?? String(error);
        if (!msg.includes('schema cache') && !msg.includes('does not exist')) {
          console.warn('company_settings fetch:', msg);
        }
      } else if (data) {
        setSettings((prev) => ({ ...prev, ...data }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('schema cache') && !msg.includes('does not exist')) {
        console.warn('company_settings:', e);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    settings,
    loading,
    refetch,
    /** Safe defaults when table is empty */
    baseCurrency: settings?.base_currency ?? DEFAULTS.base_currency ?? 'INR',
    dateFormat: settings?.date_format ?? DEFAULTS.date_format ?? 'DD-MM-YYYY',
    companyName: settings?.company_name ?? '',
  };
}

