import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronDown, Plus } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';

export function WorkspaceSelector() {
  const { isAuthenticated, bootstrapping } = useAuth();
  const { workspaces, activeWorkspace, loading, switchWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (bootstrapping || loading) {
    return (
      <span style={{ fontSize: 12, color: '#94a3b8' }}>Loading workspaces…</span>
    );
  }

  if (!isAuthenticated) {
    return (
      <button
        type="button"
        onClick={() => navigate('/login', { state: { from: window.location.pathname } })}
        style={{
          background: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6,
          padding: '4px 10px',
          color: '#93c5fd',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        Log in to select workspace
      </button>
    );
  }

  if (!activeWorkspace && workspaces.length === 0) {
    return (
      <button
        type="button"
        onClick={() => navigate('/workspaces/create')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6,
          padding: '4px 10px',
          color: '#e2e8f0',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        <Plus size={14} />
        Create Workspace
      </button>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
        <Building2 size={14} style={{ color: '#93c5fd', flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeWorkspace?.name ?? 'Select workspace'}
        </span>
        <ChevronDown size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              right: 0,
              minWidth: 260,
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              zIndex: 9999,
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '8px 12px', fontSize: 11, color: '#64748b', borderBottom: '1px solid #334155' }}>
              WORKSPACES
            </div>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => { setOpen(false); if (ws.id !== activeWorkspace?.id) switchWorkspace(ws); }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  background: ws.id === activeWorkspace?.id ? 'rgba(59,130,246,0.15)' : 'transparent',
                  border: 'none',
                  color: '#e2e8f0',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 500 }}>{ws.name}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  {ws.legal_entity_name} · {ws.currency}
                </div>
              </button>
            ))}
            <div style={{ borderTop: '1px solid #334155' }}>
              <button
                type="button"
                onClick={() => { setOpen(false); navigate('/workspaces'); }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: '#93c5fd',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Manage workspaces →
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); navigate('/workspaces/create'); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: '#93c5fd',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <Plus size={14} />
                Create workspace
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
