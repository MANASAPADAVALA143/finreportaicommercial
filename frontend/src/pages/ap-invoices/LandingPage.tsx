import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/ap-invoice/supabase';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import {
  FileText,
  ArrowRight,
  CheckCircle,
  Play,
  ArrowUpToLine,
  Shield,
  Cog,
  Zap,
  GitBranch,
  Users,
} from 'lucide-react';

const BRAND_BLUE = '#1a56db';

const TRUST_STATS_FALLBACK =
  'Trusted by finance teams who need encryption, auditability, and clear accountability.';

function formatManagedInr(total: number): string {
  const cr = total / 1e7;
  if (cr >= 0.01) return `â‚¹${cr.toFixed(2)} Cr`;
  const L = total / 1e5;
  if (L >= 1) return `â‚¹${L.toFixed(2)} L`;
  if (total >= 1000) return `â‚¹${(total / 1e3).toFixed(2)} K`;
  return `â‚¹${Math.round(total).toLocaleString('en-IN')}`;
}

export function LandingPage() {
  const [trustBar, setTrustBar] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { count, error: cErr } = await supabase.from('invoices').select('*', { count: 'exact', head: true });
        if (cancelled || cErr || count == null || count < 1) {
          if (!cancelled) setTrustBar(null);
          return;
        }
        const { data: rows, error: rErr } = await supabase
          .from('invoices')
          .select('total_amount, vendor_name')
          .limit(8000);
        if (cancelled || rErr || !rows?.length) {
          if (!cancelled) setTrustBar(null);
          return;
        }
        const sum = rows.reduce((s, r) => s + Number((r as { total_amount?: number }).total_amount ?? 0), 0);
        const vendors = new Set(
          rows.map((r) => (r as { vendor_name?: string | null }).vendor_name).filter(Boolean)
        ).size;
        if (!cancelled) {
          setTrustBar(
            `${count.toLocaleString()} Invoices Processed Â· ${formatManagedInr(sum)} Managed Â· ${vendors.toLocaleString()} Vendors`
          );
        }
      } catch {
        if (!cancelled) setTrustBar(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-white font-sans" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Navigation */}
      <nav className="fixed top-0 z-50 w-full border-b border-gray-200/50 bg-white/80 backdrop-blur-xl shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-r from-white/50 via-blue-50/30 to-white/50" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: BRAND_BLUE }}>
                <FileText className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">InvoiceFlow</span>
            </div>
            <div className="hidden items-center gap-8 md:flex">
              <a href="#features" className="text-sm font-medium text-gray-600 hover:text-[#1a56db]">Features</a>
              <a href="#pricing" className="text-sm font-medium text-gray-600 hover:text-[#1a56db]">Pricing</a>
              <a href="#how-it-works" className="text-sm font-medium text-gray-600 hover:text-[#1a56db]">How It Works</a>
              <a href="#trust" className="text-sm font-medium text-gray-600 hover:text-[#1a56db]">Trust</a>
              <Link to="/dashboard">
                <Button variant="outline" size="sm" style={{ borderColor: BRAND_BLUE, color: BRAND_BLUE }}>
                  Login
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-32 pb-20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a56db]/10 via-blue-50 to-white" />

        <div className="absolute top-0 left-0 w-[500px] h-[500px] rounded-full blur-3xl animate-pulse-slow opacity-20" style={{ backgroundColor: BRAND_BLUE }} />
        <div className="absolute top-20 right-0 w-[600px] h-[600px] bg-blue-400/10 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1s' }} />
        <div className="absolute bottom-0 left-1/2 w-[400px] h-[400px] bg-blue-300/10 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '2s' }} />

        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, ${BRAND_BLUE}14 1px, transparent 0)`,
          backgroundSize: '40px 40px'
        }} />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-8">
            <div className="flex flex-col justify-center">
              <Badge className="mb-4 w-fit opacity-90" style={{ backgroundColor: `${BRAND_BLUE}20`, color: BRAND_BLUE }}>
                AI-Powered Invoice Processing
              </Badge>
              <h1 className="text-5xl font-bold leading-tight text-gray-900 lg:text-6xl">
                Automate Your Invoice Processing with AI
              </h1>
              <p className="mt-4 text-sm font-semibold tracking-wide text-gray-800 sm:text-base">
                IFRS Â· Ind AS Â· US GAAP Â· IGAAP Â· Cash Basis
              </p>
              <p className="mt-2 text-sm text-gray-600 sm:text-base">
                Built for India Â· UAE Â· UK Â· Singapore Â· Australia Â· USA
              </p>
              <p className="mt-6 text-xl text-gray-600 whitespace-pre-line">{`Process invoices 10x faster with
