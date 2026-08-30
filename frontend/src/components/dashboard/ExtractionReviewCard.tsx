import { useNavigate } from 'react-router-dom';
import type { Invoice } from '@/lib/ap-invoice/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScanLine, Check } from 'lucide-react';
import { getEffectiveExtractionScore, invoiceNeedsExtractionReview } from '@/utils/extractionConfidence';

type Props = {
  invoices: Invoice[];
};

const CHECKED_FIELDS = ['Invoice number', 'Vendor', 'Amount', 'VAT', 'Date'];

export function ExtractionReviewCard({ invoices }: Props) {
  const navigate = useNavigate();
  const count = invoices.filter((inv) => invoiceNeedsExtractionReview(inv)).length;
  const isClear = count === 0;
  const avgConfidence =
    invoices.length > 0
      ? invoices.reduce((sum, inv) => sum + getEffectiveExtractionScore(inv), 0) / invoices.length
      : 0;

  return (
    <Card
      className={`shadow-sm border border-slate-200 border-l-4 ${isClear ? 'border-l-green-500 bg-green-50' : 'border-l-amber-500 bg-white'}`}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <ScanLine className="h-4 w-4 text-muted-foreground" />
          AI Extraction Quality
        </CardTitle>
      </CardHeader>
      <CardContent>
        {invoices.length > 0 && (
          <>
            <div className="text-2xl font-bold text-gray-900">{avgConfidence.toFixed(1)}%</div>
            <p className="text-xs text-gray-500 mt-1">average confidence</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {CHECKED_FIELDS.map((f) => (
                <span key={f} className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                  <Check className="h-3 w-3" /> {f}
                </span>
              ))}
            </div>
          </>
        )}
        {isClear ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full border-[#1a56db] text-[#1a56db] hover:bg-[#1a56db]/10"
            onClick={() => navigate('/invoices')}
          >
            View invoices
          </Button>
        ) : (
          <>
            <p className="text-xs text-gray-600 mt-2">{count} invoice{count === 1 ? '' : 's'} need manual review (low extraction confidence).</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full border-amber-600 text-amber-900 hover:bg-amber-50"
              onClick={() => navigate('/invoices?tab=needs-review')}
            >
              View exceptions →
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

