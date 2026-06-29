import { useNavigate } from 'react-router-dom';
import type { Invoice } from '@/lib/ap-invoice/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/utils/currency';
import { Files } from 'lucide-react';
import { useCompanySettings } from '@/hooks/useCompanySettings';

type Props = {
  invoices: Invoice[];
};

export function DuplicateAlertsCard({ invoices }: Props) {
  const navigate = useNavigate();
  const { baseCurrency } = useCompanySettings();
  const flagged = invoices.filter((i) => i.duplicate_flag === true);
  const count = flagged.length;

  const sumSameCurrency = flagged.reduce(
    (acc, inv) => {
      const c = (inv.currency || baseCurrency).toUpperCase();
      if (!acc[c]) acc[c] = 0;
      acc[c] += Number(inv.total_amount);
      return acc;
    },
    {} as Record<string, number>
  );

  const primaryTotal = sumSameCurrency[baseCurrency.toUpperCase()] ?? sumSameCurrency[Object.keys(sumSameCurrency)[0] ?? ''] ?? 0;
  const primaryCur = Object.keys(sumSameCurrency).includes(baseCurrency.toUpperCase())
    ? baseCurrency
    : Object.keys(sumSameCurrency)[0] ?? baseCurrency;

  const isClear = count === 0;

  return (
    <Card
      className={`shadow-sm border border-slate-200 border-l-4 ${isClear ? 'border-l-green-500 bg-green-50' : 'border-l-amber-500 bg-white'}`}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Files className="h-4 w-4 text-amber-600" />
          Duplicate alerts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isClear ? (
          <>
            <div className="text-2xl font-bold text-green-800">No duplicates detected</div>
            <p className="text-xs text-green-700 mt-1">No invoices are flagged as possible duplicates.</p>
          </>
        ) : (
          <>
            <div className="text-2xl font-bold text-gray-900">{count}</div>
            <p className="text-xs text-gray-600 mt-1">
              Flagged amount (partial view):{' '}
              <span className="font-semibold text-gray-900">
                {formatCurrency(primaryTotal, primaryCur)}
              </span>
              {Object.keys(sumSameCurrency).length > 1 && (
                <span className="block text-amber-800 mt-1">Multiple currencies â€” totals shown per base where available.</span>
              )}
            </p>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          className={`mt-3 w-full ${isClear ? 'border-green-600 text-green-800' : 'border-amber-600 text-amber-900'}`}
          onClick={() => navigate('/invoices?filter=duplicates')}
        >
          Review duplicates â†’
        </Button>
      </CardContent>
    </Card>
  );
}

