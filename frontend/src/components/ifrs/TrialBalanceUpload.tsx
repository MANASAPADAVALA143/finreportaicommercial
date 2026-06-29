import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { Upload, FileSpreadsheet, Sparkles } from "lucide-react";
import { ifrsService } from "../../services/ifrs.service";
import { formatApiError } from "../../utils/apiError";
import { useSyncIfrsTenant } from "../../hooks/useSyncIfrsTenant";

export const SAMPLE_TB_FILENAME = "sample-trial-balance.csv";
export const SAMPLE_TB_COMPANY_NAME = "[SAMPLE] Prism Manufacturing Demo";

type PreviewRow = { gl_code: string; gl_description: string; debit: number; credit: number };

type Props = {
  onUploaded: (trialBalanceId: number) => void;
};

function normalize(row: Record<string, unknown>): PreviewRow | null {
  const keys = Object.keys(row);
  const pick = (...names: string[]) => {
    for (const n of names) {
      const k = keys.find((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "") === n);
      if (k) return row[k];
    }
    return undefined;
  };
  const code = pick("glcode", "accountcode", "code");
  const desc = pick("gldescription", "accountname", "description", "name");
  const dr = pick("debit", "dr", "debitamount", "debitlakhs", "debitinrlakhs");
  const cr = pick("credit", "cr", "creditamount", "creditlakhs", "creditinrlakhs");
  if (!code || !desc) return null;
  return {
    gl_code: String(code),
    gl_description: String(desc),
    debit: Number(dr || 0),
    credit: Number(cr || 0),
  };
}

export default function TrialBalanceUpload({ onUploaded }: Props) {
  useSyncIfrsTenant();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [summary, setSummary] = useState<{ lines: number; id: number } | null>(null);

  const accepted = useMemo(
    () =>
      "Expected: gl_code, gl_description, debit, credit — or account_code, account_name, dr/cr; Debit (₹ Lakhs) / Credit (₹ Lakhs) OK",
    []
  );

  const parsePreview = async (f: File) => {
    const ab = await f.arrayBuffer();
    const wb = XLSX.read(ab);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
    const mapped = rows.map(normalize).filter(Boolean) as PreviewRow[];
    setPreview(mapped.slice(0, 10));
  };

  const onFile = async (f: File | null) => {
    if (!f) return;
    setFile(f);
    try {
      await parsePreview(f);
    } catch {
      setPreview([]);
    }
  };

  const upload = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const res = await ifrsService.uploadTrialBalance(file, "FinReport AI");
      setSummary({ lines: res.lines_count, id: res.trial_balance_id });
      toast.success("Trial balance uploaded. AI mapping started.");
      onUploaded(res.trial_balance_id);
    } catch (e: unknown) {
      toast.error(formatApiError(e) || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const uploadSampleData = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/${SAMPLE_TB_FILENAME}`);
      if (!response.ok) {
        throw new Error("Sample trial balance file not found in /public");
      }
      const blob = await response.blob();
      const sampleFile = new File([blob], SAMPLE_TB_FILENAME, { type: "text/csv" });
      setFile(sampleFile);
      await parsePreview(sampleFile);
      const res = await ifrsService.uploadTrialBalance(sampleFile, SAMPLE_TB_COMPANY_NAME);
      setSummary({ lines: res.lines_count, id: res.trial_balance_id });
      toast.success("Sample trial balance uploaded via server pipeline. AI mapping started.");
      onUploaded(res.trial_balance_id);
    } catch (e: unknown) {
      toast.error(formatApiError(e) || "Sample upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0] || null;
          void onFile(f);
        }}
      >
        <Upload className="mx-auto mb-3 h-9 w-9 text-slate-500" />
        <p className="text-sm text-slate-700">Drag and drop CSV/Excel here</p>
        <p className="mt-1 text-xs text-slate-500">{accepted}</p>
        <input
          className="mx-auto mt-3 block text-sm"
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => void onFile(e.target.files?.[0] || null)}
        />
        <div className="mt-4 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={() => void uploadSampleData()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {loading ? "Uploading sample…" : "Use sample data"}
          </button>
          <p className="mt-2 text-xs text-slate-500">
            Uploads <span className="font-mono">{SAMPLE_TB_FILENAME}</span> through the real server pipeline
            (tagged <span className="font-mono">{SAMPLE_TB_COMPANY_NAME}</span>)
          </p>
        </div>
      </div>

      {file && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
            <FileSpreadsheet className="h-4 w-4" /> {file.name}
          </div>
          <button
            onClick={upload}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Uploading..." : "Upload and Start AI Mapping"}
          </button>
        </div>
      )}

      {summary && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
          ✅ {summary.lines} GL accounts uploaded | AI Mapping in progress... (TB #{summary.id})
        </div>
      )}

      {preview.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">GL Code</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={`${r.gl_code}-${i}`} className="border-t">
                  <td className="px-3 py-2">{r.gl_code}</td>
                  <td className="px-3 py-2">{r.gl_description}</td>
                  <td className="px-3 py-2 text-right">{r.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2 text-right">{r.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

