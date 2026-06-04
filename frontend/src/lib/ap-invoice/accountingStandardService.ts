import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { getMyCompany, requireCompanyId } from './companyService';
import { IFRS_STANDARD_GL } from '@/utils/ifrsStandardGL';

export type AccountingStandard =
  | 'IFRS'
  | 'US_GAAP'
  | 'IND_AS'
  | 'IGAAP'
  | 'CASH_BASIS'
  | 'CUSTOM';

export type GLSuggestionSource = 'company_chart' | 'standard_fallback' | 'ai_suggested' | 'manual';

export interface StandardConfig {
  label: string;
  shortLabel: string;
  description: string;
  whoUsesIt: string;
  categories: StandardCategory[];
}

export interface StandardCategory {
  code: string;
  name: string;
  type: 'expense' | 'asset' | 'liability' | 'revenue';
  standardRef?: string;
  keywords: string[];
}

type GLAccountRow = {
  gl_code: string;
  gl_name: string;
  account_type: string;
  is_active?: boolean | null;
};

function mapCategoryTypeToAccountType(t: StandardCategory['type']): GLAccountRow['account_type'] {
  switch (t) {
    case 'asset':
      return 'Asset';
    case 'liability':
      return 'Liability';
    case 'revenue':
      return 'Revenue';
    case 'expense':
    default:
      return 'Expense';
  }
}

function mapCsvTypeToAccountType(raw: string): GLAccountRow['account_type'] {
  const s = raw.toLowerCase();
  if (s.includes('asset')) return 'Asset';
  if (s.includes('liab')) return 'Liability';
  if (s.includes('equity')) return 'Equity';
  if (s.includes('revenue') || s.includes('income')) return 'Revenue';
  if (s.includes('cogs') || s.includes('cost of')) return 'COGS';
  return 'Expense';
}

