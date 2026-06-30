import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Invoice } from '../../lib/ap-invoice/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useToast } from '../../hooks/use-toast';
import {
  getGstReconInvoices,
  getGstReconSummary,
  ignoreGstMismatch,
  parseGstr2bJson,
  runGstReconciliation,
  uploadGstr2bEntries,
} from '../../lib/ap-invoice/gstService';
import {
  classifyInvoiceToBox,
  computeBoxSummaries,
  FTA_BOX_LABELS,
  getUaeVatReconInvoices,
  getUaeVatReconSummary,
  ignoreUaeVatMismatch,
  parseFtaVatReturnCsv,
  runUaeVatReconciliation,
  uploadFtaReturn,
  type BoxReconSummary,
} from '../../lib/ap-invoice/uaeVatReconService';
import { formatCurrency } from '../../utils/currency';
import { displayDate } from '../../utils/dateUtils';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { useMarket } from '../../contexts/MarketContext';
import { UAE_FTA_QUARTERS } from '../../lib/ap-invoice/marketConfig';
import { Download, Upload } from 'lucide-react';

const TAX_ID_STORAGE = 'invoiceflow_company_tax_id';

function defaultIndiaPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function defaultUaeQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q}-${d.getFullYear()}`;
}

const statusBadge: Record<string, string> = {
  matched: 'bg-green-100 text-green-800 border-green-200',
  mismatch: 'bg-amber-100 text-amber-900 border-amber-300',
  unmatched: 'bg-amber-50 text-amber-950 border-amber-200',
  ignored: 'bg-gray-100 text-gray-700 border-gray-200',
};

export function GstRecon() {
  const { toast } = useToast();
  const { dateFormat } = useCompanySettings();
  const { isUAE, config } = useMarket();
  const [companyGstin, setCompanyGstin] = useState(() => {
    try {
      return localStorage.getItem(TAX_ID_STORAGE) || '';
    } catch {
      return '';
    }
  });
  const [period, setPeriod] = useState(() => (isUAE ? defaultUaeQuarter() : defaultIndiaPeriod()));
  const [summary, setSummary] = useState({ matched: 0, mismatch: 0, unmatched: 0, ignored: 0, total: 0 });
  const [rows, setRows] = useState<Invoice[]>([]);
  const [boxSummary, setBoxSummary] = useState<BoxReconSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [fileJson, setFileJson] = useState<unknown>(null);
  const [fileCsvText, setFileCsvText] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState(0);
  const [uploadPeriod, setUploadPeriod] = useState(period);
  const [uploadGstin, setUploadGstin] = useState(companyGstin);

  useEffect(() => {
    try {
      localStorage.setItem(TAX_ID_STORAGE, companyGstin);
    } catch {
      /* ignore */
    }
  }, [companyGstin]);

  const load = useCallback(
    async (overridePeriod?: string) => {
      const p = overridePeriod ?? period;
      setLoading(true);
      try {
        if (isUAE) {
          const [s, inv] = await Promise.all([getUaeVatReconSummary(p), getUaeVatReconInvoices(p)]);
          setSummary(s);
          setRows(inv);
          setBoxSummary(computeBoxSummaries(p, companyGstin.trim(), inv));
        } else {
          const [s, inv] = await Promise.all([getGstReconSummary(p), getGstReconInvoices(p)]);
          setSummary(s);
          setRows(inv);
          setBoxSummary([]);
        }
      } catch (e) {
        console.error(e);
        toast({
          title: isUAE ? 'VAT recon load failed' : 'GST recon load failed',
          description: e instanceof Error ? e.message : 'Check database migration',
          variant: 'destructive',
        });
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [period, toast, isUAE, companyGstin]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setUploadPeriod(period);
    setUploadGstin(companyGstin);
  }, [uploadOpen, period, companyGstin]);

  async function handleRunRecon() {
    if (!companyGstin.trim()) {
      toast({ title: `Enter company ${config.taxIdLabel}`, variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const r = isUAE
        ? await runUaeVatReconciliation(period, companyGstin.trim())
        : await runGstReconciliation(period, companyGstin.trim());
      toast({
        title: 'Reconciliation complete',
        description: `Matched ${r.matched}, mismatch ${r.mismatch}, unmatched ${r.unmatched}`,
      });
      await load();
    } catch (e) {
      toast({
        title: 'Reconciliation failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleIgnore(id: string) {
    try {
      if (isUAE) await ignoreUaeVatMismatch(id);
      else await ignoreGstMismatch(id);
      toast({ title: 'Marked ignored' });
      await load();
    } catch (e) {
      toast({ title: 'Failed', description: String(e), variant: 'destructive' });
    }
  }

  function onFileIndia(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const raw = JSON.parse(text) as unknown;
        setFileJson(raw);
        const parsed = parseGstr2bJson(raw, uploadGstin.trim() || companyGstin.trim(), uploadPeriod);
        setPreviewCount(parsed.length);
        if (parsed.length === 0) {
          toast({ title: 'No entries parsed', description: 'JSON format not recognized — try another export.', variant: 'destructive' });
        }
      } catch {
        setFileJson(null);
        setPreviewCount(0);
        toast({ title: 'Invalid JSON', variant: 'destructive' });
      }
    };
    reader.readAsText(f);
  }

  function onFileUae(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setFileCsvText(text);
      const snap = parseFtaVatReturnCsv(text, uploadPeriod, uploadGstin.trim() || companyGstin.trim());
      const count = snap.box_totals.length + snap.purchase_lines.length;
      setPreviewCount(count);
      if (count === 0) {
        toast({
          title: 'No FTA data parsed',
          description: 'Use CSV: box,taxable,vat or supplier_trn,name,invoice_no,date,taxable,vat,box',
          variant: 'destructive',
        });
      }
    };
    reader.readAsText(f);
  }

  async function handleUploadConfirmIndia() {
    if (!uploadGstin.trim()) {
      toast({ title: 'Company GSTIN required', variant: 'destructive' });
      return;
    }
    if (!fileJson) {
      toast({ title: 'Choose a JSON file first', variant: 'destructive' });
      return;
    }
    const entries = parseGstr2bJson(fileJson, uploadGstin.trim(), uploadPeriod);
    setBusy(true);
    try {
      const { count } = await uploadGstr2bEntries(entries, uploadPeriod, uploadGstin.trim());
      toast({ title: 'Upload complete', description: `${count} entries for ${uploadPeriod}` });
      setUploadOpen(false);
      setFileJson(null);
      setPreviewCount(0);
      setCompanyGstin(uploadGstin.trim());
      setPeriod(uploadPeriod);
      const r = await runGstReconciliation(uploadPeriod, uploadGstin.trim());
      toast({
        title: 'Auto reconciliation',
        description: `Matched ${r.matched}, mismatch ${r.mismatch}, unmatched ${r.unmatched}`,
      });
      await load(uploadPeriod);
    } catch (e) {
      toast({ title: 'Upload failed', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadConfirmUae() {
    if (!uploadGstin.trim()) {
      toast({ title: 'Company TRN required', variant: 'destructive' });
      return;
    }
    if (!fileCsvText) {
      toast({ title: 'Choose a CSV file first', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const snap = parseFtaVatReturnCsv(fileCsvText, uploadPeriod, uploadGstin.trim());
      const { count } = await uploadFtaReturn(snap);
      toast({ title: 'FTA return uploaded', description: `${count} box/line entries for ${uploadPeriod}` });
      setUploadOpen(false);
      setFileCsvText(null);
      setPreviewCount(0);
      setCompanyGstin(uploadGstin.trim());
      setPeriod(uploadPeriod);
      const r = await runUaeVatReconciliation(uploadPeriod, uploadGstin.trim());
      toast({
        title: 'Auto reconciliation',
        description: `Matched ${r.matched}, mismatch ${r.mismatch}, unmatched ${r.unmatched}`,
      });
      await load(uploadPeriod);
    } catch (e) {
      toast({ title: 'Upload failed', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  const currency = isUAE ? 'AED' : 'INR';

  const exportCsv = useMemo(
    () => () => {
      const headers = isUAE
        ? ['Invoice #', 'Vendor', 'TRN', 'Date', 'VAT Amount', 'FTA Box', 'Status']
        : ['Invoice #', 'Vendor', 'GSTIN', 'Invoice Date', 'GST Amount', 'CGST', 'SGST', 'IGST', 'Status'];
      const lines = rows.map((inv) => {
        const st = inv.gst_recon_status ?? 'unmatched';
        if (isUAE) {
          const box = classifyInvoiceToBox(inv);
          return [
            inv.invoice_number,
            inv.vendor_name,
            inv.gstin ?? '',
            inv.invoice_date,
            inv.gst_amount ?? 0,
            `Box ${box}`,
            st,
          ];
        }
        return [
          inv.invoice_number,
          inv.vendor_name,
          inv.gstin ?? '',
          inv.invoice_date,
          inv.gst_amount ?? 0,
          inv.cgst ?? 0,
          inv.sgst ?? 0,
          inv.igst ?? 0,
          st,
        ];
      }).map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
      const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${isUAE ? 'vat' : 'gst'}-recon-${period}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [rows, period, isUAE]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          {isUAE ? 'VAT Reconciliation' : 'GST Reconciliation'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {isUAE
            ? 'Match AP invoices to FTA VAT Return 201 boxes (1–11)'
            : 'Match books to GSTR-2B for a filing period'}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-4 items-end">
          <div className="space-y-2 min-w-[200px] flex-1">
            <Label>Company {config.taxIdLabel}</Label>
            <Input
              value={companyGstin}
              onChange={(e) => setCompanyGstin(e.target.value)}
              placeholder={`Your company ${config.taxIdLabel}`}
              className="font-mono text-sm"
            />
          </div>
          {isUAE ? (
            <div className="space-y-2 w-[220px]">
              <Label>FTA Filing Quarter</Label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                {UAE_FTA_QUARTERS.map((q) => (
                  <option key={q.value} value={q.value}>{q.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2 w-[180px]">
              <Label>Period (YYYY-MM)</Label>
              <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </div>
          )}
          <Button type="button" variant="outline" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            {isUAE ? 'Upload FTA VAT Return (CSV)' : 'Upload GSTR-2B'}
          </Button>
          <Button type="button" className="bg-[#0A4B8F]" disabled={busy} onClick={() => void handleRunRecon()}>
            Run reconciliation
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ['Matched', summary.matched, 'bg-green-50 border-green-200'],
            ['Mismatch', summary.mismatch, 'bg-amber-50 border-amber-300'],
            ['Unmatched', summary.unmatched, 'bg-amber-50/80 border-amber-200'],
            ['Ignored', summary.ignored, 'bg-gray-50 border-gray-200'],
          ] as const
        ).map(([label, count, cls]) => (
          <Card key={label} className={cls}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-700">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">{count}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isUAE && boxSummary.some((b) => b.books_vat > 0 || b.fta_vat > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>FTA Box Summary (Books vs Return)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Box</TableHead>
                    <TableHead>Books VAT</TableHead>
                    <TableHead>FTA VAT</TableHead>
                    <TableHead>Variance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {boxSummary
                    .filter((b) => b.books_vat > 0 || b.fta_vat > 0)
                    .map((b) => (
                      <TableRow key={b.box}>
                        <TableCell className="text-xs max-w-[240px]">{b.label}</TableCell>
                        <TableCell>{formatCurrency(b.books_vat, currency)}</TableCell>
                        <TableCell>{formatCurrency(b.fta_vat, currency)}</TableCell>
                        <TableCell className={Math.abs(b.variance_vat) > 0.05 ? 'text-amber-700' : ''}>
                          {formatCurrency(b.variance_vat, currency)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={b.matched ? statusBadge.matched : statusBadge.mismatch}>
                            {b.matched ? 'aligned' : 'variance'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Invoices with {config.taxLabel} ({rows.length})</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>{config.taxIdLabel}</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>{config.taxLabel} Amount</TableHead>
                    {isUAE && <TableHead>FTA Box</TableHead>}
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isUAE ? 8 : 7} className="text-center text-gray-500 py-8">
                        No invoices in this period. Upload FTA return and run reconciliation.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((inv) => {
                      const st = inv.gst_recon_status ?? 'unmatched';
                      const box = isUAE ? classifyInvoiceToBox(inv) : null;
                      return (
                        <TableRow key={inv.id}>
                          <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                          <TableCell>{inv.vendor_name}</TableCell>
                          <TableCell className="font-mono text-xs">{inv.gstin || '—'}</TableCell>
                          <TableCell>{displayDate(inv.invoice_date, dateFormat)}</TableCell>
                          <TableCell>{formatCurrency(Number(inv.gst_amount ?? 0), inv.currency || currency)}</TableCell>
                          {isUAE && (
                            <TableCell className="text-xs text-gray-600">
                              Box {box}: {FTA_BOX_LABELS[box!].replace(/^Box \d+ — /, '')}
                            </TableCell>
                          )}
                          <TableCell>
                            <Badge variant="outline" className={statusBadge[st] ?? statusBadge.unmatched}>
                              {st}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {(st === 'mismatch' || st === 'unmatched') && (
                              <Button type="button" size="sm" variant="ghost" onClick={() => void handleIgnore(inv.id)}>
                                Ignore
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isUAE ? 'Upload FTA VAT Return (CSV)' : 'Upload GSTR-2B JSON'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Company {config.taxIdLabel}</Label>
              <Input value={uploadGstin} onChange={(e) => setUploadGstin(e.target.value)} className="font-mono text-sm" />
            </div>
            <div className="space-y-2">
              <Label>{isUAE ? 'Quarter' : 'Period'}</Label>
              {isUAE ? (
                <select
                  value={uploadPeriod}
                  onChange={(e) => setUploadPeriod(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  {UAE_FTA_QUARTERS.map((q) => (
                    <option key={q.value} value={q.value}>{q.label}</option>
                  ))}
                </select>
              ) : (
                <Input type="month" value={uploadPeriod} onChange={(e) => setUploadPeriod(e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <Label>{isUAE ? 'CSV file' : 'JSON file'}</Label>
              <Input
                type="file"
                accept={isUAE ? '.csv,text/csv' : '.json,application/json'}
                onChange={isUAE ? onFileUae : onFileIndia}
              />
            </div>
            {isUAE && (
              <p className="text-xs text-gray-500">
                Box totals: <code>box,taxable,vat</code> — or detail lines with supplier TRN, invoice #, amounts, box.
              </p>
            )}
            <p className="text-sm text-gray-600">
              Preview: <strong>{previewCount}</strong> entries parsed
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || previewCount === 0}
              onClick={() => void (isUAE ? handleUploadConfirmUae() : handleUploadConfirmIndia())}
            >
              Upload & reconcile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
