import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/ap-invoice/supabase';
import { useMarket } from '@/contexts/MarketContext';
import { EMIRATES } from '@/lib/ap-invoice/marketConfig';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Download, Database, User, Building, Key, Mail, ArrowLeft, LayoutDashboard, Upload, FileSpreadsheet, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { COUNTRIES, STANDARDS, FY_OPTIONS, TIMEZONE_OPTIONS } from '@/constants/companyCountries';
import { CurrencyCombobox } from '@/components/ap-invoice/CurrencyCombobox';
import { ApprovalRulesSection } from '@/components/approvals/ApprovalRulesSection';
import { Checkbox } from '@/components/ui/checkbox';
import { getMyCompany, requireCompanyId } from '@/lib/ap-invoice/companyService';
import { insertGlAccount, listGlAccounts, deleteGlAccount } from '@/lib/ap-invoice/glAccountsStore';
import {
  testTallyConnection,
  syncApprovedToTally,
  getTallySyncStats,
} from '@/lib/ap-invoice/tallyService';
import { toTallySettings } from '@/hooks/useErpSettings';
import { sendPaymentReminders } from '@/lib/ap-invoice/paymentReminderService';
import { sendCfoSummary } from '@/lib/ap-invoice/cfoSummaryService';
import { loadZohoSettings, saveZohoSettings, testZohoConnection, type ZohoSettings } from '@/lib/ap-invoice/zohoService';
import { loadQBSettings, saveQBSettings, testQBConnection, type QBSettings } from '@/lib/ap-invoice/quickbooksService';

const COMPANY_TYPE_OPTIONS = [
  { value: 'private_limited', label: 'Private Limited' },
  { value: 'llp', label: 'LLP' },
  { value: 'opc', label: 'One Person Company' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'proprietorship', label: 'Proprietorship' },
  { value: 'other', label: 'Other' },
] as const;

