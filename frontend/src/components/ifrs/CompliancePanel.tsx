import { useMemo, useState } from "react";

export type ComplianceRow = {
  code: string;
  description: string;
  standard: string;
  result: string;
  severity: string;
  details?: string | null;
  recommendation?: string | null;
};

export type ComplianceSummary = {
  total: number;
  passed: number;
  failed: number;
  critical_failures: number;
  compliance_score: number;
  audit_ready: boolean;
};

type Props = {
  checks: ComplianceRow[];
  summary: ComplianceSummary | null;
  loading?: boolean;
  onRunCheck: () => void;
};

function badgeClass(result: string): string {
  if (result === "pass") return "bg-emerald-100 text-emerald-800";
  if (result === "fail") return "bg-red-100 text-red-800";
  if (result === "not_applicable") return "bg-slate-100 text-slate-600";
  if (result === "warning") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}

export default function CompliancePanel({ checks, summary, loading, onRunCheck }: Props) {
  const [filter, setFilter] = useState<"all" | "passed" | "failed" | "critical">("all");

  const filtered = useMemo(() => {
    return checks.filter((c) => {
      if (filter === "passed") return c.result === "pass" || c.result === "not_applicable";
      if (filter === "failed") return c.result === "fail";
      if (filter === "critical") return c.result === "fail" && c.severity === "critical";
      return true;
    });
  }, [checks, filter]);

  const pct = summary ? Math.min(100, Math.max(0, summary.compliance_score)) : 0;

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-900">Compliance checks</h3>
        <button
          type="button"
          disabled={loading}
          onClick={() => onRunCheck()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "Running…" : "Run compliance check"}
        </button>
      </div>

      {summary && (
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-800">
            <span>Compliance score</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-600">
            {summary.passed} passed · {summary.failed} failed · {summary.critical_failures} critical failures
            {summary.audit_ready ? " · Audit-ready threshold met" : " · Review required"}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(["all", "passed", "failed", "critical"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
              filter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs font-bold uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2">Standard</th>
              <th className="px-3 py-2">Check</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No checks yet. Run a compliance check.
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.code} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{c.standard}</td>
                  <td className="px-3 py-2 text-slate-900">{c.description}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${badgeClass(c.result)}`}>
                      {c.result}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{c.severity}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-xs text-slate-500" title={c.details || c.recommendation || ""}>
                    {c.details || c.recommendation || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