export const STANDARD_TEMPLATES: Record<AccountingStandard, StandardConfig> = {
  IFRS: {
    label: 'IFRS',
    shortLabel: 'IFRS',
    description: 'International Financial Reporting Standards',
    whoUsesIt: 'MNCs, listed companies, global businesses',
    categories: [
      { code: '1000', name: 'Property Plant & Equipment', type: 'asset', standardRef: 'IAS 16', keywords: ['equipment', 'machinery', 'vehicle', 'furniture'] },
      { code: '1500', name: 'Intangible Assets', type: 'asset', standardRef: 'IAS 38', keywords: ['software', 'license', 'patent', 'brand'] },
      { code: '5000', name: 'Cost of Sales', type: 'expense', standardRef: 'IAS 2', keywords: ['raw material', 'inventory', 'goods'] },
      { code: '6000', name: 'Employee Benefits', type: 'expense', standardRef: 'IAS 19', keywords: ['salary', 'wages', 'staff', 'payroll', 'hr'] },
      { code: '6100', name: 'Professional Services', type: 'expense', standardRef: 'IAS 1', keywords: ['consulting', 'legal', 'audit', 'advisory'] },
      { code: '6200', name: 'Lease Expense', type: 'expense', standardRef: 'IFRS 16', keywords: ['rent', 'lease', 'office space', 'wework'] },
      { code: '6300', name: 'Utilities', type: 'expense', standardRef: 'IAS 1', keywords: ['electricity', 'water', 'internet', 'phone', 'bsnl', 'airtel', 'tsspdcl'] },
      { code: '6400', name: 'Marketing & Advertising', type: 'expense', standardRef: 'IAS 38', keywords: ['marketing', 'advertising', 'ads', 'google', 'meta', 'brand'] },
      { code: '6500', name: 'Travel & Entertainment', type: 'expense', standardRef: 'IAS 1', keywords: ['travel', 'hotel', 'flight', 'makemytrip', 'cab'] },
      { code: '6600', name: 'IT & Technology', type: 'expense', standardRef: 'IAS 38', keywords: ['saas', 'cloud', 'aws', 'azure', 'github', 'hosting'] },
      { code: '7000', name: 'Research & Development', type: 'expense', standardRef: 'IAS 38', keywords: ['r&d', 'research', 'development', 'innovation'] },
      { code: '7100', name: 'Finance Costs', type: 'expense', standardRef: 'IAS 23', keywords: ['interest', 'bank charges', 'loan'] },
    ],
  },
  US_GAAP: {
    label: 'US GAAP',
    shortLabel: 'GAAP',
    description: 'Generally Accepted Accounting Principles (US)',
    whoUsesIt: 'US subsidiaries, SaaS companies, US-listed firms',
    categories: [
      { code: '1000', name: 'Property & Equipment', type: 'asset', standardRef: 'ASC 360', keywords: ['equipment', 'machinery', 'vehicle'] },
      { code: '1500', name: 'Intangible Assets', type: 'asset', standardRef: 'ASC 350', keywords: ['software', 'license', 'patent'] },
      { code: '5000', name: 'Cost of Goods Sold', type: 'expense', standardRef: 'ASC 330', keywords: ['raw material', 'inventory'] },
      { code: '6000', name: 'Compensation & Benefits', type: 'expense', standardRef: 'ASC 718', keywords: ['salary', 'wages', 'payroll'] },
      { code: '6100', name: 'Professional Fees', type: 'expense', standardRef: 'ASC 720', keywords: ['consulting', 'legal', 'audit'] },
      { code: '6200', name: 'Rent & Occupancy', type: 'expense', standardRef: 'ASC 842', keywords: ['rent', 'lease', 'office'] },
      { code: '6300', name: 'Utilities', type: 'expense', standardRef: 'ASC 720', keywords: ['electricity', 'water', 'internet'] },
      { code: '6400', name: 'Sales & Marketing', type: 'expense', standardRef: 'ASC 340', keywords: ['marketing', 'advertising', 'sales'] },
      { code: '6500', name: 'Travel & Entertainment', type: 'expense', standardRef: 'ASC 720', keywords: ['travel', 'hotel', 'flight'] },
      { code: '6600', name: 'Software & Technology', type: 'expense', standardRef: 'ASC 350-40', keywords: ['saas', 'cloud', 'aws', 'github'] },
      { code: '7000', name: 'Research & Development', type: 'expense', standardRef: 'ASC 730', keywords: ['r&d', 'research'] },
    ],
  },
  IND_AS: {
    label: 'Ind AS',
    shortLabel: 'Ind AS',
    description: 'Indian Accounting Standards (converged with IFRS)',
    whoUsesIt: 'Indian listed companies, large unlisted companies',
    categories: [
      { code: '1000', name: 'Property Plant & Equipment', type: 'asset', standardRef: 'Ind AS 16', keywords: ['equipment', 'machinery'] },
      { code: '6000', name: 'Employee Benefits', type: 'expense', standardRef: 'Ind AS 19', keywords: ['salary', 'pf', 'gratuity'] },
      { code: '6100', name: 'Professional & Legal', type: 'expense', standardRef: 'Ind AS 1', keywords: ['consulting', 'legal', 'ca'] },
      { code: '6200', name: 'Lease Rentals', type: 'expense', standardRef: 'Ind AS 116', keywords: ['rent', 'lease'] },
      { code: '6300', name: 'Power & Fuel', type: 'expense', standardRef: 'Ind AS 1', keywords: ['electricity', 'diesel', 'fuel'] },
      { code: '6400', name: 'Advertisement & Publicity', type: 'expense', standardRef: 'Ind AS 1', keywords: ['marketing', 'advertising'] },
      { code: '6500', name: 'Travelling & Conveyance', type: 'expense', standardRef: 'Ind AS 1', keywords: ['travel', 'cab', 'flight'] },
      { code: '7000', name: 'Research & Development', type: 'expense', standardRef: 'Ind AS 38', keywords: ['r&d', 'research'] },
    ],
  },
  IGAAP: {
    label: 'IGAAP',
    shortLabel: 'IGAAP',
    description: 'Indian GAAP (Companies Act)',
    whoUsesIt: 'Private Indian companies, SMEs, traditional businesses',
    categories: [
      { code: '1000', name: 'Fixed Assets', type: 'asset', standardRef: 'AS 10', keywords: ['equipment', 'machinery', 'furniture'] },
      { code: '5000', name: 'Purchase of Stock-in-Trade', type: 'expense', standardRef: 'AS 2', keywords: ['inventory', 'goods', 'stock'] },
      { code: '6000', name: 'Salaries & Wages', type: 'expense', standardRef: 'AS 15', keywords: ['salary', 'wages', 'staff'] },
      { code: '6100', name: 'Professional Charges', type: 'expense', standardRef: 'AS 1', keywords: ['consulting', 'legal', 'ca', 'audit'] },
      { code: '6200', name: 'Rent', type: 'expense', standardRef: 'AS 1', keywords: ['rent', 'office', 'lease'] },
      { code: '6300', name: 'Electricity Charges', type: 'expense', standardRef: 'AS 1', keywords: ['electricity', 'power', 'bescom', 'tsspdcl'] },
      { code: '6400', name: 'Advertisement Expenses', type: 'expense', standardRef: 'AS 1', keywords: ['advertising', 'marketing', 'publicity'] },
      { code: '6500', name: 'Travelling Expenses', type: 'expense', standardRef: 'AS 1', keywords: ['travel', 'conveyance', 'cab'] },
      { code: '6600', name: 'Repairs & Maintenance', type: 'expense', standardRef: 'AS 1', keywords: ['repair', 'maintenance', 'amc'] },
      { code: '7000', name: 'Miscellaneous Expenses', type: 'expense', standardRef: 'AS 26', keywords: ['misc', 'other'] },
    ],
  },
  CASH_BASIS: {
    label: 'Cash basis',
    shortLabel: 'Cash',
    description: 'Simple cash in / cash out tracking',
    whoUsesIt: 'Small businesses, trusts, partnerships',
    categories: [
      { code: 'C100', name: 'Staff & Labour', type: 'expense', keywords: ['salary', 'wages', 'staff'] },
      { code: 'C200', name: 'Rent & Premises', type: 'expense', keywords: ['rent', 'office'] },
      { code: 'C300', name: 'Utilities', type: 'expense', keywords: ['electricity', 'water', 'internet'] },
      { code: 'C400', name: 'Supplies & Materials', type: 'expense', keywords: ['supply', 'material', 'inventory'] },
      { code: 'C500', name: 'Professional Services', type: 'expense', keywords: ['consulting', 'legal', 'ca'] },
      { code: 'C600', name: 'Travel', type: 'expense', keywords: ['travel', 'cab', 'flight'] },
      { code: 'C700', name: 'Marketing', type: 'expense', keywords: ['marketing', 'advertising'] },
      { code: 'C800', name: 'Equipment', type: 'asset', keywords: ['equipment', 'laptop', 'machinery'] },
      { code: 'C900', name: 'Other Expenses', type: 'expense', keywords: ['other', 'misc'] },
    ],
  },
  CUSTOM: {
    label: 'Custom only',
    shortLabel: 'Custom',
    description: 'Use only your own GL codes — no standard fallback',
    whoUsesIt: 'Societies, restaurants, schools, NGOs',
    categories: [],
  },
};

