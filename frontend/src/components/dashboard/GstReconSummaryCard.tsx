import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getGstReconSummary } from '@/lib/ap-invoice/gstService';
import { Receipt } from 'lucide-react';

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function GstReconSummaryCard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<{
    matched: number;
    mismatch: number;
    unmatched: number;
    ignored: number;
    total: number;
  } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const p = currentPeriod();
    getGstReconSummary(p)
      .then(setSummary)
      .catch(() => {
        setErr(true);
        setSummary(null);
      });
  }, []);

  const period = currentPeriod();
  const s = summary;
  const allUnmatched = s && s.total > 0 && s.matched === 0 && s.mismatch === 0 && s.unmatched === s.total;
  const hasMismatch = (s?.mismatch ?? 0) > 0;
  const allMatched = s && s.total > 0 && s.mismatch === 0 && s.unmatched === 0 && s.matched === s.total;

  const border = hasMismatch ? 'border-l-amber-500' : allMatched ? 'border-l-green-500' : 'border-l-gray-300';

  return (
    <Card className={`shadow-sm border border-slate-200 border-l-4 ${border} bg-white`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Receipt className="h-4 w-4 text-[#0A4B8F]" />
          GST recon ({period})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {err || s === null ? (
          <>
            <p className="text-sm text-gray-600">Run GST migration to enable summaries.</p>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => navigate('/gst-recon')}>
              Open GST recon â†’
            </Button>
          </>
        ) : s.total === 0 ? (
          <>
            <p className="text-sm text-gray-600">No GST lines this month yet.</p>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => navigate('/gst-recon')}>
              Run reconciliation â†’
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-800">
              {s.matched} matched, {s.mismatch} mismatches, {s.unmatched} unmatched
              {s.ignored > 0 ? `, ${s.ignored} ignored` : ''}
            </p>
            {hasMismatch && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full border-amber-600 text-amber-900"
                onClick={() => navigate('/gst-recon')}
              >
                Review â†’
              </Button>
            )}
            {allUnmatched && (
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => navigate('/gst-recon')}>
                Run reconciliation â†’
              </Button>
            )}
            {allMatched && (
              <p className="text-xs text-green-700 mt-2">All GST lines matched for this period.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

