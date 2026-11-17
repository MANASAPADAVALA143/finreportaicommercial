import { useEffect, useState, type CSSProperties } from 'react';
import { listGroupEntities, type GroupEntityOption } from '../../../services/groupIntelligence.service';

export const C = {
  bg: '#060A12',
  surface: '#0B1120',
  panel: '#0F1829',
  border: '#1A2640',
  gold: '#C9A84C',
  teal: '#00D4B8',
  text: '#E2EAF4',
  dim: '#8AA0B8',
  red: '#F87171',
  amber: '#F5C16C',
};

export function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function GroupFilters({
  token,
  period,
  currency,
  companyIds,
  onPeriod,
  onCurrency,
  onCompanies,
}: {
  token: string | null;
  period: string;
  currency: string;
  companyIds: string[];
  onPeriod: (value: string) => void;
  onCurrency: (value: string) => void;
  onCompanies: (ids: string[]) => void;
}) {
  const [entities, setEntities] = useState<GroupEntityOption[]>([]);
  useEffect(() => {
    listGroupEntities(token).then((rows) => setEntities(rows.filter((row) => row.status === 'active'))).catch(() => setEntities([]));
  }, [token]);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
      <label style={{ color: C.dim, fontSize: 12 }}>
        Reporting period
        <input type="month" value={period} onChange={(e) => onPeriod(e.target.value)} style={inputStyle} />
      </label>
      <label style={{ color: C.dim, fontSize: 12 }}>
        Reporting currency
        <input
          value={currency}
          maxLength={3}
          placeholder="Auto"
          onChange={(e) => onCurrency(e.target.value.toUpperCase())}
          style={{ ...inputStyle, width: 88 }}
        />
      </label>
      <label style={{ color: C.dim, fontSize: 12, minWidth: 220 }}>
        Entities
        <select
          multiple
          value={companyIds}
          onChange={(e) => onCompanies(Array.from(e.target.selectedOptions).map((option) => option.value))}
          style={{ ...inputStyle, height: 72 }}
        >
          {entities.map((entity) => (
            <option key={entity.company_id} value={entity.company_id}>
              {entity.company_name} ({entity.base_currency})
            </option>
          ))}
        </select>
      </label>
      <span style={{ color: C.dim, fontSize: 11, maxWidth: 280 }}>
        Leave entities unselected to include every active company. Leave currency blank when they share one base currency.
      </span>
    </div>
  );
}

const inputStyle: CSSProperties = {
  display: 'block',
  marginTop: 4,
  background: '#0B1120',
  color: '#E2EAF4',
  border: '1px solid #1A2640',
  borderRadius: 8,
  padding: '6px 8px',
};

export function Notice({ text, tone = 'info' }: { text: string; tone?: 'info' | 'error' }) {
  return (
    <div style={{ padding: 16, borderRadius: 12, border: `1px solid ${tone === 'error' ? '#7F1D1D' : C.border}`, color: tone === 'error' ? C.red : C.dim }}>
      {text}
    </div>
  );
}
