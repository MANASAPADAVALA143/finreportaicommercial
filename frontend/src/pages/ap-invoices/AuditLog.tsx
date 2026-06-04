import { useCallback, useEffect, useState } from 'react';
import {
  getAuditLog,
  fetchAuditLogForExport,
  exportAuditLogCsv,
  type AuditEntityCategory,
} from '../../lib/ap-invoice/auditService';
import type { AuditLogEntry } from '../../lib/ap-invoice/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { format } from 'date-fns';
import { cn } from '../../lib/ap-invoice/utils';

const PAGE_SIZE = 50;

function actionBadgeClass(action: string): string {
  if (action.startsWith('approval.')) return 'bg-purple-100 text-purple-800 border-purple-200';
  if (action.startsWith('payment.')) return 'bg-blue-100 text-blue-800 border-blue-200';
  if (action.startsWith('gst.')) return 'bg-green-100 text-green-800 border-green-200';
  if (action.startsWith('duplicate.')) return 'bg-amber-100 text-amber-900 border-amber-200';
  if (action.startsWith('invoice.')) return 'bg-gray-100 text-gray-800 border-gray-200';
  return 'bg-slate-100 text-slate-800 border-slate-200';
}

function shortEntityId(id: string | null): string {
  if (!id) return '';
  const s = id.replace(/-/g, '');
  return s.length >= 8 ? `${s.slice(0, 8)}â€¦` : id;
}

export function AuditLog() {
  const [category, setCategory] = useState<AuditEntityCategory>('all');
  const [performedBy, setPerformedBy] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { entries: rows, total: t } = await getAuditLog({
        entityCategory: category,
        performedBy: performedBy.trim() || undefined,
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
  }, [category, performedBy, from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function clearFilters() {
    setCategory('all');
    setPerformedBy('');
    setFrom('');
    setTo('');
    setPage(0);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const rows = await fetchAuditLogForExport({
        entityCategory: category,
        performedBy: performedBy.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      exportAuditLogCsv(rows);
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Audit log</h1>
        <p className="mt-1 text-sm text-gray-500">
          Complete history of every action in InvoiceFlow
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="space-y-2 min-w-[180px]">
            <Label>Entity type</Label>
            <Select
              value={category}
              onValueChange={(v) => {
                setPage(0);
                setCategory(v as AuditEntityCategory);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="invoice">Invoice</SelectItem>
                <SelectItem value="approval">Approval</SelectItem>
                <SelectItem value="payment">Payment</SelectItem>
                <SelectItem value="gst">GST</SelectItem>
                <SelectItem value="vendor">Vendor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 flex-1 min-w-[200px]">
            <Label>User email</Label>
            <Input
              placeholder="Search by email"
              value={performedBy}
              onChange={(e) => {
                setPage(0);
                setPerformedBy(e.target.value);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setPage(0);
                setFrom(e.target.value);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setPage(0);
                setTo(e.target.value);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void handleExport()} disabled={exporting}>
              {exporting ? 'Exportingâ€¦' : 'Export CSV'}
            </Button>
          </div>
          <button
            type="button"
            className="text-sm text-blue-600 hover:underline lg:ml-2"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-gray-500">Loadingâ€¦</p>
          ) : entries.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-12">
              No audit entries yet. Actions you take in InvoiceFlow will appear here.
            </p>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Performed by</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {format(new Date(e.created_at), 'dd MMM yyyy, HH:mm')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('font-normal', actionBadgeClass(e.action))}>
                            {e.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="font-medium">{e.entity_type}</span>
                          {e.entity_id ? (
                            <span className="ml-1 font-mono text-xs text-muted-foreground">
                              {shortEntityId(e.entity_id)}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {e.performed_by ?? 'â€”'}
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          <button
                            type="button"
                            className="text-left text-xs text-blue-600 hover:underline w-full truncate"
                            onClick={() => setExpanded((prev) => (prev === e.id ? null : e.id))}
                          >
                            {expanded === e.id ? 'Hide metadata' : 'Show metadata'}
                          </button>
                          {expanded === e.id ? (
                            <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-[11px] whitespace-pre-wrap break-all">
                              {JSON.stringify(e.metadata ?? {}, null, 2)}
                            </pre>
                          ) : (
                            <p className="text-xs text-muted-foreground truncate mt-1">
                              {JSON.stringify(e.metadata ?? {})}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4 flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  {total} total Â· page {page + 1} of {Math.max(1, maxPage + 1)}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= maxPage}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

