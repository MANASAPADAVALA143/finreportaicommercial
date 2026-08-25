import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/utils/currency';
import {
  fetchPaymentRunMonthlyStats,
  type PaymentRunMonthlyStats,
} from '@/lib/ap-invoice/paymentRunService';

const empty: PaymentRunMonthlyStats = {
  runs_executed: 0,
  total_paid_aed: 0,
  pending_approval: 0,
  scheduled_this_week: 0,
  month: '',
};

export function PaymentRunsThisMonthCard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<PaymentRunMonthlyStats>(empty);

  useEffect(() => {
    void fetchPaymentRunMonthlyStats()
      .then(setStats)
      .catch(() => setStats(empty));
  }, []);

  return (
    <Card className="bg-white border border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
          <Banknote className="h-4 w-4 text-blue-600" />
          Payment Runs This Month
        </CardTitle>
        <Button
          variant="link"
          size="sm"
          className="text-xs h-auto p-0"
          onClick={() => navigate('/ap-invoices/payment-run')}
        >
          Open
        </Button>
      </CardHeader>
      <CardContent className="text-xs text-gray-600 space-y-1.5">
        <div className="flex justify-between gap-2">
          <span>Runs executed</span>
          <span className="font-medium text-gray-900">{stats.runs_executed}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Total paid AED</span>
          <span className="font-medium text-gray-900">
            {formatCurrency(Number(stats.total_paid_aed || 0), 'AED')}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Pending approval</span>
          <span className="font-medium text-amber-700">{stats.pending_approval}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Scheduled this week</span>
          <span className="font-medium text-gray-900">{stats.scheduled_this_week}</span>
        </div>
      </CardContent>
    </Card>
  );
}
