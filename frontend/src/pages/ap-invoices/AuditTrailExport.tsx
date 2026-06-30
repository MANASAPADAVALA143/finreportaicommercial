import { useCallback, useEffect, useState } from 'react';
import {
  fetchApAuditLog,
  fetchApAuditForExport,
  exportApAuditCsv,
  exportApAuditExcel,
  printApAuditPdfReport,
} from '@/lib/ap-invoice/apAuditService';
import { getMyCompany } from '@/lib/ap-invoice/companyService';
import { getInvoiceflowWorkEmail } from '@/lib/ap-invoice/auditService';
import type { ApAuditLogEntry } from '@/lib/ap-invoice/supabase';
import { exportAuditCsv, fetchAuditLog } from '@/services/auditLog.service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Download, FileSpreadsheet, FileText, Shield } from 'lucide-react';
import { format } from 'date-fns';

const PAGE_SIZE = 50;

const ENTITY_TYPES = ['all', 'invoice', 'journal_entry', 'ar_invoice', 'payment', 'company', 'period', 'vendor', 'anomaly'];
const ACTION_TYPES = ['all', 'invoice_approved', 'invoice_rejected', 'je_posted', 'je_approved', 'ar_invoice_created', 'ar_payment_received', 'company_setup_completed', 'period_locked'];

export function AuditTrailExport() {
  const year = new Date().getFullYear();
  const [entityType, setEntityType] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [actionBy, setActionBy] = useState('');
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [page, setPage] = useState(0);
  const [entries, setEntries] = useState<ApAuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [companyName, setCompanyName] = useState('Company');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const co = await getMyCompany();
      if (co?.name) setCompanyName(co.name);
      try {
        const { entries: wsRows, total: wsTotal } = await fetchAuditLog({
          from_date: from || undefined,
          to_date: to || undefined,
          action: actionFilter === 'all' ? undefined : actionFilter,
          page,
          page_size: PAGE_SIZE,
          company_id: co?.id,
        });
        const mapped: ApAuditLogEntry[] = wsRows
          .filter(r => entityType === 'all' || r.entity_type === entityType)
          .filter(r => !actionBy.trim() || (r.user_email ?? '').toLowerCase().includes(actionBy.toLowerCase()))
          .map(r => ({
            id: r.id,
            company_id: r.company_id ?? '',
            entity_type: r.entity_type,
            entity_id: r.entity_id ?? null,
            action: r.action,
            action_by: r.user_email ?? null,
            action_by_role: null,
            old_values: null,
            new_values: r.details ?? null,
            notes: r.details ? JSON.stringify(r.details) : null,
            user_agent: null,
            created_at: r.created_at,
          }));
        setEntries(mapped);
        setTotal(wsTotal);
        return;
      } catch {
        /* fall back to Supabase AP audit */
      }
      const { entries: rows, total: t } = await fetchApAuditLog({
        entityType: entityType === 'all' ? undefined : entityType,
        action: actionFilter === 'all' ? undefined : actionFilter,
        actionBy: actionBy.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setEntries(rows);
      setTotal(t);
    } catch (e) {
      console.error(e);
      setEntries([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [entityType, actionFilter, actionBy, from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleExport(kind: 'csv' | 'excel' | 'pdf') {
    setExporting(true);
    try {
      const all = await fetchApAuditForExport({
        entityType: entityType === 'all' ? undefined : entityType,
        action: actionFilter === 'all' ? undefined : actionFilter,
        actionBy: actionBy.trim() || undefined,
        from,
        to,
      });
      if (kind === 'csv') {
        try {
          const { entries: wsAll } = await fetchAuditLog({
            from_date: from || undefined,
            to_date: to || undefined,
            action: actionFilter === 'all' ? undefined : actionFilter,
            page: 0,
            page_size: 500,
          });
          exportAuditCsv(wsAll);
        } catch {
          exportApAuditCsv(all);
        }
      }
      else if (kind === 'excel') exportApAuditExcel(all);
      else {
        printApAuditPdfReport({
          companyName,
          entries: all,
          from,
          to,
          generatedBy: getInvoiceflowWorkEmail() ?? 'AP User',
        });
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6 rounded-xl bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 text-slate-100 -m-6 lg:-m-8 min-h-[calc(100vh-8rem)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Shield className="h-7 w-7 text-sky-400" />
            AP Audit Trail Export
          </h1>
          <p className="mt-1 text-sm text-slate-400">Years of documentation — PDF, Excel, CSV export</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600 text-slate-200"
            disabled={exporting}
            onClick={() => void handleExport('pdf')}
          >
            <FileText className="mr-2 h-4 w-4" /> PDF Report
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600 text-slate-200"
            disabled={exporting}
            onClick={() => void handleExport('excel')}
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600 text-slate-200"
            disabled={exporting}
            onClick={() => void handleExport('csv')}
          >
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
        </div>
      </div>

      <Card className="border-slate-700/80 bg-slate-900/90">
        <CardHeader>
          <CardTitle className="text-base text-white">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <Label className="text-slate-400">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border-slate-600 bg-slate-800" />
          </div>
          <div>
            <Label className="text-slate-400">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border-slate-600 bg-slate-800" />
          </div>
          <div>
            <Label className="text-slate-400">Entity type</Label>
            <Select value={entityType} onValueChange={(v) => { setEntityType(v); setPage(0); }}>
              <SelectTrigger className="border-slate-600 bg-slate-800"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t === 'all' ? 'All' : t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-400">Action</Label>
            <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(0); }}>
              <SelectTrigger className="border-slate-600 bg-slate-800"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t === 'all' ? 'All' : t.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-400">User</Label>
            <Input
              placeholder="email…"
              value={actionBy}
              onChange={(e) => setActionBy(e.target.value)}
              className="border-slate-600 bg-slate-800"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={() => void load()} className="w-full bg-sky-600 hover:bg-sky-500">Apply</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700/80 bg-slate-900/90">
        <CardContent className="p-0 pt-4">
          <p className="px-6 pb-3 text-sm text-slate-400">{total} action{total !== 1 ? 's' : ''} in selected period</p>
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-600 border-t-sky-400" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700">
                    <TableHead className="text-slate-300">Timestamp</TableHead>
                    <TableHead className="text-slate-300">Entity</TableHead>
                    <TableHead className="text-slate-300">Action</TableHead>
                    <TableHead className="text-slate-300">By</TableHead>
                    <TableHead className="text-slate-300">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id} className="border-slate-700 hover:bg-slate-800/40">
                      <TableCell className="text-slate-400 text-sm whitespace-nowrap">
                        {format(new Date(e.created_at), 'dd MMM yyyy HH:mm')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-slate-600 text-slate-300">{e.entity_type}</Badge>
                      </TableCell>
                      <TableCell className="text-sky-300">{e.action}</TableCell>
                      <TableCell className="text-slate-300">{e.action_by ?? '—'}</TableCell>
                      <TableCell className="max-w-xs truncate text-slate-500 text-sm">{e.notes ?? ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t border-slate-700 px-6 py-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  className="border-slate-600"
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-slate-400">Page {page + 1}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  className="border-slate-600"
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