AI-powered extraction and automatic
classification across all accounting
standards.`}</p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link to="/dashboard">
                  <Button size="lg" style={{ backgroundColor: BRAND_BLUE }} className="hover:opacity-90">
                    Start Free Trial
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
                <Button size="lg" variant="outline">
                  <Play className="mr-2 h-5 w-5" />
                  Watch Demo
                </Button>
              </div>
              <div className="mt-8 flex items-center gap-6 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span>14-day free trial</span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center">
              <div className="relative">
                <div className="absolute -inset-4 rounded-2xl opacity-20 blur-2xl" style={{ background: `linear-gradient(to right, ${BRAND_BLUE}, #3b82f6)` }} />
                <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
                  <div className="space-y-4">
                    {/* Step 1: Uploading invoice... with 0% progress bar */}
                    <div className="animate-fade-in rounded-xl border border-gray-200 bg-gray-50 p-4 shadow-lg transition-all duration-300" style={{ animationDelay: '0s', animationFillMode: 'both' }}>
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-[#1a56db] p-2.5 shadow-md">
                          <ArrowUpToLine className="h-6 w-6 text-white" />
                        </div>
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-700">Uploading invoice...</span>
                            <span className="text-xs text-gray-500">0%</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                            <div className="h-full w-0 rounded-full bg-gray-400 transition-all duration-1000" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Step 2: AI Extracting Data with gear icon and checkmark, Invoice #12345 box */}
                    <div className="animate-fade-in rounded-xl border border-green-200 bg-green-50/50 p-4 shadow-lg transition-all duration-300" style={{ animationDelay: '0.3s', animationFillMode: 'both' }}>
                      <div className="relative">
                        <div className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#10B981] shadow-lg">
                          <CheckCircle className="h-4 w-4 text-white" />
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="rounded-lg bg-[#10B981] p-2.5 shadow-md">
                            <Cog className="h-6 w-6 text-white" />
                          </div>
                          <div className="flex-1 space-y-2">
                            <span className="text-sm font-medium text-gray-700">AI Extracting Data</span>
                            <div className="rounded-lg border border-green-200 bg-white p-2.5 shadow-sm">
                              <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-gray-600" />
                                <div className="flex-1">
                                  <div className="text-xs font-medium text-gray-700">Invoice #12345</div>
                                  <div className="text-xs text-gray-500">Amount: $2,500</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Step 3: IFRS Category â†’ Operating Expense, Confidence 95%, Ready for Review */}
                    <div className="animate-fade-in rounded-xl border border-green-300 bg-green-50 p-4 shadow-lg transition-all duration-300" style={{ animationDelay: '0.6s', animationFillMode: 'both' }}>
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-[#10B981] p-2.5 shadow-md">
                          <CheckCircle className="h-6 w-6 text-white" />
                        </div>
                        <div className="flex-1 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-700">IFRS Category</span>
                            <Badge className="bg-[#10B981] text-white text-xs px-2 py-0.5 shadow-sm">Ready for Review</Badge>
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs">
                              <CheckCircle className="h-3.5 w-3.5 text-[#10B981]" />
                              <span className="font-medium text-gray-700">Operating Expense</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="text-gray-600">Confidence: 95%</span>
                            </div>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-green-200">
                            <div className="h-full w-[95%] rounded-full bg-[#10B981] transition-all duration-1000 shadow-sm" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-white via-gray-50 to-white" />
        <div className="absolute top-20 right-10 w-72 h-72 bg-blue-400/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-10 w-96 h-96 rounded-full blur-3xl bg-[#1a56db]/5" />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <Badge className="mb-4 bg-[#1a56db]/10 text-[#1a56db]">Features</Badge>
            <h2 className="text-4xl font-bold text-gray-900">
              Everything you need to process invoices
            </h2>
            <p className="mt-4 text-xl text-gray-600">
              Powerful features to streamline your AP workflow
            </p>
          </div>

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            <Card className="border-2 hover:border-[#1a56db] transition-colors">
              <CardHeader>
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#1a56db]">
                  <Zap className="h-6 w-6 text-white" />
                </div>
                <CardTitle>AI-Powered OCR</CardTitle>
                <CardDescription>
                  Extract data from any invoice format with 99% accuracy. Supports PDFs, images,
                  and scanned documents.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Multi-format support
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Smart field detection
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Batch processing
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-2 hover:border-[#1a56db] transition-colors">
              <CardHeader>
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#1a56db]">
                  <Shield className="h-6 w-6 text-white" />
                </div>
                <CardTitle>Multi-standard classification</CardTitle>
                <CardDescription>
                  Automatic categorization across IFRS, Ind AS, US GAAP, and more. Reduce manual
                  classification work by 90%.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Multi-standard categories
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Confidence scoring
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Manual override option
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-2 hover:border-[#1a56db] transition-colors">
              <CardHeader>
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#1a56db]">
                  <GitBranch className="h-6 w-6 text-white" />
                </div>
                <CardTitle>n8n Integration</CardTitle>
                <CardDescription>
                  Connect with your existing tools seamlessly. Integrate with accounting software,
                  ERP systems, and more.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Pre-built workflows
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    API access
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Real-time sync
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Trust & compliance â€” after features, before How It Works */}
      <section id="trust" className="relative py-20 overflow-hidden scroll-mt-20">
        <div className="absolute inset-0 bg-gradient-to-b from-white via-slate-50/80 to-white" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <Badge className="mb-4 bg-[#1a56db]/10 text-[#1a56db]">Trust</Badge>
            <h2 className="text-4xl font-bold text-gray-900">
              Built on Trust, Backed by Compliance
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Security and accountability are built inâ€”not bolted on.
            </p>
          </div>

          <div className="mt-8 rounded-xl border border-gray-200 bg-white/90 px-4 py-4 text-center shadow-sm md:px-8">
            <p className="text-sm font-medium text-gray-800 md:text-base">
              {trustBar ?? TRUST_STATS_FALLBACK}
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <div className="text-2xl mb-1" aria-hidden>
                  ðŸ”’
                </div>
                <CardTitle className="text-lg">Encrypted at rest &amp; in transit</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-gray-600">
                All data encrypted with AES-256. Every connection over TLS 1.3.
              </CardContent>
            </Card>
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <div className="text-2xl mb-1" aria-hidden>
                  ðŸ›¡
                </div>
                <CardTitle className="text-lg">SOC 2 compliant hosting</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-gray-600">
                Hosted on Supabaseâ€”independently SOC 2 Type II certified infrastructure.
              </CardContent>
            </Card>
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <div className="text-2xl mb-1" aria-hidden>
                  ðŸ“‹
                </div>
                <CardTitle className="text-lg">Complete audit trail</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-gray-600">
                Every invoice action logged with timestamp and user. Nothing is ever deleted silently.
              </CardContent>
            </Card>
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 mb-1 text-[#1a56db]">
                  <Users className="h-7 w-7" aria-hidden />
                </div>
                <CardTitle className="text-lg">Role-based access</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-gray-600">
                Control who can view, approve, and pay invoices. Access matched to responsibility.
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white via-blue-50/30 to-white" />
        <div className="absolute top-0 left-1/4 w-64 h-64 rounded-full blur-3xl animate-pulse-slow bg-[#1a56db]/10" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-blue-300/10 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1.5s' }} />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <Badge className="mb-4 bg-[#1a56db]/10 text-[#1a56db]">How It Works</Badge>
            <h2 className="text-4xl font-bold text-gray-900">
              Simple process, powerful results
            </h2>
            <p className="mt-4 text-xl text-gray-600">
              Get started in minutes, not hours
            </p>
          </div>

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            <div className="relative">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1a56db] text-2xl font-bold text-white">
                  1
                </div>
                <h3 className="mt-6 text-xl font-semibold text-gray-900">Upload Invoices</h3>
                <p className="mt-2 text-gray-600">
                  Drag and drop your invoices or integrate via API. Supports all formats.
                </p>
              </div>
              <div className="absolute top-8 left-full hidden h-0.5 w-full bg-gradient-to-r from-[#1a56db] to-transparent md:block" />
            </div>

            <div className="relative">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1a56db] text-2xl font-bold text-white">
                  2
                </div>
                <h3 className="mt-6 text-xl font-semibold text-gray-900">AI Processes</h3>
                <p className="mt-2 text-gray-600">
                  Our AI extracts all data automatically with 99% accuracy in seconds.
                </p>
              </div>
              <div className="absolute top-8 left-full hidden h-0.5 w-full bg-gradient-to-r from-[#1a56db] to-transparent md:block" />
            </div>

            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1a56db] text-2xl font-bold text-white">
                3
              </div>
              <h3 className="mt-6 text-xl font-semibold text-gray-900">Auto-categorize & Sync</h3>
              <p className="mt-2 text-gray-600">
                Invoices are classified and synced to your accounting system automatically.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="relative py-20 overflow-hidden">
        {/* Radial gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-gray-50 via-white to-gray-50" />

        {/* Mesh gradient effect */}
        <div className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `
              radial-gradient(at 20% 30%, rgb(10 75 143 / 0.15) 0px, transparent 50%),
              radial-gradient(at 80% 70%, rgb(59 130 246 / 0.15) 0px, transparent 50%),
              radial-gradient(at 50% 50%, rgb(147 197 253 / 0.1) 0px, transparent 50%)
            `
          }}
        />

        {/* Decorative circles */}
        <div className="absolute top-10 left-5 w-96 h-96 bg-[#1a56db]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-5 w-96 h-96 bg-blue-300/10 rounded-full blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <Badge className="mb-4 bg-[#1a56db]/10 text-[#1a56db]">Pricing</Badge>
            <h2 className="text-4xl font-bold text-gray-900">
              Choose your plan
            </h2>
            <p className="mt-4 text-xl text-gray-600">
              Simple, transparent pricing that grows with you
            </p>
          </div>

          <div className="mt-16 grid gap-8 lg:grid-cols-3">
            <Card className="relative">
              <CardHeader>
                <CardTitle className="text-2xl">Starter</CardTitle>
                <CardDescription>Perfect for small businesses</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-gray-900">$49</span>
                  <span className="text-gray-600">/month</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>100 invoices/month</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>AI-powered OCR</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>Basic support</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>Export to CSV</span>
                  </li>
                </ul>
                <Link to="/dashboard">
                  <Button className="mt-8 w-full" variant="outline">
                    Start Free Trial
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="relative border-2 border-[#1a56db] shadow-lg">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                <Badge className="bg-[#1a56db] text-white">Most Popular</Badge>
              </div>
              <CardHeader>
                <CardTitle className="text-2xl">Professional</CardTitle>
                <CardDescription>For growing companies</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-gray-900">$149</span>
                  <span className="text-gray-600">/month</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>500 invoices/month</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>AI-powered OCR</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>Multi-standard classification</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>Priority support</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>n8n Integration</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>API access</span>
                  </li>
                </ul>
                <Link to="/dashboard">
                  <Button className="mt-8 w-full bg-[#1a56db] hover:opacity-90">
                    Start Free Trial
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="relative">
              <CardHeader>
                <CardTitle className="text-2xl">Enterprise</CardTitle>
                <CardDescription>For large organizations</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-gray-900">Custom</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>Unlimited invoices</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>Everything in Professional</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>Dedicated support</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>Custom workflows</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>SLA guarantee</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span>On-premise option</span>
                  </li>
                </ul>
                <Button className="mt-8 w-full" variant="outline">
                  Contact Sales
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-20 overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-white via-blue-50/20 to-white" />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative rounded-2xl bg-gradient-to-br from-[#1a56db] via-blue-700 to-blue-600 px-8 py-16 text-center overflow-hidden shadow-2xl">
            {/* Gradient orbs inside CTA */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-900/20 rounded-full blur-3xl" />

            <div className="relative">
            <h2 className="text-4xl font-bold text-white">
              Ready to transform your invoice processing?
            </h2>
            <p className="mt-4 text-xl text-blue-100">
              Join hundreds of companies already saving time and money
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link to="/dashboard">
                <Button size="lg" variant="secondary">
                  Start Free Trial
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="border-white text-white hover:bg-white/10">
                Schedule a Demo
              </Button>
            </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-gray-200 overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-gray-50 to-white" />

        {/* Subtle decoration */}
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#1a56db]/20 to-transparent" />

        <div className="relative py-12 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1a56db]">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                <span className="text-xl font-bold text-gray-900">InvoiceFlow</span>
              </div>
              <p className="mt-4 text-sm text-gray-600">
                Automate your invoice processing with AI-powered technology.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Product</h3>
              <ul className="mt-4 space-y-2 text-sm text-gray-600">
                <li><a href="#features" className="hover:text-[#1a56db]">Features</a></li>
                <li><a href="#pricing" className="hover:text-[#1a56db]">Pricing</a></li>
                <li><a href="#" className="hover:text-[#1a56db]">API</a></li>
                <li><a href="#" className="hover:text-[#1a56db]">Integrations</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Company</h3>
              <ul className="mt-4 space-y-2 text-sm text-gray-600">
                <li><a href="#" className="hover:text-[#1a56db]">About</a></li>
                <li><a href="#" className="hover:text-[#1a56db]">Contact</a></li>
                <li><a href="#" className="hover:text-[#1a56db]">Blog</a></li>
                <li><a href="#" className="hover:text-[#1a56db]">Careers</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Legal</h3>
              <ul className="mt-4 space-y-2 text-sm text-gray-600">
                <li><a href="#" className="hover:text-[#1a56db]">Terms of Service</a></li>
                <li><a href="#" className="hover:text-[#1a56db]">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-[#1a56db]">Cookie Policy</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 border-t border-gray-200 pt-8 text-center text-sm text-gray-600">
            <p>Â© 2024 InvoiceFlow. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