const STANDARD_ALIASES: Record<string, AccountingStandard> = {
  IFRS: 'IFRS',
  US_GAAP: 'US_GAAP',
  IND_AS: 'IND_AS',
  IGAAP: 'IGAAP',
  CASH_BASIS: 'CASH_BASIS',
  CUSTOM: 'CUSTOM',
  J_GAAP: 'IFRS',
  MFRS: 'IFRS',
  PFRS: 'IFRS',
};

export function normalizeAccountingStandard(raw: string | null | undefined): AccountingStandard {
  if (!raw || !String(raw).trim()) return 'IFRS';
  const key = String(raw).trim().toUpperCase().replace(/[\s-]+/g, '_');
  const mapped = STANDARD_ALIASES[key] ?? (STANDARD_ALIASES[raw as keyof typeof STANDARD_ALIASES] as AccountingStandard | undefined);
  if (mapped) return mapped;
  if (key in STANDARD_TEMPLATES) return key as AccountingStandard;
  return 'IFRS';
}

export async function getAccountingStandard(client: SupabaseClient = supabase): Promise<AccountingStandard> {
  const cid = (await getMyCompany())?.id;
  let q = client.from('company_settings').select('accounting_standard').order('updated_at', { ascending: false }).limit(1);
  if (cid) q = q.eq('company_id', cid);
  const { data, error } = await q.maybeSingle();
  if (error || !data?.accounting_standard) return 'IFRS';
  return normalizeAccountingStandard(data.accounting_standard);
}

