import { useEffect, useState } from 'react';
import {
  listBankGuarantees,
  getBgSummary,
  daysUntilExpiry,
  expiryColorClass,
  type BgRow,
} from '@/lib/ap-invoice/bankGuaranteeService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/utils/currency';
import { Shield, AlertTriangle, Clock, Banknote } from 'lucide-react';
import { cn } from '@/lib/ap-invoice/utils';

const BG_TYPE_LABELS: Record<string, string> = {
  performance: 'Performance Bond',
  advance_payment: 'Advance Payment',
  retention: 'Retention',
  bid_bond: 'Bid Bond',
};

function vendorLabel(row: BgRow): string {
  return row.vendor_name ?? '—';
}

export function BankGuarantees() {
  const [rows, setRows] = useState<BgRow[]>([]);
  const [summary, setSummary] = useState({ totalActive: 0, expiringIn30: 0, expired: 0, totalValueAed: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const data = await listBankGuarantees();
        setRows(data);
        setSummary(await getBgSummary(data));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const cards = [
    { label: 'Total Active BGs', value: summary.totalActive, icon: Shield, color: 'text-sky-400' },
    { label: 'Expiring in 30 days', value: summary.expiringIn30, icon: Clock, color: 'text-amber-400' },
    { label: 'Expired', value: summary.expired, icon: AlertTriangle, color: 'text-red-400' },
    {
      label: 'Total Value AED',
      value: formatCurrency(summary.totalValueAed, 'AED'),
      icon: Banknote,
      color: 'text-emerald-400',
    },
  ];

  return (
    <div className="space-y-6 rounded-xl bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 text-slate-100 -m-6 lg:-m-8 min-h-[calc(100vh-8rem)]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Bank Guarantee Tracker</h1>
        <p className="mt-1 text-sm text-slate-400">UAE AP — monitor BG expiry and legal exposure</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="border-slate-700/80 bg-slate-900/90 shadow-lg">
            <CardContent className="flex items-center gap-4 p-5">
              <c.icon className={cn('h-8 w-8 shrink-0', c.color)} />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{c.label}</p>
                <p className="text-2xl font-bold text-white">{c.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-slate-700/80 bg-slate-900/90">
        <CardHeader>
          <CardTitle className="text-lg text-white">Bank Guarantees</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-600 border-t-sky-400" />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-slate-800/50">
                    <TableHead className="text-slate-300">BG Number</TableHead>
                    <TableHead className="text-slate-300">Vendor</TableHead>
                    <TableHead className="text-slate-300">Bank</TableHead>
                    <TableHead className="text-slate-300">Type</TableHead>
                    <TableHead className="text-slate-300 text-right">Amount</TableHead>
                    <TableHead className="text-slate-300">Expiry</TableHead>
                    <TableHead className="text-slate-300">Days Left</TableHead>
                    <TableHead className="text-slate-300">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const days = daysUntilExpiry(row.expiry_date);
                    return (
                      <TableRow key={row.id} className="border-slate-700 hover:bg-slate-800/40">
                        <TableCell className="font-mono font-medium text-sky-300">{row.bg_number}</TableCell>
                        <TableCell className="text-slate-200">{vendorLabel(row)}</TableCell>
                        <TableCell className="text-slate-300">{row.issuing_bank ?? '—'}</TableCell>
                        <TableCell className="text-slate-400 text-sm">
                          {BG_TYPE_LABELS[row.bg_type ?? ''] ?? row.bg_type ?? '—'}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-white">
                          {formatCurrency(Number(row.amount_aed ?? 0), row.currency ?? 'AED')}
                        </TableCell>
                        <TableCell className="text-slate-300">{row.expiry_date}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('border font-semibold', expiryColorClass(days))}>
                            {days < 0 ? 'Expired' : `${days}d`}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              'capitalize',
                              row.status === 'active'
                                ? 'border-emerald-700 text-emerald-400'
                                : row.status === 'expired'
                                  ? 'border-red-700 text-red-400'
                                  : 'border-slate-600 text-slate-400',
                            )}
                          >
                            {row.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!rows.length && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-12 text-center text-slate-500">
                        No bank guarantees yet. Run MODULE-DEMO-DATA.sql in Supabase to populate demo rows.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
