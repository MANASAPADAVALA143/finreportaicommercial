import { useEffect, useMemo, useState } from 'react';
import type { Vendor, VendorHistory, InvoiceAnomaly, BankGuarantee, ApAuditLogEntry } from '@/lib/ap-invoice/supabase';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getVendorHistory } from '@/lib/ap-invoice/vendorMasterService';
import { listBankGuarantees, daysUntilExpiry } from '@/lib/ap-invoice/bankGuaranteeService';
import { listInvoiceAnomalies } from '@/lib/ap-invoice/anomalyService';
import { fetchApAuditLog } from '@/lib/ap-invoice/apAuditService';
import { RISK_FLAG_LABELS } from '@/lib/ap-invoice/vendorRiskEngine';
import { formatCurrency } from '@/utils/currency';
import { displayDate } from '@/utils/dateUtils';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { cn } from '@/lib/ap-invoice/utils';
import { Shield, AlertTriangle, History, FileText } from 'lucide-react';
import { supabase } from '@/lib/ap-invoice/supabase';

const riskBadge: Record<string, string> = {
  low: 'border-emerald-700 text-emerald-400',
  medium: 'border-amber-700 text-amber-400',
  high: 'border-orange-700 text-orange-400',
  critical: 'border-red-700 text-red-400',
};

type Props = {
  vendor: Vendor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function VendorRiskDetailDialog({ vendor, open, onOpenChange }: Props) {
  const { baseCurrency, dateFormat } = useCompanySettings();
  const [history, setHistory] = useState<VendorHistory[]>([]);
  const [bgs, setBgs] = useState<BankGuarantee[]>([]);
  const [anomalies, setAnomalies] = useState<InvoiceAnomaly[]>([]);
  const [auditEntries, setAuditEntries] = useState<ApAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vendor?.id || !open) return;
    setLoading(true);
    void (async () => {
      try {
        const [hist, allBgs, allAnomalies, vendorInvoices] = await Promise.all([
          getVendorHistory(vendor.id),
          listBankGuarantees().catch(() => []),
          listInvoiceAnomalies().catch(() => []),
          supabase
            .from('invoices')
            .select('id')
            .ilike('vendor_name', vendor.name)
            .then((r) => (r.data ?? []).map((i) => i.id as string)),
        ]);

        setHistory(hist.filter((h) => h.change_type === 'bank_change' || h.field_changed?.includes('bank')));
        setBgs(allBgs.filter((b) => b.vendor_id === vendor.id));

        const invSet = new Set(vendorInvoices);
        setAnomalies(allAnomalies.filter((a) => a.invoice_id && invSet.has(a.invoice_id)));

        const { entries } = await fetchApAuditLog({ entityType: 'vendor', pageSize: 20 });
        setAuditEntries(entries.filter((e) => e.entity_id === vendor.id));
      } finally {
        setLoading(false);
      }
    })();
  }, [vendor?.id, vendor?.name, open]);

  const flags = useMemo(() => {
    const raw = (vendor?.risk_flags ?? []) as string[];
    return raw.map((f) => ({ code: f, label: RISK_FLAG_LABELS[f] ?? f.replace(/_/g, ' ') }));
  }, [vendor?.risk_flags]);

  if (!vendor) return null;

  const score = Math.round(Number(vendor.risk_score ?? 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto bg-slate-900 border-slate-700 text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-white">{vendor.name} — Risk Detail</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-600 border-t-sky-400" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4 rounded-lg border border-slate-700 bg-slate-800/80 p-4">
              <span className="text-4xl font-bold tabular-nums text-sky-300">{score}</span>
              <div>
                <Badge variant="outline" className={cn('capitalize', riskBadge[vendor.risk_level ?? 'low'])}>
                  {vendor.risk_level ?? 'low'} risk
                </Badge>
                <p className="mt-1 text-sm text-slate-400">
                  Spend {formatCurrency(Number(vendor.total_invoices_amount ?? 0), baseCurrency)} ·{' '}
                  {vendor.total_invoices_count ?? 0} invoices
                </p>
              </div>
            </div>

            <Card className="border-slate-700 bg-slate-800/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-200 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  Risk rule breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {flags.length ? (
                  flags.map((f) => (
                    <div key={f.code} className="rounded border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
                      {f.label}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No active risk flags</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-700 bg-slate-800/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-200 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Invoice anomalies ({anomalies.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-40 overflow-y-auto">
                {anomalies.map((a) => (
                  <div key={a.id} className="rounded border border-slate-600 px-3 py-2 text-xs">
                    <span className="font-semibold text-red-300">{a.flag_code}</span>
                    <span className="text-slate-400"> — {a.flag_reason}</span>
                    <Badge variant="outline" className="ml-2 text-[10px] border-slate-600">{a.status}</Badge>
                  </div>
                ))}
                {!anomalies.length && <p className="text-sm text-slate-500">No anomalies flagged</p>}
              </CardContent>
            </Card>

            <Card className="border-slate-700 bg-slate-800/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-200 flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Bank change timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-36 overflow-y-auto">
                {history.map((h) => (
                  <div key={h.id} className="text-xs text-slate-400 border-l-2 border-amber-600 pl-3 py-1">
                    <span className="text-slate-300">{displayDate(h.created_at, dateFormat)}</span>
                    {' — '}
                    {h.field_changed}: {h.old_value ?? '—'} → {h.new_value ?? '—'}
                    {h.approved_by && <span className="text-emerald-400"> (approved by {h.approved_by})</span>}
                  </div>
                ))}
                {!history.length && <p className="text-sm text-slate-500">No bank changes recorded</p>}
              </CardContent>
            </Card>

            <Card className="border-slate-700 bg-slate-800/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-200 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-sky-400" />
                  Active bank guarantees ({bgs.filter((b) => b.status === 'active').length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {bgs.map((bg) => {
                  const days = daysUntilExpiry(bg.expiry_date);
                  return (
                    <div key={bg.id} className="flex justify-between text-sm rounded border border-slate-600 px-3 py-2">
                      <span className="font-mono text-sky-300">{bg.bg_number}</span>
                      <span className="text-slate-400">{formatCurrency(Number(bg.amount_aed ?? 0), 'AED')}</span>
                      <span className={days <= 7 ? 'text-red-400' : 'text-slate-400'}>{days}d left</span>
                    </div>
                  );
                })}
                {!bgs.length && <p className="text-sm text-slate-500">No bank guarantees on file</p>}
              </CardContent>
            </Card>

            <Card className="border-slate-700 bg-slate-800/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-200">Audit trail (vendor)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 max-h-32 overflow-y-auto text-xs text-slate-400">
                {auditEntries.map((e) => (
                  <div key={e.id}>
                    {displayDate(e.created_at, dateFormat)} — <span className="text-slate-300">{e.action}</span> by {e.action_by ?? 'System'}
                  </div>
                ))}
                {!auditEntries.length && <p className="text-sm text-slate-500">No audit entries yet</p>}
              </CardContent>
            </Card>

            <Button variant="outline" className="w-full border-slate-600" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