export function Settings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { market, setMarket, isUAE } = useMarket();
  const [ftaRegistration, setFtaRegistration] = useState('');
  const [vatFilingFrequency, setVatFilingFrequency] = useState<'monthly' | 'quarterly'>('monthly');
  const [emirate, setEmirate] = useState('');
  const [indiaGstin, setIndiaGstin] = useState(() => {
    try {
      return localStorage.getItem('invoiceflow_company_tax_id') || '';
    } catch {
      return '';
    }
  });
  const [ifrsEnabled, setIfrsEnabled] = useState(false);
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [apiEndpointClassifyJson, setApiEndpointClassifyJson] = useState('');
  const [emailWebhookUrl, setEmailWebhookUrl] = useState('');
  const [emailPollingFrequency, setEmailPollingFrequency] = useState('manual');
  const [emailSenderWhitelist, setEmailSenderWhitelist] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [coaEntries, setCoaEntries] = useState<Array<{ gl_code: string; account_name: string; account_type: string; ifrs_mapping: string; department: string; cost_center: string }>>([]);
  const [coaUploading, setCoaUploading] = useState(false);

  const [tallyUrl, setTallyUrl] = useState('http://localhost:9000');
  const [tallyCompany, setTallyCompany] = useState('');
  const [tallyEnabled, setTallyEnabled] = useState(false);
  const [tallyVersion, setTallyVersion] = useState<'standard' | 'edit_log'>('standard');
  const [tallyTestResult, setTallyTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [tallyTesting, setTallyTesting] = useState(false);
  const [tallySyncing, setTallySyncing] = useState(false);
  const [tallySyncStats, setTallySyncStats] = useState<{ totalApproved: number; synced: number; unsynced: number } | null>(null);
  const [reminderDays, setReminderDays] = useState(7);
  const [reminderSending, setReminderSending] = useState(false);
  const [cfoSummaryDays, setCfoSummaryDays] = useState(7);
  const [cfoRecipients, setCfoRecipients] = useState('');
  const [cfoSending, setCfoSending] = useState(false);
  const [zoho, setZoho] = useState<ZohoSettings>({ client_id: '', client_secret: '', refresh_token: '', organization_id: '', domain: 'in' });
  const [zohoSaving, setZohoSaving] = useState(false);
  const [zohoTesting, setZohoTesting] = useState(false);
  const [zohoTestResult, setZohoTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [qb, setQb] = useState<QBSettings>({ client_id: '', client_secret: '', refresh_token: '', realm_id: '', environment: 'production' });
  const [qbSaving, setQbSaving] = useState(false);
  const [qbTesting, setQbTesting] = useState(false);
  const [qbTestResult, setQbTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [userProfile, setUserProfile] = useState({
    name: 'John Doe',
    email: 'john@invoiceflow.com',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [companyRow, setCompanyRow] = useState({
    id: null as string | null,
    company_name: '',
    country: 'IN',
    base_currency: 'INR',
    accounting_standard: 'IND_AS',
    date_format: 'DD-MM-YYYY',
    timezone: 'Asia/Kolkata',
    fy_start: '04-01',
    company_type: 'private_limited',
    gst_registered: 'Yes',
    tds_applicable: 'Yes',
    cfo_email: '',
    export_zoho_enabled: true,
    export_tally_enabled: true,
  });
  const [savingCompany, setSavingCompany] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchCOA();
    fetchCompanySettingsRow();
    void fetchCompanyMarketFields();
  }, []);

  /** When UAE market toggle is on, keep Company Settings defaults on AE / AED / IFRS. */
  useEffect(() => {
    if (!isUAE) return;
    setCompanyRow((prev) => {
      if (prev.country === 'AE' && prev.base_currency === 'AED') return prev;
      const ae = COUNTRIES.find((c) => c.code === 'AE');
      if (!ae) return prev;
      return {
        ...prev,
        country: 'AE',
        base_currency: 'AED',
        accounting_standard: ae.standard,
        date_format: ae.dateFormat,
        timezone: prev.timezone === 'Asia/Kolkata' || !prev.timezone ? 'Asia/Dubai' : prev.timezone,
        fy_start: prev.fy_start === '04-01' ? '01-01' : prev.fy_start,
      };
    });
  }, [isUAE]);

  /** When India market is on, keep IN / INR / Ind AS / Apr–Mar FY. */
  useEffect(() => {
    if (isUAE) return;
    setCompanyRow((prev) => {
      const inCountry = COUNTRIES.find((c) => c.code === 'IN');
      const std =
        prev.accounting_standard === 'IFRS' || !prev.accounting_standard
          ? 'IND_AS'
          : prev.accounting_standard === 'Ind AS'
            ? 'IND_AS'
            : prev.accounting_standard;
      if (
        prev.country === 'IN' &&
        prev.base_currency === 'INR' &&
        (prev.accounting_standard === 'IND_AS' || prev.accounting_standard === 'IGAAP') &&
        prev.fy_start === '04-01'
      ) {
        return prev.accounting_standard === std ? prev : { ...prev, accounting_standard: std };
      }
      return {
        ...prev,
        country: 'IN',
        base_currency: 'INR',
        accounting_standard: std === 'IFRS' ? 'IND_AS' : std,
        date_format: inCountry?.dateFormat || 'DD-MM-YYYY',
        timezone: prev.timezone === 'Asia/Dubai' || !prev.timezone ? 'Asia/Kolkata' : prev.timezone,
        fy_start: '04-01',
      };
    });
  }, [isUAE, market]);

  async function fetchCompanyMarketFields() {
    try {
      const cid = (await getMyCompany())?.id;
      if (!cid) return;
      // Prefer UAE market columns; fall back if live Supabase schema lacks them (400 / PGRST204).
      let data: Record<string, unknown> | null = null;
      const full = await supabase
        .from('companies')
        .select('fta_registration, vat_filing_frequency, emirate')
        .eq('id', cid)
        .maybeSingle();
      if (full.error) {
        const msg = (full.error.message || '').toLowerCase();
        const missingCol =
          msg.includes('fta_registration') ||
          msg.includes('vat_filing_frequency') ||
          msg.includes('emirate') ||
          msg.includes('schema cache') ||
          full.error.code === '42703' ||
          full.error.code === 'PGRST204';
        if (!missingCol) {
          console.warn('companies market fields:', full.error.message);
          return;
        }
        console.warn(
          'companies.fta_registration / vat_filing_frequency / emirate missing — run UAE companies migration on Supabase. Skipping market fields.',
        );
        return;
      }
      data = full.data as Record<string, unknown> | null;
      if (!data) return;
      if (data.fta_registration) setFtaRegistration(String(data.fta_registration));
      if (data.vat_filing_frequency === 'monthly' || data.vat_filing_frequency === 'quarterly') {
        setVatFilingFrequency(data.vat_filing_frequency as 'monthly' | 'quarterly');
      }
      if (data.emirate) setEmirate(String(data.emirate));
    } catch (e) {
      console.warn('companies market fields:', e);
    }
  }

  async function fetchCompanySettingsRow() {
    try {
      const cid = (await getMyCompany())?.id;
      let q = supabase.from('company_settings').select('*').order('updated_at', { ascending: false }).limit(1);
      if (cid) q = q.eq('company_id', cid);
      const { data, error } = await q.maybeSingle();
      if (error || !data) return;
      setCompanyRow({
        id: data.id,
        company_name: data.company_name ?? '',
        country: data.country ?? 'IN',
        base_currency: data.base_currency ?? 'INR',
        accounting_standard: data.accounting_standard ?? 'IND_AS',
        date_format: data.date_format ?? 'DD-MM-YYYY',
        timezone: data.timezone ?? 'Asia/Kolkata',
        fy_start: data.fy_start ?? '04-01',
        company_type: (data as { company_type?: string }).company_type ?? 'private_limited',
        gst_registered: (data as { gst_registered?: string }).gst_registered ?? 'Yes',
        tds_applicable: (data as { tds_applicable?: string }).tds_applicable ?? 'Yes',
        cfo_email: (data as { cfo_email?: string }).cfo_email ?? '',
        export_zoho_enabled: (data as { export_zoho_enabled?: boolean }).export_zoho_enabled ?? true,
        export_tally_enabled: (data as { export_tally_enabled?: boolean }).export_tally_enabled ?? true,
      });
    } catch (e) {
      console.warn('company_settings:', e);
    }
  }

  function handleCountryChange(countryCode: string) {
    const country = COUNTRIES.find((c) => c.code === countryCode);
    if (!country) return;
    setCompanyRow((prev) => ({
      ...prev,
      country: countryCode,
      base_currency: country.currency,
      accounting_standard: country.standard,
      date_format: country.dateFormat,
    }));
  }

  async function handleSaveCompanySettings() {
    setSavingCompany(true);
    try {
      const company_id = await requireCompanyId();
      // Persist market toggle into company_settings so reload matches UAE/India
      const countryCode = isUAE ? 'AE' : companyRow.country === 'AE' && market === 'india' ? 'IN' : companyRow.country;
      const ae = COUNTRIES.find((c) => c.code === 'AE');
      const effective = isUAE
        ? {
            country: 'AE',
            base_currency: 'AED',
            accounting_standard: companyRow.accounting_standard || ae?.standard || 'IFRS',
            date_format: companyRow.date_format || ae?.dateFormat || 'DD-MM-YYYY',
            timezone: companyRow.timezone === 'Asia/Kolkata' ? 'Asia/Dubai' : companyRow.timezone || 'Asia/Dubai',
            fy_start: companyRow.fy_start === '04-01' ? '01-01' : companyRow.fy_start || '01-01',
          }
        : {
            country: countryCode === 'AE' ? 'IN' : countryCode || 'IN',
            base_currency: companyRow.base_currency === 'AED' ? 'INR' : companyRow.base_currency || 'INR',
            accounting_standard:
              companyRow.accounting_standard === 'IFRS' || !companyRow.accounting_standard
                ? 'IND_AS'
                : companyRow.accounting_standard === 'Ind AS'
                  ? 'IND_AS'
                  : companyRow.accounting_standard,
            date_format: companyRow.date_format || 'DD-MM-YYYY',
            timezone: companyRow.timezone === 'Asia/Dubai' ? 'Asia/Kolkata' : companyRow.timezone || 'Asia/Kolkata',
            fy_start: '04-01',
          };

      const payload = {
        company_id,
        company_name: companyRow.company_name || null,
        country: effective.country,
        base_currency: effective.base_currency,
        accounting_standard: effective.accounting_standard,
        date_format: effective.date_format,
        timezone: effective.timezone,
        fy_start: effective.fy_start,
        company_type: companyRow.company_type || null,
        gst_registered: companyRow.gst_registered || null,
        tds_applicable: companyRow.tds_applicable || null,
        cfo_email: companyRow.cfo_email?.trim() || null,
        export_zoho_enabled: companyRow.export_zoho_enabled,
        export_tally_enabled: companyRow.export_tally_enabled,
        updated_at: new Date().toISOString(),
      };
      if (companyRow.id) {
        const { error } = await supabase.from('company_settings').update(payload).eq('id', companyRow.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('company_settings').insert(payload).select('id').single();
        if (error) throw error;
        if (data?.id) setCompanyRow((p) => ({ ...p, id: data.id }));
      }

      setCompanyRow((p) => ({
        ...p,
        country: effective.country,
        base_currency: effective.base_currency,
        accounting_standard: effective.accounting_standard,
        date_format: effective.date_format,
        timezone: effective.timezone,
        fy_start: effective.fy_start,
      }));

      const { error: marketErr } = await supabase
        .from('companies')
        .update({
          market: isUAE ? 'uae' : market,
          admin_email: companyRow.cfo_email?.trim() || null,
          fta_registration: ftaRegistration.trim() || null,
          vat_filing_frequency: vatFilingFrequency,
          emirate: emirate || null,
        })
        .eq('id', company_id);
      if (marketErr) {
        const msg = (marketErr.message || '').toLowerCase();
        const missingCol =
          msg.includes('fta_registration') ||
          msg.includes('vat_filing_frequency') ||
          msg.includes('emirate') ||
          msg.includes('schema cache') ||
          marketErr.code === '42703' ||
          marketErr.code === 'PGRST204';
        if (missingCol) {
          // Retry without UAE-only columns so Company Settings still save.
          const { error: fallbackErr } = await supabase
            .from('companies')
            .update({
              market: isUAE ? 'uae' : market,
              admin_email: companyRow.cfo_email?.trim() || null,
            })
            .eq('id', company_id);
          if (fallbackErr) throw fallbackErr;
          toast({
            title: 'Saved (partial)',
            description:
              'Company settings saved. FTA / VAT filing / emirate columns are missing on Supabase — run the UAE companies migration to enable them.',
          });
        } else {
          throw marketErr;
        }
      } else if (isUAE && !ftaRegistration.trim()) {
        toast({
          title: 'Saved — FTA Registration recommended',
          description: 'Add your FTA Registration Number for UAE VAT compliance.',
        });
      } else {
        toast({ title: 'Saved', description: 'Company settings updated.' });
      }
    } catch (e: unknown) {
      console.error(e);
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : 'Could not save company settings. Run CREATE-COMPANY-AND-GLOBAL-COLUMNS.sql in Supabase.',
        variant: 'destructive',
      });
    } finally {
      setSavingCompany(false);
    }
  }

  async function fetchSettings() {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('*')
        .in('setting_key', ['ifrs_enabled', 'api_endpoint', 'api_endpoint_classify_json', 'email_webhook_url', 'email_polling_frequency', 'email_sender_whitelist', 'tally_url', 'tally_company', 'tally_enabled', 'tally_version']);

      if (error) throw error;

      const settings = data || [];
      const ifrsSettings = settings.find((s) => s.setting_key === 'ifrs_enabled');
      const apiSettings = settings.find((s) => s.setting_key === 'api_endpoint');
      const apiClassifyJsonSettings = settings.find((s) => s.setting_key === 'api_endpoint_classify_json');
      const emailWebhookSettings = settings.find((s) => s.setting_key === 'email_webhook_url');
      const emailPollingSettings = settings.find((s) => s.setting_key === 'email_polling_frequency');
      const emailWhitelistSettings = settings.find((s) => s.setting_key === 'email_sender_whitelist');

      setIfrsEnabled(ifrsSettings?.setting_value === 'true');
      setApiEndpoint(apiSettings?.setting_value || '');
      setApiEndpointClassifyJson(apiClassifyJsonSettings?.setting_value || '');
      setEmailWebhookUrl(emailWebhookSettings?.setting_value || '');
      setEmailPollingFrequency(emailPollingSettings?.setting_value || 'manual');
      setEmailSenderWhitelist(emailWhitelistSettings?.setting_value || '');
      setTallyUrl(settings.find((s) => s.setting_key === 'tally_url')?.setting_value || 'http://localhost:9000');
      setTallyCompany(settings.find((s) => s.setting_key === 'tally_company')?.setting_value || '');
      setTallyEnabled(settings.find((s) => s.setting_key === 'tally_enabled')?.setting_value === 'true');
      setTallyVersion((settings.find((s) => s.setting_key === 'tally_version')?.setting_value as 'standard' | 'edit_log') || 'standard');
      getTallySyncStats().then(setTallySyncStats).catch(() => null);
      loadZohoSettings().then((s) => setZoho((prev) => ({ ...prev, ...s }))).catch(() => null);
      loadQBSettings().then((s) => setQb((prev) => ({ ...prev, ...s }))).catch(() => null);
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Save IFRS setting
      const { data: existingIfrs, error: ifrsCheckError } = await supabase
        .from('app_settings')
        .select('id')
        .eq('setting_key', 'ifrs_enabled')
        .maybeSingle();

      if (ifrsCheckError) throw ifrsCheckError;

      if (existingIfrs) {
        const { error: ifrsUpdateError } = await supabase
          .from('app_settings')
          .update({
            setting_value: ifrsEnabled.toString(),
            updated_at: new Date().toISOString(),
          })
          .eq('setting_key', 'ifrs_enabled');
        
        if (ifrsUpdateError) throw ifrsUpdateError;
      } else {
        const { error: ifrsInsertError } = await supabase.from('app_settings').insert({
          setting_key: 'ifrs_enabled',
          setting_value: ifrsEnabled.toString(),
        });
        
        if (ifrsInsertError) throw ifrsInsertError;
      }

      // Save API endpoint setting
      console.log('💾 Saving API endpoint:', apiEndpoint);
      
      const { data: existingApi, error: apiCheckError } = await supabase
        .from('app_settings')
        .select('id')
        .eq('setting_key', 'api_endpoint')
        .maybeSingle();

      if (apiCheckError) {
        console.error('❌ Error checking existing API endpoint:', apiCheckError);
        throw apiCheckError;
      }

      if (existingApi) {
        console.log('📝 Updating existing API endpoint record');
        const { error: apiUpdateError } = await supabase
          .from('app_settings')
          .update({
            setting_value: apiEndpoint,
            updated_at: new Date().toISOString(),
          })
          .eq('setting_key', 'api_endpoint');
        
        if (apiUpdateError) {
          console.error('❌ Error updating API endpoint:', apiUpdateError);
          throw apiUpdateError;
        }
        console.log('✅ API endpoint updated successfully');
      } else {
        console.log('➕ Inserting new API endpoint record');
        const { error: apiInsertError } = await supabase.from('app_settings').insert({
          setting_key: 'api_endpoint',
          setting_value: apiEndpoint,
        });
        
        if (apiInsertError) {
          console.error('❌ Error inserting API endpoint:', apiInsertError);
          throw apiInsertError;
        }
        console.log('✅ API endpoint inserted successfully');
      }

      // Verify the save worked
      const { data: verifyData, error: verifyError } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('setting_key', 'api_endpoint')
        .maybeSingle();

      if (verifyError) {
        console.error('❌ Error verifying saved API endpoint:', verifyError);
        throw verifyError;
      }

      if (verifyData?.setting_value === apiEndpoint) {
        console.log('✅ Verified: API endpoint saved correctly:', verifyData.setting_value);
        toast({
          title: 'Success',
          description: `Settings saved successfully. API endpoint configured: ${apiEndpoint.substring(0, 50)}...`,
        });
      } else {
        console.warn('⚠️ Verification failed. Expected:', apiEndpoint, 'Got:', verifyData?.setting_value);
        toast({
          title: 'Warning',
          description: 'Settings may not have saved correctly. Please check and try again.',
          variant: 'destructive',
        });
      }

      // Save optional classification webhook (JSON) for bulk upload
      const { data: existingClassify } = await supabase
        .from('app_settings')
        .select('id')
        .eq('setting_key', 'api_endpoint_classify_json')
        .maybeSingle();
      if (existingClassify) {
        await supabase
          .from('app_settings')
          .update({
            setting_value: apiEndpointClassifyJson,
            updated_at: new Date().toISOString(),
          })
          .eq('setting_key', 'api_endpoint_classify_json');
      } else {
        await supabase.from('app_settings').insert({
          setting_key: 'api_endpoint_classify_json',
          setting_value: apiEndpointClassifyJson,
        });
      }
      
      // Save Email Integration settings
      const emailSettings = [
        { key: 'email_webhook_url', value: emailWebhookUrl },
        { key: 'email_polling_frequency', value: emailPollingFrequency },
        { key: 'email_sender_whitelist', value: emailSenderWhitelist },
      ];

      for (const setting of emailSettings) {
        const { data: existing } = await supabase
          .from('app_settings')
          .select('id')
          .eq('setting_key', setting.key)
          .maybeSingle();

        if (existing) {
          await supabase
            .from('app_settings')
            .update({
              setting_value: setting.value,
              updated_at: new Date().toISOString(),
            })
            .eq('setting_key', setting.key);
        } else {
          await supabase.from('app_settings').insert({
            setting_key: setting.key,
            setting_value: setting.value,
          });
        }
      }

      // Refresh settings to ensure they're up to date
      await fetchSettings();
    } catch (error: any) {
      console.error('❌ Error saving settings:', error);
      toast({
        title: 'Error',
        description: error?.message || 'Failed to save settings. Please check the browser console for details.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  async function saveTallySettings() {
    const tallySettings = [
      { key: 'tally_url', value: tallyUrl },
      { key: 'tally_company', value: tallyCompany },
      { key: 'tally_enabled', value: tallyEnabled.toString() },
      { key: 'tally_version', value: tallyVersion },
    ];
    for (const s of tallySettings) {
      const { data: existing } = await supabase.from('app_settings').select('id').eq('setting_key', s.key).maybeSingle();
      if (existing) {
        await supabase.from('app_settings').update({ setting_value: s.value, updated_at: new Date().toISOString() }).eq('setting_key', s.key);
      } else {
        await supabase.from('app_settings').insert({ setting_key: s.key, setting_value: s.value });
      }
    }
    await fetchSettings();
  }

  async function fetchCOA() {
    try {
      const cid = (await getMyCompany())?.id;
      let rows = await listGlAccounts(supabase, cid);
      if (rows.length === 0 && cid) {
        rows = await listGlAccounts(supabase, null);
      }
      setCoaEntries(
        rows.map((r) => ({
          gl_code: r.gl_code,
          account_name: r.gl_name,
          account_type: r.account_type,
          ifrs_mapping: r.standard_reference ?? '',
          department: r.department ?? '',
          cost_center: r.cost_center ?? '',
        })),
      );
    } catch (e) {
      console.warn('COA fetch failed (table may not exist):', e);
      setCoaEntries([]);
    }
  }

  function downloadCOATemplate() {
    const rows = [
      ['gl_code', 'gl_name', 'account_type', 'vat_treatment', 'department', 'cost_center', 'standard_reference'],
      ['1000', 'Property Plant & Equipment', 'Asset', 'out_of_scope', 'Operations', 'OPS-001', 'IAS 16'],
      ['1100', 'Cash & Bank', 'Asset', 'out_of_scope', 'Finance', 'FIN-001', 'IAS 7'],
      ['1810', 'Input VAT Recoverable', 'Asset', 'standard', 'Finance', 'FIN-001', 'UAE VAT'],
      ['2100', 'Accounts Payable', 'Liability', 'out_of_scope', 'Finance', 'FIN-001', 'IAS 1'],
      ['2200', 'Output VAT Payable', 'Liability', 'standard', 'Finance', 'FIN-001', 'UAE VAT'],
      ['4100', 'Revenue - Services', 'Revenue', 'standard', 'Sales', 'SAL-001', 'IFRS 15'],
      ['5000', 'Cost of Sales', 'COGS', 'standard', 'Operations', 'OPS-001', 'IAS 2'],
      ['6100', 'Professional Services', 'Expense', 'standard', 'Operations', 'OPS-001', 'IAS 1'],
      ['6200', 'Lease Expense', 'Expense', 'standard', 'Facilities', 'FAC-001', 'IFRS 16'],
      ['6300', 'Utilities', 'Expense', 'standard', 'Facilities', 'FAC-001', 'IAS 1'],
      ['7100', 'Finance Costs', 'Expense', 'exempt', 'Finance', 'FIN-001', 'IAS 23'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Chart of Accounts');
    XLSX.writeFile(wb, 'gl_accounts_template.csv');
    toast({ title: 'Downloaded', description: 'gl_accounts_template.csv (columns match GL Accounts)' });
  }

  async function handleCOAUpload(file: File) {
    setCoaUploading(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const rows = json.map((r) => ({
        gl_code: String(r.gl_code ?? r['GL Code'] ?? r.GL_CODE ?? '').trim(),
        gl_name: String(
          r.gl_name ?? r.account_name ?? r['Account Name'] ?? r.accountName ?? r['GL Name'] ?? '',
        ).trim(),
        account_type: String(r.account_type ?? r['Account Type'] ?? 'Expense').trim() || 'Expense',
        vat_treatment: String(r.vat_treatment ?? r['VAT Treatment'] ?? '').trim() || null,
        department: String(r.department ?? r.Department ?? '').trim() || null,
        cost_center: String(r.cost_center ?? r['Cost Center'] ?? r.costCenter ?? '').trim() || null,
        standard_reference: String(
          r.standard_reference ?? r.ifrs_mapping ?? r['IFRS Mapping'] ?? '',
        ).trim() || null,
      })).filter((r) => r.gl_code && r.gl_name);
      if (rows.length === 0) {
        toast({
          title: 'No valid rows',
          description: 'Upload a CSV/Excel with gl_code and gl_name (or account_name) columns.',
          variant: 'destructive',
        });
        return;
      }
      const company_id = await requireCompanyId();
      let inserted = 0;
      const errors: string[] = [];
      for (const r of rows) {
        const { error } = await insertGlAccount(supabase, {
          company_id,
          gl_code: r.gl_code,
          gl_name: r.gl_name,
          account_type: r.account_type,
          department: r.department,
          cost_center: r.cost_center,
          imported_from: 'csv',
          standard_reference: r.standard_reference ?? r.vat_treatment,
        });
        if (error) errors.push(`${r.gl_code}: ${error}`);
        else inserted++;
      }
      await fetchCOA();
      if (errors.length) {
        toast({
          title: `Imported ${inserted}, ${errors.length} failed`,
          description: errors.slice(0, 3).join('; '),
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Success', description: `Uploaded ${inserted} GL account(s).` });
      }
    } catch (e: unknown) {
      toast({ title: 'Upload failed', description: String(e instanceof Error ? e.message : e), variant: 'destructive' });
    } finally {
      setCoaUploading(false);
    }
  }

  async function clearCOA() {
    if (!confirm('Clear all Chart of Accounts entries? This cannot be undone.')) return;
    try {
      const company_id = await requireCompanyId();
      const rows = await listGlAccounts(supabase, company_id);
      for (const r of rows) {
        await deleteGlAccount(supabase, r.id);
      }
      setCoaEntries([]);
      toast({ title: 'Cleared', description: 'Chart of Accounts cleared.' });
    } catch (e: unknown) {
      toast({ title: 'Error', description: String(e instanceof Error ? e.message : e), variant: 'destructive' });
    }
  }

  async function exportAllData() {
    try {
      const { data: invoices, error } = await supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const jsonData = JSON.stringify(invoices, null, 2);
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoices-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();

      toast({
        title: 'Success',
        description: 'Data exported successfully',
      });
    } catch (error) {
      console.error('Error exporting data:', error);
      toast({
        title: 'Error',
        description: 'Failed to export data',
        variant: 'destructive',
      });
    }
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage application settings and preferences
          </p>
        </div>
        <Button
          onClick={() => navigate('/dashboard')}
          variant="outline"
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>

      <Card className="border-blue-100 bg-slate-50/80">
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>
            Tenant-specific rules (approval chain, vendor policy, ERP flags) live in Company config. New organisations can use the setup wizard.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/company/config')}>
            Open company config
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/onboarding')}>
            Setup wizard
          </Button>
        </CardContent>
      </Card>

      {/* Company Settings — saved to company_settings table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building className="h-5 w-5 text-[#0A4B8F]" />
            <CardTitle>Company Settings</CardTitle>
          </div>
          <CardDescription>
            Country, base currency, accounting standard, and display formats (run SQL migration if save fails)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="co-company-name">Company Name</Label>
              <Input
                id="co-company-name"
                value={companyRow.company_name}
                onChange={(e) => setCompanyRow({ ...companyRow, company_name: e.target.value })}
                placeholder="Your company legal name"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="co-cfo-email">CFO email (daily briefing)</Label>
              <Input
                id="co-cfo-email"
                type="email"
                value={companyRow.cfo_email}
                onChange={(e) => setCompanyRow({ ...companyRow, cfo_email: e.target.value })}
                placeholder="cfo@yourcompany.com"
              />
              <p className="text-[11px] text-muted-foreground">
                EC2 cron sends the daily AP briefing here automatically — no per-client server setup.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Country</Label>
              <Select value={companyRow.country} onValueChange={handleCountryChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Base currency</Label>
              <CurrencyCombobox
                value={companyRow.base_currency}
                onChange={(code) => setCompanyRow({ ...companyRow, base_currency: code })}
              />
            </div>
            <div className="space-y-2">
              <Label>Accounting standard</Label>
              <Select
                value={companyRow.accounting_standard}
                onValueChange={(v) => setCompanyRow({ ...companyRow, accounting_standard: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STANDARDS.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                {STANDARDS.find((s) => s.code === companyRow.accounting_standard)?.description}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Date display format</Label>
              <Select
                value={companyRow.date_format}
                onValueChange={(v) => setCompanyRow({ ...companyRow, date_format: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(new Set(COUNTRIES.map((c) => c.dateFormat))).map((fmt) => (
                    <SelectItem key={fmt} value={fmt}>
                      {fmt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select
                value={companyRow.timezone}
                onValueChange={(v) => setCompanyRow({ ...companyRow, timezone: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Financial year start</Label>
              <Select
                value={companyRow.fy_start}
                onValueChange={(v) => setCompanyRow({ ...companyRow, fy_start: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FY_OPTIONS.map((fy) => (
                    <SelectItem key={fy.value} value={fy.value}>
                      {fy.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator className="my-6" />

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Accounting and compliance</h3>
              <p className="mt-1 text-xs text-gray-500">
                Accounting standard above drives GL suggestions on invoices and matches the selector on the GL Accounts page (same row in company_settings).
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Company type</Label>
                <Select
                  value={companyRow.company_type}
                  onValueChange={(v) => setCompanyRow({ ...companyRow, company_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPANY_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{isUAE ? 'VAT registered' : 'GST registered'}</Label>
                <Select
                  value={companyRow.gst_registered}
                  onValueChange={(v) => setCompanyRow({ ...companyRow, gst_registered: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>TDS applicable</Label>
                <Select
                  value={companyRow.tds_applicable}
                  onValueChange={(v) => setCompanyRow({ ...companyRow, tds_applicable: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-3 md:col-span-2">
                <Label>Export formats (month-end)</Label>
                <p className="text-xs text-gray-500">Used with GL Accounts export; enable the systems your accountant uses.</p>
                <div className="flex flex-wrap gap-6">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="ex-zoho"
                      checked={companyRow.export_zoho_enabled}
                      onCheckedChange={(c) =>
                        setCompanyRow({ ...companyRow, export_zoho_enabled: c === true })
                      }
                    />
                    <label htmlFor="ex-zoho" className="text-sm font-medium leading-none cursor-pointer">
                      Zoho Books (CSV)
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="ex-tally"
                      checked={companyRow.export_tally_enabled}
                      onCheckedChange={(c) =>
                        setCompanyRow({ ...companyRow, export_tally_enabled: c === true })
                      }
                    />
                    <label htmlFor="ex-tally" className="text-sm font-medium leading-none cursor-pointer">
                      Tally (XML)
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Separator className="my-6" />

          {/* Market / Region toggle */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Market / Region</h3>
              <p className="mt-1 text-xs text-gray-500">
                Switches tax labels, currency, and compliance rules. India and UAE clients use the same codebase — per company.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void setMarket('india')}
                className="flex-1 rounded-lg border px-4 py-3 text-left transition-colors"
                style={{
                  background: market === 'india' ? '#1D9E75' : 'transparent',
                  color: market === 'india' ? '#fff' : 'inherit',
                  borderColor: market === 'india' ? '#1D9E75' : 'hsl(var(--border))',
                  fontWeight: 600,
                }}
              >
                <div>🇮🇳 India Mode</div>
                <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>GST · GSTIN · INR · Tally</div>
              </button>
              <button
                type="button"
                onClick={() => void setMarket('uae')}
                className="flex-1 rounded-lg border px-4 py-3 text-left transition-colors"
                style={{
                  background: market === 'uae' ? '#378ADD' : 'transparent',
                  color: market === 'uae' ? '#fff' : 'inherit',
                  borderColor: market === 'uae' ? '#378ADD' : 'hsl(var(--border))',
                  fontWeight: 600,
                }}
              >
                <div>🇦🇪 UAE Mode</div>
                <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>VAT · TRN · AED · FTA</div>
              </button>
            </div>
            {isUAE && (
              <div className="grid gap-4 md:grid-cols-2 rounded-lg border border-sky-200 bg-sky-50/40 p-4">
                <div className="space-y-2">
                  <Label>FTA Registration Number <span className="text-red-600">*</span></Label>
                  <Input
                    placeholder="15-digit FTA TRN e.g. 100234567890123"
                    value={ftaRegistration}
                    onChange={(e) => setFtaRegistration(e.target.value)}
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">Required for UAE VAT filing and GulfTax sync.</p>
                </div>
                <div className="space-y-2">
                  <Label>VAT Filing Frequency</Label>
                  <Select value={vatFilingFrequency} onValueChange={(v) => setVatFilingFrequency(v as 'monthly' | 'quarterly')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Emirate</Label>
                  <Select value={emirate} onValueChange={setEmirate}>
                    <SelectTrigger><SelectValue placeholder="Select emirate" /></SelectTrigger>
                    <SelectContent>
                      {EMIRATES.map((e) => (
                        <SelectItem key={e} value={e}>{e}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {!isUAE && (
              <div className="grid gap-4 md:grid-cols-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                <div className="space-y-2">
                  <Label>Company GSTIN</Label>
                  <Input
                    placeholder="15-digit GSTIN e.g. 29AAAAA0000A1Z5"
                    value={indiaGstin}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase();
                      setIndiaGstin(v);
                      try {
                        localStorage.setItem('invoiceflow_company_tax_id', v);
                      } catch {
                        /* ignore */
                      }
                    }}
                    maxLength={15}
                  />
                  <p className="text-[11px] text-muted-foreground">Used on GSTR-2B recon — not FTA TRN.</p>
                </div>
                <div className="space-y-2">
                  <Label>GST filing frequency</Label>
                  <Select
                    value={vatFilingFrequency}
                    onValueChange={(v) => setVatFilingFrequency(v as 'monthly' | 'quarterly')}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly (default)</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">India GSTR-1 / GSTR-3B are typically monthly.</p>
                </div>
                <div className="space-y-2 md:col-span-2 text-xs text-muted-foreground">
                  Country: India · Currency: INR · Tax: GST · Standard: Ind AS / IGAAP · FY: April–March
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end mt-6">
            <Button
              type="button"
              onClick={() => void handleSaveCompanySettings()}
              disabled={savingCompany}
              className="bg-[#0A4B8F] hover:bg-[#0D6EFD]"
            >
              {savingCompany ? 'Saving…' : 'Save Company Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ApprovalRulesSection />

      {/* User Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-[#0A4B8F]" />
            <CardTitle>User Profile</CardTitle>
          </div>
          <CardDescription>
            Manage your personal information and account settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="user-name">Full Name</Label>
              <Input
                id="user-name"
                value={userProfile.name}
                onChange={(e) =>
                  setUserProfile({ ...userProfile, name: e.target.value })
                }
                placeholder="John Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">Email Address</Label>
              <Input
                id="user-email"
                type="email"
                value={userProfile.email}
                onChange={(e) =>
                  setUserProfile({ ...userProfile, email: e.target.value })
                }
                placeholder="john@example.com"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-900">Change Password</h4>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={userProfile.currentPassword}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, currentPassword: e.target.value })
                  }
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={userProfile.newPassword}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, newPassword: e.target.value })
                  }
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={userProfile.confirmPassword}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, confirmPassword: e.target.value })
                  }
                  placeholder="••••••••"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => {
                toast({
                  title: 'Success',
                  description: 'Profile updated successfully',
                });
              }}
              className="bg-[#0A4B8F] hover:bg-[#0D6EFD]"
            >
              Save Profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* API Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-[#0A4B8F]" />
            <CardTitle>API Configuration</CardTitle>
          </div>
          <CardDescription>
            Configure integration endpoints and API keys
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="space-y-0.5">
              <Label htmlFor="ifrs-enabled" className="text-base font-medium">
                Enable IFRS Classification (Premium)
              </Label>
              <p className="text-sm text-gray-500">
                Automatically classify invoices using IFRS standards with AI
              </p>
            </div>
            <Switch
              id="ifrs-enabled"
              checked={ifrsEnabled}
              onCheckedChange={setIfrsEnabled}
            />
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="n8n-webhook">n8n Webhook URL</Label>
              <Input
                id="n8n-webhook"
                type="url"
                placeholder="https://your-n8n-instance.com/webhook/invoice-processing"
                value={apiEndpoint}
                onChange={(e) => setApiEndpoint(e.target.value)}
              />
              <p className="text-sm text-gray-500">
                n8n workflow webhook endpoint for invoice processing. Use /webhook/ URL (not /webhook-test/). Workflow must be ACTIVE (toggle ON in n8n).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="n8n-classify-json">Classification webhook (JSON, optional)</Label>
              <Input
                id="n8n-classify-json"
                type="url"
                placeholder="https://your-n8n.com/webhook/invoice-classify-json"
                value={apiEndpointClassifyJson}
                onChange={(e) => setApiEndpointClassifyJson(e.target.value)}
              />
              <p className="text-sm text-gray-500">
                For bulk upload IFRS/GL/risk. If set, bulk upload uses this URL (JSON body). If empty, the main webhook above is used.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="openai-key">OpenAI API Key</Label>
              <Input
                id="openai-key"
                type="password"
                placeholder="sk-••••••••••••••••••••••••"
              />
              <p className="text-sm text-gray-500">
                Required for AI-powered invoice data extraction and IFRS classification
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} className="bg-[#0A4B8F] hover:bg-[#0D6EFD]">
              {saving ? 'Saving...' : 'Save API Configuration'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ERP Integrations — Tally, QuickBooks, Xero */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-[#0A4B8F]" />
            <CardTitle>ERP Integrations</CardTitle>
          </div>
          <CardDescription>
            Push approved invoices to Tally, QuickBooks, or Xero
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Tally ERP */}
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📊</span>
                <div>
                  <div className="font-semibold">Tally ERP</div>
                  <div className="text-sm text-gray-500">
                    Push approved invoices as Purchase Vouchers to TallyPrime
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="tally-enabled" className="text-sm font-medium">Enabled</Label>
                <Switch
                  id="tally-enabled"
                  checked={tallyEnabled}
                  onCheckedChange={setTallyEnabled}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tally-url">Tally Server URL</Label>
                <Input
                  id="tally-url"
                  value={tallyUrl}
                  onChange={(e) => setTallyUrl(e.target.value)}
                  placeholder="http://localhost:9000"
                />
                <p className="text-xs text-gray-500">
                  Enable HTTP port in TallyPrime → Gateway → Configure
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tally-company">Company Name (exactly as in Tally)</Label>
                <Input
                  id="tally-company"
                  value={tallyCompany}
                  onChange={(e) => setTallyCompany(e.target.value)}
                  placeholder="Acme Corp Private Limited"
                />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Label>TallyPrime Version</Label>
              <div className="flex gap-3">
                {[
                  { value: 'standard' as const, label: 'TallyPrime Rel 7.0', desc: 'Standard — for most businesses' },
                  { value: 'edit_log' as const, label: 'TallyPrime Edit Log Rel 7.0', desc: 'MCA compliance + audit trail' },
                ].map((opt) => (
                  <div
                    key={opt.value}
                    role="button"
                    tabIndex={0}
                    onClick={() => setTallyVersion(opt.value)}
                    onKeyDown={(e) => e.key === 'Enter' && setTallyVersion(opt.value)}
                    className={`flex-1 cursor-pointer rounded-lg border-2 p-3 transition-colors ${
                      tallyVersion === opt.value
                        ? 'border-[#1a56db] bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className={`font-semibold text-sm ${tallyVersion === opt.value ? 'text-[#1a56db]' : 'text-gray-900'}`}>
                      {opt.label}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                Use Edit Log only if required by MCA compliance or auditors. Standard is sufficient for most InvoiceFlow users.
              </p>
            </div>
            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm text-gray-700">
              <p className="font-medium text-gray-800 mb-1">TallyPrime Rel 7.0 — Enable HTTP API</p>
              <ol className="list-decimal list-inside space-y-0.5 text-xs">
                <li>Open TallyPrime</li>
                <li>Press F12 (Configure)</li>
                <li>Go to Advanced Configuration</li>
                <li>Enable TallyPrime Server → YES</li>
                <li>Port Number → 9000</li>
                <li>Allow HTTP XML Requests → YES</li>
                <li>Press Enter to save. TallyPrime must be running with company open when pushing from InvoiceFlow.</li>
              </ol>
            </div>
            {tallySyncStats && (
              <div className="mt-3 flex gap-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="text-center">
                  <div className="font-bold text-lg text-gray-900">{tallySyncStats.totalApproved}</div>
                  <div className="text-xs text-gray-500">Approved</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-lg text-green-700">{tallySyncStats.synced}</div>
                  <div className="text-xs text-gray-500">Synced</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-lg text-orange-600">{tallySyncStats.unsynced}</div>
                  <div className="text-xs text-gray-500">Pending</div>
                </div>
              </div>
            )}
            {tallyTestResult && (
              <div className={`mt-2 rounded p-2 text-sm ${tallyTestResult.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                {tallyTestResult.ok ? '✅ ' : '❌ '}{tallyTestResult.message}
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-4">
              <Button
                onClick={async () => {
                  try {
                    await saveTallySettings();
                    toast({ title: 'Saved', description: 'Tally settings saved.' });
                  } catch (e) {
                    toast({ title: 'Error', description: String(e), variant: 'destructive' });
                  }
                }}
                className="bg-[#1a56db]"
              >
                Save Tally
              </Button>
              <Button
                variant="outline"
                disabled={tallyTesting}
                onClick={async () => {
                  setTallyTesting(true);
                  setTallyTestResult(null);
                  try {
                    const result = await testTallyConnection(tallyUrl);
                    setTallyTestResult(result);
                  } catch (e) {
                    setTallyTestResult({ ok: false, message: String(e) });
                  } finally {
                    setTallyTesting(false);
                  }
                }}
              >
                {tallyTesting ? 'Testing…' : 'Test Connection'}
              </Button>
              <Button
                variant="outline"
                disabled={tallySyncing}
                onClick={async () => {
                  setTallySyncing(true);
                  try {
                    const settings = toTallySettings({
                      tally_url: tallyUrl,
                      tally_company: tallyCompany,
                      tally_enabled: tallyEnabled,
                      tally_version: tallyVersion,
                    });
                    const result = await syncApprovedToTally(settings);
                    toast({
                      title: `Sync complete — ${result.synced} synced, ${result.failed} failed`,
                      description: result.messages.slice(0, 3).join(' | '),
                    });
                    const stats = await getTallySyncStats();
                    setTallySyncStats(stats);
                  } catch (e) {
                    toast({ title: 'Sync failed', description: String(e), variant: 'destructive' });
                  } finally {
                    setTallySyncing(false);
                  }
                }}
              >
                {tallySyncing ? 'Syncing…' : 'Sync All Approved'}
              </Button>
            </div>
          </div>

          {/* Zoho Books */}
          <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-[#E42527] rounded px-2 py-1 text-white font-bold text-sm">ZOHO</div>
              <div>
                <div className="font-semibold">Zoho Books</div>
                <div className="text-sm text-gray-500">Push approved invoices as Bills via OAuth2</div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm">
              <div className="flex gap-2 items-center">
                <Label className="w-32 shrink-0">Client ID</Label>
                <Input value={zoho.client_id} onChange={(e) => setZoho((p) => ({ ...p, client_id: e.target.value }))} placeholder="Zoho API Client ID" />
              </div>
              <div className="flex gap-2 items-center">
                <Label className="w-32 shrink-0">Client Secret</Label>
                <Input type="password" value={zoho.client_secret} onChange={(e) => setZoho((p) => ({ ...p, client_secret: e.target.value }))} placeholder="Client Secret" />
              </div>
              <div className="flex gap-2 items-center">
                <Label className="w-32 shrink-0">Refresh Token</Label>
                <Input type="password" value={zoho.refresh_token} onChange={(e) => setZoho((p) => ({ ...p, refresh_token: e.target.value }))} placeholder="Paste refresh token" />
              </div>
              <div className="flex gap-2 items-center">
                <Label className="w-32 shrink-0">Organization ID</Label>
                <Input value={zoho.organization_id} onChange={(e) => setZoho((p) => ({ ...p, organization_id: e.target.value }))} placeholder="Your Zoho Org ID" />
              </div>
              <div className="flex gap-2 items-center">
                <Label className="w-32 shrink-0">Data Center</Label>
                <select
                  value={zoho.domain}
                  onChange={(e) => setZoho((p) => ({ ...p, domain: e.target.value as ZohoSettings['domain'] }))}
                  className="border rounded px-2 py-1 text-sm bg-white"
                >
                  <option value="in">India (.in)</option>
                  <option value="com">US (.com)</option>
                  <option value="eu">EU (.eu)</option>
                  <option value="com.au">AU (.com.au)</option>
                  <option value="jp">JP (.jp)</option>
                </select>
              </div>
            </div>
            {zohoTestResult && (
              <div className={`mt-2 rounded p-2 text-sm ${zohoTestResult.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                {zohoTestResult.ok ? '✅ ' : '❌ '}{zohoTestResult.message}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <Button
                size="sm"
                disabled={zohoSaving}
                onClick={async () => {
                  setZohoSaving(true);
                  try {
                    await saveZohoSettings(zoho);
                    toast({ title: 'Saved', description: 'Zoho Books settings saved.' });
                  } catch (e) {
                    toast({ title: 'Error', description: String(e), variant: 'destructive' });
                  } finally {
                    setZohoSaving(false);
                  }
                }}
                className="bg-[#1a56db]"
              >
                {zohoSaving ? 'Saving…' : 'Save Zoho'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={zohoTesting}
                onClick={async () => {
                  setZohoTesting(true);
                  setZohoTestResult(null);
                  try {
                    const result = await testZohoConnection(zoho);
                    setZohoTestResult(result);
                  } catch (e) {
                    setZohoTestResult({ ok: false, message: String(e) });
                  } finally {
                    setZohoTesting(false);
                  }
                }}
              >
                {zohoTesting ? 'Testing…' : 'Test Connection'}
              </Button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Get credentials at <a href="https://api-console.zoho.in" className="underline" target="_blank" rel="noreferrer">api-console.zoho.in</a>. Scopes needed: ZohoBooks.bills.CREATE, ZohoBooks.contacts.READ. Then use the "Push to Zoho" button on each approved invoice.
            </p>
          </div>

          {/* QuickBooks Online */}
          <div className="rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="flex items-center gap-3 mb-1">
              <div className="bg-[#2CA01C] rounded px-2 py-1 text-white font-bold text-sm">QB</div>
              <div>
                <div className="font-semibold">QuickBooks Online</div>
                <div className="text-sm text-gray-500">Push approved bills directly to QuickBooks Online</div>
              </div>
            </div>
            <Input value={qb.client_id} onChange={(e) => setQb((p) => ({ ...p, client_id: e.target.value }))} placeholder="QB App Client ID" />
            <Input type="password" value={qb.client_secret} onChange={(e) => setQb((p) => ({ ...p, client_secret: e.target.value }))} placeholder="QB App Client Secret" />
            <Input type="password" value={qb.refresh_token} onChange={(e) => setQb((p) => ({ ...p, refresh_token: e.target.value }))} placeholder="Refresh Token (from Intuit OAuth flow)" />
            <Input value={qb.realm_id} onChange={(e) => setQb((p) => ({ ...p, realm_id: e.target.value }))} placeholder="Realm ID (Company ID)" />
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={qb.environment}
              onChange={(e) => setQb((p) => ({ ...p, environment: e.target.value as QBSettings['environment'] }))}
            >
              <option value="production">Production</option>
              <option value="sandbox">Sandbox (testing)</option>
            </select>
            {qbTestResult && (
              <div className={`rounded p-2 text-sm ${qbTestResult.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                {qbTestResult.ok ? '✅ ' : '❌ '}{qbTestResult.message}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={qbSaving}
                onClick={async () => {
                  setQbSaving(true);
                  try {
                    await saveQBSettings(qb);
                    toast({ title: 'Saved', description: 'QuickBooks settings saved.' });
                  } catch (e) {
                    toast({ title: 'Error', description: String(e), variant: 'destructive' });
                  } finally {
                    setQbSaving(false);
                  }
                }}
              >
                {qbSaving ? 'Saving…' : 'Save QB'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={qbTesting}
                onClick={async () => {
                  setQbTesting(true);
                  setQbTestResult(null);
                  try {
                    const result = await testQBConnection(qb);
                    setQbTestResult(result);
                  } catch (e) {
                    setQbTestResult({ ok: false, message: String(e) });
                  } finally {
                    setQbTesting(false);
                  }
                }}
              >
                {qbTesting ? 'Testing…' : 'Test Connection'}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Get credentials at <a href="https://developer.intuit.com" className="underline" target="_blank" rel="noreferrer">developer.intuit.com</a>. Scope: <code>com.intuit.quickbooks.accounting</code>. Use the OAuth Playground to get a refresh token, then paste it above.
            </p>
          </div>

          {/* Xero placeholder */}
          <div className="rounded-lg border border-gray-200 p-4 opacity-75">
            <div className="flex items-center gap-3">
              <div className="bg-[#13B5EA] rounded px-2 py-1 text-white font-bold text-sm">XERO</div>
              <div>
                <div className="font-semibold">Xero</div>
                <div className="text-sm text-gray-500">Connect via OAuth — add VITE_XERO_CLIENT_ID to .env</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chart of Accounts (Enterprise) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-[#0A4B8F]" />
            <CardTitle>Chart of Accounts</CardTitle>
          </div>
          <CardDescription>
            Upload your GL codes to use your own account numbering. AI will map IFRS categories to your codes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadCOATemplate}>
              <Download className="mr-2 h-4 w-4" />
              Download Template
            </Button>
            <label className="inline-flex cursor-pointer">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleCOAUpload(f);
                  e.target.value = '';
                }}
                disabled={coaUploading}
              />
              <span
                className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium border bg-background hover:bg-accent hover:text-accent-foreground ${coaUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Upload className="mr-2 h-4 w-4" />
                {coaUploading ? 'Uploading...' : 'Upload CSV/Excel'}
              </span>
            </label>
            <Button variant="outline" size="sm" onClick={clearCOA} className="text-red-600 hover:text-red-700">
              <Trash2 className="mr-2 h-4 w-4" />
              Clear & Re-upload
            </Button>
          </div>
          {coaEntries.length > 0 && (
            <div className="rounded-lg border overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">GL Code</th>
                    <th className="px-3 py-2 text-left font-medium">Account Name</th>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-left font-medium">IFRS Mapping</th>
                  </tr>
                </thead>
                <tbody>
                  {coaEntries.map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5 font-mono">{row.gl_code}</td>
                      <td className="px-3 py-1.5">{row.account_name}</td>
                      <td className="px-3 py-1.5">{row.account_type}</td>
                      <td className="px-3 py-1.5 text-blue-600">{row.ifrs_mapping || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {coaEntries.length === 0 && (
            <p className="text-sm text-gray-500">No Chart of Accounts uploaded. Download the template, fill in your GL codes and IFRS mapping, then upload.</p>
          )}
        </CardContent>
      </Card>

      {/* Payment Reminders */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Download className="h-5 w-5 text-[#0A4B8F]" />
            <CardTitle>Payment Reminders</CardTitle>
          </div>
          <CardDescription>
            Send overdue and upcoming-due reminders via n8n (email / WhatsApp). Set VITE_PAYMENT_REMINDER_WEBHOOK_URL in .env.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Label htmlFor="reminder-days" className="whitespace-nowrap">Remind when due within</Label>
            <Input
              id="reminder-days"
              type="number"
              min={1}
              max={90}
              value={reminderDays}
              onChange={(e) => setReminderDays(Math.max(1, Math.min(90, Number(e.target.value))))}
              className="w-24"
            />
            <span className="text-sm text-gray-600">days</span>
          </div>
          <p className="text-xs text-gray-500">
            Checks all Approved invoices not yet paid. Overdue invoices are always included. Webhook payload includes invoice_number, vendor_name, due_date, days_until_due, vendor_email, vendor_phone.
          </p>
          <Button
            variant="outline"
            disabled={reminderSending}
            onClick={async () => {
              setReminderSending(true);
              try {
                const result = await sendPaymentReminders(reminderDays);
                const webhookSet = !!(import.meta.env.VITE_PAYMENT_REMINDER_WEBHOOK_URL as string | undefined);
                toast({
                  title: `Reminders: ${result.sent} sent (${result.overdue} overdue, ${result.due_soon} upcoming)`,
                  description: webhookSet
                    ? result.messages.slice(0, 5).join(' · ') || 'No invoices matched.'
                    : 'Set VITE_PAYMENT_REMINDER_WEBHOOK_URL to actually send. Found: ' + result.messages.slice(0, 3).join(', '),
                });
              } catch (e) {
                toast({ title: 'Error', description: String(e), variant: 'destructive' });
              } finally {
                setReminderSending(false);
              }
            }}
          >
            {reminderSending ? 'Sending…' : 'Send Reminders Now'}
          </Button>
        </CardContent>
      </Card>

      {/* CFO Weekly WhatsApp Summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-[#0A4B8F]" />
            <CardTitle>CFO WhatsApp Summary</CardTitle>
          </div>
          <CardDescription>
            Send a weekly AP summary (invoices, amounts, overdue, top vendors) via WhatsApp or email. Set VITE_CFO_SUMMARY_WEBHOOK_URL in .env.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Label htmlFor="cfo-days" className="whitespace-nowrap">Period</Label>
            <Input
              id="cfo-days"
              type="number"
              min={1}
              max={90}
              value={cfoSummaryDays}
              onChange={(e) => setCfoSummaryDays(Math.max(1, Math.min(90, Number(e.target.value))))}
              className="w-24"
            />
            <span className="text-sm text-gray-600">days</span>
          </div>
          <div>
            <Label htmlFor="cfo-recipients">Recipients (E.164 phone numbers, comma-separated)</Label>
            <Input
              id="cfo-recipients"
              placeholder="+919876543210, +918012345678"
              value={cfoRecipients}
              onChange={(e) => setCfoRecipients(e.target.value)}
              className="mt-1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Used by your n8n workflow to address WhatsApp messages. Passed as recipients[] in payload.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={cfoSending}
            onClick={async () => {
              setCfoSending(true);
              try {
                const phones = cfoRecipients.split(',').map((s) => s.trim()).filter(Boolean);
                const result = await sendCfoSummary(cfoSummaryDays, phones);
                toast({
                  title: result.ok ? 'CFO Summary sent' : 'CFO Summary failed',
                  description: result.message,
                  variant: result.ok ? 'default' : 'destructive',
                });
              } catch (e) {
                toast({ title: 'Error', description: String(e), variant: 'destructive' });
              } finally {
                setCfoSending(false);
              }
            }}
          >
            {cfoSending ? 'Sending…' : 'Send CFO Summary Now'}
          </Button>
        </CardContent>
      </Card>

      {/* Vendor Self-Upload Portal */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-[#0A4B8F]" />
            <CardTitle>Vendor Self-Upload Portal</CardTitle>
          </div>
          <CardDescription>
            Share this link with vendors so they can submit invoices directly — no login required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <Input
              readOnly
              value={`${window.location.origin}/vendor-upload${companyRow.id ? `?company=${companyRow.id}` : ''}`}
              className="font-mono text-sm bg-gray-50"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const url = `${window.location.origin}/vendor-upload${companyRow.id ? `?company=${companyRow.id}` : ''}`;
                void navigator.clipboard.writeText(url);
                toast({ title: 'Copied', description: 'Vendor portal link copied to clipboard.' });
              }}
            >
              Copy
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            Vendors upload PDF/image + their name. File is stored in Supabase Storage and a Processing invoice is created automatically. You can also pass ?company= to scope to a specific company.
          </p>
        </CardContent>
      </Card>

      {/* Email Integration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-[#0A4B8F]" />
            <CardTitle>Email Integration</CardTitle>
          </div>
          <CardDescription>
            Configure email invoice fetching via n8n webhook
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-webhook">n8n Email Webhook URL</Label>
              <Input
                id="email-webhook"
                type="url"
                value={emailWebhookUrl}
                onChange={(e) => setEmailWebhookUrl(e.target.value)}
                placeholder="https://your-n8n-instance.com/webhook/email-invoices"
              />
              <p className="text-xs text-gray-500">
                The n8n webhook URL that handles email fetching and invoice extraction
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-polling">Polling Frequency</Label>
              <Select
                value={emailPollingFrequency}
                onValueChange={setEmailPollingFrequency}
              >
                <SelectTrigger id="email-polling">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual (On Demand)</SelectItem>
                  <SelectItem value="hourly">Every Hour</SelectItem>
                  <SelectItem value="daily">Every Day</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                How often to automatically fetch invoices from email
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-whitelist">Sender Whitelist (Optional)</Label>
              <Input
                id="email-whitelist"
                value={emailSenderWhitelist}
                onChange={(e) => setEmailSenderWhitelist(e.target.value)}
                placeholder="vendor1@example.com, vendor2@example.com"
              />
              <p className="text-xs text-gray-500">
                Comma-separated list of email addresses. Only fetch invoices from these senders. Leave empty to fetch from all senders.
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-[#0A4B8F] hover:bg-[#0D6EFD]"
            >
              {saving ? 'Saving...' : 'Save Email Configuration'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Data Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-blue-600" />
            <CardTitle>Data Management</CardTitle>
          </div>
          <CardDescription>
            Export and manage your invoice data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div>
              <p className="font-medium">Export All Data</p>
              <p className="text-sm text-gray-500">
                Download all invoice data in JSON format
              </p>
            </div>
            <Button onClick={exportAllData} variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Export JSON
            </Button>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="font-medium">Database Information</p>
            <div className="mt-2 space-y-1 text-sm text-gray-600">
              <p>Provider: Supabase PostgreSQL</p>
              <p>Version: 15.x</p>
              <p>Status: Connected</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Preferences */}
      <Card>
        <CardHeader>
          <CardTitle>User Preferences</CardTitle>
          <CardDescription>
            Customize your experience
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Default Currency</Label>
            <Input defaultValue="USD" placeholder="USD" />
          </div>

          <div className="space-y-2">
            <Label>Date Format</Label>
            <Input defaultValue="MM/DD/YYYY" placeholder="MM/DD/YYYY" />
          </div>

          <div className="space-y-2">
            <Label>Timezone</Label>
            <Input defaultValue="UTC" placeholder="UTC" />
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-600">
          <p>
            <strong>InvoiceFlow AP Processing</strong>
          </p>
          <p>Version 1.0.0</p>
          <p>© 2024 InvoiceFlow. All rights reserved.</p>
          <p className="mt-4 text-xs text-gray-500">
            This application helps streamline your accounts payable process with
            automated invoice processing, IFRS classification, and comprehensive
            audit trails.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
