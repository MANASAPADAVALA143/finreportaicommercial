import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronDown, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { logoUrl } from '../services/companySetup.service';

export function CompanySelector() {
  const { isAuthenticated } = useAuth();
  const { companiesList, activeCompany, activeCompanyId, loading, setActiveCompany } = useCompany();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (!isAuthenticated) return null;

  if (loading && companiesList.length === 0) {
    return <span style={{ fontSize: 12, color: '#94a3b8' }}>Loading companies…</span>;
  }

  if (companiesList.length === 0) {
    return (
      <button
        type="button"
        onClick={() => navigate('/company-setup')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 6,
          padding: '4px 10px',
          color: '#fcd34d',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        <Building2 size={14} />
        Setup Company
      </button>
    );
  }

  const logo = logoUrl(activeCompany?.logo_url ?? null);
  const multi = companiesList.length > 1;

  if (!multi && activeCompany) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#e2e8f0' }}>
        {logo ? (
          <img src={logo} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'contain' }} />
        ) : (
          <Building2 size={16} style={{ color: '#5eead4' }} />
        )}
        <span style={{ fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeCompany.company_name}
        </span>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6,
          padding: '4px 12px',
          color: '#e2e8f0',
          fontSize: 12,
          cursor: 'pointer',
          minWidth: 180,
        }}
      >
        {logo ? (
          <img src={logo} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'contain', flexShrink: 0 }} />
        ) : (
          <Building2 size={16} style={{ color: '#5eead4', flexShrink: 0 }} />
        )}
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeCompany?.company_name ?? 'Select company'}
        </span>
        <ChevronDown size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              minWidth: 280,
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              zIndex: 9999,
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '8px 12px', fontSize: 11, color: '#64748b', borderBottom: '1px solid #334155' }}>
              COMPANIES
            </div>
            {companiesList.map(c => {
              const cLogo = logoUrl(c.logo_url);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setActiveCompany(c.id);
                    setOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    background: c.id === activeCompanyId ? 'rgba(20,184,166,0.15)' : 'transparent',
                    border: 'none',
                    color: '#e2e8f0',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {cLogo ? (
                    <img src={cLogo} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'contain' }} />
                  ) : (
                    <Building2 size={16} style={{ color: '#5eead4' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.company_name}
                    </div>
                    {c.legal_type && (
                      <span style={{ fontSize: 10, color: '#94a3b8', background: '#334155', padding: '1px 6px', borderRadius: 4 }}>
                        {c.legal_type}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            <div style={{ borderTop: '1px solid #334155' }}>
              <button
                type="button"
                onClick={() => { setOpen(false); navigate('/company-setup'); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: '#5eead4',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <Plus size={14} />
                Add Company
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
