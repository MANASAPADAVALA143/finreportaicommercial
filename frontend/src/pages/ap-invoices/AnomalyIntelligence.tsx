/**
 * /anomaly-intelligence
 * Live anomaly dashboard — SPC control charts, Benford analysis,
 * price drift alerts, ghost vendor risk, all powered by training data.
 */

import { useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, CartesianGrid, XAxis, YAxis,
  Tooltip, ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';
import { getMyCompany } from '@/lib/ap-invoice/companyService';
import { supabase } from '@/lib/ap-invoice/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, Brain, CheckCircle2, Loader2, RefreshCw,
  TrendingUp, TrendingDown, Minus, ShieldAlert, Activity,
} from 'lucide-react';
import { useMarket } from '@/contexts/MarketContext';
import { formatCurrency } from '@/utils/currency';
import {
  VendorAnomalyDetailPanel,
  type AnomalyWithInvoice,
  type VendorProfileRow,
  type VendorInvoiceRow,
} from '@/components/anomaly/VendorAnomalyDetailPanel';

// ─── Types ────────────────────────────────────────────────────────────────────

type VendorProfile = VendorProfileRow;

interface LiveInvoice extends VendorInvoiceRow {}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFmt(currency: string) {
  return (n: number) => formatCurrency(n, currency);
}

const AXIS = { fontSize: 10, fill: '#94a3b8' };
const GRID = { strokeDasharray: '3 3', stroke: 'rgba(0,0,0,0.07)' };

/** Build SPC control chart data for a vendor's live invoices vs baseline */
function buildSPCData(profile: VendorProfile, invoices: LiveInvoice[]) {
  const ucl = profile.mean_amount + 3 * profile.std_deviation;
  const lcl = Math.max(0, profile.mean_amount - 3 * profile.std_deviation);
  const warn_hi = profile.mean_amount + 2 * profile.std_deviation;
  const warn_lo = Math.max(0, profile.mean_amount - 2 * profile.std_deviation);

  return invoices
    .filter((i) => i.vendor_name.toLowerCase() === profile.vendor_name.toLowerCase())
    .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date))
    .slice(-20)
    .map((inv) => ({
      date: inv.invoice_date.slice(5), // MM-DD
      amount: inv.total_amount,
      ucl,
      lcl,
      warn_hi,
      warn_lo,
      mean: profile.mean_amount,
      out: inv.total_amount > ucl || inv.total_amount < lcl,
    }));
}

/** Benford's Law expected distribution */
const BENFORD_EXPECTED = [0, 30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6];

function buildBenfordData(invoices: LiveInvoice[], vendorName?: string) {
  const filtered = vendorName
    ? invoices.filter((i) => i.vendor_name.toLowerCase() === vendorName.toLowerCase())
    : invoices;

  const counts = Array(10).fill(0);
  for (const inv of filtered) {
    const first = String(Math.round(inv.total_amount)).replace(/^0+/, '')[0];
    if (first && parseInt(first) >= 1) counts[parseInt(first)]++;
  }
  const total = counts.reduce((s, v) => s + v, 0) || 1;

  return Array.from({ length: 9 }, (_, i) => ({
    digit: String(i + 1),
    actual: Math.round((counts[i + 1] / total) * 1000) / 10,
    expected: BENFORD_EXPECTED[i + 1],
    deviation: Math.abs((counts[i + 1] / total) * 100 - BENFORD_EXPECTED[i + 1]),
  }));
}

