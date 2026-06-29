import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getAnomalyDashboardStats } from '@/lib/ap-invoice/anomalyService';
import { AlertTriangle } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#64748b'];

export function AnomalyDashboardCard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalThisMonth: 0,
    critical: 0,
    high: 0,
    medium: 0,
    byType: [] as { name: string; value: number }[],
  });

  useEffect(() => {
    void getAnomalyDashboardStats()
      .then(setStats)
      .catch(() => undefined);
  }, []);

  const pieData = [
    { name: 'Critical', value: stats.critical },
    { name: 'High', value: stats.high },
    { name: 'Medium', value: stats.medium },
  ].filter((d) => d.value > 0);

  return (
    <Card className="border-slate-200">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          Anomaly Detection — this month
        </CardTitle>
        <Button variant="link" size="sm" className="text-xs h-auto p-0" onClick={() => navigate('/invoices?tab=anomalies')}>
          View all →
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-gray-500 text-xs">Total flags</p>
            <p className="text-xl font-bold text-gray-900">{stats.totalThisMonth}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Critical / High / Medium</p>
            <p className="font-semibold text-gray-900">
              <span className="text-red-600">{stats.critical}</span>
              {' / '}
              <span className="text-orange-600">{stats.high}</span>
              {' / '}
              <span className="text-yellow-600">{stats.medium}</span>
            </p>
          </div>
        </div>
        {pieData.length > 0 && (
          <ResponsiveContainer width="100%" height={100}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={40}>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        )}
        {stats.totalThisMonth === 0 && (
          <p className="text-xs text-gray-500">No anomalies flagged this month.</p>
        )}
      </CardContent>
    </Card>
  );
}
