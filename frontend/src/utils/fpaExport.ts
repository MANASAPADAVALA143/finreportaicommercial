import * as XLSX from 'xlsx';

export function exportRowsToExcel(filename: string, sheets: { name: string; rows: Record<string, unknown>[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export function downloadBase64Pdf(base64: string, filename: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Opens print dialog on a minimal HTML document (browser “Save as PDF”). */
export function exportHtmlPrintPdf(title: string, innerHtml: string) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(
    `<!DOCTYPE html><html><head><title>${title}</title></head><body style="font-family:system-ui">${innerHtml}<script>window.onload=function(){window.print()}<\/script></body></html>`
  );
  w.document.close();
}