/** Benford conformity score 0-100 (100 = perfect) */
function benfordScore(data: ReturnType<typeof buildBenfordData>) {
  const totalDev = data.reduce((s, d) => s + d.deviation, 0);
  return Math.max(0, Math.round(100 - totalDev * 2));
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AnomalyIntelligence() {
  const { config: marketConfig } = useMarket();
  const displayCurrency = marketConfig.currency;
  const fmt = makeFmt(displayCurrency);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<VendorProfile[]>([]);
  const [invoices, setInvoices] = useState<LiveInvoice[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyWithInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVendor, setSelectedVendor] = useState<VendorProfile | null>(null);
  const [detailVendor, setDetailVendor] = useState<VendorProfile | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [tab, setTab] = useState<'spc' | 'benford' | 'drift' | 'ghost'>('spc');

  function openVendorDetail(p: VendorProfile) {
    setDetailVendor(p);
    setSelectedVendor(p);
    setDetailOpen(true);
  }

  useEffect(() => {
    void (async () => {
      const company = await getMyCompany();
      if (!company) return;
      setCompanyId(company.id);
      await load(company.id);
    })();
  }, []);

  async function load(cid: string) {
    setLoading(true);
    const [vpRes, invRes, anRes] = await Promise.all([
      supabase.from('vendor_profiles').select('*').eq('company_id', cid).order('mean_amount', { ascending: false }),
      supabase
        .from('invoices')
        .select('id,vendor_name,invoice_number,total_amount,invoice_date,status')
        .eq('company_id', cid)
        .order('invoice_date', { ascending: false })
        .limit(500),
      supabase
        .from('invoice_anomalies')
        .select('*, invoices(id, invoice_number, vendor_name, total_amount, invoice_date)')
        .eq('company_id', cid)
        .order('created_at', { ascending: false }),
    ]);
    if (vpRes.error) console.warn('[anomaly-intelligence] vendor_profiles:', vpRes.error.message);
    if (invRes.error) console.warn('[anomaly-intelligence] invoices:', invRes.error.message);
    if (anRes.error) console.warn('[anomaly-intelligence] invoice_anomalies:', anRes.error.message);
    const vp = (vpRes.data ?? []) as VendorProfile[];
    const inv = (invRes.data ?? []) as LiveInvoice[];
    setProfiles(vp);
    setInvoices(inv);
    setAnomalies((anRes.data ?? []) as AnomalyWithInvoice[]);
    if (vp.length > 0 && !selectedVendor) setSelectedVendor(vp[0]);
    setLoading(false);
  }

  // ── Derived analytics ───────────────────────────────────────────────────────

  const anomalyVendors = profiles.filter((p) => {
    const vendorInvs = invoices.filter((i) => i.vendor_name.toLowerCase() === p.vendor_name.toLowerCase());
    return vendorInvs.some((i) => Math.abs(i.total_amount - p.mean_amount) / Math.max(p.std_deviation, 1) > 3);
  });

  const driftVendors = profiles.filter((p) => p.price_trend === 'increasing' && p.price_trend_pct > 5);
  const splittingVendors = profiles.filter((p) => p.is_splitting_vendor);
  void profiles.filter((p) => p.historical_rejection_rate > 0.1);

  const spcData = selectedVendor ? buildSPCData(selectedVendor, invoices) : [];
  const benfordData = buildBenfordData(invoices, selectedVendor?.vendor_name);
  const bScore = benfordScore(benfordData);

  // Ghost vendor = vendor with only 1 invoice ever, never recurring
  const ghostVendors = profiles.filter(
    (p) => p.training_invoice_count === 1 && !p.is_recurring
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="text-center py-20">
        <Brain className="h-14 w-14 mx-auto text-gray-200 mb-3" />
        <p className="text-lg font-semibold text-gray-500">No training data yet</p>
        <p className="text-sm text-gray-400 mt-1">Go to 🧠 Training Data and upload historical invoices first</p>
        <Button variant="outline" className="mt-4" onClick={() => window.location.href = '/training'}>
          Go to Training Data →
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="h-6 w-6 text-rose-500" />
            Anomaly Intelligence
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Real-time pattern detection · trained on your ERP history · {profiles.length} vendor profiles
          </p>
        </div>
        {companyId && (
          <Button variant="outline" size="sm" onClick={() => void load(companyId)}>
            <RefreshCw className="h-4 w-4 mr-1.5" />Refresh
          </Button>
        )}
      </div>

      {/* ── Alert Summary ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Amount Anomalies', value: anomalyVendors.length, icon: AlertTriangle, color: 'red', desc: 'vendors with >3σ invoices' },
          { label: 'Price Drift', value: driftVendors.length, icon: TrendingUp, color: 'orange', desc: 'vendors drifting >5%' },
          { label: 'Splitting Risk', value: splittingVendors.length, icon: ShieldAlert, color: 'yellow', desc: 'invoice splitting detected' },
          { label: 'Ghost Vendors', value: ghostVendors.length, icon: AlertTriangle, color: 'purple', desc: 'single-invoice vendors' },
        ].map((s) => (
          <Card key={s.label} className={`border-${s.color}-100 bg-${s.color}-50/40`}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className={`text-2xl font-bold text-${s.color}-600`}>{s.value}</p>
                  <p className="text-xs font-semibold text-gray-700 mt-0.5">{s.label}</p>
                  <p className="text-[11px] text-gray-400">{s.desc}</p>
                </div>
                <s.icon className={`h-5 w-5 text-${s.color}-400 mt-0.5 shrink-0`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Vendor Selector ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-600">Select Vendor to Analyse</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {profiles.slice(0, 20).map((p) => {
              const isAnomaly = anomalyVendors.includes(p);
              const isDrift = p.price_trend === 'increasing';
              const isSplit = p.is_splitting_vendor;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedVendor(p)}
                  className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${
                    selectedVendor?.id === p.id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : isAnomaly ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                      : isDrift ? 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100'
                      : isSplit ? 'bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {p.vendor_name.length > 22 ? p.vendor_name.slice(0, 22) + '…' : p.vendor_name}
                  {isAnomaly && ' ⚠️'}
                  {isDrift && !isAnomaly && ' 📈'}
                  {isSplit && !isAnomaly && ' ✂️'}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Analysis Tabs ── */}
      {selectedVendor && (
        <>
          <div className="flex gap-1 border-b">
            {[
              { id: 'spc', label: '📊 SPC Control Chart' },
              { id: 'benford', label: '🔢 Benford Analysis' },
              { id: 'drift', label: '📈 Price Drift' },
              { id: 'ghost', label: '👻 Ghost Vendors' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id as typeof tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.id
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* SPC Chart */}
          {tab === 'spc' && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{selectedVendor.vendor_name} — SPC Control Chart</CardTitle>
                <CardDescription>
                  Mean: {fmt(selectedVendor.mean_amount)} · UCL: {fmt(selectedVendor.mean_amount + 3 * selectedVendor.std_deviation)} · LCL: {fmt(Math.max(0, selectedVendor.mean_amount - 3 * selectedVendor.std_deviation))}
                  · Trained on {selectedVendor.training_invoice_count} invoices
                </CardDescription>
              </CardHeader>
              <CardContent>
                {spcData.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 text-sm">
                    No live invoices found for {selectedVendor.vendor_name}
                    <br /><span className="text-xs">SPC compares live invoices against the trained baseline</span>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={spcData} margin={{ top: 10, right: 20, bottom: 0, left: 20 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="date" tick={AXIS} />
                      <YAxis tick={AXIS} tickFormatter={(v) => fmt(v)} width={60} />
                      <Tooltip formatter={(v: number) => [fmt(v)]} />
                      <ReferenceLine y={selectedVendor.mean_amount} stroke="#6366f1" strokeDasharray="6 3" label={{ value: 'Mean', fontSize: 10, fill: '#6366f1' }} />
                      <ReferenceLine y={selectedVendor.mean_amount + 3 * selectedVendor.std_deviation} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'UCL', fontSize: 10, fill: '#ef4444' }} />
                      <ReferenceLine y={Math.max(0, selectedVendor.mean_amount - 3 * selectedVendor.std_deviation)} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'LCL', fontSize: 10, fill: '#ef4444' }} />
                      <ReferenceLine y={selectedVendor.mean_amount + 2 * selectedVendor.std_deviation} stroke="#f59e0b" strokeDasharray="2 4" />
                      <Line
                        type="monotone"
                        dataKey="amount"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={(props) => {
                          const { cx, cy, payload } = props as { cx: number; cy: number; payload: { out: boolean } };
                          return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={payload.out ? 6 : 4} fill={payload.out ? '#ef4444' : '#6366f1'} stroke="white" strokeWidth={2} />;
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
                <div className="flex gap-4 mt-3 text-xs text-gray-500 flex-wrap">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-indigo-500 inline-block" />Normal invoice</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" />Outside control limits (anomaly)</span>
                  <span className="flex items-center gap-1"><span className="w-6 border-t-2 border-dashed border-red-500 inline-block" />UCL/LCL (±3σ)</span>
                  <span className="flex items-center gap-1"><span className="w-6 border-t-2 border-dashed border-amber-400 inline-block" />Warning (±2σ)</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Benford */}
          {tab === 'benford' && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">Benford's Law Analysis — {selectedVendor.vendor_name}</CardTitle>
                    <CardDescription>Leading digit distribution · deviation from expected = potential manipulation</CardDescription>
                  </div>
                  <div className={`text-center px-3 py-1.5 rounded-lg ${bScore >= 70 ? 'bg-green-50 border border-green-200' : bScore >= 50 ? 'bg-yellow-50 border border-yellow-200' : 'bg-red-50 border border-red-200'}`}>
                    <p className={`text-2xl font-bold ${bScore >= 70 ? 'text-green-700' : bScore >= 50 ? 'text-yellow-700' : 'text-red-700'}`}>{bScore}</p>
                    <p className="text-[10px] text-gray-500">Conformity</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={benfordData} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="digit" tick={AXIS} label={{ value: 'Leading Digit', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#94a3b8' }} />
                    <YAxis tick={AXIS} unit="%" width={35} />
                    <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`]} />
                    <Bar dataKey="expected" fill="#e2e8f0" name="Expected" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="actual" name="Actual" radius={[3, 3, 0, 0]}>
                      {benfordData.map((d, i) => (
                        <Cell key={i} fill={d.deviation > 8 ? '#ef4444' : d.deviation > 4 ? '#f59e0b' : '#6366f1'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 text-xs text-gray-500 flex gap-4 flex-wrap">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-slate-200 inline-block rounded" />Expected (Benford)</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-indigo-500 inline-block rounded" />Normal</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-500 inline-block rounded" />Mild anomaly</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500 inline-block rounded" />High anomaly</span>
                </div>
                {bScore < 60 && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                    ⚠️ <strong>Low conformity score ({bScore}/100)</strong> — {selectedVendor.vendor_name}'s invoice amounts deviate significantly from Benford's Law. This may indicate invoice manipulation or splitting patterns.
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Price Drift */}
          {tab === 'drift' && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Price Drift Alerts (Mann-Kendall Test)</CardTitle>
                <CardDescription>Vendors showing statistically significant price increases over time</CardDescription>
              </CardHeader>
              <CardContent>
                {driftVendors.length === 0 ? (
                  <div className="flex items-center gap-2 text-green-600 py-6">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-sm font-medium">No significant price drift detected across vendors</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {driftVendors.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-4 rounded-lg border border-orange-200 bg-orange-50">
                        <div>
                          <p className="font-semibold text-gray-900 text-sm">{p.vendor_name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Avg: {fmt(p.mean_amount)} · Range: {fmt(p.min_amount)} – {fmt(p.max_amount)} · {p.training_invoice_count} invoices
                          </p>
                          <p className="text-xs text-orange-700 mt-1 font-medium">
                            📈 Upward price drift: +{p.price_trend_pct.toFixed(1)}% — contract review recommended
                          </p>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <TrendingUp className="h-6 w-6 text-orange-500 ml-auto" />
                          <p className="text-xs text-orange-600 font-bold">+{p.price_trend_pct.toFixed(1)}%</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 rounded-lg bg-gray-50 border p-3 text-xs text-gray-500">
                  <strong>How it works:</strong> Mann-Kendall non-parametric trend test applied to each vendor's invoice history.
                  A normalized score &gt;0.3 = statistically significant upward trend. Requires minimum 6 invoices.
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ghost Vendors */}
          {tab === 'ghost' && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-purple-500" />
                  Ghost Vendor Risk Analysis
                </CardTitle>
                <CardDescription>Single-invoice vendors with no recurring history — potential fraud risk</CardDescription>
              </CardHeader>
              <CardContent>
                {ghostVendors.length === 0 ? (
                  <div className="flex items-center gap-2 text-green-600 py-6">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-sm font-medium">No ghost vendor patterns detected</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                          <th className="px-3 py-2 text-left">Vendor</th>
                          <th className="px-3 py-2 text-right">Amount</th>
                          <th className="px-3 py-2 text-center">Invoices</th>
                          <th className="px-3 py-2 text-center">GL Code</th>
                          <th className="px-3 py-2 text-center">Risk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ghostVendors.map((p) => (
                          <tr key={p.id} className="border-b hover:bg-purple-50/30">
                            <td className="px-3 py-2.5 font-medium text-gray-900">{p.vendor_name}</td>
                            <td className="px-3 py-2.5 text-right font-semibold">{fmt(p.mean_amount)}</td>
                            <td className="px-3 py-2.5 text-center text-gray-500">{p.training_invoice_count}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{(p as unknown as Record<string, unknown>).typical_gl_code as string || '—'}</span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <Badge className={p.mean_amount > 100000 ? 'bg-red-100 text-red-700 border-red-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'}>
                                {p.mean_amount > 100000 ? 'High' : 'Medium'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-700">
                  <strong>Ghost vendor indicators:</strong> Only one invoice ever · Not in approved vendor list · High amount · Round-number amounts · No PO reference.
                  Cross-check these vendors against your approved vendor master.
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── All Vendor Alerts ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All Vendor Alerts</CardTitle>
          <CardDescription>Active flags across all {profiles.length} profiled vendors</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-gray-500">Vendor</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-500">Avg Amount</th>
                  <th className="px-4 py-2 text-center font-semibold text-gray-500">Trend</th>
                  <th className="px-4 py-2 text-center font-semibold text-gray-500">Flags</th>
                  <th className="px-4 py-2 text-center font-semibold text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => {
                  const isAnomaly = anomalyVendors.includes(p);
                  const flags = [
                    isAnomaly && '⚠️ Amount anomaly',
                    p.is_splitting_vendor && '✂️ Splitting',
                    p.price_trend === 'increasing' && '📈 Price drift',
                    p.historical_rejection_rate > 0.1 && '🚫 High rejection',
                    p.training_invoice_count === 1 && '👻 Ghost vendor',
                  ].filter(Boolean) as string[];

                  const statusBadge =
                    flags.length === 0
                      ? { label: 'Clean', className: 'bg-green-100 text-green-700 border-green-200' }
                      : flags.length === 1
                      ? { label: 'Watch', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' }
                      : { label: 'Flag', className: '' };

                  return (
                    <tr
                      key={p.id}
                      className="border-b hover:bg-indigo-50/30 cursor-pointer"
                      onClick={() => openVendorDetail(p)}
                    >
                      <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[200px] truncate">{p.vendor_name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(p.mean_amount)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {p.price_trend === 'increasing'
                          ? <TrendingUp className="h-4 w-4 text-orange-500 inline" />
                          : p.price_trend === 'decreasing'
                          ? <TrendingDown className="h-4 w-4 text-blue-400 inline" />
                          : <Minus className="h-4 w-4 text-gray-300 inline" />}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex gap-1 justify-center flex-wrap">
                          {flags.length === 0
                            ? <span className="text-gray-300">—</span>
                            : flags.map((f, i) => (
                              <span key={i} className="text-[10px] bg-red-50 text-red-700 border border-red-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">{f}</span>
                            ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {flags.length === 0 ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openVendorDetail(p); }}
                          >
                            <Badge className={`${statusBadge.className} text-[10px] hover:opacity-80`}>Clean</Badge>
                          </button>
                        ) : flags.length === 1 ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openVendorDetail(p); }}
                          >
                            <Badge className={`${statusBadge.className} text-[10px] hover:opacity-80 cursor-pointer`}>Watch</Badge>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openVendorDetail(p); }}
                          >
                            <Badge variant="destructive" className="text-[10px] hover:opacity-80 cursor-pointer">Flag</Badge>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <VendorAnomalyDetailPanel
        profile={detailVendor}
        invoices={invoices}
        anomalies={anomalies}
        companyId={companyId}
        currency={displayCurrency}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onAnomalyResolved={() => companyId && void load(companyId)}
      />
    </div>
  );
}
