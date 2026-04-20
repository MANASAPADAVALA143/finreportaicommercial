import { FormEvent, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { formatApiError } from '../utils/apiError';

const API_BASE =
  (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || 'http://localhost:8000';

const ROLES = [
  'CFO',
  'Financial Controller',
  'Finance Director',
  'VP Finance',
  'Finance Manager',
  'Other',
] as const;

const REVENUE = [
  'Under $2M',
  '$2M–$10M',
  '$10M–$50M',
  '$50M–$200M',
  '$200M+',
  'Prefer not to say',
] as const;

const INVOICE_VOL = ['Under 100', '100–500', '500–2000', '2000+'] as const;

const PAINS = [
  'Month-end close too slow',
  'IFRS compliance is manual',
  'AP processing eats team time',
  'Journal entry errors / audit risk',
  'All of the above',
] as const;

type FormState = {
  full_name: string;
  email: string;
  phone: string;
  company_name: string;
  role: (typeof ROLES)[number];
  revenue_range: (typeof REVENUE)[number];
  invoice_volume: (typeof INVOICE_VOL)[number];
  pain_area: (typeof PAINS)[number];
  heard_about: string;
};

const initial: FormState = {
  full_name: '',
  email: '',
  phone: '',
  company_name: '',
  role: 'CFO',
  revenue_range: 'Under $2M',
  invoice_volume: 'Under 100',
  pain_area: 'Month-end close too slow',
  heard_about: '',
};

export default function GetDemoPage() {
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ ok: boolean; message: string; phone: string; name: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setDone(null);
    const payload = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      company_name: form.company_name.trim(),
      role: form.role,
      revenue_range: form.revenue_range,
      invoice_volume: form.invoice_volume,
      pain_area: form.pain_area,
      heard_about: form.heard_about.trim() || undefined,
    };
    try {
      const res = await fetch(`${API_BASE.replace(/\/$/, '')}/api/voice/inbound-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        detail?: unknown;
      };
      if (!res.ok) {
        throw new Error(formatApiError({ response: { data } } as never) || res.statusText || 'Request failed');
      }
      if (data.success) {
        setDone({
          ok: true,
          message: data.message || 'Nova will call you shortly.',
          phone: payload.phone,
          name: payload.full_name,
        });
      } else {
        setDone({
          ok: false,
          message: data.message || "We'll be in touch within 2 hours.",
          phone: payload.phone,
          name: payload.full_name,
        });
      }
    } catch (err) {
      setDone({
        ok: false,
        message: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
        phone: form.phone.trim(),
        name: form.full_name.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || !!done?.ok;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 text-slate-100">
      <div className="absolute inset-0 opacity-20 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgxNDgsIDE2MywgMTg0LCAwLjA1KSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')]" />

      <div className="relative max-w-xl mx-auto px-4 py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-cyan-300/90 hover:text-cyan-200 text-sm mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>

        <div className="flex items-center gap-2 text-cyan-300/90 text-sm font-medium mb-4">
          <Sparkles className="w-4 h-4" />
          Book a demo
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">Talk to Nova in seconds</h1>
        <p className="text-slate-400 mb-8 leading-relaxed">
          Share a few details. After you submit, Nova can call the number you provide so we understand your
          situation before your FinReportAI session.
        </p>

        {done?.ok ? (
          <div className="rounded-xl border border-cyan-500/40 bg-slate-900/60 p-6 text-slate-200 leading-relaxed">
            Thanks {done.name} — Nova will call you at <span className="text-cyan-300 font-medium">{done.phone}</span>{' '}
            within the next 60 seconds to understand your situation.
          </div>
        ) : done && !done.ok ? (
          <div className="rounded-xl border border-amber-500/40 bg-slate-900/60 p-6 text-slate-200 leading-relaxed">
            {done.message}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-slate-700/80 bg-slate-900/50 p-6 backdrop-blur">
            <Field label="Full name" required>
              <input
                required
                className="w-full rounded-lg bg-slate-950/80 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </Field>
            <Field label="Work email" required>
              <input
                required
                type="email"
                className="w-full rounded-lg bg-slate-950/80 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </Field>
            <Field label="Phone (E.164, include country code)" required>
              <input
                required
                placeholder="+15551234567"
                className="w-full rounded-lg bg-slate-950/80 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </Field>
            <Field label="Company name" required>
              <input
                required
                className="w-full rounded-lg bg-slate-950/80 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                value={form.company_name}
                onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
              />
            </Field>
            <Field label="Your role" required>
              <select
                required
                className="w-full rounded-lg bg-slate-950/80 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as FormState['role'] }))}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Company revenue range" required>
              <select
                required
                className="w-full rounded-lg bg-slate-950/80 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                value={form.revenue_range}
                onChange={(e) => setForm((f) => ({ ...f, revenue_range: e.target.value as FormState['revenue_range'] }))}
              >
                {REVENUE.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Monthly invoice volume" required>
              <select
                required
                className="w-full rounded-lg bg-slate-950/80 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                value={form.invoice_volume}
                onChange={(e) =>
                  setForm((f) => ({ ...f, invoice_volume: e.target.value as FormState['invoice_volume'] }))
                }
              >
                {INVOICE_VOL.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Biggest pain right now" required>
              <select
                required
                className="w-full rounded-lg bg-slate-950/80 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                value={form.pain_area}
                onChange={(e) => setForm((f) => ({ ...f, pain_area: e.target.value as FormState['pain_area'] }))}
              >
                {PAINS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="How did you hear about us?">
              <input
                className="w-full rounded-lg bg-slate-950/80 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                value={form.heard_about}
                onChange={(e) => setForm((f) => ({ ...f, heard_about: e.target.value }))}
              />
            </Field>

            <button
              type="submit"
              disabled={disabled}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 py-3 font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-cyan-500/25 transition-all"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Submitting…
                </>
              ) : (
                'Request demo call'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-1.5">
        {label}
        {required ? <span className="text-rose-400"> *</span> : null}
      </label>
      {children}
    </div>
  );
}
