import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import * as api from '../../services/reraApi';
import { useReraData, AED, DemoBadge, Card, KpiCard, PageHeader, GoldButton, Table, EmptyRow, StatusBadge, SURFACE, BORDER, MUTED, GOLD } from './shared';

type Tab = 'overview' | 'bookings' | 'payments' | 'escrow';

export default function RERAProjectDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');

  const project = useReraData(() => api.getProject(id), null as any, () => false, [id]);
  const bookings = useReraData(async () => (await api.listBookings(id)).bookings, [], () => false, [id]);
  const payments = useReraData(async () => (await api.listPayments(id)).payments, [], () => false, [id]);
  const escrow = useReraData(async () => (await api.listEscrowTransactions(id)).transactions, [], () => false, [id]);

  const [bookingModal, setBookingModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [escrowModal, setEscrowModal] = useState<'deposit' | 'withdraw' | null>(null);

  if (project.loading && !project.data) {
    return <p style={{ color: MUTED }}>Loading project…</p>;
  }
  if (!project.data) {
    return (
      <div>
        <button type="button" onClick={() => navigate('/real-estate/projects')} className="flex items-center gap-2 text-sm mb-4" style={{ color: GOLD }}>
          <ArrowLeft size={14} /> Back to Projects
        </button>
        <p style={{ color: MUTED }}>Project not found (or the API isn't reachable — no demo fallback exists for a specific project id).</p>
      </div>
    );
  }

  const p = project.data;
  const variance = p.total_project_cost - p.total_collected;

  return (
    <div>
      <button type="button" onClick={() => navigate('/real-estate/projects')} className="flex items-center gap-2 text-sm mb-4" style={{ color: GOLD }}>
        <ArrowLeft size={14} /> Back to Projects
      </button>
      <PageHeader title={p.name} subtitle={`${p.rera_number} · ${p.location || '—'}`} action={<StatusBadge status={p.status} />} />

      <div className="flex gap-2 mb-6 border-b" style={{ borderColor: BORDER }}>
        {(['overview', 'bookings', 'payments', 'escrow'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="px-4 py-2 text-sm capitalize border-b-2 -mb-px"
            style={{ borderColor: tab === t ? GOLD : 'transparent', color: tab === t ? GOLD : MUTED }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Budget" value={AED(p.total_project_cost)} />
            <KpiCard label="Collected" value={AED(p.total_collected)} />
            <KpiCard label="Variance" value={AED(variance)} sub={variance >= 0 ? 'Under target' : 'Over target'} />
            <KpiCard label="Completion" value={`${p.construction_progress}%`} accent />
          </div>
          <Card className="mb-6">
            <p className="text-sm font-semibold mb-2">Budget Utilisation</p>
            <div className="h-2 rounded-full mb-1" style={{ background: BORDER }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, p.utilization_percentage)}%`, background: GOLD }} />
            </div>
            <p className="text-xs" style={{ color: MUTED }}>{p.utilization_percentage}% of escrow deposits withdrawn</p>
          </Card>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard label="Bookings" value={String(bookings.data.length)} />
            <KpiCard label="Payments Logged" value={String(payments.data.length)} />
            <KpiCard label="Escrow Balance" value={AED(p.escrow_balance)} />
          </div>
        </div>
      )}

      {tab === 'bookings' && (
        <div>
          <div className="flex justify-end mb-3">
            <GoldButton onClick={() => setBookingModal(true)}>
              <span className="flex items-center gap-2"><Plus size={14} /> New Booking</span>
            </GoldButton>
          </div>
          <Table headers={['Booking Ref', 'Buyer', 'Unit', 'SPA Value', 'Status', 'Booking Date']}>
            {bookings.data.length === 0 ? (
              <EmptyRow colSpan={6} text="No bookings yet." />
            ) : (
              bookings.data.map((b) => (
                <tr key={b.id} className="border-b" style={{ borderColor: BORDER }}>
                  <td className="px-4 py-3 font-mono text-xs">{b.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{b.customer_name || '—'}</td>
                  <td className="px-4 py-3">{b.unit_number || '—'}</td>
                  <td className="px-4 py-3">{AED(b.total_value)}</td>
                  <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                  <td className="px-4 py-3" style={{ color: MUTED }}>{b.booking_date || '—'}</td>
                </tr>
              ))
            )}
          </Table>
          {bookingModal && (
            <BookingModal
              projectId={id}
              onClose={() => setBookingModal(false)}
              onSaved={() => {
                setBookingModal(false);
                bookings.reload();
              }}
            />
          )}
        </div>
      )}

      {tab === 'payments' && (
        <div>
          <div className="flex justify-end mb-3">
            <GoldButton onClick={() => setPaymentModal(true)} disabled={bookings.data.length === 0}>
              <span className="flex items-center gap-2"><Plus size={14} /> Log Payment</span>
            </GoldButton>
          </div>
          <Table headers={['Payment Ref', 'Booking Ref', 'Amount', 'Payment Date', 'VAT', 'Status']}>
            {payments.data.length === 0 ? (
              <EmptyRow colSpan={6} text="No payments logged yet." />
            ) : (
              payments.data.map((pay) => (
                <tr key={pay.id} className="border-b" style={{ borderColor: BORDER }}>
                  <td className="px-4 py-3 font-mono text-xs">{pay.id.slice(0, 8)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{pay.booking_id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{AED(pay.gross_amount)}</td>
                  <td className="px-4 py-3" style={{ color: MUTED }}>{pay.payment_date || '—'}</td>
                  <td className="px-4 py-3">{AED(pay.vat_amount)}</td>
                  <td className="px-4 py-3"><StatusBadge status={pay.status} /></td>
                </tr>
              ))
            )}
          </Table>
          {paymentModal && (
            <PaymentModal
              projectId={id}
              bookingId={bookings.data[0]?.id || ''}
              bookings={bookings.data}
              onClose={() => setPaymentModal(false)}
              onSaved={() => {
                setPaymentModal(false);
                payments.reload();
                project.reload();
              }}
            />
          )}
        </div>
      )}

      {tab === 'escrow' && (
        <div>
          <div className="flex justify-end gap-2 mb-3">
            <GoldButton onClick={() => setEscrowModal('withdraw')}>Withdraw</GoldButton>
          </div>
          <p className="text-xs mb-3" style={{ color: MUTED }}>
            Deposits are created automatically when a payment is logged — there's no separate manual "deposit" action.
          </p>
          <Table headers={['Type', 'Amount', 'Date', 'Purpose', 'Approved By']}>
            {escrow.data.length === 0 ? (
              <EmptyRow colSpan={5} text="No escrow transactions yet." />
            ) : (
              escrow.data.map((tx) => (
                <tr key={tx.id} className="border-b" style={{ borderColor: BORDER }}>
                  <td className="px-4 py-3 capitalize">{tx.type}</td>
                  <td className="px-4 py-3">{AED(tx.amount)}</td>
                  <td className="px-4 py-3" style={{ color: MUTED }}>{tx.transaction_date || '—'}</td>
                  <td className="px-4 py-3" style={{ color: MUTED }}>{tx.purpose || '—'}</td>
                  <td className="px-4 py-3" style={{ color: MUTED }}>{tx.approved_by || '—'}</td>
                </tr>
              ))
            )}
          </Table>
          {escrowModal === 'withdraw' && (
            <WithdrawModal
              projectId={id}
              onClose={() => setEscrowModal(null)}
              onSaved={() => {
                setEscrowModal(null);
                escrow.reload();
                project.reload();
              }}
            />
          )}
        </div>
      )}

      <DemoBadge show={false} />
    </div>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border p-6" style={{ background: SURFACE, borderColor: BORDER }}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-semibold">{title}</p>
          <button type="button" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="mb-3">
      <label className="text-xs" style={{ color: MUTED }}>{label}</label>
      <input {...rest} className="w-full mt-1 px-3 py-2 rounded-lg border bg-transparent text-sm text-white" style={{ borderColor: BORDER }} />
    </div>
  );
}

function BookingModal({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ unit_number: '', customer_name: '', total_value: '', booking_date: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.createBooking({
        project_id: projectId,
        unit_number: form.unit_number || undefined,
        customer_name: form.customer_name || undefined,
        total_value: form.total_value ? Number(form.total_value) : undefined,
        booking_date: form.booking_date || undefined,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell title="New Booking" onClose={onClose}>
      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      <Field label="Unit number" value={form.unit_number} onChange={(e) => setForm({ ...form, unit_number: e.target.value })} />
      <Field label="Buyer name" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
      <Field label="SPA value (AED)" type="number" value={form.total_value} onChange={(e) => setForm({ ...form, total_value: e.target.value })} />
      <Field label="Booking date" type="date" value={form.booking_date} onChange={(e) => setForm({ ...form, booking_date: e.target.value })} />
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm" style={{ color: MUTED }}>Cancel</button>
        <GoldButton onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Create'}</GoldButton>
      </div>
    </ModalShell>
  );
}

function PaymentModal({
  projectId, bookingId, bookings, onClose, onSaved,
}: {
  projectId: string; bookingId: string; bookings: { id: string; unit_number: string | null }[]; onClose: () => void; onSaved: () => void;
}) {
  const [selectedBooking, setSelectedBooking] = useState(bookingId);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.createPayment({
        project_id: projectId,
        booking_id: selectedBooking,
        gross_amount: Number(amount || 0),
        payment_date: date || undefined,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell title="Log Payment" onClose={onClose}>
      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      <div className="mb-3">
        <label className="text-xs" style={{ color: MUTED }}>Booking</label>
        <select
          value={selectedBooking}
          onChange={(e) => setSelectedBooking(e.target.value)}
          className="w-full mt-1 px-3 py-2 rounded-lg border bg-transparent text-sm text-white"
          style={{ borderColor: BORDER }}
        >
          {bookings.map((b) => (
            <option key={b.id} value={b.id} style={{ background: SURFACE }}>{b.unit_number || b.id.slice(0, 8)}</option>
          ))}
        </select>
      </div>
      <Field label="Amount (AED)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Field label="Payment date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm" style={{ color: MUTED }}>Cancel</button>
        <GoldButton onClick={() => void save()} disabled={saving || !selectedBooking}>{saving ? 'Saving…' : 'Log Payment'}</GoldButton>
      </div>
    </ModalShell>
  );
}

function WithdrawModal({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.withdrawEscrow({ project_id: projectId, amount: Number(amount || 0), purpose, approved_by: approvedBy });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell title="Withdraw from Escrow" onClose={onClose}>
      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      <Field label="Amount (AED)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Field label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      <Field label="Approved by (compliance sign-off)" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} />
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm" style={{ color: MUTED }}>Cancel</button>
        <GoldButton onClick={() => void save()} disabled={saving || !amount || !purpose || !approvedBy}>{saving ? 'Saving…' : 'Withdraw'}</GoldButton>
      </div>
    </ModalShell>
  );
}
