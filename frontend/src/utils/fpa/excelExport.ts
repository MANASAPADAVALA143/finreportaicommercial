import type { VarianceRow } from '../../types/fpa';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || '';

function toVariancePayload(rows: VarianceRow[]) {
  return rows
    .filter((r) => !r.isHeader)
    .map((r) => ({
      account: r.category,
      budget: Number(r.budget) || 0,
      actual: Number(r.actual) || 0,
      variance: Number(r.variance) || 0,
      variance_pct: Number(r.variancePct) || 0,
      department: r.department || 'All Depts',
    }));
}

export async function exportVarianceExcelWithAI(rows: VarianceRow[]): Promise<void> {
  if (!API_BASE) throw new Error('API base URL is not configured.');
  const payloadRows = toVariancePayload(rows);
  if (!payloadRows.length) throw new Error('No variance rows available to export.');

  const response = await fetch(`${API_BASE}/api/fpa/variance/export-excel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variance_data: payloadRows }),
  });
  if (!response.ok) throw new Error(await response.text());

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fpa_report_ai_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  window.URL.revokeObjectURL(url);
}

