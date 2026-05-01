import '@fontsource/ibm-plex-mono';
import { useEffect, useState } from 'react';

const AITHENTIC = {
  bg: '#060A12',
  surface: '#0B1120',
  panel: '#0F1829',
  border: '#1A2640',
  teal: '#00D4B8',
  red: '#FF4444',
  yellow: '#FFB800',
  green: '#00D4B8',
  textPrimary: '#E2EAF4',
  textDim: '#4A6080',
  font: "'IBM Plex Mono', monospace",
};

type Insight = {
  what_happened?: string;
  why_it_happened?: string[];
  what_to_do?: string;
  source_route?: string;
  deep_link?: string;
  module_label?: string;
};

type AlertItem = {
  agent: string;
  insight?: Insight;
  time?: string;
};

type BriefResponse = {
  date: string;
  total_agents_run: number;
  alerts: {
    red: AlertItem[];
    yellow: AlertItem[];
    green: AlertItem[];
  };
};

export default function CommandCenter() {
  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [boardPackProgress, setBoardPackProgress] = useState<string[]>([]);
  const [boardPackReady, setBoardPackReady] = useState(false);
  const [boardPackPath, setBoardPackPath] = useState('');

  useEffect(() => {
    void fetchLatestBrief();
    const interval = window.setInterval(() => {
      void fetchLatestBrief();
    }, 300000);
    return () => window.clearInterval(interval);
  }, []);

  const fetchLatestBrief = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/agents/latest-brief');
      const data = (await res.json()) as BriefResponse;
      setBrief(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const generateBoardPack = async () => {
    setBoardPackProgress([]);
    setBoardPackReady(false);

    const response = await fetch('/api/board-pack/generate', { method: 'POST' });
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));
        if (data.step === 'complete') {
          setBoardPackReady(true);
          setBoardPackPath(data.pdf_path || '');
        } else if (data.step) {
          setBoardPackProgress((prev) => [...prev, data.step]);
        }
      }
    }
  };

  const AlertCard = ({ alert, color }: { alert: AlertItem; color: string }) => (
    <div
      style={{
        background: AITHENTIC.panel,
        border: `1px solid ${color}33`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 4,
        padding: '16px 20px',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          fontFamily: AITHENTIC.font,
          fontSize: 10,
          letterSpacing: '0.1em',
          color,
          marginBottom: 8,
          textTransform: 'uppercase',
        }}
      >
        {alert.agent.replace(/_/g, ' ')}
      </div>
      <div
        style={{
          fontFamily: AITHENTIC.font,
          fontSize: 13,
          color: AITHENTIC.textPrimary,
          marginBottom: 8,
          lineHeight: 1.6,
        }}
      >
        {alert.insight?.what_happened}
      </div>
      {alert.insight?.why_it_happened && (
        <div style={{ fontSize: 11, color: AITHENTIC.textDim, marginBottom: 8 }}>
          {alert.insight.why_it_happened.map((w, i) => (
            <div key={i}>→ {w}</div>
          ))}
        </div>
      )}
      <div
        style={{
          fontFamily: AITHENTIC.font,
          fontSize: 11,
          color,
          padding: '6px 10px',
          background: `${color}11`,
          borderRadius: 2,
          display: 'inline-block',
        }}
      >
        {alert.insight?.what_to_do}
      </div>
      {alert.insight?.deep_link && (
        <a
          href={alert.insight.deep_link}
          style={{
            display: 'inline-block',
            marginTop: 10,
            fontSize: 10,
            color: AITHENTIC.teal,
            textDecoration: 'none',
            letterSpacing: '0.1em',
            borderBottom: `1px solid ${AITHENTIC.teal}33`,
          }}
        >
          → VIEW IN {(alert.insight.module_label || alert.agent).toUpperCase().replace(/_/g, ' ')}
        </a>
      )}
    </div>
  );

  return (
    <div
      style={{
        background: AITHENTIC.bg,
        minHeight: '100vh',
        fontFamily: AITHENTIC.font,
        color: AITHENTIC.textPrimary,
        padding: '24px 32px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 32,
          borderBottom: `1px solid ${AITHENTIC.border}`,
          paddingBottom: 20,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.2em',
              color: AITHENTIC.teal,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            NEXUS-C · AGENTIC COMMAND CENTER
          </div>
          <div style={{ fontSize: 22 }}>CFO Intelligence Dashboard</div>
          <div style={{ fontSize: 11, color: AITHENTIC.textDim, marginTop: 4 }}>
            {brief
              ? `Last updated: ${new Date(brief.date).toLocaleTimeString()} · ${brief.total_agents_run} agents ran`
              : 'Loading...'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => void generateBoardPack()}
            style={{
              background: AITHENTIC.teal,
              color: AITHENTIC.bg,
              border: 'none',
              borderRadius: 3,
              padding: '10px 20px',
              fontFamily: AITHENTIC.font,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            ⬡ GENERATE BOARD PACK
          </button>
          <button
            onClick={() => void fetchLatestBrief()}
            style={{
              background: 'transparent',
              color: AITHENTIC.teal,
              border: `1px solid ${AITHENTIC.teal}`,
              borderRadius: 3,
              padding: '10px 16px',
              fontFamily: AITHENTIC.font,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            ↻ REFRESH
          </button>
        </div>
      </div>

      {boardPackProgress.length > 0 && (
        <div
          style={{
            background: AITHENTIC.panel,
            border: `1px solid ${AITHENTIC.border}`,
            borderRadius: 4,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 10, color: AITHENTIC.teal, letterSpacing: '0.1em', marginBottom: 12 }}>
            BOARD PACK GENERATION
          </div>
          {boardPackProgress.map((step, i) => (
            <div key={i} style={{ fontSize: 12, color: AITHENTIC.textDim, padding: '4px 0' }}>
              ✓ {step}
            </div>
          ))}
          {boardPackReady && (
            <a
              href={`/api/board-pack/download-file/${encodeURIComponent(
                boardPackPath.split(/[\\/]/).pop() ?? ''
              )}`}
              style={{
                display: 'inline-block',
                marginTop: 12,
                background: AITHENTIC.teal,
                color: AITHENTIC.bg,
                padding: '8px 16px',
                borderRadius: 2,
                fontSize: 12,
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              ↓ DOWNLOAD BOARD PACK PDF
            </a>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ color: AITHENTIC.textDim, fontSize: 12, padding: 40, textAlign: 'center' }}>
          NEXUS-C loading intelligence...
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 32 }}>
          <div
            style={{
              background: AITHENTIC.surface,
              border: `1px solid ${AITHENTIC.border}`,
              borderTop: `2px solid ${AITHENTIC.red}`,
              borderRadius: 4,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: '0.15em', color: AITHENTIC.red, marginBottom: 16 }}>
              URGENT ACTION REQUIRED
            </div>
            {brief?.alerts?.red?.length ? (
              brief.alerts.red.map((a, i) => <AlertCard key={i} alert={a} color={AITHENTIC.red} />)
            ) : (
              <div style={{ color: AITHENTIC.textDim, fontSize: 12, padding: '20px 0' }}>No urgent issues detected</div>
            )}
          </div>

          <div
            style={{
              background: AITHENTIC.surface,
              border: `1px solid ${AITHENTIC.border}`,
              borderTop: `2px solid ${AITHENTIC.yellow}`,
              borderRadius: 4,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: '0.15em', color: AITHENTIC.yellow, marginBottom: 16 }}>
              MONITOR CLOSELY
            </div>
            {brief?.alerts?.yellow?.length ? (
              brief.alerts.yellow.map((a, i) => <AlertCard key={i} alert={a} color={AITHENTIC.yellow} />)
            ) : (
              <div style={{ color: AITHENTIC.textDim, fontSize: 12, padding: '20px 0' }}>No items to monitor</div>
            )}
          </div>

          <div
            style={{
              background: AITHENTIC.surface,
              border: `1px solid ${AITHENTIC.border}`,
              borderTop: `2px solid ${AITHENTIC.green}`,
              borderRadius: 4,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: '0.15em', color: AITHENTIC.green, marginBottom: 16 }}>
              ON TRACK
            </div>
            {brief?.alerts?.green?.length ? (
              brief.alerts.green.map((a, i) => <AlertCard key={i} alert={a} color={AITHENTIC.green} />)
            ) : (
              <div style={{ color: AITHENTIC.textDim, fontSize: 12, padding: '20px 0' }}>All metrics on track</div>
            )}
          </div>
        </div>
      )}

      <div style={{ background: AITHENTIC.surface, border: `1px solid ${AITHENTIC.border}`, borderRadius: 4, padding: 20 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.15em',
            color: AITHENTIC.textDim,
            marginBottom: 16,
            textTransform: 'uppercase',
          }}
        >
          Agent Workforce — Autonomous Mode
        </div>
        {[
          { name: 'Variance Agent', schedule: 'Daily 6AM' },
          { name: 'Forecast Agent', schedule: 'Monday 7AM' },
          { name: 'Recon Agent', schedule: 'Daily 6AM' },
          { name: 'JE Anomaly Agent', schedule: 'Daily 6AM' },
          { name: 'Board Pack Agent', schedule: 'Day 1 Monthly' },
          { name: 'CFO Advisor', schedule: 'On Demand' },
        ].map((agent, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: i < 5 ? `1px solid ${AITHENTIC.border}` : 'none',
            }}
          >
            <span style={{ fontSize: 12 }}>{agent.name}</span>
            <span style={{ fontSize: 10, color: AITHENTIC.textDim }}>{agent.schedule}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
