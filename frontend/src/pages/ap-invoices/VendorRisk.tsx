import { useEffect, useMemo, useState } from 'react';
import { listVendorsForCompany } from '@/lib/ap-invoice/vendorMasterService';
import { listBankGuarantees } from '@/lib/ap-invoice/bankGuaranteeService';
import { listInvoiceAnomalies } from '@/lib/ap-invoice/anomalyService';
import type { Vendor } from '@/lib/ap-invoice/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency';
import { cn } from '@/lib/ap-invoice/utils';
import { AlertTriangle, Shield } from 'lucide-react';
import { VendorRiskDetailDialog } from '@/components/vendors/VendorRiskDetailDialog';

const riskBadge: Record<string, string> = {
  low: 'border-emerald-700 text-emerald-400 bg-emerald-950/40',
  medium: 'border-amber-700 text-amber-400 bg-amber-950/40',
  high: 'border-orange-700 text-orange-400 bg-orange-950/40',
  critical: 'border-red-700 text-red-400 bg-red-950/40',
};

function riskGauge(score: number): string {
  if (score >= 81) return 'text-red-400';
  if (score >= 51) return 'text-orange-400';
  if (score >= 21) return 'text-amber-400';
  return 'text-emerald-400';
}

export function VendorRisk() {
  const { fmt } = useDisplayCurrency();
  const [detailVendor, setDetailVendor] = useState<Vendor | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [bgs, setBgs] = useState<Awaited<ReturnType<typeof listBankGuarantees>>>([]);
  const [anomalies, setAnomalies] = useState<Awaited<ReturnType<typeof listInvoiceAnomalies>>>([]);
  const [loading, setLoading] = useState(true);
  const [riskFilter, setRiskFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [v, bg, an] = await Promise.all([
          listVendorsForCompany(),
          listBankGuarantees().catch(() => []),
          listInvoiceAnomalies().catch(() => []),
        ]);
        setVendors(v);
        setBgs(bg);
        setAnomalies(an);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const bgByVendor = useMemo(() => {
    const m: Record<string, number> = {};
    for (const bg of bgs) {
      if (bg.vendor_id && bg.status === 'active') m[bg.vendor_id] = (m[bg.vendor_id] ?? 0) + 1;
    }
    return m;
  }, [bgs]);

  const filtered = vendors
    .filter((v) => {
      if (riskFilter !== 'all' && (v.risk_level ?? 'low') !== riskFilter) return false;
      if (search && !v.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort(
      (a, b) => Number(b.total_invoices_amount ?? 0) - Number(a.total_invoices_amount ?? 0),
    );

  const attention = filtered.filter((v) => ['critical', 'high'].includes(v.risk_level ?? 'low'));

  return (
    <div className="space-y-6 rounded-xl bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 text-slate-100 -m-6 lg:-m-8 min-h-[calc(100vh-8rem)]">
      <div>
        <h1 className="text-2xl font-bold text-white">Vendor Risk Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">
          Portfolio risk scores, flags, and bank guarantee coverage
          {anomalies.length > 0 && ` · ${anomalies.filter((a) => a.status === 'open').length} open anomaly flags`}
        </p>
      </div>

      {attention.length > 0 && (
        <Card className="border-red-900/60 bg-red-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-red-300">
              <AlertTriangle className="h-5 w-5" />
              Vendors requiring attention ({attention.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {attention.map((v) => (
              <Badge key={v.id} variant="outline" className={riskBadge[v.risk_level ?? 'high']}>
                {v.name} — {Math.round(Number(v.risk_score ?? 0))}/100
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search vendor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs border-slate-600 bg-slate-800 text-white"
        />
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="w-40 border-slate-600 bg-slate-800 text-white">
            <SelectValue placeholder="Risk level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border-slate-700/80 bg-slate-900/90">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-600 border-t-sky-400" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700">
                  <TableHead className="text-slate-300">Vendor</TableHead>
                  <TableHead className="text-slate-300">Risk Score</TableHead>
                  <TableHead className="text-slate-300">Level</TableHead>
                  <TableHead className="text-slate-300">Flags</TableHead>
                  <TableHead className="text-slate-300 text-right">Total Spend</TableHead>
                  <TableHead className="text-slate-300">Last Invoice</TableHead>
                  <TableHead className="text-slate-300">Bank</TableHead>
                  <TableHead className="text-slate-300">BGs</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((v) => {
                  const score = Math.round(Number(v.risk_score ?? 25));
                  const flags = (v.risk_flags ?? []) as string[];
                  return (
                    <TableRow key={v.id} className="border-slate-700 hover:bg-slate-800/40">
                      <TableCell className="font-medium text-white">{v.name}</TableCell>
                      <TableCell>
                        <span className={cn('text-xl font-bold tabular-nums', riskGauge(score))}>{score}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize', riskBadge[v.risk_level ?? 'low'])}>
                          {v.risk_level ?? 'low'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-400 text-sm">{flags.length || '—'}</TableCell>
                      <TableCell className="text-right text-slate-200">
                        {fmt(Number(v.total_invoices_amount ?? 0))}
                      </TableCell>
                      <TableCell className="text-slate-400">{v.last_invoice_date ?? '—'}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            v.bank_verification_status === 'verified'
                              ? 'border-emerald-700 text-emerald-400'
                              : 'border-amber-700 text-amber-400'
                          }
                        >
                          {v.bank_verification_status ?? 'unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-300">
                        {bgByVendor[v.id] ? (
                          <span className="flex items-center gap-1">
                            <Shield className="h-3.5 w-3.5" /> {bgByVendor[v.id]}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-slate-600 text-slate-200"
                          onClick={() => {
                            setDetailVendor(v);
                            setDetailOpen(true);
                          }}
                        >
                          Detail
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <VendorRiskDetailDialog
        vendor={detailVendor}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
