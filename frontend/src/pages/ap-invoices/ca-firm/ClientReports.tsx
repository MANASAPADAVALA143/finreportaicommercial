import { useState } from 'react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Loader2, Download, Sparkles, Share2, Mail } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { anthropicMessagesUrl } from '../../lib/ap-invoice/anthropicApiUrl';

type ReportData = {
  clientName: string;
  period: string;
  firmName: string;
  revenue: string;
  grossProfit: string;
  netProfit: string;
  cashBalance: string;
  gpPct: string;
  netPct: string;
  currentRatio: string;
  dso: string;
  recommendations: string;
};

const DEMO_DATA: ReportData = {
  clientName: 'Sharma & Sons Pvt Ltd',
  period: 'FY 2025-26',
  firmName: 'R.K. Associates, Chartered Accountants',
  revenue: '38,00,000',
  grossProfit: '16,00,000',
  netProfit: '4,07,000',
  cashBalance: '4,85,000',
  gpPct: '42.1%',
  netPct: '10.7%',
  currentRatio: '2.05',
  dso: '85 days',
  recommendations: '',
};

export function ClientReports() {
  const { toast } = useToast();
  const [data, setData] = useState<ReportData>(DEMO_DATA);
  const [loading, setLoading] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [recommendations, setRecommendations] = useState('');

  const generateReport = async () => {
    setLoading(true);
    setReportReady(false);
    try {
      const res = await fetch(anthropicMessagesUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 800,
          messages: [{
            role: 'user',
            content: `You are a CA firm preparing a client financial report for ${data.clientName}, ${data.period}.\n\nKey numbers:\n- Revenue: â‚¹${data.revenue}\n- Gross Profit: â‚¹${data.grossProfit} (${data.gpPct})\n- Net Profit: â‚¹${data.netProfit} (${data.netPct})\n- Cash Balance: â‚¹${data.cashBalance}\n- Current Ratio: ${data.currentRatio}\n- DSO: ${data.dso}\n\nWrite exactly 3 sections (each 2-3 sentences):\n1. EXECUTIVE SUMMARY: Overall financial health\n2. KEY STRENGTHS: 3 specific positives from the numbers\n3. RECOMMENDED ACTIONS: 3 specific action items with timelines\n\nProfessional Indian CA style. Use â‚¹ symbol. Specific numbers.`,
          }],
        }),
      });
      const d = await res.json() as { content?: Array<{ text?: string }> };
      setRecommendations(d.content?.[0]?.text ?? '');
      setData((prev) => ({ ...prev, recommendations: d.content?.[0]?.text ?? '' }));
      setReportReady(true);
    } catch {
      toast({ title: 'Error', description: 'Failed to generate report', variant: 'destructive' });
    }
    setLoading(false);
  };

  const loadDemo = () => {
    setData(DEMO_DATA);
    setReportReady(false);
    setRecommendations('');
    toast({ title: 'Demo data loaded', description: 'Sharma & Sons Pvt Ltd â€” FY 2025-26' });
  };

  const downloadHTML = () => {
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Financial Report â€” ${data.clientName}</title>
<style>
  body { font-family: Georgia, serif; color: #1e293b; margin: 0; padding: 0; }
  .cover { background: #1e3a5f; color: white; padding: 80px 60px; min-height: 200px; }
  .cover h1 { font-size: 36px; margin: 0 0 8px; }
  .cover h2 { font-size: 22px; margin: 0 0 24px; opacity: 0.8; }
  .cover p { font-size: 14px; opacity: 0.7; margin: 4px 0; }
  .section { padding: 40px 60px; border-bottom: 1px solid #e2e8f0; }
  .section h3 { font-size: 18px; color: #1e3a5f; text-transform: uppercase; letter-spacing: .05em; margin: 0 0 20px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; margin-bottom: 24px; }
  .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
  .kpi .val { font-size: 24px; font-weight: 700; color: #1e3a5f; }
  .kpi .lbl { font-size: 11px; color: #64748b; margin-top: 4px; }
  .ratio-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }
  .ratio { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 12px; text-align: center; }
  .ratio .rval { font-size: 20px; font-weight: 700; color: #166534; }
  .ratio .rlbl { font-size: 11px; color: #4ade80; margin-top: 2px; }
  .recs { white-space: pre-wrap; line-height: 1.8; font-size: 14px; }
  .footer { background: #f8fafc; padding: 20px 60px; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
  .watermark { font-size: 11px; color: #94a3b8; }
</style>
</head>
<body>
<div class="cover">
  <p style="font-size:12px;opacity:.6;margin-bottom:32px;text-transform:uppercase;letter-spacing:.1em">FINANCIAL REPORT</p>
  <h1>${data.clientName}</h1>
  <h2>${data.period}</h2>
  <p>Prepared by: ${data.firmName}</p>
  <p>Date: ${today}</p>
  <p class="watermark" style="margin-top:32px;">Powered by Gnanova Pro</p>
</div>

<div class="section">
  <h3>Executive Summary</h3>
  <div class="kpi-grid">
    <div class="kpi"><div class="val">â‚¹${data.revenue}</div><div class="lbl">Revenue</div></div>
    <div class="kpi"><div class="val">â‚¹${data.grossProfit}</div><div class="lbl">Gross Profit (${data.gpPct})</div></div>
    <div class="kpi"><div class="val">â‚¹${data.netProfit}</div><div class="lbl">Net Profit (${data.netPct})</div></div>
    <div class="kpi"><div class="val">â‚¹${data.cashBalance}</div><div class="lbl">Cash Balance</div></div>
  </div>
</div>

<div class="section">
  <h3>Key Ratios</h3>
  <div class="ratio-grid">
    <div class="ratio"><div class="rval">${data.gpPct}</div><div class="rlbl">Gross Margin</div></div>
    <div class="ratio"><div class="rval">${data.netPct}</div><div class="rlbl">Net Margin</div></div>
    <div class="ratio"><div class="rval">${data.currentRatio}</div><div class="rlbl">Current Ratio</div></div>
    <div class="ratio"><div class="rval">${data.dso}</div><div class="rlbl">DSO</div></div>
  </div>
</div>

${recommendations ? `<div class="section">
  <h3>AI Analysis & Recommendations</h3>
  <div class="recs">${recommendations}</div>
</div>` : ''}

<div class="footer">
  <span>${data.firmName}</span>
  <span>Powered by Gnanova Pro Â· DEMO</span>
  <span>${today}</span>
</div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${data.clientName.replace(/\s+/g, '_')}_report.html`; a.click();
    toast({ title: 'Report downloaded', description: 'Open in browser and print to PDF' });
  };

  const openWhatsApp = () => {
    const msg = encodeURIComponent(`Hi, please find the financial report for ${data.clientName} (${data.period}) attached.\n\nRevenue: â‚¹${data.revenue} | Net Profit: â‚¹${data.netProfit} | GP: ${data.gpPct}\n\nPrepared by ${data.firmName} â€” Powered by Gnanova Pro`);
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">CA Firm Tools</p>
        <h1 className="text-2xl font-bold text-slate-900">Client Report Generator</h1>
        <p className="text-sm text-slate-500 mt-1">Generate a branded, professional financial report with AI commentary â€” ready to share.</p>
      </div>

      {/* Inputs */}
      <Card className="border border-slate-200">
        <CardContent className="p-5 space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <div><Label className="text-xs font-medium text-slate-600">Client Name</Label><Input className="mt-1" value={data.clientName} onChange={(e) => setData((s) => ({ ...s, clientName: e.target.value }))} /></div>
            <div><Label className="text-xs font-medium text-slate-600">Period</Label><Input className="mt-1" value={data.period} onChange={(e) => setData((s) => ({ ...s, period: e.target.value }))} /></div>
            <div><Label className="text-xs font-medium text-slate-600">Your Firm Name</Label><Input className="mt-1" value={data.firmName} onChange={(e) => setData((s) => ({ ...s, firmName: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              ['Revenue (â‚¹)', 'revenue'], ['Gross Profit (â‚¹)', 'grossProfit'],
              ['Net Profit (â‚¹)', 'netProfit'], ['Cash Balance (â‚¹)', 'cashBalance'],
              ['GP %', 'gpPct'], ['Net %', 'netPct'], ['Current Ratio', 'currentRatio'], ['DSO', 'dso'],
            ].map(([label, key]) => (
              <div key={key}>
                <Label className="text-xs font-medium text-slate-600">{label}</Label>
                <Input className="mt-1 text-sm" value={data[key as keyof ReportData]} onChange={(e) => setData((s) => ({ ...s, [key]: e.target.value }))} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={loadDemo}>Load Demo Data</Button>
        <Button onClick={generateReport} disabled={loading} className="gap-2 bg-amber-600 hover:bg-amber-700">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? 'Generating AI commentaryâ€¦' : 'Generate Report'}
        </Button>
      </div>

      {/* Preview */}
      {(reportReady || data.clientName) && (
        <Card className="border border-slate-200 overflow-hidden">
          {/* Cover */}
          <div className="bg-[#1e3a5f] text-white px-8 py-10">
            <p className="text-xs uppercase tracking-widest opacity-60 mb-6">Financial Report</p>
            <h2 className="text-3xl font-bold mb-2">{data.clientName}</h2>
            <p className="text-lg opacity-80 mb-6">{data.period}</p>
            <p className="text-sm opacity-60">Prepared by: {data.firmName}</p>
            <p className="text-sm opacity-60">Date: {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <p className="text-xs opacity-40 mt-4">Powered by Gnanova Pro</p>
          </div>

          <CardContent className="p-8 space-y-8">
            {/* KPIs */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#1e3a5f] mb-4">Executive Summary</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Revenue', value: `â‚¹${data.revenue}` },
                  { label: `Gross Profit (${data.gpPct})`, value: `â‚¹${data.grossProfit}` },
                  { label: `Net Profit (${data.netPct})`, value: `â‚¹${data.netProfit}` },
                  { label: 'Cash Balance', value: `â‚¹${data.cashBalance}` },
                ].map((k) => (
                  <div key={k.label} className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100">
                    <p className="text-xl font-bold text-[#1e3a5f]">{k.value}</p>
                    <p className="text-xs text-slate-500 mt-1">{k.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Ratios */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#1e3a5f] mb-4">Key Ratios</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Gross Margin', value: data.gpPct },
                  { label: 'Net Margin', value: data.netPct },
                  { label: 'Current Ratio', value: data.currentRatio },
                  { label: 'DSO', value: data.dso },
                ].map((r) => (
                  <div key={r.label} className="bg-emerald-50 rounded-xl p-4 text-center border border-emerald-100">
                    <p className="text-xl font-bold text-emerald-700">{r.value}</p>
                    <p className="text-xs text-emerald-600 mt-1">{r.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Recommendations */}
            {recommendations && (
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#1e3a5f] mb-4">
                  <Sparkles className="w-4 h-4 inline mr-1" />AI Analysis & Recommendations
                </h3>
                <div className="bg-blue-50/40 border border-blue-100 rounded-xl p-5 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {recommendations}
                </div>
              </div>
            )}

            {/* Footer actions */}
            <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-100">
              <Button onClick={downloadHTML} className="gap-2 bg-[#1e3a5f] hover:bg-[#1e3a5f]/90">
                <Download className="w-4 h-4" /> Download Report (HTMLâ†’PDF)
              </Button>
              <Button variant="outline" className="gap-2" onClick={openWhatsApp}>
                <Share2 className="w-4 h-4" /> Share via WhatsApp
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => toast({ title: 'Email', description: 'Connect email integration in Settings â†’ Integrations' })}>
                <Mail className="w-4 h-4" /> Email to Client
              </Button>
            </div>
            <p className="text-xs text-slate-400 text-center">Powered by Gnanova Pro Â· {data.firmName}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

