/** Demo / screenshot-friendly vendor labels (no DB migration required). */
export function anonymiseVendor(name: string): string {
  const n = name.trim();
  const exact: Record<string, string> = {
    'Amazon Web Services India': 'CloudMatrix Technologies Pvt. Ltd.',
    'Amazon Web Services': 'CloudMatrix Technologies Ltd.',
    AWS: 'CloudMatrix Technologies',
    'Google Cloud': 'DataSphere Solutions',
    'Microsoft Azure': 'NetCore Systems Ltd.',
  };
  if (exact[n]) return exact[n];
  if (/amazon\s*web\s*services/i.test(n)) {
    return /india/i.test(n) ? 'CloudMatrix Technologies Pvt. Ltd.' : 'CloudMatrix Technologies Ltd.';
  }
  if (/\baws\b/i.test(n) && n.length < 40) return 'CloudMatrix Technologies';
  if (/google\s*cloud/i.test(n)) return 'DataSphere Solutions';
  if (/microsoft\s*azure/i.test(n)) return 'NetCore Systems Ltd.';
  return n;
}

/** Replace known hyperscaler names inside insight titles, details, or comma-separated lists. */
export function redactDemoVendorNames(text: string): string {
  let t = text;
  t = t.replace(/Amazon Web Services India/gi, 'CloudMatrix Technologies Pvt. Ltd.');
  t = t.replace(/Amazon Web Services/gi, 'CloudMatrix Technologies Ltd.');
  t = t.replace(/\bGoogle Cloud\b/gi, 'DataSphere Solutions');
  t = t.replace(/\bMicrosoft Azure\b/gi, 'NetCore Systems Ltd.');
  t = t.replace(/\bAWS\b(?=\s|,|$|\))/gi, 'CloudMatrix Technologies');
  return t;
}
