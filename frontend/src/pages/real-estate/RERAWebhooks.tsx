import { useState } from 'react';
import * as api from '../../services/reraApi';
import { useReraData, DemoBadge, PageHeader, GoldButton, Table, EmptyRow, BORDER, MUTED, GOLD } from './shared';

type Tab = 'events' | 'dlq';

export default function RERAWebhooks() {
  const [tab, setTab] = useState<Tab>('events');
  const events = useReraData(async () => (await api.listWebhookEvents()).events, [], () => false);
  const dlq = useReraData(async () => (await api.listDlqEvents()).events, [], () => false);
  const [replaying, setReplaying] = useState<string | null>(null);

  const replay = async (id: string) => {
    setReplaying(id);
    try {
      await api.replayDlqEvent(id);
      dlq.reload();
      events.reload();
    } finally {
      setReplaying(null);
    }
  };

  return (
    <div>
      <PageHeader title="Webhooks" subtitle="Zoho Task 01 — Construction Progress API Bridge" />

      <div className="flex gap-2 mb-6 border-b" style={{ borderColor: BORDER }}>
        {(['events', 'dlq'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="px-4 py-2 text-sm border-b-2 -mb-px"
            style={{ borderColor: tab === t ? GOLD : 'transparent', color: tab === t ? GOLD : MUTED }}
          >
            {t === 'events' ? 'Events' : `Dead Letter Queue (${dlq.data.length})`}
          </button>
        ))}
      </div>

      {tab === 'events' && (
        <Table headers={['Event ID', 'Source', 'SPA ID', 'Event Type', 'Timestamp']}>
          {events.data.length === 0 ? (
            <EmptyRow colSpan={5} text="No webhook events received yet." />
          ) : (
            events.data.map((e) => (
              <tr key={e.id} className="border-b" style={{ borderColor: BORDER }}>
                <td className="px-4 py-3 font-mono text-xs">{e.id.slice(0, 8)}</td>
                <td className="px-4 py-3">{e.source}</td>
                <td className="px-4 py-3 font-mono text-xs">{e.spa_id}</td>
                <td className="px-4 py-3">{e.event_type || '—'}</td>
                <td className="px-4 py-3" style={{ color: MUTED }}>
                  {e.event_timestamp ? new Date(e.event_timestamp).toLocaleString() : '—'}
                </td>
              </tr>
            ))
          )}
        </Table>
      )}

      {tab === 'dlq' && (
        <Table headers={['DLQ ID', 'SPA ID', 'Event Type', 'Error', 'Received', 'Actions']}>
          {dlq.data.length === 0 ? (
            <EmptyRow colSpan={6} text="Dead-letter queue is empty." />
          ) : (
            dlq.data.map((e) => (
              <tr key={e.id} className="border-b" style={{ borderColor: BORDER }}>
                <td className="px-4 py-3 font-mono text-xs">{e.id.slice(0, 8)}</td>
                <td className="px-4 py-3 font-mono text-xs">{e.spa_id}</td>
                <td className="px-4 py-3">{e.event_type || '—'}</td>
                <td className="px-4 py-3 text-red-400 text-xs">{e.dlq_reason || '—'}</td>
                <td className="px-4 py-3" style={{ color: MUTED }}>
                  {e.received_at ? new Date(e.received_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <GoldButton onClick={() => void replay(e.id)} disabled={replaying === e.id}>
                    {replaying === e.id ? 'Replaying…' : 'Replay'}
                  </GoldButton>
                </td>
              </tr>
            ))
          )}
        </Table>
      )}

      <DemoBadge show={false} />
    </div>
  );
}