export async function setAccountingStandard(standard: AccountingStandard, client: SupabaseClient = supabase) {
  const company_id = (await getMyCompany())?.id ?? (await requireCompanyId());
  let sel = client.from('company_settings').select('id').order('updated_at', { ascending: false }).limit(1);
  if (company_id) sel = sel.eq('company_id', company_id);
  const { data: row } = await sel.maybeSingle();
  const now = new Date().toISOString();
  if (row?.id) {
    await client
      .from('company_settings')
      .update({ accounting_standard: standard, updated_at: now })
      .eq('id', row.id);
    return;
  }
  await client.from('company_settings').insert({
    company_id,
    accounting_standard: standard,
    updated_at: now,
    country: 'IN',
    base_currency: 'INR',
  });
}

export type SmartGLResult = {
  code: string;
  name: string;
  source: 'company_chart' | 'standard_fallback' | 'ai_suggested';
  standardRef?: string;
  accountType: string;
  confidence: number;
  needsConfirmation: boolean;
};

export async function resolveGLCodeSmart(
  client: SupabaseClient,
  params: {
    ifrsCategory: string;
    description: string;
    vendorName: string;
  }
): Promise<SmartGLResult> {
  const { ifrsCategory, description, vendorName } = params;
  const standard = await getAccountingStandard(client);
  const cat = (ifrsCategory || '').trim();
  const searchText = `${cat} ${description || ''} ${vendorName || ''}`.toLowerCase();

  const tenantId = (await getMyCompany())?.id;
  let glQ = client
    .from('gl_accounts')
    .select('gl_code, gl_name, account_type, is_active')
    .eq('is_active', true)
    .order('gl_code', { ascending: true });
  if (tenantId) glQ = glQ.eq('company_id', tenantId);
  const { data: companyGLs, error: glErr } = await glQ;

  if (!glErr && companyGLs?.length) {
    const rows = companyGLs as GLAccountRow[];
    const catLower = cat.toLowerCase();
    const exactMatch = rows.find(
      (gl) =>
        catLower &&
        (gl.gl_name.toLowerCase().includes(catLower) || catLower.includes(gl.gl_name.toLowerCase()))
    );
    if (exactMatch) {
      return {
        code: exactMatch.gl_code,
        name: exactMatch.gl_name,
        source: 'company_chart',
        accountType: exactMatch.account_type || 'Expense',
        confidence: 95,
        needsConfirmation: false,
      };
    }
    const keywordMatch = rows.find((gl) => searchText.includes(gl.gl_name.toLowerCase()));
    if (keywordMatch) {
      return {
        code: keywordMatch.gl_code,
        name: keywordMatch.gl_name,
        source: 'company_chart',
        accountType: keywordMatch.account_type || 'Expense',
        confidence: 80,
        needsConfirmation: false,
      };
    }
  }

  if (standard !== 'CUSTOM') {
    const template = STANDARD_TEMPLATES[standard];
    const byCategoryName = template.categories.find(
      (c) => cat && c.name.toLowerCase() === cat.toLowerCase()
    );
    if (byCategoryName) {
      return {
        code: byCategoryName.code,
        name: byCategoryName.name,
        source: 'standard_fallback',
        standardRef: byCategoryName.standardRef,
        accountType: mapCategoryTypeToAccountType(byCategoryName.type),
        confidence: 75,
        needsConfirmation: true,
      };
    }
    const bestMatch = template.categories.find((c) =>
      c.keywords.some((kw) => searchText.includes(kw.toLowerCase()))
    );
    if (bestMatch) {
      return {
        code: bestMatch.code,
        name: bestMatch.name,
        source: 'standard_fallback',
        standardRef: bestMatch.standardRef,
        accountType: mapCategoryTypeToAccountType(bestMatch.type),
        confidence: 70,
        needsConfirmation: true,
      };
    }
  }

  const legacy = cat ? IFRS_STANDARD_GL[cat] : undefined;
  if (legacy && standard !== 'CUSTOM') {
    return {
      code: legacy.code,
      name: legacy.name,
      source: 'standard_fallback',
      accountType: 'Expense',
      confidence: 65,
      needsConfirmation: true,
    };
  }

  return {
    code: '9999',
    name: 'Unclassified Expense',
    source: 'ai_suggested',
    accountType: 'Expense',
    confidence: 30,
    needsConfirmation: true,
  };
}

