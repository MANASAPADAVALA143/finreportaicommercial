/**
 * StatementViewer — enhanced IFRS statement display
 *
 * Features:
 *  • 4 KPI summary cards (Total Assets, Revenue, Net Profit, CT Liability)
 *  • 6-tab bar: P&L | Balance Sheet | Cash Flow | Equity | 🇦🇪 UAE CT | ✅ Compliance
 *  • Statement tables matching IFRS 16 design (section headers, indents, bold totals,
 *    parenthesis negatives, mono amounts)
 *  • UAE CT Bridge: interactive form → live calculation → structured output
 *  • Compliance panel: 20 checks from compliance_checker.py shown as pass/fail list
 *  • Per-tab export buttons: PDF | Excel | Word
 *  • Inline amount override (pencil icon on hover)
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  GeneratedStatementPayload,
  StatementLineItem,
  ifrsService,
} from "../../services/ifrs.service";
import { formatApiError } from "../../utils/apiError";

// ── Types ────────────────────────────────────────────────────────────────────

type Props = {
  statements: Record<string, GeneratedStatementPayload>;
  tbId?: number;
};

type CTBridgeResult = {
  ifrs_pbt: number;
  revenue: number;
  adjustments: {
    description: string;
    amount: number;
    add_back: boolean;
    note: string;
    ifrs_reference?: string;
  }[];
  total_add_backs: number;
  total_deductions: number;
  taxable_income: number;
  ct_rate_pct: number;
  ct_liability: number;
  effective_rate_pct: number;
  small_business_relief: boolean;
  free_zone_eligible: boolean;
  free_zone_note?: string;
  rate_note: string;
  currency: string;
};

type ComplianceCheck = {
  code: string;
  description: string;
  standard: string;
  result: "pass" | "fail" | "warning" | "not_applicable";
  severity: "critical" | "major" | "minor";
  details?: string;
  recommendation?: string;
};

type ComplianceSummary = {
  total: number;
  passed: number;
  failed: number;
  critical_failures: number;
  compliance_score: number;
  audit_ready: boolean;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const STATEMENT_TABS = [
  { key: "profit_loss",              emoji: "📊", label: "P&L" },
  { key: "financial_position",       emoji: "📋", label: "Balance Sheet" },
  { key: "cash_flows",               emoji: "💧", label: "Cash Flow" },
  { key: "equity",                   emoji: "📈", label: "Equity" },
  { key: "other_comprehensive_income", emoji: "📄", label: "OCI" },
] as const;

const EXTRA_TABS = [
  { key: "uae_ct",    emoji: "🇦🇪", label: "UAE CT" },
  { key: "compliance", emoji: "✅", label: "Compliance" },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function money(v: number): string {
  const abs = Math.abs(v);
  const formatted = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v < 0 ? `(${formatted})` : formatted;
}

function kpiMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

function findLine(
  items: StatementLineItem[],
  ...keywords: string[]
): number {
  for (const li of items) {
    const name = li.ifrs_line_item.toLowerCase();
    if (keywords.some((k) => name.includes(k.toLowerCase()))) return Number(li.amount || 0);
  }
  return 0;
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  currency,
  color,
  sub,
}: {
  label: string;
  value: number;
  currency: string;
  color: "blue" | "green" | "red" | "orange" | "emerald";
  sub?: string;
}) {
  const colorMap: Record<string, string> = {
    blue:    "from-blue-600 to-blue-700",
    green:   "from-emerald-600 to-emerald-700",
    red:     "from-red-500 to-red-600",
    orange:  "from-amber-500 to-amber-600",
    emerald: "from-teal-600 to-teal-700",
  };
  return (
    <div className={`rounded-xl bg-gradient-to-br ${colorMap[color]} p-4 text-white shadow`}>
      <p className="text-xs font-semibold uppercase tracking-widest opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold font-mono">
        {currency} {kpiMoney(value)}
      </p>
      {sub && <p className="mt-1 text-[11px] opacity-70">{sub}</p>}
    </div>
  );
}

// ── Statement Table ───────────────────────────────────────────────────────────

function StatementTable({
  payload,
  tbId,
}: {
  payload: GeneratedStatementPayload;
  tbId?: number;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const grouped = useMemo(() => {
    if (!payload?.line_items) return [];
    const sections: Record<string, StatementLineItem[]> = {};
    for (const li of payload.line_items) {
      if (!sections[li.ifrs_section]) sections[li.ifrs_section] = [];
      sections[li.ifrs_section].push(li);
    }
    return Object.entries(sections);
  }, [payload]);

  const handleSave = async (lineId: number) => {
    const parsed = parseFloat(editValue.replace(/[^0-9.\-]/g, ""));
    if (isNaN(parsed)) { setEditingId(null); return; }
    setSaving(true);
    try {
      await ifrsService.updateLineItem(lineId, parsed);
      toast.success("Amount updated");
      setEditingId(null);
    } catch (e) {
      toast.error(formatApiError(e) || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Statement header */}
      <div className="border-b border-gray-100 bg-gray-50 px-5 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500">
            Period: {payload.period_end ?? "—"} &nbsp;|&nbsp; Currency: {payload.currency}
          </p>
        </div>
        {payload.status === "draft" && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            DRAFT
          </span>
        )}
      </div>

      <table className="min-w-full text-sm">
        <tbody>
          {grouped.map(([section, lines]) => (
            <Fragment key={section}>
              {/* Section header */}
              <tr className="bg-gray-100">
                <td
                  className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-500"
                  colSpan={3}
                >
                  {section}
                </td>
              </tr>

              {lines
                .slice()
                .sort((a, b) => a.display_order - b.display_order)
                .map((line) => {
                  const amount = Number(line.amount || 0);
                  const isEditing = editingId === line.id;

                  return (
                    <tr
                      key={line.id}
                      className={
                        line.is_total
                          ? "border-y-2 border-gray-900 bg-gray-50"
                          : line.is_subtotal
                          ? "border-t border-gray-400"
                          : "border-t border-gray-100 hover:bg-blue-50/30"
                      }
                    >
                      {/* Label */}
                      <td
                        className={`py-2 pr-2 ${
                          line.is_total || line.is_subtotal
                            ? "font-bold text-gray-900"
                            : "font-normal text-gray-700"
                        }`}
                        style={{ paddingLeft: `${12 + (line.indent_level || 0) * 20}px` }}
                      >
                        {line.ifrs_line_item}
                        {line.is_manual_override && (
                          <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-700">
                            EDITED
                          </span>
                        )}
                      </td>

                      {/* Amount */}
                      <td
                        className={`py-2 pr-4 text-right font-mono ${
                          line.is_total || line.is_subtotal
                            ? "font-bold text-gray-900"
                            : amount < 0
                            ? "text-red-600"
                            : "text-gray-700"
                        }`}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className="w-32 rounded border border-blue-400 px-2 py-0.5 text-right font-mono text-sm outline-none"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => void handleSave(line.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void handleSave(line.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                        ) : (
                          money(amount)
                        )}
                      </td>

                      {/* Edit trigger */}
                      <td className="w-6 py-2 pr-2">
                        {tbId && !line.is_total && !line.is_subtotal && !isEditing && (
                          <button
                            title="Override amount"
                            onClick={() => {
                              setEditingId(line.id);
                              setEditValue(String(amount));
                            }}
                            className="invisible text-gray-300 hover:text-blue-500 group-hover:visible"
                          >
                            ✏️
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── UAE CT Bridge Panel ───────────────────────────────────────────────────────

function CTBridgePanel({ tbId, currency }: { tbId: number; currency: string }) {
  const [result, setResult] = useState<CTBridgeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({
    entertainment_expense: 0,
    fines_penalties: 0,
    non_business_expenses: 0,
    non_qualifying_depreciation: 0,
    dividend_income_uae_sub: 0,
    qualifying_capital_gains: 0,
    qualifying_free_zone_income: 0,
    is_free_zone_person: false,
    qualifying_income_pct: 100,
  });

  // Auto-load saved result on mount
  useEffect(() => {
    void (async () => {
      try {
        const saved = await ifrsService.getCTBridge(tbId);
        setResult(saved as unknown as CTBridgeResult);
        if (saved.inputs) {
          setInputs((prev) => ({ ...prev, ...(saved.inputs as object) }));
        }
      } catch {
        // No saved result yet — fine
      }
    })();
  }, [tbId]);

  const handleCalculate = async () => {
    setLoading(true);
    try {
      const res = await ifrsService.generateCTBridge(tbId, inputs);
      setResult(res);
      toast.success("UAE CT bridge calculated");
    } catch (e) {
      toast.error(formatApiError(e) || "CT bridge failed");
    } finally {
      setLoading(false);
    }
  };

  const field = (
    label: string,
    key: keyof typeof inputs,
    note?: string
  ) => (
    <div className="space-y-0.5">
      <label className="block text-xs font-medium text-gray-600">{label}</label>
      {note && <p className="text-[10px] text-gray-400">{note}</p>}
      <input
        type="number"
        min={0}
        value={inputs[key] as number}
        onChange={(e) =>
          setInputs((prev) => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))
        }
        className="w-full rounded border border-gray-200 px-2 py-1 text-right font-mono text-sm focus:border-blue-400 focus:outline-none"
        placeholder="0.00"
      />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Input Form */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-bold text-gray-900">
          🇦🇪 UAE Corporate Tax Bridge — Input Adjustments
        </h3>
        <p className="mb-4 text-xs text-gray-500">
          All amounts in {currency}. Leave at 0 if not applicable. IFRS PBT is auto-read from
          the generated P&amp;L statement.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
              ➕ Add back — Disallowed Expenses
            </p>
          </div>
          {field(
            "Entertainment & Hospitality",
            "entertainment_expense",
            "50% disallowed (Art. 32 UAE CT Law)"
          )}
          {field("Fines & Penalties", "fines_penalties", "100% disallowed")}
          {field("Non-business Expenses", "non_business_expenses", "100% disallowed")}
          {field(
            "Depreciation — Non-qualifying Assets",
            "non_qualifying_depreciation",
            "Non-business asset depreciation"
          )}

          <div className="sm:col-span-2 lg:col-span-3 pt-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              ➖ Deduct — Exempt Income
            </p>
          </div>
          {field(
            "Dividends from UAE Subsidiaries",
            "dividend_income_uae_sub",
            "Participation Exemption (Art. 23)"
          )}
          {field(
            "Qualifying Capital Gains",
            "qualifying_capital_gains",
            "Disposal of qualifying participations"
          )}
          {field(
            "Qualifying Free Zone Income",
            "qualifying_free_zone_income",
            "Only if Free Zone Person (Art. 18)"
          )}

          <div className="sm:col-span-2 lg:col-span-3 pt-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
              🏢 Free Zone Status
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="fz_person"
              checked={inputs.is_free_zone_person}
              onChange={(e) =>
                setInputs((prev) => ({ ...prev, is_free_zone_person: e.target.checked }))
              }
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <label htmlFor="fz_person" className="text-sm font-medium text-gray-700">
              Qualifying Free Zone Person
            </label>
          </div>
          {inputs.is_free_zone_person && (
            <div className="space-y-0.5">
              <label className="block text-xs font-medium text-gray-600">
                Qualifying Income % (need ≥ 95%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={inputs.qualifying_income_pct}
                onChange={(e) =>
                  setInputs((prev) => ({
                    ...prev,
                    qualifying_income_pct: parseFloat(e.target.value) || 0,
                  }))
                }
                className="w-full rounded border border-gray-200 px-2 py-1 text-right font-mono text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
          )}
        </div>

        <button
          onClick={handleCalculate}
          disabled={loading}
          className="mt-5 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {loading ? "Calculating…" : "🇦🇪 Calculate UAE CT"}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-bold text-gray-900">
            UAE Corporate Tax Calculation — {result.currency}
          </h3>

          <table className="min-w-full text-sm">
            <tbody>
              {/* PBT */}
              <tr className="border-b border-gray-100">
                <td className="py-2 font-medium text-gray-800">IFRS Net Profit Before Tax</td>
                <td className="py-2 text-right font-mono font-medium text-gray-900">
                  {money(result.ifrs_pbt)}
                </td>
              </tr>

              {/* Adjustments */}
              {result.adjustments.map((adj, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 pl-6 text-gray-600">
                    {adj.add_back ? (
                      <span className="mr-1 text-amber-500 font-bold">+</span>
                    ) : (
                      <span className="mr-1 text-emerald-500 font-bold">−</span>
                    )}
                    {adj.description}
                    {adj.ifrs_reference && (
                      <span className="ml-2 rounded bg-gray-100 px-1 text-[9px] text-gray-500">
                        {adj.ifrs_reference}
                      </span>
                    )}
                  </td>
                  <td
                    className={`py-1.5 text-right font-mono text-sm ${
                      adj.add_back ? "text-amber-700" : "text-emerald-700"
                    }`}
                  >
                    {adj.add_back ? "" : "("}
                    {money(adj.amount)}
                    {adj.add_back ? "" : ")"}
                  </td>
                </tr>
              ))}

              {/* Taxable income */}
              <tr className="border-y-2 border-gray-700 bg-blue-50">
                <td className="py-2 font-bold text-gray-900">Taxable Income</td>
                <td className="py-2 text-right font-mono font-bold text-gray-900">
                  {money(result.taxable_income)}
                </td>
              </tr>

              {/* CT rate row */}
              <tr className="border-b border-gray-100">
                <td className="py-2 text-gray-700">
                  UAE Corporate Tax @ {result.ct_rate_pct.toFixed(0)}%
                </td>
                <td className="py-2 text-right font-mono text-gray-900">
                  {money(result.ct_liability)}
                </td>
              </tr>

              {/* CT liability total */}
              <tr className="border-y-2 border-gray-900 bg-gray-50">
                <td className="py-2 font-bold text-gray-900">CT Liability</td>
                <td className="py-2 text-right font-mono font-bold text-blue-700">
                  {result.currency} {money(result.ct_liability)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Status badges */}
          <div className="mt-4 flex flex-wrap gap-2">
            {result.small_business_relief && (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                ✅ Small Business Relief — 0% CT
              </span>
            )}
            {result.free_zone_eligible && (
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                ✅ Qualifying Free Zone — 0% CT
              </span>
            )}
            {!result.small_business_relief && !result.free_zone_eligible && (
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                Standard Rate: 9%
              </span>
            )}
            {result.effective_rate_pct !== undefined && (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                Effective Rate: {result.effective_rate_pct.toFixed(1)}%
              </span>
            )}
          </div>

          {/* Rate note */}
          <p className="mt-3 text-xs italic text-gray-500">{result.rate_note}</p>
          {result.free_zone_note && (
            <p className="mt-1 text-xs italic text-blue-600">{result.free_zone_note}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Compliance Panel ──────────────────────────────────────────────────────────

function CompliancePanel({ tbId }: { tbId: number }) {
  const [checks, setChecks] = useState<ComplianceCheck[]>([]);
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const runChecks = async () => {
    setLoading(true);
    try {
      const res = await ifrsService.runComplianceCheck(tbId);
      setChecks(res.checks as ComplianceCheck[]);
      setSummary(res.summary);
      setLoaded(true);
    } catch (e) {
      toast.error(formatApiError(e) || "Compliance check failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const res = await ifrsService.getComplianceResults(tbId);
        if (res.checks?.length) {
          setChecks(res.checks as ComplianceCheck[]);
          setSummary(res.summary);
          setLoaded(true);
        }
      } catch {
        // not yet run
      }
    })();
  }, [tbId]);

  const resultIcon = (r: string) =>
    r === "pass" ? "✅" : r === "warning" ? "⚠️" : r === "not_applicable" ? "➖" : "❌";

  const severityColor = (s: string, r: string) => {
    if (r === "pass") return "text-emerald-700";
    if (r === "not_applicable") return "text-gray-400";
    if (s === "critical") return "text-red-700 font-semibold";
    if (s === "major") return "text-orange-700";
    return "text-amber-600";
  };

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-emerald-50 p-3 text-center">
            <p className="text-xl font-bold text-emerald-700">{summary.passed}</p>
            <p className="text-xs text-gray-500">Passed</p>
          </div>
          <div className="rounded-lg border bg-red-50 p-3 text-center">
            <p className="text-xl font-bold text-red-700">{summary.failed}</p>
            <p className="text-xs text-gray-500">Failed</p>
          </div>
          <div className="rounded-lg border bg-blue-50 p-3 text-center">
            <p className="text-xl font-bold text-blue-700">{summary.compliance_score.toFixed(0)}%</p>
            <p className="text-xs text-gray-500">Score</p>
          </div>
          <div className="rounded-lg border bg-gray-50 p-3 text-center">
            <p className="text-xl font-bold text-gray-700">
              {summary.audit_ready ? "✅" : "❌"}
            </p>
            <p className="text-xs text-gray-500">Audit Ready</p>
          </div>
        </div>
      )}

      {/* Run button */}
      <button
        onClick={runChecks}
        disabled={loading}
        className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
      >
        {loading ? "Running checks…" : loaded ? "🔄 Re-run Compliance" : "▶ Run 20 IFRS Checks"}
      </button>

      {/* Checks list */}
      {checks.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 w-8">
                  #
                </th>
                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Check
                </th>
                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Standard
                </th>
                <th className="px-4 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-gray-500 w-20">
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c, i) => (
                <Fragment key={c.code}>
                  <tr className={`border-b ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                    <td className="px-4 py-2 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2">
                      <p className={`text-sm ${severityColor(c.severity, c.result)}`}>
                        {c.description}
                      </p>
                      {c.details && c.result !== "pass" && (
                        <p className="mt-0.5 text-[11px] text-gray-500">{c.details}</p>
                      )}
                      {c.recommendation && c.result !== "pass" && (
                        <p className="mt-0.5 text-[11px] text-blue-600 italic">{c.recommendation}</p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-gray-400">{c.standard}</td>
                    <td className="px-4 py-2 text-center">
                      <span className="text-base">{resultIcon(c.result)}</span>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loaded && !loading && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
          Click "Run 20 IFRS Checks" to validate your financial statements against IFRS standards.
        </div>
      )}
    </div>
  );
}

// ── Export Buttons ────────────────────────────────────────────────────────────

function ExportBar({ tbId }: { tbId: number }) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleExport = (format: "excel" | "pdf" | "word") => {
    setLoading(format);
    try {
      ifrsService.downloadExport(tbId, format);
      toast.success(`${format.toUpperCase()} download started`);
    } catch (e) {
      toast.error(formatApiError(e) || "Export failed");
    } finally {
      setTimeout(() => setLoading(null), 1500);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => handleExport("excel")}
        disabled={loading === "excel"}
        className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
      >
        📊 {loading === "excel" ? "Preparing…" : "Excel"}
      </button>
      <button
        onClick={() => handleExport("pdf")}
        disabled={loading === "pdf"}
        className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
      >
        📄 {loading === "pdf" ? "Preparing…" : "PDF"}
      </button>
      <button
        onClick={() => handleExport("word")}
        disabled={loading === "word"}
        className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50"
      >
        📝 {loading === "word" ? "Preparing…" : "Word"}
      </button>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function StatementViewer({ statements, tbId }: Props) {
  const statementTabs = STATEMENT_TABS.filter((t) => statements[t.key]);
  const allTabs = [
    ...statementTabs,
    ...(tbId ? EXTRA_TABS : []),
  ];

  const [activeTab, setActiveTab] = useState<string>(
    statementTabs[0]?.key ?? "profit_loss"
  );

  // ── KPI derivation ────────────────────────────────────────────────────────
  const { totalAssets, revenue, netProfit, currency } = useMemo(() => {
    const fp = statements["financial_position"];
    const pl = statements["profit_loss"];

    const fpItems = fp?.line_items ?? [];
    const plItems = pl?.line_items ?? [];

    const totalAssets = findLine(fpItems, "TOTAL ASSETS");
    const revenue = findLine(plItems, "TOTAL REVENUE", "revenue from contracts");
    const netProfit = findLine(plItems, "PROFIT FOR THE PERIOD", "profit after tax", "pat");

    const currency = fp?.currency ?? pl?.currency ?? "AED";
    return { totalAssets, revenue, netProfit, currency };
  }, [statements]);

  const [ctLiability, setCtLiability] = useState<number>(0);

  useEffect(() => {
    if (!tbId) return;
    void (async () => {
      try {
        const saved = await ifrsService.getCTBridge(tbId);
        setCtLiability(saved.ct_liability ?? 0);
      } catch {
        // no CT bridge yet
      }
    })();
  }, [tbId]);

  const currentPayload = statements[activeTab];

  if (!Object.keys(statements).length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-400">
        No statements generated yet. Click "Generate IFRS Statements" above.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Total Assets"
          value={totalAssets}
          currency={currency}
          color="blue"
        />
        <KpiCard
          label="Total Revenue"
          value={revenue}
          currency={currency}
          color="emerald"
        />
        <KpiCard
          label="Net Profit"
          value={netProfit}
          currency={currency}
          color={netProfit >= 0 ? "green" : "red"}
          sub={netProfit < 0 ? "Loss for period" : undefined}
        />
        <KpiCard
          label="UAE CT Liability"
          value={ctLiability}
          currency={currency}
          color="orange"
          sub={ctLiability === 0 ? "Not yet calculated" : "9% standard rate"}
        />
      </div>

      {/* Tab bar + Export */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {allTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === tab.key
                  ? "bg-blue-600 text-white shadow"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.emoji} {tab.label}
            </button>
          ))}
        </div>
        {tbId && <ExportBar tbId={tbId} />}
      </div>

      {/* Tab content */}
      {activeTab === "uae_ct" && tbId ? (
        <CTBridgePanel tbId={tbId} currency={currency} />
      ) : activeTab === "compliance" && tbId ? (
        <CompliancePanel tbId={tbId} />
      ) : currentPayload ? (
        <div className="space-y-2">
          {/* Statement sub-header */}
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">
              {allTabs.find((t) => t.key === activeTab)?.emoji}{" "}
              {
                {
                  profit_loss: "Profit & Loss Statement",
                  financial_position: "Statement of Financial Position",
                  cash_flows: "Statement of Cash Flows",
                  equity: "Statement of Changes in Equity",
                  other_comprehensive_income: "Other Comprehensive Income",
                }[activeTab] ?? activeTab
              }
            </h2>
          </div>
          <StatementTable payload={currentPayload} tbId={tbId} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-400">
          No data for this statement type.
        </div>
      )}
    </div>
  );
}
