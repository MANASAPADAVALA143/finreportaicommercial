import { useNavigate } from 'react-router-dom';
import type { Invoice } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScanLine } from 'lucide-react';
import { invoiceNeedsExtractionReview } from '@/utils/extractionConfidence';

type Props = {
  invoices: Invoice[];
};

export function ExtractionReviewCard({ invoices }: Props) {
  const navigate = useNavigate();
  const count = invoices.filter((inv) => invoiceNeedsExtractionReview(inv)).length;
  const isClear = count === 0;

  return (
    <Card
      className={`shadow-sm border-l-4 ${isClear ? 'border-l-green-500 bg-green-50/30' : 'border-l-amber-500 bg-white'}`}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <ScanLine className="h-4 w-4 text-muted-foreground" />
          Needs review
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isClear ? (
          <>
            <div className="text-2xl font-bold text-gray-900">All good</div>
            <p className="text-xs text-gray-500 mt-1">All invoices extracted with high confidence.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full border-[#1a56db] text-[#1a56db] hover:bg-[#1a56db]/10"
              onClick={() => navigate('/invoices')}
            >
              View invoices
            </Button>
          </>
        ) : (
          <>
            <div className="text-2xl font-bold text-gray-900">{count}</div>
            <p className="text-xs text-gray-600 mt-1">{count} invoice{count === 1 ? '' : 's'} need manual review (low extraction confidence).</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full border-amber-600 text-amber-900 hover:bg-amber-50"
              onClick={() => navigate('/invoices?tab=needs-review')}
            >
              Review now
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
