import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { TallySettings } from '@/utils/tallyExport';

export type TallyVersion = 'standard' | 'edit_log';

export type ErpSettings = {
  tally_url: string;
  tally_company: string;
  tally_enabled: boolean;
  tally_version: TallyVersion;
};

const defaults: ErpSettings = {
  tally_url: 'http://localhost:9000',
  tally_company: 'My Company',
  tally_enabled: false,
  tally_version: 'standard',
};

export function useErpSettings(): ErpSettings {
  const [settings, setSettings] = useState<ErpSettings>(defaults);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('setting_key, setting_value')
          .in('setting_key', ['tally_url', 'tally_company', 'tally_enabled', 'tally_version']);
        const map = new Map((data || []).map((r) => [r.setting_key, r.setting_value]));
        const version = map.get('tally_version') as TallyVersion | undefined;
        setSettings({
          tally_url: map.get('tally_url') || defaults.tally_url,
          tally_company: map.get('tally_company') || defaults.tally_company,
          tally_enabled: map.get('tally_enabled') === 'true',
          tally_version: version === 'edit_log' ? 'edit_log' : 'standard',
        });
      } catch {
        setSettings(defaults);
      }
    }
    void load();
  }, []);

  return settings;
}

export function toTallySettings(erp: ErpSettings): TallySettings {
  return {
    url: erp.tally_url || 'http://localhost:9000',
    company: erp.tally_company || 'My Company',
    version: erp.tally_version || 'standard',
  };
}
