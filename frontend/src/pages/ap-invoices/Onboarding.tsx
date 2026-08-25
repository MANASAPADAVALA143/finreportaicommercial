import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useToast } from '../../hooks/use-toast';
import { supabase } from '../../lib/ap-invoice/supabase';
import { clearCompanyCache, TIER_PRESETS, type SubscriptionTier } from '../../lib/ap-invoice/companyService';
import { useMarket } from '../../contexts/MarketContext';
import type { Market } from '../../lib/ap-invoice/marketConfig';
import { useIndustryConfig } from '../../context/IndustryConfigContext';
import {
  INDUSTRY_CARDS,
  INDUSTRY_PREVIEW,
  type IndustryKey,
} from '../../services/industryConfig.service';

export function Onboarding() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { market, setMarket } = useMarket();
  const { setIndustry: persistIndustry } = useIndustryConfig();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState<IndustryKey>('general');
  const [size, setSize] = useState('1–10');
  const [standard, setStandard] = useState('IFRS');
  const [loadStandardGl, setLoadStandardGl] = useState(true);
  const [approverEmails, setApproverEmails] = useState('');
  const [cfoEmail, setCfoEmail] = useState('');
  const [autoUnder, setAutoUnder] = useState('25000');
  const [teamEmails, setTeamEmails] = useState('');
  const preview = INDUSTRY_PREVIEW[industry] || INDUSTRY_PREVIEW.general;

  async function finish() {
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user?.id) {
        toast({
          title: 'Sign in required',
          description: 'Create an account or sign in to finish onboarding.',
          variant: 'destructive',
        });
        setBusy(false);
        return;
      }

      const tier: SubscriptionTier = 'starter';
      const preset = TIER_PRESETS[tier];
      const slug =
        companyName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') +
        '-' +
        Date.now().toString(36);

      // Generate the ID upfront so we never need to SELECT companies before membership exists.
      // (Avoids RLS chicken-and-egg: SELECT policy requires membership, but member row isn't inserted yet.)
      const companyId = crypto.randomUUID();

      const { error: cErr } = await supabase
        .from('companies')
        .insert({
          id: companyId,
          name: companyName.trim() || 'My organisation',
          slug: slug || `org-${Date.now().toString(36)}`,
          industry: industry,
          accounting_standard: standard,
          subscription_tier: tier,
          max_invoices_per_month: preset.max_invoices_per_month,
          max_users: preset.max_users,
          price_inr_monthly: preset.price_inr_monthly,
        });

      if (cErr) throw cErr;

      const { error: mErr } = await supabase.from('company_members').insert({
        company_id: companyId,
        user_id: user.id,
        role: 'owner',
        email: user.email ?? null,
        joined_at: new Date().toISOString(),
        is_active: true,
      });
      if (mErr) throw mErr;

      // Now membership exists â€” safe to read the company
      await supabase.from('companies').select('id').eq('id', companyId).single();

      const approvers = approverEmails
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const { error: cfgErr } = await supabase.from('company_config').insert({
        company_id: companyId,
        approval_flow: approvers.length > 0 ? approvers : ['Finance Manager', 'CFO'],
        agent_config: {
          high_value_threshold_inr: 500000,
          auto_approve_min_confidence: 90,
          auto_approve_max_risk_score: 30,
          require_human_new_vendor: true,
          require_human_critical_risk: true,
          require_human_duplicate: true,
          sla_hours_before_escalation: 4,
        },
        compliance_rules: {
          gst_check_enabled: true,
          duplicate_check_enabled: true,
          duplicate_lookback_days: 365,
          max_amount_without_po: Number(autoUnder) || 50000,
          require_po_above: 100000,
          blocked_vendors: [],
        },
      });
      if (cfgErr) console.warn('company_config:', cfgErr.message);

      const cfo = cfoEmail.trim() || user.email || null;
      const { error: settingsErr } = await supabase.from('company_settings').insert({
        company_id: companyId,
        company_name: companyName.trim() || 'My organisation',
        country: market === 'uae' ? 'AE' : 'IN',
        base_currency: market === 'uae' ? 'AED' : 'INR',
        accounting_standard: standard === 'Ind AS' ? 'IND_AS' : standard === 'IFRS' ? 'IFRS' : standard,
        date_format: 'DD-MM-YYYY',
        timezone: market === 'uae' ? 'Asia/Dubai' : 'Asia/Kolkata',
        fy_start: market === 'uae' ? '01-01' : '04-01',
        cfo_email: cfo,
        updated_at: new Date().toISOString(),
      });
      if (settingsErr) console.warn('company_settings:', settingsErr.message);

      if (cfo) {
        await supabase.from('companies').update({ admin_email: cfo }).eq('id', companyId);
      }

      if (loadStandardGl) {
        /* Optional: chart seed can be run from Settings later */
      }

      const extras = teamEmails
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const em of extras) {
        await supabase.from('company_members').insert({
          company_id: companyId,
          email: em,
          role: 'viewer',
          invited_at: new Date().toISOString(),
          is_active: true,
        });
      }

      await supabase.auth.updateUser({ data: { active_company_id: companyId } });
      try {
        await persistIndustry(industry);
      } catch (e) {
        console.warn('industry config:', e);
      }
      clearCompanyCache();
      toast({ title: 'Welcome to InvoiceFlow', description: 'Your workspace is ready.' });
      // Full reload ensures no stale company cache or in-memory state from previous workspace
      setTimeout(() => { window.location.href = '/dashboard'; }, 800);
    } catch (e) {
      console.error(e);
      toast({
        title: 'Onboarding failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="mb-6 flex justify-between text-sm text-gray-500">
        <span>Step {step} of 6</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
          Skip for now
        </Button>
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Select your industry</CardTitle>
            <CardDescription>
              Labels for cost centers, AP/AR, and compliance modules follow your industry.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {INDUSTRY_CARDS.map((card) => {
                const active = industry === card.key;
                return (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => setIndustry(card.key)}
                    className={`text-left rounded-xl border p-3 transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-400'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-xl mb-1">{card.icon}</div>
                    <div className="font-semibold text-sm text-slate-900">{card.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{card.description}</div>
                  </button>
                );
              })}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="text-xs font-semibold uppercase text-slate-500 mb-2">Sidebar preview</p>
              <ul className="space-y-1">
                <li>• {preview.apLabel}</li>
                <li>• {preview.arLabel}</li>
                <li>• {preview.costCenterLabel}</li>
                {preview.showIfrs15 && <li>• IFRS 15 Recognition</li>}
                {preview.showIfrs16 && <li>• IFRS 16 Leases</li>}
                {preview.showRera && <li>• RERA Compliance</li>}
              </ul>
            </div>
            <Button className="w-full" onClick={() => setStep(2)}>
              Continue
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Company details</CardTitle>
            <CardDescription>How we label your workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm font-semibold">Select Your Market</Label>
              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => { void setMarket('india' as Market); setStandard('Ind AS'); }}
                  className="flex-1 rounded-lg border px-4 py-3 text-left transition-colors"
                  style={{
                    background: market === 'india' ? '#1D9E75' : 'transparent',
                    color: market === 'india' ? '#fff' : 'inherit',
                    borderColor: market === 'india' ? '#1D9E75' : '#e5e7eb',
                    fontWeight: 600,
                  }}
                >
                  <div>🇮🇳 India</div>
                  <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>GST · GSTIN · INR</div>
                </button>
                <button
                  type="button"
                  onClick={() => { void setMarket('uae' as Market); setStandard('IFRS'); }}
                  className="flex-1 rounded-lg border px-4 py-3 text-left transition-colors"
                  style={{
                    background: market === 'uae' ? '#378ADD' : 'transparent',
                    color: market === 'uae' ? '#fff' : 'inherit',
                    borderColor: market === 'uae' ? '#378ADD' : '#e5e7eb',
                    fontWeight: 600,
                  }}
                >
                  <div>🇦🇪 UAE</div>
                  <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>VAT · TRN · AED</div>
                </button>
              </div>
            </div>
            <div>
              <Label>Company name</Label>
              <Input className="mt-1" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div>
              <Label>Company size</Label>
              <Select value={size} onValueChange={setSize}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1–10">1–10</SelectItem>
                  <SelectItem value="11–50">11–50</SelectItem>
                  <SelectItem value="51–200">51–200</SelectItem>
                  <SelectItem value="200+">200+</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button className="flex-1" onClick={() => setStep(3)}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Accounting standard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={standard} onValueChange={setStandard}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="IFRS">IFRS</SelectItem>
                <SelectItem value="US GAAP">US GAAP</SelectItem>
                <SelectItem value="Ind AS">Ind AS</SelectItem>
                <SelectItem value="IGAAP">IGAAP</SelectItem>
                <SelectItem value="Cash Basis">Cash Basis</SelectItem>
                <SelectItem value="Custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={loadStandardGl}
                onChange={(e) => setLoadStandardGl(e.target.checked)}
              />
              Load standard GL codes (you can refine in Settings)
            </label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button className="flex-1" onClick={() => setStep(4)}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Approvals &amp; CFO email</CardTitle>
            <CardDescription>
              Daily CFO briefing goes to this address automatically (AED or INR by market). Optional approver emails for the chain.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>CFO email (required for daily briefing)</Label>
              <Input
                className="mt-1"
                type="email"
                value={cfoEmail}
                onChange={(e) => setCfoEmail(e.target.value)}
                placeholder="cfo@yourcompany.com"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Stored on company settings — no server changes when you add clients.
              </p>
            </div>
            <div>
              <Label>Approver emails (optional)</Label>
              <TextareaLike value={approverEmails} onChange={setApproverEmails} placeholder="cfo@company.com, fm@company.com" />
            </div>
            <div>
              <Label>Auto-approve below (₹)</Label>
              <Input className="mt-1" value={autoUnder} onChange={(e) => setAutoUnder(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(3)}>
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (!cfoEmail.trim() && !approverEmails.trim()) {
                    /* allow continue — finish() falls back to signed-in user email */
                  }
                  setStep(5);
                }}
              >
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle>First invoice</CardTitle>
            <CardDescription>Upload later from the main menu.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(4)}>
              Back
            </Button>
            <Button className="flex-1" onClick={() => navigate('/ap-invoices/upload')}>
              Upload now
            </Button>
            <Button className="flex-1" variant="secondary" onClick={() => setStep(6)}>
              Skip
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 6 && (
        <Card>
          <CardHeader>
            <CardTitle>Invite team</CardTitle>
            <CardDescription>Optional — comma-separated emails.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <TextareaLike value={teamEmails} onChange={setTeamEmails} placeholder="ap1@company.com, ap2@company.com" />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(5)}>
                Back
              </Button>
              <Button className="flex-1" disabled={busy} onClick={() => void finish()}>
                {busy ? 'Finishing…' : 'Finish'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TextareaLike({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

