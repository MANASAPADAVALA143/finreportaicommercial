import * as XLSX from 'xlsx';
import type { GLLine } from '@/services/internalAudit.service';

export const UPLOAD_CHUNK_SIZE = 2000;

const ALIASES: Record<keyof GLLine | 'debit' | 'credit', string[]> = {
  journal_id: ['journal_id', 'je_id', 'je_number', 'entry_id', 'entry_no', 'voucher_no', 'voucher_number', 'document_no', 'doc_no', 'reference', 'id'],
  posting_date: ['posting_date', 'date', 'je_date', 'entry_date', 'txn_date', 'transaction_date', 'voucher_date', 'doc_date', 'value_date'],
  account: ['account', 'account_code', 'account_no', 'account_number', 'gl_code', 'gl_account', 'ledger_code', 'ledger'],
  account_name: ['account_name', 'account_description', 'gl_name', 'ledger_name', 'account_title'],
  amount: ['amount', 'net_amount', 'value', 'line_amount'],
  debit: ['debit', 'dr', 'debit_amount'],
  credit: ['credit', 'cr', 'credit_amount'],
  user_id: ['user_id', 'posted_by', 'created_by', 'user', 'preparer'],
  source: ['source', 'source_module', 'module', 'journal_type'],
  description: ['description', 'narration', 'memo', 'remarks', 'line_description'],
  entity: ['entity', 'branch', 'cost_center', 'division'],
};

function norm(key: string): string {
  return key.toLowerCase().trim().replace(/[\s\-./]+/g, '_');
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[^0-9.\-()]/g, '');
  if (!s) return 0;
  const negative = s.startsWith('(') && s.endsWith(')');
  const n = Number(s.replace(/[()]/g, ''));
  return Number.isFinite(n) ? (negative ? -n : n) : 0;
}

function toIsoDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 30000 && serial < 60000) {
    return toIsoDate(new Date(Math.round((serial - 25569) * 86400 * 1000)));
  }
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : toIsoDate(d);
}

export type ParsedGL = {
  lines: GLLine[];
  skipped: number;
  columns: string[];
  months: string[];
  missing: string[];
};

export function mapRows(rows: Record<string, unknown>[]): ParsedGL {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const byNorm = new Map(columns.map((c) => [norm(c), c]));
  const pick = (field: keyof typeof ALIASES) => ALIASES[field].map((a) => byNorm.get(a)).find(Boolean);
  const col = Object.fromEntries(Object.keys(ALIASES).map((f) => [f, pick(f as keyof typeof ALIASES)])) as Record<
    keyof typeof ALIASES,
    string | undefined
  >;

  const missing: string[] = [];
  if (!col.journal_id) missing.push('Journal ID');
  if (!col.posting_date) missing.push('Posting date');
  if (!col.account) missing.push('Account');
  if (!col.amount && !col.debit && !col.credit) missing.push('Amount (or Debit/Credit)');
  if (missing.length) return { lines: [], skipped: rows.length, columns, months: [], missing };

  const text = (row: Record<string, unknown>, c?: string) => (c ? String(row[c] ?? '').trim() : '');
  const lines: GLLine[] = [];
  let skipped = 0;
  for (const row of rows) {
    const date = toIsoDate(row[col.posting_date!]);
    const journalId = text(row, col.journal_id);
    const account = text(row, col.account);
    const amount = col.amount
      ? Math.abs(toNumber(row[col.amount]))
      : Math.abs(toNumber(row[col.debit ?? ''])) || Math.abs(toNumber(row[col.credit ?? '']));
    if (!date || !journalId || !account || !amount) {
      skipped += 1;
      continue;
    }
    lines.push({
      journal_id: journalId,
      posting_date: date,
      account,
      account_name: text(row, col.account_name) || undefined,
      amount,
      user_id: text(row, col.user_id),
      source: text(row, col.source) || 'ERP',
      description: text(row, col.description) || undefined,
      entity: text(row, col.entity) || undefined,
    });
  }
  const months = [...new Set(lines.map((l) => l.posting_date.slice(0, 7)))].sort();
  return { lines, skipped, columns, months, missing };
}

export async function parseGLFile(file: File): Promise<ParsedGL> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return mapRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' }));
}

export function chunk<T>(items: T[], size = UPLOAD_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