function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQ = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
          continue;
        }
        inQ = false;
        continue;
      }
      field += c;
      continue;
    }
    if (c === '"') {
      inQ = true;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\n') {
      row.push(field);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export async function importGLFromCSV(
  client: SupabaseClient,
  csvText: string,
  source: 'tally' | 'zoho' | 'manual'
): Promise<{ imported: number; error: string | null }> {
  const table = parseCSVRows(csvText.trim());
  if (table.length < 2) return { imported: 0, error: 'CSV has no data rows' };
  const headers = table[0].map((h) => h.trim().toLowerCase());
  const codeIdx = headers.findIndex((h) => h.includes('code') || h.includes('ledger'));
  const nameIdx = headers.findIndex((h) => h.includes('name') || h.includes('account'));
  const typeIdx = headers.findIndex((h) => h.includes('type') || h.includes('group'));
  if (codeIdx < 0 || nameIdx < 0) return { imported: 0, error: 'Need columns containing "code"/"ledger" and "name"/"account"' };

  const records = table.slice(1).map((cols) => {
    const pad = (idx: number) => (idx >= 0 && idx < cols.length ? cols[idx].trim().replace(/^"|"$/g, '') : '');
    const code = pad(codeIdx);
    const name = pad(nameIdx);
    const typeRaw = typeIdx >= 0 ? pad(typeIdx) : '';
    return {
      gl_code: code,
      gl_name: name || code,
      account_type: mapCsvTypeToAccountType(typeRaw),
      is_active: true,
      imported_from: source,
    };
  }).filter((r) => r.gl_code && r.gl_name);

  if (records.length === 0) return { imported: 0, error: 'No valid rows' };

  const { error } = await client.from('gl_accounts').upsert(records, { onConflict: 'gl_code' });
  return { imported: records.length, error: error?.message ?? null };
}

function monthRangeISO(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const last = new Date(y, m, 0).getDate();
  const end = `${month}-${String(last).padStart(2, '0')}`;
  return { start, end };
}

export async function exportForZoho(
  client: SupabaseClient,
  month: string
): Promise<string> {
  const { start, end } = monthRangeISO(month);
  const { data: invoices, error } = await client
    .from('invoices')
    .select(
      'invoice_number, vendor_name, total_amount, invoice_date, gl_account_code, gl_code, gl_account_name, gl_name, ifrs_category, currency, status, approval_status, gl_confirmed'
    )
    .gte('invoice_date', start)
    .lte('invoice_date', end);

  if (error) throw new Error(error.message);

  const rows = (invoices || []).filter((inv: Record<string, unknown>) => {
    const approved = inv.status === 'Approved' || inv.approval_status === 'approved';
    const code = (inv.gl_account_code ?? inv.gl_code) as string | null;
    return approved && inv.gl_confirmed === true && code;
  });

  const headers = ['Date', 'Vendor Name', 'Invoice No', 'Amount', 'Currency', 'Account Code', 'Account Name', 'Category'];
  const lines = [
    headers.join(','),
    ...rows.map((inv: Record<string, unknown>) =>
      [
        inv.invoice_date,
        `"${String(inv.vendor_name ?? '').replace(/"/g, '""')}"`,
        inv.invoice_number,
        inv.total_amount,
        inv.currency ?? 'INR',
        inv.gl_account_code ?? inv.gl_code,
        `"${String(inv.gl_account_name ?? inv.gl_name ?? '').replace(/"/g, '""')}"`,
        `"${String(inv.ifrs_category ?? '').replace(/"/g, '""')}"`,
      ].join(',')
    ),
  ];
  return lines.join('\n');
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function exportForTally(
  client: SupabaseClient,
  month: string
): Promise<string> {
  const { start, end } = monthRangeISO(month);
  const { data: invoices, error } = await client
    .from('invoices')
    .select('*')
    .gte('invoice_date', start)
    .lte('invoice_date', end);
  if (error) throw new Error(error.message);

  const rows = (invoices || []).filter((inv: Record<string, unknown>) => {
    const approved = inv.status === 'Approved' || inv.approval_status === 'approved';
    const code = (inv.gl_account_code ?? inv.gl_code) as string | null;
    return approved && inv.gl_confirmed === true && code;
  });

  const entries = rows
    .map((inv: Record<string, unknown>) => {
      const dateStr = String(inv.invoice_date ?? '').replace(/-/g, '');
      const num = escapeXml(String(inv.invoice_number ?? ''));
      const party = escapeXml(String(inv.vendor_name ?? ''));
      const amt = Number(inv.total_amount ?? 0);
      const ledger = escapeXml(String(inv.gl_account_name ?? inv.gl_name ?? 'Purchase Accounts'));
      return `
  <VOUCHER VCHTYPE="Purchase" ACTION="Create">
    <DATE>${dateStr}</DATE>
    <VOUCHERNUMBER>${num}</VOUCHERNUMBER>
    <PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>
    <AMOUNT>${amt}</AMOUNT>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${ledger}</LEDGERNAME>
      <AMOUNT>-${amt}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
  </VOUCHER>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA><REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
  </REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
  ${entries}
  </TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY>
</ENVELOPE>`;
}

export async function loadStandardTemplateGLAccounts(
  client: SupabaseClient,
  standard: AccountingStandard
): Promise<{ inserted: number; skipped: number; error: string | null }> {
  if (standard === 'CUSTOM') return { inserted: 0, skipped: 0, error: null };
  const company_id = await requireCompanyId();
  const template = STANDARD_TEMPLATES[standard];
  const { data: existing } = await client.from('gl_accounts').select('gl_code').eq('company_id', company_id);
  const have = new Set((existing || []).map((r: { gl_code: string }) => r.gl_code));
  let inserted = 0;
  let skipped = 0;
  for (const c of template.categories) {
    if (have.has(c.code)) {
      skipped++;
      continue;
    }
    const { error } = await client.from('gl_accounts').insert({
      company_id,
      gl_code: c.code,
      gl_name: c.name,
      account_type: mapCategoryTypeToAccountType(c.type),
      is_active: true,
      imported_from: 'template',
      standard_reference: c.standardRef ?? null,
    });
    if (error) return { inserted, skipped, error: error.message };
    inserted++;
    have.add(c.code);
  }
  return { inserted, skipped, error: null };
}

export async function countUnconfirmedAiGlInvoices(client: SupabaseClient = supabase): Promise<number> {
  const { count, error } = await client
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('gl_suggestion_source', 'ai_suggested')
    .eq('gl_confirmed', false);
  if (error) return 0;
  return count ?? 0;
}

export async function logGlSuggestionAction(
  client: SupabaseClient,
  payload: {
    invoiceId: string;
    ifrsCategory: string | null;
    suggestedCode: string | null;
    suggestedName: string | null;
    accountingStandard: AccountingStandard;
    action: 'confirmed' | 'overridden' | 'skipped';
    finalCode: string | null;
    finalName: string | null;
  }
) {
  const std = payload.accountingStandard;
  const company_id = (await getMyCompany())?.id;
  if (!company_id) return;
  await client.from('gl_suggestions_log').insert({
    company_id,
    invoice_id: payload.invoiceId,
    ifrs_category: payload.ifrsCategory,
    suggested_code: payload.suggestedCode,
    suggested_name: payload.suggestedName,
    accounting_standard: std,
    action: payload.action,
    final_code: payload.finalCode,
    final_name: payload.finalName,
  });
}
