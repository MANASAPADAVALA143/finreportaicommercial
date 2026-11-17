import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useCompany } from '../../../context/CompanyContext';
import { getGroupPosition, showMoney, type GroupEntity, type GroupPosition } from '../../../services/groupIntelligence.service';
import { C, currentPeriod, GroupFilters, Notice } from './ui';

type SortKey = 'company_name' | 'revenue' | 'ebitda' | 'net_profit' | 'gl_cash';

export default function EntityPerformance() {
  const { accessToken } = useAuth();
  const { setActiveCompany } = useCompany();
  const navigate = useNavigate();
  const [period, setPeriod] = useState(currentPeriod);
  const [currency, setCurrency] = useState('');
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [position, setPosition] = useState<GroupPosition | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getGroupPosition(accessToken, period, currency, companyIds)
      .then((next) => {
        if (cancelled) return;
        setPosition(next);
        setSelectedId((current) => current || next.entities[0]?.company_id || '');
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'Entity performance could not be loaded');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, period, currency, companyIds]);

  const rows = useMemo(() => {
    const list = (position?.entities ?? []).filter((entity) => entity.company_name.toLowerCase().includes(query.toLowerCase()));
    return [...list].sort((a, b) => compare(a, b, sortKey));
  }, [position, query, sortKey]);
  const selected = rows.find((entity) => entity.company_id === selectedId) || rows[0];

  const openCompany = (companyId: string) => {
    setActiveCompany(companyId);
    navigate('/cfo');
  };

  return (
    <div style={{ background: C.bg, minHeight: '100%', color: C.text, padding: 24 }}>
      <div style={{ color: C.gold, letterSpacing: '0.14em', fontSize: 12 }}>GNANOVA CFO</div>
      <h1 style={{ margin: '4px 0 0', fontSize: 28 }}>Entity performance</h1>
      <p style={{ color: C.dim }}>
        Amounts in the table are in the group reporting currency. Local currency is shown on the entity detail.
      </p>
      <div style={{ margin: '16px 0' }}>
        <GroupFilters token={accessToken} period={period} currency={currency} companyIds={companyIds} onPeriod={setPeriod} onCurrency={setCurrency} onCompanies={setCompanyIds} />
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter entities"
        style={{ background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', width: 240 }}
      />
      <Link to="/cfo/group" style={{ color: C.teal, marginLeft: 16 }}>Back to command centre</Link>

      {loading && <div style={{ marginTop: 16 }}><Notice text="Loading entity results." /></div>}
      {error && <div style={{ marginTop: 16 }}><Notice tone="error" text={error} /></div>}

      {position && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 16 }}>
          <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: C.dim, textAlign: 'left' }}>
                  <Sort label="Entity" k="company_name" sortKey={sortKey} onSort={setSortKey} />
                  <th style={th}>Base</th>
                  <th style={th}>Reporting</th>
                  <Sort label="Revenue" k="revenue" sortKey={sortKey} onSort={setSortKey} />
                  <th style={th}>Gross profit</th>
                  <Sort label="EBITDA" k="ebitda" sortKey={sortKey} onSort={setSortKey} />
                  <Sort label="Net profit" k="net_profit" sortKey={sortKey} onSort={setSortKey} />
                  <th style={th}>Assets</th>
                  <th style={th}>Liabilities</th>
                  <Sort label="GL cash" k="gl_cash" sortKey={sortKey} onSort={setSortKey} />
                  <th style={th}>Bank cash</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entity) => (
                  <tr
                    key={entity.company_id}
                    onClick={() => setSelectedId(entity.company_id)}
                    style={{ borderTop: `1px solid ${C.border}`, background: selected?.company_id === entity.company_id ? '#132033' : 'transparent', cursor: 'pointer' }}
                  >
                    <td style={td}>{entity.company_name}</td>
                    <td style={td}>{entity.base_currency}</td>
                    <td style={td}>{position.reporting_currency}</td>
                    <td style={td}>{showMoney(entity.reporting.revenue)}</td>
                    <td style={td}>{showMoney(entity.reporting.gross_profit)}</td>
                    <td style={td}>{showMoney(entity.reporting.ebitda)}</td>
                    <td style={td}>{showMoney(entity.reporting.net_profit)}</td>
                    <td style={td}>{showMoney(entity.reporting.total_assets)}</td>
                    <td style={td}>{showMoney(entity.reporting.total_liabilities)}</td>
                    <td style={td}>{showMoney(entity.reporting.gl_cash)}</td>
                    <td style={td}>{bankCash(position, entity.company_id)}</td>
                    <td style={td}>{entity.health.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <Notice text="No entities match this filter." />}
          </div>
          {selected && (
            <aside style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>{selected.company_name}</h2>
              <p style={{ color: C.dim, fontSize: 13 }}>{selected.health.rules.join(' ')}</p>
              <Detail label="Local revenue" value={showMoney(selected.local.revenue)} />
              <Detail label="Reporting revenue" value={showMoney(selected.reporting.revenue)} />
              <Detail label="Reporting EBITDA" value={showMoney(selected.reporting.ebitda)} />
              <Detail label="GL cash" value={showMoney(selected.reporting.gl_cash)} />
              <Detail label="Ownership" value={selected.ownership.ownership_percent == null ? selected.ownership.assumption || 'No ownership record' : `${selected.ownership.ownership_percent}%`} />
              <Detail label="FX" value={selected.fx ? `Avg ${selected.fx.average_rate ?? '—'} / Close ${selected.fx.closing_rate ?? '—'}` : 'Identity or unavailable'} />
              <button
                type="button"
                onClick={() => openCompany(selected.company_id)}
                style={{ marginTop: 16, background: C.teal, color: '#04120F', border: 0, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
              >
                Open company CFO
              </button>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function bankCash(position: GroupPosition, companyId: string) {
  const rows = position.bank_accounts.filter((row) => row.company_id === companyId);
  if (!rows.length) return 'Unavailable';
  if (rows.some((row) => row.reporting_amount == null)) return 'Unavailable';
  const total = rows.reduce((sum, row) => sum + (row.reporting_amount || 0), 0);
  return showMoney({ value: total, currency: position.reporting_currency, available: true, reason: null, method: 'Reconciled bank balance' });
}

function compare(a: GroupEntity, b: GroupEntity, key: SortKey) {
  if (key === 'company_name') return a.company_name.localeCompare(b.company_name);
  const field = key === 'revenue' ? 'revenue' : key === 'ebitda' ? 'ebitda' : key === 'net_profit' ? 'net_profit' : 'gl_cash';
  const left = a.reporting[field].value;
  const right = b.reporting[field].value;
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

function Sort({ label, k, sortKey, onSort }: { label: string; k: SortKey; sortKey: SortKey; onSort: (key: SortKey) => void }) {
  return (
    <th style={th}>
      <button type="button" onClick={() => onSort(k)} style={{ background: 'none', border: 0, color: sortKey === k ? C.gold : C.dim, cursor: 'pointer', padding: 0 }}>
        {label}
      </button>
    </th>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, marginTop: 8 }}>
      <span style={{ color: C.dim }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const th: CSSProperties = { padding: '10px 12px', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '10px 12px', whiteSpace: 'nowrap' };
