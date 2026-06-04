import { useEffect, useState } from 'react';
import { useMarket } from '@/contexts/MarketContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import type { NormalizedExtractedInvoice } from '@/lib/cameraService';

export type PreviewLineItem = {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: NormalizedExtractedInvoice | null;
  confidence?: number;
  saving: boolean;
  lineItems?: PreviewLineItem[];
  onSave: (values: NormalizedExtractedInvoice) => void;
};

export function InvoiceExtractionPreviewModal({
  open,
  onOpenChange,
  initial,
  confidence,
  saving,
  lineItems,
  onSave,
}: Props) {
  const { config } = useMarket();
  const [v, setV] = useState<NormalizedExtractedInvoice | null>(null);

  useEffect(() => {
    if (open && initial) setV({ ...initial });
    if (!open) setV(null);
  }, [open, initial]);

  if (!v) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Review extracted invoice</DialogTitle>
          <DialogDescription>
            Edit fields if needed, then save to Supabase.{' '}
            {confidence != null ? (
              <span className="font-medium text-foreground">Confidence: {Math.round(confidence)}%</span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label>Invoice kind (DB)</Label>
            <Select
              value={v.invoice_kind}
              onValueChange={(val) =>
                setV({ ...v, invoice_kind: val === 'sales' ? 'sales' : 'purchase' })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="purchase">AP — purchase (vendor bill)</SelectItem>
                <SelectItem value="sales">AR — sales (customer bill)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ex-invoice_number">Invoice #</Label>
            <Input
              id="ex-invoice_number"
              value={v.invoice_number}
              onChange={(e) => setV({ ...v, invoice_number: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="ex-invoice_date">Invoice date</Label>
              <Input
                id="ex-invoice_date"
                type="date"
                value={v.invoice_date.slice(0, 10)}
                onChange={(e) => setV({ ...v, invoice_date: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ex-due_date">Due date</Label>
              <Input
                id="ex-due_date"
                type="date"
                value={v.due_date.slice(0, 10)}
                onChange={(e) => setV({ ...v, due_date: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ex-vendor_name">Vendor / seller</Label>
            <Input
              id="ex-vendor_name"
              value={v.vendor_name}
              onChange={(e) => setV({ ...v, vendor_name: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ex-customer_name">Customer name (AR)</Label>
            <Input
              id="ex-customer_name"
              value={v.customer_name}
              onChange={(e) => setV({ ...v, customer_name: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ex-customer_gstin">Customer {config.taxIdLabel}</Label>
            <Input
              id="ex-customer_gstin"
              value={v.customer_gstin}
              onChange={(e) => setV({ ...v, customer_gstin: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ex-gstin">Vendor {config.taxIdLabel}</Label>
            <Input id="ex-gstin" value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="ex-total">Total amount</Label>
              <Input
                id="ex-total"
                type="number"
                step="0.01"
                value={Number.isFinite(v.total_amount) ? v.total_amount : 0}
                onChange={(e) => setV({ ...v, total_amount: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ex-currency">Currency</Label>
              <Input
                id="ex-currency"
                value={v.currency}
                maxLength={3}
                onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase().slice(0, 3) })}
              />
            </div>
          </div>

          {/* Line items — read-only preview */}
          {lineItems && lineItems.length > 0 && (
            <div className="grid gap-1">
              <Label>Line items ({lineItems.length})</Label>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Description</th>
                      <th className="px-2 py-1.5 text-right font-medium w-12">Qty</th>
                      <th className="px-2 py-1.5 text-right font-medium w-20">Unit price</th>
                      <th className="px-2 py-1.5 text-right font-medium w-20">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1.5 text-left">{li.description || '—'}</td>
                        <td className="px-2 py-1.5 text-right">{li.quantity}</td>
                        <td className="px-2 py-1.5 text-right">{li.unit_price.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right font-medium">{li.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">Line items will be saved with the invoice.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => onSave(v)}>
            {saving ? 'Saving…' : 'Save to invoice list'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
