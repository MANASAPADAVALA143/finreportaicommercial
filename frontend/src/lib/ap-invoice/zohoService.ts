/**
 * Zoho Books integration — push approved invoices as Bills.
 *
 * Setup (Settings → Zoho Books):
 *   1. Create a Zoho API client at https://api-console.zoho.com → Self Client → Server-based
 *   2. Scopes: ZohoBooks.bills.CREATE, ZohoBooks.bills.READ, ZohoBooks.contacts.READ
 *   3. Generate code → exchange for refresh_token (one-time, paste into Settings)
 *   4. Save client_id, client_secret, refresh_token, organization_id in Settings
 *
 * Token refresh is automatic — stored in Supabase app_settings so it survives browser sessions.
 */

import { supabase } from '@/lib/supabase';
import { logAction } from '@/lib/auditService';
import type { Invoice } from '@/lib/supabase';

export interface ZohoSettings {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  organization_id: string;
  /** Zoho data center: com | in | eu | com.au | jp */
  domain: 'com' | 'in' | 'eu' | 'com.au' | 'jp';
}

export interface ZohoPushResult {
  success: boolean;
  message: string;
  bill_id?: string;
  bill_number?: string;
}

const SETTING_KEYS = {
  client_id: 'zoho_client_id',
  client_secret: 'zoho_client_secret',
  refresh_token: 'zoho_refresh_token',
  organization_id: 'zoho_organization_id',
  domain: 'zoho_domain',
  access_token: 'zoho_access_token',
  access_token_expiry: 'zoho_access_token_expiry',
};

async function readSetting(key: string): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('setting_value').eq('setting_key', key).maybeSingle();
  return (data as { setting_value?: string } | null)?.setting_value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  const { data: existing } = await supabase.from('app_settings').select('id').eq('setting_key', key).maybeSingle();
  if (existing) {
    await supabase.from('app_settings').update({ setting_value: value, updated_at: new Date().toISOString() }).eq('setting_key', key);
  } else {
    await supabase.from('app_settings').insert({ setting_key: key, setting_value: value });
  }
}

async function getAccessToken(settings: ZohoSettings): Promise<string> {
  const cached = await readSetting(SETTING_KEYS.access_token);
  const expiry = await readSetting(SETTING_KEYS.access_token_expiry);
  if (cached && expiry && Date.now() < Number(expiry) - 60_000) return cached;

  const tokenUrl = `https://accounts.zoho.${settings.domain}/oauth/v2/token`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: settings.client_id,
    client_secret: settings.client_secret,
    refresh_token: settings.refresh_token,
  });

  const res = await fetch(tokenUrl, { method: 'POST', body });
  const json = await res.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!json.access_token) throw new Error(`Zoho token error: ${json.error ?? JSON.stringify(json)}`);

  const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
  await writeSetting(SETTING_KEYS.access_token, json.access_token);
  await writeSetting(SETTING_KEYS.access_token_expiry, String(expiresAt));
  return json.access_token;
}

function buildBillPayload(invoice: Invoice) {
  return {
    vendor_name: invoice.vendor_name,
    bill_number: invoice.invoice_number,
    date: invoice.invoice_date,
    due_date: invoice.due_date,
    currency_code: invoice.currency || 'INR',
    line_items: [
      {
        description: `Invoice ${invoice.invoice_number} — ${invoice.vendor_name}`,
        rate: Number(invoice.total_amount) - Number(invoice.tax_amount ?? 0),
        quantity: 1,
        tax_percentage: invoice.tax_rate ?? 0,
      },
    ],
    notes: `Imported from InvoiceFlow. GL: ${invoice.gl_code ?? ''} ${invoice.gl_name ?? ''}`.trim(),
  };
}

export async function pushInvoiceToZoho(
  invoice: Invoice,
  settings: ZohoSettings,
  performedBy?: string
): Promise<ZohoPushResult> {
  let token: string;
  try {
    token = await getAccessToken(settings);
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }

  const apiBase = `https://www.zohoapis.${settings.domain}`;
  const url = `${apiBase}/books/v3/bills?organization_id=${settings.organization_id}`;
  const billPayload = buildBillPayload(invoice);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ JSONString: JSON.stringify(billPayload) }),
    });

    const json = await res.json() as { code?: number; message?: string; bill?: { bill_id?: string; bill_number?: string } };

    if (json.code !== 0) {
      return { success: false, message: json.message ?? `Zoho error code ${json.code}` };
    }

    const billId = json.bill?.bill_id;
    const billNumber = json.bill?.bill_number;

    await supabase.from('invoices').update({
      updated_at: new Date().toISOString(),
    }).eq('id', invoice.id);

    logAction('tally.sync', 'invoice', invoice.id, performedBy ?? null, {
      integration: 'zoho',
      bill_id: billId,
    });

    return { success: true, message: `Bill created in Zoho Books (${billNumber ?? billId})`, bill_id: billId, bill_number: billNumber };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadZohoSettings(): Promise<Partial<ZohoSettings>> {
  const [client_id, client_secret, refresh_token, organization_id, domain] = await Promise.all([
    readSetting(SETTING_KEYS.client_id),
    readSetting(SETTING_KEYS.client_secret),
    readSetting(SETTING_KEYS.refresh_token),
    readSetting(SETTING_KEYS.organization_id),
    readSetting(SETTING_KEYS.domain),
  ]);
  return {
    client_id: client_id ?? '',
    client_secret: client_secret ?? '',
    refresh_token: refresh_token ?? '',
    organization_id: organization_id ?? '',
    domain: (domain as ZohoSettings['domain']) ?? 'in',
  };
}

export async function saveZohoSettings(s: ZohoSettings): Promise<void> {
  await Promise.all([
    writeSetting(SETTING_KEYS.client_id, s.client_id),
    writeSetting(SETTING_KEYS.client_secret, s.client_secret),
    writeSetting(SETTING_KEYS.refresh_token, s.refresh_token),
    writeSetting(SETTING_KEYS.organization_id, s.organization_id),
    writeSetting(SETTING_KEYS.domain, s.domain),
  ]);
}

export async function testZohoConnection(settings: ZohoSettings): Promise<{ ok: boolean; message: string }> {
  try {
    const token = await getAccessToken(settings);
    const apiBase = `https://www.zohoapis.${settings.domain}`;
    const res = await fetch(`${apiBase}/books/v3/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const json = await res.json() as { code?: number; organizations?: unknown[] };
    if (json.code === 0) {
      const count = (json.organizations ?? []).length;
      return { ok: true, message: `Connected to Zoho Books — ${count} organization(s) found.` };
    }
    return { ok: false, message: `Zoho responded with code ${json.code}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
