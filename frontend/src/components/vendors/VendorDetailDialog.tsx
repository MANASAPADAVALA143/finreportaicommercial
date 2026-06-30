import { useEffect, useState } from 'react';
import type { Vendor, VendorHistory } from '@/lib/ap-invoice/supabase';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useMarket } from '@/contexts/MarketContext';
import { formatCurrency } from '@/utils/currency';
import { displayDate } from '@/utils/dateUtils';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import {
  getVendorHistory,
  updateVendorBankDetails,
} from '@/lib/ap-invoice/vendorMasterService';
import { getInvoiceflowWorkEmail } from '@/lib/ap-invoice/auditService';
import { useToast } from '@/hooks/use-toast';

type Props = {
  vendor: Vendor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

const verificationBadge: Record<string, string> = {
  verified: 'bg-green-100 text-green-800 border-green-200',
  pending_verification: 'bg-amber-100 text-amber-800 border-amber-200',
  flagged: 'bg-red-100 text-red-800 border-red-200',
};

const riskBadge: Record<string, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

export function VendorDetailDialog({ vendor, open, onOpenChange, onSaved }: Props) {
  const { config, isUAE } = useMarket();
  const { dateFormat } = useCompanySettings();
  const { toast } = useToast();
  const [history, setHistory] = useState<VendorHistory[]>([]);
  const [bank, setBank] = useState({
    bank_account_number: '',
    bank_name: '',
    bank_iban: '',
    bank_swift: '',
    change_reason: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!vendor?.id || !open) return;
    setBank({
      bank_account_number: vendor.bank_account_number ?? '',
      bank_name: vendor.bank_name ?? '',
      bank_iban: vendor.bank_iban ?? '',
      bank_swift: vendor.bank_swift ?? '',
      change_reason: '',
    });
    void getVendorHistory(vendor.id).then(setHistory);
  }, [vendor?.id, open, vendor]);

  if (!vendor) return null;

  const vStatus = vendor.bank_verification_status ?? 'verified';

  async function handleSaveBank() {
    if (!vendor) return;
    setSaving(true);
    try {
      const result = await updateVendorBankDetails(
        vendor.id,
        bank,
        getInvoiceflowWorkEmail() ?? undefined,
        vendor.name
      );
      if (result.bankChanged) {
        toast({
          title: 'Bank details updated — payments frozen',
          description: 'Pending payments to this vendor are frozen until AP Manager + CFO approve.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Vendor bank details saved' });
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Save failed — check browser console.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vendor.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={verificationBadge[vStatus] ?? verificationBadge.verified}>
              Bank: {vStatus.replace(/_/g, ' ').toUpperCase()}
            </Badge>
            <Badge variant="outline" className={riskBadge[vendor.risk_level ?? 'low'] ?? riskBadge.low}>
              Risk {vendor.risk_level ?? 'low'} ({Math.round(Number(vendor.risk_score ?? 0))}/100)
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-500">Total spend</p>
              <p className="font-semibold">{formatCurrency(Number(vendor.total_invoices_amount ?? 0), config.currency)}</p>
            </div>
            <div>
              <p className="text-gray-500">Invoices</p>
              <p className="font-semibold">{vendor.total_invoices_count ?? 0}</p>
            </div>
            <div>
              <p className="text-gray-500">{config.taxIdLabel}</p>
              <p className="font-mono text-xs">{vendor.gstin || '—'}</p>
            </div>
            <div>
              <p className="text-gray-500">Last invoice</p>
              <p>{vendor.last_invoice_date ? displayDate(vendor.last_invoice_date, dateFormat) : '—'}</p>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-semibold text-gray-800">Bank details</p>
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              Changing bank details freezes all approved unpaid payments until dual approval (AP + CFO).
            </p>
            <div className="space-y-2">
              <Label>Bank name</Label>
              <Input value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Account number</Label>
              <Input
                className="font-mono text-sm"
                value={bank.bank_account_number}
                onChange={(e) => setBank({ ...bank, bank_account_number: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{isUAE ? 'IBAN' : 'IBAN / Account ref'}</Label>
              <Input
                className="font-mono text-sm"
                value={bank.bank_iban}
                onChange={(e) => setBank({ ...bank, bank_iban: e.target.value })}
                placeholder={isUAE ? 'AE070331234567890123456' : ''}
              />
            </div>
            <div className="space-y-2">
              <Label>SWIFT / BIC</Label>
              <Input
                className="font-mono text-sm"
                value={bank.bank_swift}
                onChange={(e) => setBank({ ...bank, bank_swift: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Reason for change (optional)</Label>
              <Input value={bank.change_reason} onChange={(e) => setBank({ ...bank, change_reason: e.target.value })} />
            </div>
          </div>

          {history.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-sm font-semibold text-gray-800 mb-2">Change history</p>
              <ul className="space-y-2 max-h-40 overflow-y-auto text-xs">
                {history.map((h) => (
                  <li key={h.id} className="rounded border border-gray-100 bg-gray-50 p-2">
                    <span className="font-medium">{h.change_type}</span>
                    {h.field_changed && ` · ${h.field_changed}`}
                    <br />
                    <span className="text-gray-600">
                      {h.old_value || '—'} → {h.new_value || '—'}
                    </span>
                    <br />
                    <span className="text-gray-400">{displayDate(h.created_at, dateFormat)} · {h.changed_by || 'system'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button className="bg-[#0A4B8F]" disabled={saving} onClick={() => void handleSaveBank()}>
            Save bank details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
