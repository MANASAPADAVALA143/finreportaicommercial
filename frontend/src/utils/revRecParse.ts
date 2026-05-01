import Papa from 'papaparse';
import * as XLSX from 'xlsx';

/** Navy / blue tokens aligned with FinReportAI R2R styling */
export const REV_REC_NAVY = '#0F2D5E';
export const REV_REC_BLUE = '#1D4ED8';

function normKey(k: string): string {
  return String(k)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[normKey(k)] = v;
  }
  return out;
}

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

export async function parseTableFile(file: File): Promise<Record<string, unknown>[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await file.text();
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, unknown>>(text, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          if (res.errors?.length) {
            const fatal = res.errors.find((e) => e.type === 'Quotes' || e.type === 'FieldMismatch');
            if (fatal) reject(new Error(fatal.message));
          }
          resolve((res.data || []).map((r) => normalizeRow(r)));
        },
        error: (err: Error) => reject(err),
      });
    });
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    return json.map((r) => normalizeRow(r));
  }
  throw new Error('Use .csv, .xlsx, or .xls');
}

export type BillingRecord = {
  contract_id: string;
  customer_name: string;
  arr: number;
  mrr: number;
  billing_date: string;
  billing_system: string;
};

export function rowsToBillingRecords(rows: Record<string, unknown>[]): BillingRecord[] {
  return rows.map((r) => ({
    contract_id: str(r.contract_id ?? r.contractid ?? r['contract_id']),
    customer_name: str(r.customer_name ?? r.customer ?? r.account_name),
    arr: num(r.arr ?? r.annual_recurring_revenue),
    mrr: num(r.mrr ?? r.monthly_recurring_revenue),
    billing_date: str(r.billing_date ?? r.invoice_date ?? r.date ?? ''),
    billing_system: str(r.billing_system ?? r.system ?? r.source ?? 'sap').toLowerCase() || 'sap',
  }));
}

export type DebitCreditEntry = {
  period: string;
  account_code: string;
  description: string;
  debit: number;
  credit: number;
  posted_by: string;
  posted_date: string;
  contract_id?: string | null;
};

export function rowsToGlRevenueEntries(
  rows: Record<string, unknown>[],
  defaultPeriod: string
): DebitCreditEntry[] {
  return rows.map((r) => ({
    period: str(r.period ?? r.posting_period ?? r.fiscal_period ?? defaultPeriod),
    account_code: str(r.account_code ?? r.gl_account ?? r.account ?? ''),
    description: str(r.description ?? r.memo ?? r.text ?? ''),
    debit: num(r.debit ?? r.dr),
    credit: num(r.credit ?? r.cr),
    posted_by: str(r.posted_by ?? r.user ?? r.created_by ?? ''),
    posted_date: str(r.posted_date ?? r.posting_date ?? r.date ?? r.timestamp ?? ''),
    contract_id: (() => {
      const c = r.contract_id ?? r.contract ?? r.contractid;
      const s = str(c);
      return s || null;
    })(),
  }));
}

export function billingToContractSchedules(records: BillingRecord[]): Array<{
  contract_id: string;
  customer_name: string;
  start_date: string;
  end_date: string;
  total_value: number;
  monthly_amount: number;
  performance_obligation: string;
  recognition_type: string;
}> {
  return records.map((b) => ({
    contract_id: b.contract_id,
    customer_name: b.customer_name,
    start_date: b.billing_date || '1970-01-01',
    end_date: b.billing_date || '1970-01-01',
    total_value: b.arr || b.mrr * 12,
    monthly_amount: b.mrr || b.arr / 12,
    performance_obligation: 'Subscription / recurring services',
    recognition_type: 'over_time',
  }));
}
