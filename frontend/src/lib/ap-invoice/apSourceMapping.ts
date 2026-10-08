/**
 * Source-data mapping for AP imports. Keeps four layers separate:
 * business (source) category → IFRS classification → GL code → GL account name.
 */

export type GlMasterEntry = {
  name: string;
  type: 'Asset' | 'Liability' | 'Expense';
  business_category: string;
};

/** Default UAE AP GL master; a company chart_of_accounts row always wins over this. */
export const AP_GL_MASTER: Record<string, GlMasterEntry> = {
  '1500': { name: 'IT Equipment (PP&E)', type: 'Asset', business_category: 'IT Infrastructure' },
  '1510': { name: 'Software & Licences (Intangible)', type: 'Asset', business_category: 'Software & Licenses' },
  '6100': { name: 'Professional Fees', type: 'Expense', business_category: 'Professional Services' },
  '6200': { name: 'Telecom & Utilities', type: 'Expense', business_category: 'Telecom & Utilities' },
  '6300': { name: 'Office Supplies', type: 'Expense', business_category: 'Office Supplies' },
  '6400': { name: 'Security Services', type: 'Expense', business_category: 'Security Services' },
  '6500': { name: 'Audit & Compliance Fees', type: 'Expense', business_category: 'Audit & Compliance' },
  '6600': { name: 'Travel & Transport', type: 'Expense', business_category: 'Travel & Transport' },
  '6800': { name: 'Rent & Lease', type: 'Expense', business_category: 'Rent & Lease' },
};

const IFRS_BY_BUSINESS_CATEGORY: Record<string, { expense: string; asset?: string }> = {
  'audit & compliance': { expense: 'Audit & Professional Fees' },
  'professional services': { expense: 'Professional Services' },
  'telecom & utilities': { expense: 'Utilities & Telecom' },
  utilities: { expense: 'Utilities & Telecom' },
  'security services': { expense: 'Security & Facility Services' },
  'travel & transport': { expense: 'Travel & Transport' },
  'rent & lease': { expense: 'Rent & Lease (IFRS 16)' },
  'office supplies': { expense: 'Office Supplies' },
  'it infrastructure': {
    expense: 'IT Infrastructure',
    asset: 'Property, Plant & Equipment (IAS 16)',
  },
  'software & licenses': {
    expense: 'Software & Licenses',
    asset: 'Intangible Assets (IAS 38)',
  },
  'software & licences': {
    expense: 'Software & Licenses',
    asset: 'Intangible Assets (IAS 38)',
  },
  marketing: { expense: 'Marketing & Advertising' },
  'marketing & advertising': { expense: 'Marketing & Advertising' },
};

function isAssetGl(glCode: string, glCategory: string): boolean {
  const cat = glCategory.trim().toLowerCase();
  if (cat.includes('asset')) return true;
  if (cat.includes('expense')) return false;
  return /^1\d{3}$/.test(glCode.trim());
}

/** IFRS classification derived from the source business category and GL nature. */
export function ifrsFromSourceCategory(
  category: string | null | undefined,
  glCode: string | null | undefined,
  glCategory: string | null | undefined,
): { ifrs_category: string; ifrs_explanation: string } | null {
  const cat = String(category ?? '').trim();
  if (!cat) return null;
  const code = String(glCode ?? '').trim();
  const glCat = String(glCategory ?? '').trim();
  const hit = IFRS_BY_BUSINESS_CATEGORY[cat.toLowerCase()];
  const asset = isAssetGl(code, glCat);
  const ifrs = hit ? (asset && hit.asset ? hit.asset : hit.expense) : cat;
  const glPart = code ? ` · GL ${code}${glCat ? ` (${glCat})` : ''}` : '';
  return {
    ifrs_category: ifrs,
    ifrs_explanation: `Source category "${cat}"${glPart}`,
  };
}

/** GL account name: explicit sheet name → company CoA (caller) → default master → business category. */
export function glAccountNameFor(
  glCode: string | null | undefined,
  sheetGlName: string | null | undefined,
  category: string | null | undefined,
): string | null {
  const name = String(sheetGlName ?? '').trim();
  if (name) return name;
  const code = String(glCode ?? '').trim();
  if (code && AP_GL_MASTER[code]) return AP_GL_MASTER[code].name;
  const cat = String(category ?? '').trim();
  return cat || null;
}

const VENDOR_NOISE = new Set([
  'llc', 'l.l.c', 'fze', 'fzco', 'fz', 'fzllc', 'pjsc', 'psc', 'plc', 'ltd', 'limited',
  'inc', 'co', 'company', 'est', 'establishment', 'uae', 'the',
]);

/** "DEWA (Dubai Electricity)" and "DEWA" → "dewa"; "Oracle Middle East" → "oracle". */
export function normalizeVendorName(name: string | null | undefined): string {
  let s = String(name ?? '').toLowerCase();
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/middle east/g, ' ');
  s = s.replace(/[^a-z0-9&\s]/g, ' ');
  return s
    .split(/\s+/)
    .filter((w) => w && !VENDOR_NOISE.has(w))
    .join(' ')
    .trim();
}

/** Same vendor when codes agree, or normalized names are equal / one is a whole-word prefix of the other. */
export function sameVendor(
  a: string | null | undefined,
  b: string | null | undefined,
  codeA?: string | null,
  codeB?: string | null,
): boolean {
  const ca = String(codeA ?? '').trim().toUpperCase();
  const cb = String(codeB ?? '').trim().toUpperCase();
  if (ca && cb) return ca === cb;
  const na = normalizeVendorName(a);
  const nb = normalizeVendorName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.startsWith(`${nb} `) || nb.startsWith(`${na} `);
}

export type SourceWorkflowState = {
  status: 'Processing' | 'Approved' | 'Paid' | 'Rejected' | 'On Hold';
  payment_status: 'unpaid' | 'scheduled' | 'paid';
  approved: boolean;
};

/** Map sheet approval_status / payment_status to the app's workflow fields. */
export function workflowFromSource(
  approvalStatus: string | null | undefined,
  paymentStatus: string | null | undefined,
): SourceWorkflowState | null {
  const a = String(approvalStatus ?? '').trim().toLowerCase();
  const p = String(paymentStatus ?? '').trim().toLowerCase();
  if (!a && !p) return null;
  const payment: SourceWorkflowState['payment_status'] =
    p === 'paid' ? 'paid' : p === 'scheduled' ? 'scheduled' : 'unpaid';
  const approved = a === 'approved' || payment !== 'unpaid';
  let status: SourceWorkflowState['status'] = 'Processing';
  if (a === 'rejected') status = 'Rejected';
  else if (a === 'on hold' || a === 'on_hold' || a === 'hold') status = 'On Hold';
  else if (payment === 'paid') status = 'Paid';
  else if (approved) status = 'Approved';
  return { status, payment_status: payment, approved };
}
