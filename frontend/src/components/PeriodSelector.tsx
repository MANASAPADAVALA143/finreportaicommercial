/**
 * Accounting period dropdown — fetches /api/company-setup/periods
 */
import { useEffect, useState } from 'react';
import { backendOrigin } from '../utils/backendOrigin';
import { useAuth } from '../context/AuthContext';

export interface AccountingPeriod {
  id: string;
  period_name: string;
  start_date: string;
  end_date: string;
  status: string;
}

interface Props {
  workspaceId: string;
  onPeriodChange: (start: string, end: string) => void;
  className?: string;
}

export default function PeriodSelector({ workspaceId, onPeriodChange, className = '' }: Props) {
  const { accessToken } = useAuth();
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    const wsId = workspaceId || localStorage.getItem('gnanova_workspace_id');
    const hdrs: Record<string, string> = {
      'X-Workspace-ID': wsId,
      'X-Tenant-ID': wsId,
    };
    if (accessToken) hdrs.Authorization = `Bearer ${accessToken}`;

    fetch(`${backendOrigin()}/api/company-setup/periods`, { headers: hdrs, credentials: 'include' })
      .then(r => r.ok ? r.json() : { periods: [] })
      .then(data => {
        const list: AccountingPeriod[] = data.periods ?? [];
        setPeriods(list);
        const open = list.find(p => p.status === 'open') ?? list[0];
        if (open) {
          setSelected(open.id);
          onPeriodChange(open.start_date, open.end_date);
        } else {
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
          const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
          onPeriodChange(start, end);
        }
      })
      .catch(() => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        onPeriodChange(start, end);
      });
  }, [workspaceId, accessToken]);

  const handleChange = (id: string) => {
    setSelected(id);
    const p = periods.find(x => x.id === id);
    if (p) onPeriodChange(p.start_date, p.end_date);
  };

  if (!periods.length) {
    return null;
  }

  return (
    <select
      value={selected}
      onChange={e => handleChange(e.target.value)}
      className={className || 'px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white text-gray-700'}
    >
      {periods.map(p => (
        <option key={p.id} value={p.id}>
          {p.period_name} ({p.status})
        </option>
      ))}
    </select>
  );
}
