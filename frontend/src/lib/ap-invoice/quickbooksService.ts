/**
 * QuickBooks Online integration — push approved invoices as Bills.
 *
 * Setup (Settings → QuickBooks):
 *   1. Create an Intuit developer app at https://developer.intuit.com → sandbox or production
 *   2. OAuth 2.0 scopes: com.intuit.quickbooks.accounting
 *   3. Use the OAuth Playground or one-time flow to exchange code for refresh_token
 *   4. Paste client_id, client_secret, refresh_token, realm_id into Settings → QuickBooks
 *
 * Token refresh happens automatically — tokens stored in Supabase app_settings.
 * Intuit tokens: access_token expires in 1 hour, refresh_token expires in 101 days.
 */

import { supabase } from '@/lib/ap-invoice/supabase';
import type { Invoice } from '@/lib/ap-invoice/supabase';

export interface QBSettings {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  realm_id: string;
  /** 'sandbox' for testing, 'production' for live */
  environment: 'sandbox' | 'production';
}

export interface QBPushResult {
  success: boolean;
  message: string;
  bill_id?: string;
}

const SETTING_KEYS = {
  client_id: 'qb_client_id',
  client_secret: 'qb_client_secret',
  refresh_token: 'qb_refresh_token',
  realm_id: 'qb_realm_id',
  environment: 'qb_environment',
  access_token: 'qb_access_token',
  access_token_expiry: 'qb_access_token_expiry',
};

async function readSetting(key: string): Promise<string | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('setting_value')
    .eq('setting_key', key)
    .maybeSingle();
  return (data as { setting_value?: string } | null)?.setting_value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .eq('setting_key', key)
    .maybeSingle();
  if (existing) {
    await supabase
      .from('app_settings')
      .update({ setting_value: value, updated_at: new Date().toISOString() })
      .eq('setting_key', key);
  } else {
    await supabase.from('app_settings').insert({ setting_key: key, setting_value: value });
  }
}

async function getAccessToken(settings: QBSettings): Promise<string> {
  const cached = await readSetting(SETTING_KEYS.access_token);
  const expiry = await readSetting(SETTING_KEYS.access_token_expiry);
  if (cached && expiry && Date.now() < Number(expiry) - 60_000) return cached;

  const tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
  const credentials = btoa(`${settings.client_id}:${settings.client_secret}`);

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: settings.refresh_token,
    }),
  });

  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!json.access_token) {
    throw new Error(`QB token error: ${json.error_description ?? json.error ?? JSON.stringify(json)}`);
  }

  const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
  await writeSetting(SETTING_KEYS.access_token, json.access_token);
  await writeSetting(SETTING_KEYS.access_token_expiry, String(expiresAt));

  // Intuit rotates the refresh token — save the new one
  if (json.refresh_token) {
    await writeSetting(SETTING_KEYS.refresh_token, json.refresh_token);
  }

  return json.access_token;
}

function qbApiBase(environment: 'sandbox' | 'production'): string {
  return environment === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}

function buildBillPayload(invoice: Invoice) {
  return {
    VendorRef: { name: invoice.vendor_name },
    TxnDate: invoice.invoice_date ?? new Date().toISOString().split('T')[0],
    DueDate: invoice.due_date ?? undefined,
    DocNumber: invoice.invoice_number,
    PrivateNote: `InvoiceFlow: GL ${invoice.gl_code ?? ''} ${invoice.gl_name ?? ''}`.trim(),
    Line: [
      {
        Amount: Number(invoice.total_amount ?? 0) - Number(invoice.tax_amount ?? 0),
        DetailType: 'AccountBasedExpenseLineDetail',
        Description: `Invoice ${invoice.invoice_number} — ${invoice.vendor_name}`,
        AccountBasedExpenseLineDetail: {
          AccountRef: { name: invoice.gl_name ?? 'Expenses' },
          TaxCodeRef: invoice.tax_amount ? { value: 'TAX' } : { value: 'NON' },
        },
      },
    ],
    TotalAmt: Number(invoice.total_amount ?? 0),
  };
}

export async function pushInvoiceToQB(
  invoice: Invoice,
  settings: QBSettings
): Promise<QBPushResult> {
  let token: string;
  try {
    token = await getAccessToken(settings);
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }

  const base = qbApiBase(settings.environment);
  const url = `${base}/v3/company/${settings.realm_id}/bill?minorversion=70`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(buildBillPayload(invoice)),
    });

    if (!res.ok) {
      const err = (await res.json()) as { Fault?: { Error?: Array<{ Message?: string; Detail?: string }> } };
      const msg = err.Fault?.Error?.[0]?.Detail ?? err.Fault?.Error?.[0]?.Message ?? `HTTP ${res.status}`;
      return { success: false, message: msg };
    }

    const json = (await res.json()) as { Bill?: { Id?: string } };
    const billId = json.Bill?.Id;

    await supabase
      .from('invoices')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', invoice.id);

    return {
      success: true,
      message: `Bill created in QuickBooks Online (ID: ${billId ?? 'unknown'})`,
      bill_id: billId,
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadQBSettings(): Promise<Partial<QBSettings>> {
  const [client_id, client_secret, refresh_token, realm_id, environment] = await Promise.all([
    readSetting(SETTING_KEYS.client_id),
    readSetting(SETTING_KEYS.client_secret),
    readSetting(SETTING_KEYS.refresh_token),
    readSetting(SETTING_KEYS.realm_id),
    readSetting(SETTING_KEYS.environment),
  ]);
  return {
    client_id: client_id ?? '',
    client_secret: client_secret ?? '',
    refresh_token: refresh_token ?? '',
    realm_id: realm_id ?? '',
    environment: (environment as QBSettings['environment']) ?? 'production',
  };
}

export async function saveQBSettings(s: QBSettings): Promise<void> {
  await Promise.all([
    writeSetting(SETTING_KEYS.client_id, s.client_id),
    writeSetting(SETTING_KEYS.client_secret, s.client_secret),
    writeSetting(SETTING_KEYS.refresh_token, s.refresh_token),
    writeSetting(SETTING_KEYS.realm_id, s.realm_id),
    writeSetting(SETTING_KEYS.environment, s.environment),
  ]);
}

export async function testQBConnection(settings: QBSettings): Promise<{ ok: boolean; message: string }> {
  try {
    const token = await getAccessToken(settings);
    const base = qbApiBase(settings.environment);
    const res = await fetch(
      `${base}/v3/company/${settings.realm_id}/companyinfo/${settings.realm_id}?minorversion=70`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      }
    );
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status} from QuickBooks API` };
    }
    const json = (await res.json()) as { CompanyInfo?: { CompanyName?: string } };
    const name = json.CompanyInfo?.CompanyName ?? 'unknown';
    return { ok: true, message: `Connected to QuickBooks Online — company: ${name}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
