/** Display names for common AP GL codes when invoices.gl_account_name is absent. */
export const GL_ACCOUNT_LABELS: Record<string, string> = {
  '1600': 'Fixed Assets',
  '2100': 'Accounts Payable',
  '2105': 'RCM Payable',
  '6100': 'Operating Expense',
  '6500': 'Non-Recoverable Expense',
};

export function glAccountDisplayName(
  code: string | null | undefined,
  storedName?: string | null,
): string {
  const c = String(code ?? '').trim();
  const stored = String(storedName ?? '').trim();
  if (stored && stored.toLowerCase() !== 'gl account') return stored;
  if (c && GL_ACCOUNT_LABELS[c]) return GL_ACCOUNT_LABELS[c];
  return stored || (c ? 'GL Account' : '');
}
