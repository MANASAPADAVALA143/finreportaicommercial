/**
 * Shared Excel bulk-upload parsing — skips title rows, maps column aliases, resolves currency.
 */
import * as XLSX from 'xlsx';

/** Find header row when row 1 is a merged title (e.g. company name). */
export function findBulkExcelHeaderRowIndex(sheet: XLSX.WorkSheet): number {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  const looksLikeHeader = (cell: unknown) => {
    const s = String(cell ?? '').trim().toLowerCase();
    return (
      s.includes('invoice')
      || s.includes('vendor')
      || s.includes('supplier')
      || s === 'invoice_number'
      || s === 'invoice_no'
      || s === 'invoice no'
      || s === 'invoice #'
    );
  };
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const filled = row.filter((c) => String(c ?? '').trim() !== '');
    if (filled.length < 2) continue;
    if (row.some(looksLikeHeader)) return i;
  }
  return 0;
}

export function sheetToBulkJsonRows(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const headerRowIndex = findBulkExcelHeaderRowIndex(sheet);
  return XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: '' }) as Record<string, unknown>[];
}

const BULK_COLUMN_MAP: Record<string, string> = {
  invoice_number: 'invoice_number',
  'invoice number': 'invoice_number',
  'invoice #': 'invoice_number',
  invoice_no: 'invoice_number',
  'invoice no': 'invoice_number',
  'inv no': 'invoice_number',
  invoice_date: 'invoice_date',
  'invoice date': 'invoice_date',
  date: 'invoice_date',
  'inv date': 'invoice_date',
  due_date: 'due_date',
  'due date': 'due_date',
  'payment due': 'due_date',
  vendor_name: 'vendor_name',
  'vendor name': 'vendor_name',
  vendor: 'vendor_name',
  supplier: 'vendor_name',
  'supplier name': 'vendor_name',
  vendor_trn: 'vendor_trn',
  'vendor trn': 'vendor_trn',
  trn: 'vendor_trn',
  'supplier trn': 'vendor_trn',
  vendor_email: 'vendor_email',
  'vendor email': 'vendor_email',
  email: 'vendor_email',
  vendor_phone: 'vendor_phone',
  'vendor phone': 'vendor_phone',
  phone: 'vendor_phone',
  vendor_address: 'vendor_address',
  'vendor address': 'vendor_address',
  address: 'vendor_address',
  total_amount: 'total_amount',
  'total amount': 'total_amount',
  total: 'total_amount',
  'total aed': 'total_amount',
  'net amount': 'total_amount',
  'invoice amount': 'total_amount',
  amount: 'total_amount',
  'amount aed': 'total_amount',
  tax_amount: 'vat_amount',
  'tax amount': 'vat_amount',
  tax_amount_aed: 'vat_amount',
  vat_amount: 'vat_amount',
  'vat amount': 'vat_amount',
  'vat amount aed': 'vat_amount',
  vat_rate: 'vat_rate',
  'vat rate': 'vat_rate',
  'tax rate': 'vat_rate',
  vat_treatment: 'vat_treatment',
  'vat treatment': 'vat_treatment',
  'tax treatment': 'vat_treatment',
  currency: 'currency',
  curr: 'currency',
  description: 'description',
  notes: 'description',
  remarks: 'description',
  gl_code: 'gl_code',
  'gl code': 'gl_code',
  'account code': 'gl_code',
  ledger_code: 'gl_code',
  status: 'status',
  reference: 'reference',
  ref: 'reference',
  po_number: 'po_number',
  'po number': 'po_number',
  'purchase order': 'po_number',
  'po #': 'po_number',
  gstin: 'gstin',
  'vendor gstin': 'gstin',
  'supplier gstin': 'gstin',
};

function normalizeBulkColumnKey(rawKey: string): string {
  return String(rawKey || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeBulkRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const key = normalizeBulkColumnKey(rawKey);
    const mappedKey = BULK_COLUMN_MAP[key] ?? key.replace(/\s+/g, '_');
    normalized[mappedKey] = value;
  }
  return normalized;
}

export function resolveBulkDefaultCurrency(isUAE: boolean): string {
  try {
    const saved = localStorage.getItem('finreportai_ap_market');
    if (saved === 'uae') return 'AED';
    if (saved === 'india') return 'INR';
  } catch {
    /* ignore */
  }
  return isUAE ? 'AED' : 'INR';
}
