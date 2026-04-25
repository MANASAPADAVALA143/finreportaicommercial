import { useState } from 'react';
import { FileText, Play } from 'lucide-react';
import { FpaPageShell } from '../../components/fpa/FpaPageShell';
import { LoadingSpinner } from '../../components/fpa/LoadingSpinner';
import { ErrorBanner } from '../../components/fpa/ErrorBanner';
import { postFpaJson } from '../../lib/fpaApi';
import { downloadBase64Pdf } from '../../utils/fpaExport';

type BPRes = {
  executive_summary: string;
  html_preview: string;
  pdf_base64: string;
};

export default function BoardPack() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<BPRes | null>(null);
  const [form, setForm] = useState({
    company_name: 'FinReportAI Demo Ltd',
    period: 'Q1 2026',
    cfo_name: 'Alex CFO',
    key_message_1: 'Growth remains on plan.',
    key_message_2: 'Watch gross margin mix.',
    key_message_3: 'Liquidity is adequate under base case.',
    include_pl: true,
    include_cash: true,
    include_kpis: true,
    include_variance: true,
    include_forecast: true,
    include_risks: true,
    variance_summary: 'Marketing spend elevated vs budget; G&A controlled.',
    forecast_summary: 'Base case +12% YoY revenue with stable EBITDA margin.',
  });

  const run = async () => {
    setErr('');
    setLoading(true);
    try {
      const out = await postFpaJson<BPRes>('/api/reports/board-pack', form);
      setRes(out);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <FpaPageShell title="Board pack" subtitle="HTML preview · PDF (server)">
      <ErrorBanner message={err} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
          {(
            [
              ['company_name', 'Company'],
              ['period', 'Period'],
              ['cfo_name', 'CFO name'],
              ['key_message_1', 'Key message 1'],
              ['key_message_2', 'Key message 2'],
              ['key_message_3', 'Key message 3'],
              ['variance_summary', 'Variance summary'],
              ['forecast_summary', 'Forecast summary'],
            ] as const
          ).map(([k, lab]) => (
            <label key={k} className="block text-xs text-slate-300">
              {lab}
              <input
                className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                value={(form as any)[k]}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
              />
            </label>
          ))}
          {(
            [
              ['include_pl', 'P&L summary'],
              ['include_cash', 'Cash'],
              ['include_kpis', 'KPIs'],
              ['include_variance', 'Variance'],
              ['include_forecast', 'Forecast'],
              ['include_risks', 'Risks'],
            ] as const
          ).map(([k, lab]) => (
            <label key={k} className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={(form as any)[k]}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.checked }))}
              />
              {lab}
            </label>
          ))}
          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Generate
          </button>
          {loading ? <LoadingSpinner label="Generating pack…" /> : null}
          {res ? (
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800"
                onClick={() => downloadBase64Pdf(res.pdf_base64, `BoardPack_${form.period}.pdf`)}
              >
                <FileText className="h-4 w-4" />
                Download PDF
              </button>
              <span className="text-xs text-slate-500">PowerPoint export can be added via python-pptx later.</span>
            </div>
          ) : null}
        </div>
        <div className="min-h-[480px] rounded-xl border border-slate-700 bg-white">
          {res ? (
            <iframe title="Board pack preview" className="h-[720px] w-full rounded-xl" srcDoc={res.html_preview} />
          ) : (
            <div className="flex h-96 items-center justify-center text-slate-500">Preview appears here.</div>
          )}
        </div>
      </div>
      {res ? (
        <div className="mt-6 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
          <h3 className="font-semibold text-white">Executive summary</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{res.executive_summary}</p>
        </div>
      ) : null}
    </FpaPageShell>
  );
}
